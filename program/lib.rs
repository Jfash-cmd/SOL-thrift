use anchor_lang::prelude::*;
use anchor_spl::token::{self, Mint, Token, TokenAccount, Transfer};

declare_id!("Fg6PaFpoGXkYsidMpWTK6W2BeZ7FEfcYkg476zPFsLnS");

// ============================================================================
// CONSTANTS & ACCOUNT SPACE SIZING (Section 3)
// ============================================================================

/// Exact account space for Circle:
/// 8 (discriminator)
/// + 32 (creator)
/// + 8 (circle_id)
/// + 32 (token_mint)
/// + 32 (vault)
/// + 1 (bump)
/// + 1 (vault_bump)
/// + 1 (status: CircleStatus)
/// + 1 (members_target)
/// + 1 (current_member_count)
/// + 1 (active_member_count)
/// + 1 (contributions_this_period)
/// + 8 (contribution)
/// + 1 (deposit_pct)
/// + 8 (period_duration)
/// + 8 (grace_duration)
/// + 8 (fill_window_duration)
/// + 1 (min_members)
/// + 1 (current_period)
/// + 8 (period_start_time)
/// + 320 (members: [Pubkey; 10])
/// + 10 (payout_order: [u8; 10])
/// = 492 bytes
pub const CIRCLE_SPACE: usize = 8
    + 32
    + 8
    + 32
    + 32
    + 1
    + 1
    + 1
    + 1
    + 1
    + 1
    + 1
    + 8
    + 1
    + 8
    + 8
    + 8
    + 1
    + 1
    + 8
    + (32 * 10)
    + 10;

/// Exact account space for Member:
/// 8 (discriminator)
/// + 32 (circle)
/// + 32 (wallet)
/// + 1 (slot)
/// + 8 (deposit_remaining)
/// + 1 (has_been_paid)
/// + 1 (last_contributed_period)
/// + 1 (status: MemberStatus)
/// + 1 (bump)
/// = 85 bytes
pub const MEMBER_SPACE: usize = 8 + 32 + 32 + 1 + 8 + 1 + 1 + 1 + 1;

// ============================================================================
// PROGRAM INSTRUCTIONS
// ============================================================================

#[program]
pub mod solthrift {
    use super::*;

