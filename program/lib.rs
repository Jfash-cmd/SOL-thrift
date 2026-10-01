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
/// = 491 bytes
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
/// + 1 (contributed_this_period)
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

    /// Spec Section 5, Instruction 1: create_circle
    /// Implements circle initialization with parameters from Section 2 and invariants from Section 7.
    /// Validates parameters, creates the program-owned vault, assigns the creator to slot 1,
    /// and takes the creator's slot-1 deposit via SPL token transfer.
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
        creator_member.contributed_this_period = false;
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

    /// Spec Section 5, Instruction 2: join_circle
    /// Takes the next free slot (join order) and charges the deposit from Section 6:
    /// max(deposit_pct * (N - k) * c / 100, c), rounded UP.
    /// Sets circle status to Active when the circle reaches N members.
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
        member.contributed_this_period = false;
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
    pub contributed_this_period: bool,
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
    #[msg("Math operation overflowed")]
    MathOverflow,
    #[msg("Circle is not open for new members")]
    CircleNotOpen,
    #[msg("Circle has already reached maximum members")]
    CircleFull,
    #[msg("Token account mint does not match circle token mint")]
    InvalidMint,
    #[msg("Token account owner does not match signer")]
    InvalidTokenOwner,
    #[msg("Vault owner does not match circle PDA")]
    InvalidVaultOwner,
    #[msg("Member has already joined this circle")]
    MemberAlreadyJoined,
}