    // Spec Section 5, Instruction 1: create_circle
    pub fn create_circle(
        ctx: Context<CreateCircle>,
        circle_id: u64,
        members: u8,
        contribution: u64,
        deposit_pct: u8,
        period_duration: i64,
        grace_duration: i64,
        fill_window_duration: i64,
    ) -> Result<()> {
        // --- Section 2 & Section 7 Parameter Validations ---
        require!(
            members >= 3 && members <= 10,
            SolthriftError::InvalidMemberCount
        );
        require!(
            deposit_pct >= 25 && deposit_pct <= 100,
            SolthriftError::InvalidDepositPercentage
        );
        require!(
            period_duration > 0,
            SolthriftError::InvalidPeriodDuration
        );
        require!(
            grace_duration >= 0,
            SolthriftError::InvalidGraceDuration
        );

        // Section 7 Invariant: Contribution is never below 5 whole tokens.
        // Computed from the mint's decimals: 5 * 10^(decimals)
        let decimals_factor = 10u64
            .checked_pow(ctx.accounts.token_mint.decimals as u32)
            .ok_or(SolthriftError::MathOverflow)?;
        let min_contribution = 5u64
            .checked_mul(decimals_factor)
            .ok_or(SolthriftError::MathOverflow)?;
        require!(
            contribution >= min_contribution,
            SolthriftError::ContributionTooLow
        );

        // Calculate slot-1 deposit per Section 6 formula:
        // max(deposit_pct * (N - k) * c / 100, c), rounded UP (k = 1)
        let slot_1_deposit = calculate_deposit(deposit_pct, members, 1, contribution)?;

        // Transfer creator's slot-1 deposit from their token account to the vault
        let cpi_accounts = Transfer {
            from: ctx.accounts.creator_token_account.to_account_info(),
            to: ctx.accounts.vault.to_account_info(),
            authority: ctx.accounts.creator.to_account_info(),
        };
        let cpi_program = ctx.accounts.token_program.to_account_info();
        token::transfer(CpiContext::new(cpi_program, cpi_accounts), slot_1_deposit)?;

        // Initialize Circle PDA state
        let circle = &mut ctx.accounts.circle;
        circle.creator = ctx.accounts.creator.key();
        circle.circle_id = circle_id;
        circle.token_mint = ctx.accounts.token_mint.key();
        circle.vault = ctx.accounts.vault.key();
        circle.bump = ctx.bumps.circle;
        circle.vault_bump = ctx.bumps.vault;
        circle.status = CircleStatus::Open;
        circle.members_target = members;
        circle.current_member_count = 1;
        circle.active_member_count = 1;
        circle.contributions_this_period = 0;
        circle.contribution = contribution;
        circle.deposit_pct = deposit_pct;
        circle.period_duration = period_duration;
        circle.grace_duration = grace_duration;
        circle.fill_window_duration = if fill_window_duration > 0 {
            fill_window_duration
        } else {
            172_800 // Default to 2 days (Section 2)
        };
        circle.min_members = 3;
        circle.current_period = 0; // 0 while Open; starts at 1 when Active
        circle.period_start_time = 0;

        // Initialize fixed-size 10-slot member list & payout order (join order = 1..N)
        circle.members = [Pubkey::default(); 10];
        circle.members[0] = ctx.accounts.creator.key();
        circle.payout_order = [0u8; 10];
        circle.payout_order[0] = 1;

        // Initialize Member PDA for the creator (Slot 1)
        let creator_member = &mut ctx.accounts.creator_member;
        creator_member.circle = circle.key();
        creator_member.wallet = ctx.accounts.creator.key();
        creator_member.slot = 1;
        creator_member.deposit_remaining = slot_1_deposit;
        creator_member.has_been_paid = false;
        creator_member.last_contributed_period = 0; // 0 = never
        creator_member.status = MemberStatus::Active;
        creator_member.bump = ctx.bumps.creator_member;

        // Emit Section 8 Events
        emit!(CircleCreated {
            circle: circle.key(),
            creator: ctx.accounts.creator.key(),
            circle_id,
            token_mint: ctx.accounts.token_mint.key(),
            vault: ctx.accounts.vault.key(),
            members_target: members,
            contribution,
            deposit_pct,
            period_duration,
            grace_duration,
        });

        emit!(MemberJoined {
            circle: circle.key(),
            member: creator_member.key(),
            wallet: ctx.accounts.creator.key(),
            slot: 1,
            deposit_paid: slot_1_deposit,
        });

        Ok(())
    }

    // Spec Section 5, Instruction 2: join_circle
    pub fn join_circle(ctx: Context<JoinCircle>) -> Result<()> {
        let circle = &mut ctx.accounts.circle;

        // Circle must be Open to join
        require!(
            circle.status == CircleStatus::Open,
            SolthriftError::CircleNotOpen
        );
        require!(
            circle.current_member_count < circle.members_target,
            SolthriftError::CircleFull
        );

        let member_wallet_key = ctx.accounts.member_wallet.key();

        // Ensure wallet has not already joined this circle
        for existing in circle.members.iter().take(circle.current_member_count as usize) {
            require_keys_neq!(
                *existing,
                member_wallet_key,
                SolthriftError::MemberAlreadyJoined
            );
        }

        // Slot number k is 1-indexed (2 to N)
        let slot = circle
            .current_member_count
            .checked_add(1)
            .ok_or(SolthriftError::MathOverflow)?;

        // Calculate slot deposit per Section 6
        let deposit = calculate_deposit(
            circle.deposit_pct,
            circle.members_target,
            slot,
            circle.contribution,
        )?;

        // Transfer deposit from joining member's token account to the vault
        let cpi_accounts = Transfer {
            from: ctx.accounts.member_token_account.to_account_info(),
            to: ctx.accounts.vault.to_account_info(),
            authority: ctx.accounts.member_wallet.to_account_info(),
        };
        let cpi_program = ctx.accounts.token_program.to_account_info();
        token::transfer(CpiContext::new(cpi_program, cpi_accounts), deposit)?;

        // Initialize Member PDA
        let member = &mut ctx.accounts.member;
        member.circle = circle.key();
        member.wallet = member_wallet_key;
        member.slot = slot;
        member.deposit_remaining = deposit;
        member.has_been_paid = false;
        member.last_contributed_period = 0; // 0 = never
        member.status = MemberStatus::Active;
        member.bump = ctx.bumps.member;

        // Update Circle state
        let slot_idx = (slot - 1) as usize;
        circle.members[slot_idx] = member_wallet_key;
        circle.payout_order[slot_idx] = slot;
        circle.current_member_count = slot;
        circle.active_member_count = circle
            .active_member_count
            .checked_add(1)
            .ok_or(SolthriftError::MathOverflow)?;

        // Section 5, item 2: When N members have joined, circle becomes Active automatically
        let mut round_activated = false;
        if circle.current_member_count == circle.members_target {
            circle.status = CircleStatus::Active;
            circle.current_period = 1;
            circle.period_start_time = Clock::get()?.unix_timestamp;
            circle.contributions_this_period = 0;
            round_activated = true;
        }

        // Emit Section 8 Events
        emit!(MemberJoined {
            circle: circle.key(),
            member: member.key(),
            wallet: member_wallet_key,
            slot,
            deposit_paid: deposit,
        });

        if round_activated {
            emit!(RoundStarted {
                circle: circle.key(),
                current_period: 1,
                period_start_time: circle.period_start_time,
            });
        }

        Ok(())
    }

    // Spec Section 5, Instruction 3: contribute
    pub fn contribute(ctx: Context<Contribute>) -> Result<()> {
        let circle = &mut ctx.accounts.circle;
        let member = &mut ctx.accounts.member;

        // Circle must be Active
        require!(
            circle.status == CircleStatus::Active,
            SolthriftError::CircleNotActive
        );

        // Member must be active
        require!(
            member.status == MemberStatus::Active,
            SolthriftError::MemberNotActive
        );

        // Member must not have contributed for this period already
        require!(
            member.last_contributed_period != circle.current_period,
            SolthriftError::AlreadyContributedThisPeriod
        );

        // Must be before period_start_time + period_duration + grace_duration
        let now = Clock::get()?.unix_timestamp;
        let deadline_with_grace = circle
            .period_start_time
            .checked_add(circle.period_duration)
            .ok_or(SolthriftError::MathOverflow)?
            .checked_add(circle.grace_duration)
            .ok_or(SolthriftError::MathOverflow)?;
        require!(
            now <= deadline_with_grace,
            SolthriftError::ContributionWindowClosed
        );

        // Transfer exactly `contribution` from member's token account into the vault
        let cpi_accounts = Transfer {
            from: ctx.accounts.member_token_account.to_account_info(),
            to: ctx.accounts.vault.to_account_info(),
            authority: ctx.accounts.member_wallet.to_account_info(),
        };
        let cpi_program = ctx.accounts.token_program.to_account_info();
        token::transfer(CpiContext::new(cpi_program, cpi_accounts), circle.contribution)?;

        // Update member contribution record
        member.last_contributed_period = circle.current_period;

        // Add 1 to circle contributions_this_period
        circle.contributions_this_period = circle
            .contributions_this_period
            .checked_add(1)
            .ok_or(SolthriftError::MathOverflow)?;

        // Emit Section 8 contributed event
        emit!(Contributed {
            circle: circle.key(),
            member: member.key(),
            wallet: ctx.accounts.member_wallet.key(),
            period: circle.current_period,
            amount: circle.contribution,
            timestamp: now,
        });

        Ok(())
    }

    // Spec Section 5, Instruction 4: payout
    pub fn payout(ctx: Context<Payout>) -> Result<()> {
        let circle = &mut ctx.accounts.circle;
        let recipient_member = &mut ctx.accounts.recipient_member;

        // Circle must be Active
        require!(
            circle.status == CircleStatus::Active,
            SolthriftError::CircleNotActive
        );

        // Allowed only when contributions_this_period == active_member_count
        require!(
            circle.contributions_this_period == circle.active_member_count,
            SolthriftError::ContributionsIncomplete
        );

        // Period bounds check
        require!(
            circle.current_period >= 1 && (circle.current_period as usize) <= circle.payout_order.len(),
            SolthriftError::InvalidPeriod
        );

        // Recipient slot is payout_order[current_period - 1]
        let current_period_idx = (circle.current_period as usize)
            .checked_sub(1)
            .ok_or(SolthriftError::MathOverflow)?;
        let recipient_slot = circle.payout_order[current_period_idx];

        // Verify that the recipient Member account matches that slot
        require!(
            recipient_member.slot == recipient_slot,
            SolthriftError::RecipientSlotMismatch
        );

        // Verify recipient Member wallet matches the registered slot wallet in Circle
        let slot_idx = (recipient_slot as usize)
            .checked_sub(1)
            .ok_or(SolthriftError::MathOverflow)?;
        require_keys_eq!(
            recipient_member.wallet,
            circle.members[slot_idx],
            SolthriftError::RecipientWalletMismatch
        );

        // Verify recipient is active and has not been paid yet
        require!(
            recipient_member.status == MemberStatus::Active,
            SolthriftError::RecipientNotActive
        );
        require!(
            !recipient_member.has_been_paid,
            SolthriftError::RecipientAlreadyPaid
        );

        // Pot calculation: exactly contribution * active_member_count.
        // Never pays out deposits - transfers only the contributions collected this period.
        let pot_amount = circle
            .contribution
            .checked_mul(circle.active_member_count as u64)
            .ok_or(SolthriftError::MathOverflow)?;

        // Ensure vault has sufficient funds to cover the pot payout
        require!(
            ctx.accounts.vault.amount >= pot_amount,
            SolthriftError::InsufficientVaultFunds
        );

        // Transfer pot_amount from vault to recipient's token account, signed by Circle PDA seeds
        let creator_key = circle.creator;
        let circle_id_bytes = circle.circle_id.to_le_bytes();
        let bump = circle.bump;
        let signer_seeds: &[&[&[u8]]] = &[&[
            b"circle",
            creator_key.as_ref(),
            circle_id_bytes.as_ref(),
            &[bump],
        ]];

        let cpi_accounts = Transfer {
            from: ctx.accounts.vault.to_account_info(),
            to: ctx.accounts.recipient_token_account.to_account_info(),
            authority: circle.to_account_info(),
        };
        let cpi_program = ctx.accounts.token_program.to_account_info();
        token::transfer(
            CpiContext::new_with_signer(cpi_program, cpi_accounts, signer_seeds),
            pot_amount,
        )?;

        // Mark recipient as paid
        recipient_member.has_been_paid = true;

        // Reset contributions_this_period to 0
        circle.contributions_this_period = 0;

        let now = Clock::get()?.unix_timestamp;
        let paid_period = circle.current_period;

        // If this was the last period (current_period == members_target),
        // set status to Filling instead and record the time.
        // Otherwise, add 1 to current_period and set period_start_time to now.
        if circle.current_period == circle.members_target {
            circle.status = CircleStatus::Filling;
            circle.period_start_time = now;
        } else {
            circle.current_period = circle
                .current_period
                .checked_add(1)
                .ok_or(SolthriftError::MathOverflow)?;
            circle.period_start_time = now;
        }

        // Emit Section 8 paid_out event
        emit!(PaidOut {
            circle: circle.key(),
            recipient_member: recipient_member.key(),
            recipient_wallet: recipient_member.wallet,
            slot: recipient_slot,
            period: paid_period,
            amount: pot_amount,
            timestamp: now,
        });

        Ok(())
    }
}

// ============================================================================
// ACCOUNTS CONTEXTS
// ============================================================================

#[derive(Accounts)]
#[instruction(circle_id: u64)]
pub struct CreateCircle<'info> {
    /// Circle PDA: ["circle", creator, circle_id as u64 le bytes]
    #[account(
        init,
        payer = creator,
        space = CIRCLE_SPACE,
        seeds = [b"circle", creator.key().as_ref(), &circle_id.to_le_bytes()],
        bump,
    )]
    pub circle: Account<'info, Circle>,

    /// Member PDA for creator (Slot 1): ["member", circle, creator]
    #[account(
        init,
        payer = creator,
        space = MEMBER_SPACE,
        seeds = [b"member", circle.key().as_ref(), creator.key().as_ref()],
        bump,
    )]
    pub creator_member: Account<'info, Member>,

    /// Vault: Token account owned by the Circle PDA
    #[account(
        init,
        payer = creator,
        seeds = [b"vault", circle.key().as_ref()],
        bump,
        token::mint = token_mint,
        token::authority = circle,
    )]
    pub vault: Account<'info, TokenAccount>,

    #[account(mut)]
    pub creator: Signer<'info>,

    /// Stablecoin mint (USDC or USDT on Devnet)
    pub token_mint: Account<'info, Mint>,

    /// Creator token account to fund initial slot-1 deposit
    #[account(
        mut,
        constraint = creator_token_account.mint == token_mint.key() @ SolthriftError::InvalidMint,
        constraint = creator_token_account.owner == creator.key() @ SolthriftError::InvalidTokenOwner,
    )]
    pub creator_token_account: Account<'info, TokenAccount>,

    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
    pub rent: Sysvar<'info, Rent>,
}

#[derive(Accounts)]
pub struct JoinCircle<'info> {
    #[account(
        mut,
        has_one = vault,
        has_one = token_mint,
    )]
    pub circle: Account<'info, Circle>,

    /// Member PDA for the joining member: ["member", circle, wallet]
    #[account(
        init,
        payer = member_wallet,
        space = MEMBER_SPACE,
        seeds = [b"member", circle.key().as_ref(), member_wallet.key().as_ref()],
        bump,
    )]
    pub member: Account<'info, Member>,

    #[account(mut)]
    pub member_wallet: Signer<'info>,

    pub token_mint: Account<'info, Mint>,

    /// Joining member token account to pay slot deposit
    #[account(
        mut,
        constraint = member_token_account.mint == token_mint.key() @ SolthriftError::InvalidMint,
        constraint = member_token_account.owner == member_wallet.key() @ SolthriftError::InvalidTokenOwner,
    )]
    pub member_token_account: Account<'info, TokenAccount>,

    /// Program vault owned by the Circle PDA
    #[account(
        mut,
        constraint = vault.mint == token_mint.key() @ SolthriftError::InvalidMint,
        constraint = vault.owner == circle.key() @ SolthriftError::InvalidVaultOwner,
    )]
    pub vault: Account<'info, TokenAccount>,

    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct Contribute<'info> {
    #[account(
        mut,
        has_one = vault,
        has_one = token_mint,
    )]
    pub circle: Account<'info, Circle>,

    /// Member PDA of the contributing member
    #[account(
        mut,
        seeds = [b"member", circle.key().as_ref(), member_wallet.key().as_ref()],
        bump = member.bump,
        has_one = circle,
        constraint = member.wallet == member_wallet.key() @ SolthriftError::InvalidMemberWallet,
    )]
    pub member: Account<'info, Member>,

    #[account(mut)]
    pub member_wallet: Signer<'info>,

    pub token_mint: Account<'info, Mint>,

    /// Member token account paying the period contribution
    #[account(
        mut,
        constraint = member_token_account.mint == token_mint.key() @ SolthriftError::InvalidMint,
        constraint = member_token_account.owner == member_wallet.key() @ SolthriftError::InvalidTokenOwner,
    )]
    pub member_token_account: Account<'info, TokenAccount>,

    /// Program vault owned by the Circle PDA
    #[account(
        mut,
        constraint = vault.key() == circle.vault @ SolthriftError::InvalidVault,
        constraint = vault.mint == token_mint.key() @ SolthriftError::InvalidMint,
    )]
    pub vault: Account<'info, TokenAccount>,

    pub token_program: Program<'info, Token>,
}

#[derive(Accounts)]
pub struct Payout<'info> {
    #[account(
        mut,
        has_one = vault,
        has_one = token_mint,
    )]
    pub circle: Account<'info, Circle>,

    /// Member PDA of the period recipient
    #[account(
        mut,
        has_one = circle,
    )]
    pub recipient_member: Account<'info, Member>,

    pub token_mint: Account<'info, Mint>,

    /// Destination token account owned by the recipient's wallet
    #[account(
        mut,
        constraint = recipient_token_account.mint == token_mint.key() @ SolthriftError::InvalidMint,
        constraint = recipient_token_account.owner == recipient_member.wallet @ SolthriftError::InvalidTokenOwner,
    )]
    pub recipient_token_account: Account<'info, TokenAccount>,

    /// Program vault owned by the Circle PDA
    #[account(
        mut,
        constraint = vault.key() == circle.vault @ SolthriftError::InvalidVault,
        constraint = vault.mint == token_mint.key() @ SolthriftError::InvalidMint,
    )]
    pub vault: Account<'info, TokenAccount>,

    /// Caller can be anyone (they only pay the transaction fee)
    pub caller: Signer<'info>,

    pub token_program: Program<'info, Token>,
}

// ============================================================================
// ACCOUNT STATE DEFINITIONS (Section 3 & Section 4)
// ============================================================================

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq)]
pub enum CircleStatus {
    Open,
    Active,
    Filling,
    Closed,
}

#[account]
pub struct Circle {
    pub creator: Pubkey,
    pub circle_id: u64,
    pub token_mint: Pubkey,
    pub vault: Pubkey,
    pub bump: u8,
    pub vault_bump: u8,
    pub status: CircleStatus,
    pub members_target: u8,
    pub current_member_count: u8,
    pub active_member_count: u8,
    pub contributions_this_period: u8,
    pub contribution: u64,
    pub deposit_pct: u8,
    pub period_duration: i64,
    pub grace_duration: i64,
    pub fill_window_duration: i64,
    pub min_members: u8,
    pub current_period: u8,
    pub period_start_time: i64,
    pub members: [Pubkey; 10],
    pub payout_order: [u8; 10],
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq)]
pub enum MemberStatus {
    Active,
    Removed,
    Left,
}

#[account]
pub struct Member {
    pub circle: Pubkey,
    pub wallet: Pubkey,
    pub slot: u8,
    pub deposit_remaining: u64,
    pub has_been_paid: bool,
    pub last_contributed_period: u8, // 0 = never
    pub status: MemberStatus,
    pub bump: u8,
}

// ============================================================================
// HELPER FUNCTIONS (Section 6 Money Math)
// ============================================================================

/// Calculates deposit amount for slot k according to Section 6:
/// max(deposit_pct * (N - k) * c / 100, c), rounded UP.
/// Uses 128-bit integers with checked arithmetic to guarantee no overflow or precision loss.
pub fn calculate_deposit(
    deposit_pct: u8,
    total_members: u8,
    slot: u8,
    contribution: u64,
) -> Result<u64> {
    require!(
        slot >= 1 && slot <= total_members,
        SolthriftError::InvalidSlot
    );

    let owed_periods = (total_members - slot) as u128;
    let pct_share = (deposit_pct as u128)
        .checked_mul(owed_periods)
        .ok_or(SolthriftError::MathOverflow)?
        .checked_mul(contribution as u128)
        .ok_or(SolthriftError::MathOverflow)?;

    // Ceiling division: (x + 99) / 100
    let pct_share_rounded_up = pct_share
        .checked_add(99)
        .ok_or(SolthriftError::MathOverflow)?
        .checked_div(100)
        .ok_or(SolthriftError::MathOverflow)?;

    let deposit = std::cmp::max(pct_share_rounded_up, contribution as u128);

    u64::try_from(deposit).map_err(|_| error!(SolthriftError::MathOverflow))
}

// ============================================================================
// EVENTS (Section 8)
// ============================================================================

#[event]
pub struct CircleCreated {
    pub circle: Pubkey,
    pub creator: Pubkey,
    pub circle_id: u64,
    pub token_mint: Pubkey,
    pub vault: Pubkey,
    pub members_target: u8,
    pub contribution: u64,
    pub deposit_pct: u8,
    pub period_duration: i64,
    pub grace_duration: i64,
}

#[event]
pub struct MemberJoined {
    pub circle: Pubkey,
    pub member: Pubkey,
    pub wallet: Pubkey,
    pub slot: u8,
    pub deposit_paid: u64,
}

#[event]
pub struct RoundStarted {
    pub circle: Pubkey,
    pub current_period: u8,
    pub period_start_time: i64,
}

#[event]
pub struct Contributed {
    pub circle: Pubkey,
    pub member: Pubkey,
    pub wallet: Pubkey,
    pub period: u8,
    pub amount: u64,
    pub timestamp: i64,
}

#[event]
pub struct PaidOut {
    pub circle: Pubkey,
    pub recipient_member: Pubkey,
    pub recipient_wallet: Pubkey,
    pub slot: u8,
    pub period: u8,
    pub amount: u64,
    pub timestamp: i64,
}

// ============================================================================
// ERRORS
// ============================================================================

#[error_code]
pub enum SolthriftError {
    #[msg("Member count must be between 3 and 10")]
    InvalidMemberCount,
    #[msg("Deposit percentage must be between 25% and 100%")]
    InvalidDepositPercentage,
    #[msg("Contribution must be at least 5 whole tokens")]
    ContributionTooLow,
    #[msg("Period duration must be greater than zero")]
    InvalidPeriodDuration,
    #[msg("Grace duration cannot be negative")]
    InvalidGraceDuration,
    #[msg("Fill window duration cannot be negative")]
    InvalidFillWindowDuration,
    #[msg("Slot must be between 1 and the total number of members")]
    InvalidSlot,
    #[msg("Period is invalid")]
    InvalidPeriod,
    #[msg("Math operation overflowed")]
    MathOverflow,
    #[msg("Circle is not open for new members")]
    CircleNotOpen,
    #[msg("Circle has already reached maximum members")]
    CircleFull,
    #[msg("Circle is not currently active")]
    CircleNotActive,
    #[msg("Member is not active")]
    MemberNotActive,
    #[msg("Member has already contributed for the current period")]
    AlreadyContributedThisPeriod,
    #[msg("Contribution window has closed (deadline plus grace passed)")]
    ContributionWindowClosed,
    #[msg("Cannot payout until all active members have contributed this period")]
    ContributionsIncomplete,
    #[msg("Recipient member slot does not match payout order for current period")]
    RecipientSlotMismatch,
    #[msg("Recipient wallet does not match member slot in circle")]
    RecipientWalletMismatch,
    #[msg("Recipient has already been paid for this round")]
    RecipientAlreadyPaid,
    #[msg("Recipient member is not active")]
    RecipientNotActive,
    #[msg("Member account does not belong to this circle")]
    InvalidMemberCircle,
    #[msg("Member PDA address is invalid")]
    InvalidMemberPda,
    #[msg("Member wallet does not match signer")]
    InvalidMemberWallet,
    #[msg("Token account mint does not match circle token mint")]
    InvalidMint,
    #[msg("Token account owner does not match expected authority")]
    InvalidTokenOwner,
    #[msg("Vault account does not match circle vault")]
    InvalidVault,
    #[msg("Vault owner does not match circle PDA")]
    InvalidVaultOwner,
    #[msg("Member has already joined this circle")]
    MemberAlreadyJoined,
    #[msg("Insufficient vault balance for payout")]
    InsufficientVaultFunds,
    #[msg("Payout amount does not match expected period contributions")]
    InvalidPayoutAmount,
}
