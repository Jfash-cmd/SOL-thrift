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
/// + 1 (order_len)
/// + 1 (expected_contributors)
/// + 8 (reserve)
/// + 1 (owing_count)
/// + 1 (pending_owing)
/// + 1 (period_refundable: bool)
/// + 1 (unpaid_count: u8)
/// + 8 (forfeit_per_claimant: u64)
/// + 8 (forfeit_pool_remaining: u64)
/// + 8 (contribution)
/// + 1 (deposit_pct)
/// + 8 (period_duration)
/// + 8 (grace_duration)
/// + 8 (fill_window_duration)
/// + 8 (open_deadline: i64)
/// + 1 (min_members)
/// + 1 (current_period)
/// + 8 (period_start_time)
/// + 320 (members: [Pubkey; 10])
/// + 10 (payout_order: [u8; 10])
/// = 530 bytes
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
    + 1
    + 1
    + 8
    + 1
    + 1 // pending_owing: u8
    + 1 // period_refundable: bool
    + 1 // unpaid_count: u8
    + 8 // forfeit_per_claimant: u64
    + 8 // forfeit_pool_remaining: u64
    + 8
    + 1
    + 8
    + 8
    + 8
    + 8 // open_deadline: i64
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
/// + 1 (leaving: bool)
/// + 1 (forfeit_claimed: bool)
/// = 87 bytes
pub const MEMBER_SPACE: usize = 8 + 32 + 32 + 1 + 8 + 1 + 1 + 1 + 1 + 1 + 1;

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
        open_window_duration: i64,
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

        let now = Clock::get()?.unix_timestamp;
        let actual_open_window = if open_window_duration > 0 {
            open_window_duration
        } else {
            604_800 // Default to 7 days (Section 2)
        };
        let open_deadline = now
            .checked_add(actual_open_window)
            .ok_or(SolthriftError::MathOverflow)?;

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
        circle.order_len = 0;
        circle.expected_contributors = 0;
        circle.reserve = 0;
        circle.owing_count = 0;
        circle.pending_owing = 0;
        circle.period_refundable = false;
        circle.unpaid_count = 0;
        circle.forfeit_per_claimant = 0;
        circle.forfeit_pool_remaining = 0;
        circle.contribution = contribution;
        circle.deposit_pct = deposit_pct;
        circle.period_duration = period_duration;
        circle.grace_duration = grace_duration;
        circle.fill_window_duration = if fill_window_duration > 0 {
            fill_window_duration
        } else {
            172_800 // Default to 2 days (Section 2)
        };
        circle.open_deadline = open_deadline;
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
        creator_member.leaving = false;
        creator_member.forfeit_claimed = false;

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
            open_deadline,
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
        member.leaving = false;
        member.forfeit_claimed = false;

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
            circle.order_len = circle.members_target;
            circle.expected_contributors = circle.active_member_count;
            circle.reserve = 0;
            circle.owing_count = 0;
            circle.pending_owing = 0;
            circle.period_refundable = false;
            circle.unpaid_count = circle.members_target;
            circle.forfeit_per_claimant = 0;
            circle.forfeit_pool_remaining = 0;
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

        // Allowed only when contributions_this_period == expected_contributors
        require!(
            circle.contributions_this_period == circle.expected_contributors,
            SolthriftError::ContributionsIncomplete
        );

        // Period bounds check: 1 <= current_period <= order_len
        require!(
            circle.current_period >= 1 && circle.current_period <= circle.order_len,
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

        // Pot calculation:
        // base = contributions_this_period * contribution
        // draw = entire reserve if current_period == order_len; else min(reserve, contribution * owing_count)
        // pot = base + draw
        let base_contributions = (circle.contributions_this_period as u64)
            .checked_mul(circle.contribution)
            .ok_or(SolthriftError::MathOverflow)?;

        let draw = if circle.current_period == circle.order_len {
            circle.reserve
        } else {
            let owing_needed = circle
                .contribution
                .checked_mul(circle.owing_count as u64)
                .ok_or(SolthriftError::MathOverflow)?;
            std::cmp::min(circle.reserve, owing_needed)
        };

        circle.reserve = circle
            .reserve
            .checked_sub(draw)
            .ok_or(SolthriftError::MathOverflow)?;

        let pot = base_contributions
            .checked_add(draw)
            .ok_or(SolthriftError::MathOverflow)?;

        // Verify vault holds at least the pot before paying
        require!(
            ctx.accounts.vault.amount >= pot,
            SolthriftError::InsufficientVaultFunds
        );

        // Transfer pot from vault to recipient's token account, signed by Circle PDA seeds
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
            pot,
        )?;

        // Mark recipient as paid
        recipient_member.has_been_paid = true;
        circle.unpaid_count = circle
            .unpaid_count
            .checked_sub(1)
            .ok_or(SolthriftError::MathOverflow)?;

        let now = Clock::get()?.unix_timestamp;
        let paid_period = circle.current_period;

        // Advance owing_count with pending_owing so that members removed during this period
        // start their reserve draws with the NEXT period, preventing double charging.
        circle.owing_count = circle
            .owing_count
            .checked_add(circle.pending_owing)
            .ok_or(SolthriftError::MathOverflow)?;
        circle.pending_owing = 0;
        circle.period_refundable = false;

        // If current_period == order_len, set status to Filling;
        // otherwise current_period += 1, contributions_this_period = 0,
        // period_start_time = now, expected_contributors = active_member_count.
        if circle.current_period == circle.order_len {
            circle.status = CircleStatus::Filling;
            circle.period_start_time = now;
        } else {
            circle.current_period = circle
                .current_period
                .checked_add(1)
                .ok_or(SolthriftError::MathOverflow)?;
            circle.contributions_this_period = 0;
            circle.period_start_time = now;
            circle.expected_contributors = circle.active_member_count;
        }

        // Emit Section 8 paid_out event
        emit!(PaidOut {
            circle: circle.key(),
            recipient_member: recipient_member.key(),
            recipient_wallet: recipient_member.wallet,
            slot: recipient_slot,
            period: paid_period,
            amount: pot,
            timestamp: now,
        });

        Ok(())
    }

    // Spec Section 5, Instruction 5: remove_defaulter
    pub fn remove_defaulter(ctx: Context<RemoveDefaulter>) -> Result<()> {
        let circle = &mut ctx.accounts.circle;
        let member = &mut ctx.accounts.member;

        // Allowed only when circle is Active
        require!(
            circle.status == CircleStatus::Active,
            SolthriftError::CircleNotActive
        );

        // Target member must be currently Active
        require!(
            member.status == MemberStatus::Active,
            SolthriftError::MemberNotActive
        );

        // Target member must have missed contribution this period
        require!(
            member.last_contributed_period != circle.current_period,
            SolthriftError::MemberAlreadyContributed
        );

        // Allowed only when now > period_start_time + period_duration + grace_duration
        let now = Clock::get()?.unix_timestamp;
        let deadline_with_grace = circle
            .period_start_time
            .checked_add(circle.period_duration)
            .ok_or(SolthriftError::MathOverflow)?
            .checked_add(circle.grace_duration)
            .ok_or(SolthriftError::MathOverflow)?;
        require!(
            now > deadline_with_grace,
            SolthriftError::GracePeriodNotExpired
        );

        // 1. Mark member Removed and decrement active_member_count
        member.status = MemberStatus::Removed;
        circle.active_member_count = circle
            .active_member_count
            .checked_sub(1)
            .ok_or(SolthriftError::MathOverflow)?;

        // If the member has NOT been paid, delete their entry from payout_order
        // by shifting later entries left (order_len -= 1), and decrement unpaid_count.
        if !member.has_been_paid {
            circle.unpaid_count = circle
                .unpaid_count
                .checked_sub(1)
                .ok_or(SolthriftError::MathOverflow)?;

            let mut found_idx: Option<usize> = None;
            for i in 0..(circle.order_len as usize) {
                if circle.payout_order[i] == member.slot {
                    found_idx = Some(i);
                    break;
                }
            }
            let idx = found_idx.ok_or(SolthriftError::SlotNotFoundInPayoutOrder)?;

            let last_entry_idx = (circle.order_len as usize)
                .checked_sub(1)
                .ok_or(SolthriftError::PayoutOrderEmpty)?;

            for i in idx..last_entry_idx {
                let next_slot = circle.payout_order[i + 1];
                circle.payout_order[i] = next_slot;
            }
            circle.payout_order[last_entry_idx] = 0;
            circle.order_len = circle
                .order_len
                .checked_sub(1)
                .ok_or(SolthriftError::MathOverflow)?;
        }

        // 1. Closing takes priority: In BOTH branches of remove_defaulter, after removal, if
        // active_member_count < min_members, set status = Closing (not Filling). In that
        // case do NOT cover this period from the defaulter's deposit.
        // If the removed member HAS been paid, forfeit min(deposit_remaining, (order_len - current_period + 1) * contribution),
        // add circle.reserve to the forfeit pool, set reserve = 0, and divide by unpaid_count.
        // If unpaid_count is 0 or member was NOT paid, forfeit nothing and refund full deposit.
        // Closing means no more payouts happen.
        if circle.active_member_count < circle.min_members {
            circle.status = CircleStatus::Closing;

            let refund_amount: u64;

            if member.has_been_paid && circle.unpaid_count > 0 {
                let order_len = circle.order_len as u64;
                let current_period = circle.current_period as u64;
                let contribution = circle.contribution;
                let unpaid_count = circle.unpaid_count as u64;
                let reserve = circle.reserve;

                let periods_owed = order_len
                    .checked_sub(current_period)
                    .ok_or(SolthriftError::MathOverflow)?
                    .checked_add(1)
                    .ok_or(SolthriftError::MathOverflow)?;
                let amount_owed = periods_owed
                    .checked_mul(contribution)
                    .ok_or(SolthriftError::MathOverflow)?;

                let forfeited_from_deposit = std::cmp::min(member.deposit_remaining, amount_owed);
                refund_amount = member
                    .deposit_remaining
                    .checked_sub(forfeited_from_deposit)
                    .ok_or(SolthriftError::MathOverflow)?;
                member.deposit_remaining = 0;

                let total_forfeited = forfeited_from_deposit
                    .checked_add(reserve)
                    .ok_or(SolthriftError::MathOverflow)?;
                circle.reserve = 0;

                circle.forfeit_per_claimant = total_forfeited
                    .checked_div(unpaid_count)
                    .ok_or(SolthriftError::MathOverflow)?;
                circle.forfeit_pool_remaining = total_forfeited;
            } else {
                refund_amount = member.deposit_remaining;
                member.deposit_remaining = 0;
                circle.forfeit_pool_remaining = 0;
            }

            if refund_amount > 0 {
                require!(
                    ctx.accounts.vault.amount >= refund_amount,
                    SolthriftError::InsufficientVaultFunds
                );

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
                    to: ctx.accounts.member_token_account.to_account_info(),
                    authority: circle.to_account_info(),
                };
                let cpi_program = ctx.accounts.token_program.to_account_info();
                token::transfer(
                    CpiContext::new_with_signer(cpi_program, cpi_accounts, signer_seeds),
                    refund_amount,
                )?;
            }

            emit!(MemberRemoved {
                circle: circle.key(),
                member: member.key(),
                wallet: member.wallet,
                slot: member.slot,
                covered_amount: 0,
                reserved_amount: 0,
                refunded_amount: refund_amount,
                timestamp: now,
            });

            return Ok(());
        }

        // Check if member was unpaid and was the sole remaining unpaid member:
        // (meaning current_period > order_len after their deletion, leaving no unpaid entries)
        let is_sole_unpaid = !member.has_been_paid && circle.current_period > circle.order_len;

        if is_sole_unpaid {
            // Do not cover this period and do not move any deposit.
            // Refund full deposit_remaining to member's wallet token account.
            let refund_amount = member.deposit_remaining;
            member.deposit_remaining = 0;

            if refund_amount > 0 {
                require!(
                    ctx.accounts.vault.amount >= refund_amount,
                    SolthriftError::InsufficientVaultFunds
                );

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
                    to: ctx.accounts.member_token_account.to_account_info(),
                    authority: circle.to_account_info(),
                };
                let cpi_program = ctx.accounts.token_program.to_account_info();
                token::transfer(
                    CpiContext::new_with_signer(cpi_program, cpi_accounts, signer_seeds),
                    refund_amount,
                )?;
            }

            // Set status to Filling (leave this period's contributions in the vault for a refund instruction in a later chunk)
            circle.status = CircleStatus::Filling;
            circle.period_start_time = now;
            circle.period_refundable = true;

            // Emit Section 8 member_removed event
            emit!(MemberRemoved {
                circle: circle.key(),
                member: member.key(),
                wallet: member.wallet,
                slot: member.slot,
                covered_amount: 0,
                reserved_amount: 0,
                refunded_amount: refund_amount,
                timestamp: now,
            });

            return Ok(());
        }

        // Standard removal path (when member is paid OR is unpaid with other unpaid members remaining)

        // 2. Cover this period: require that covered_amount == circle.contribution
        let covered_amount = std::cmp::min(member.deposit_remaining, circle.contribution);
        require!(
            covered_amount == circle.contribution,
            SolthriftError::InsufficientDepositForCoverage
        );

        circle.contributions_this_period = circle
            .contributions_this_period
            .checked_add(1)
            .ok_or(SolthriftError::MathOverflow)?;
        member.deposit_remaining = member
            .deposit_remaining
            .checked_sub(covered_amount)
            .ok_or(SolthriftError::MathOverflow)?;

        let mut reserved_amount = 0u64;
        let refund_amount: u64;

        if !member.has_been_paid {
            refund_amount = member.deposit_remaining;
            member.deposit_remaining = 0;
        } else {
            // 4. If the member HAS been paid:
            // remaining = order_len - current_period
            // Move min(deposit_remaining, remaining * contribution) into reserve.
            // Increment pending_owing += 1 so reserve draws begin with the NEXT period in payout,
            // preventing double-charging this period (where their contribution was already covered from deposit).
            // Refund anything left to their wallet's token account.
            let remaining_periods = (circle.order_len as u64)
                .checked_sub(circle.current_period as u64)
                .ok_or(SolthriftError::MathOverflow)?;
            let needed_for_remaining = remaining_periods
                .checked_mul(circle.contribution)
                .ok_or(SolthriftError::MathOverflow)?;

            reserved_amount = std::cmp::min(member.deposit_remaining, needed_for_remaining);
            circle.reserve = circle
                .reserve
                .checked_add(reserved_amount)
                .ok_or(SolthriftError::MathOverflow)?;
            circle.pending_owing = circle
                .pending_owing
                .checked_add(1)
                .ok_or(SolthriftError::MathOverflow)?;

            refund_amount = member
                .deposit_remaining
                .checked_sub(reserved_amount)
                .ok_or(SolthriftError::MathOverflow)?;
            member.deposit_remaining = 0;
        }

        // Refund transfer if refund_amount > 0
        if refund_amount > 0 {
            require!(
                ctx.accounts.vault.amount >= refund_amount,
                SolthriftError::InsufficientVaultFunds
            );

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
                to: ctx.accounts.member_token_account.to_account_info(),
                authority: circle.to_account_info(),
            };
            let cpi_program = ctx.accounts.token_program.to_account_info();
            token::transfer(
                CpiContext::new_with_signer(cpi_program, cpi_accounts, signer_seeds),
                refund_amount,
            )?;
        }

        // If removal leaves no unpaid entries (current_period > order_len), set status to Filling.
        if circle.current_period > circle.order_len {
            circle.status = CircleStatus::Filling;
            circle.period_start_time = now;
        }

        // Emit Section 8 member_removed event
        emit!(MemberRemoved {
            circle: circle.key(),
            member: member.key(),
            wallet: member.wallet,
            slot: member.slot,
            covered_amount,
            reserved_amount,
            refunded_amount: refund_amount,
            timestamp: now,
        });

        Ok(())
    }

    // Spec Section 5, Instruction 6: flag_leaving
    pub fn flag_leaving(ctx: Context<FlagLeaving>) -> Result<()> {
        let circle = &ctx.accounts.circle;
        let member = &mut ctx.accounts.member;

        // Allowed while the circle is Active or Filling
        require!(
            circle.status == CircleStatus::Active || circle.status == CircleStatus::Filling,
            SolthriftError::CircleNotActiveOrFilling
        );

        // Member must be currently Active
        require!(
            member.status == MemberStatus::Active,
            SolthriftError::MemberNotActive
        );

        member.leaving = true;

        emit!(LeavingFlagged {
            circle: circle.key(),
            member: member.key(),
            wallet: member.wallet,
            slot: member.slot,
            timestamp: Clock::get()?.unix_timestamp,
        });

        Ok(())
    }

    // Spec Section 5, Instruction 7: exit_member
    pub fn exit_member(ctx: Context<ExitMember>) -> Result<()> {
        let circle = &mut ctx.accounts.circle;
        let member = &mut ctx.accounts.member;

        // Allowed only when the circle is Filling or Closing
        require!(
            circle.status == CircleStatus::Filling || circle.status == CircleStatus::Closing,
            SolthriftError::CircleNotFillingOrClosing
        );

        // Member must be currently Active to exit
        require!(
            member.status == MemberStatus::Active,
            SolthriftError::MemberNotActive
        );

        // Either the member has leaving == true or the circle is Closing
        require!(
            member.leaving || circle.status == CircleStatus::Closing,
            SolthriftError::MemberNotEligibleToExit
        );

        let mut refund_amount = member.deposit_remaining;
        member.deposit_remaining = 0;
        member.status = MemberStatus::Left;
        circle.active_member_count = circle
            .active_member_count
            .checked_sub(1)
            .ok_or(SolthriftError::MathOverflow)?;

        // If circle is Closing, member is not paid, forfeit has not been claimed,
        // forfeit_per_claimant > 0, and forfeit pool has enough:
        // bundle forfeit share into this exit refund transfer.
        let mut forfeit_amount: u64 = 0;
        if circle.status == CircleStatus::Closing
            && !member.has_been_paid
            && !member.forfeit_claimed
            && circle.forfeit_per_claimant > 0
            && circle.forfeit_pool_remaining >= circle.forfeit_per_claimant
        {
            forfeit_amount = circle.forfeit_per_claimant;
            refund_amount = refund_amount
                .checked_add(forfeit_amount)
                .ok_or(SolthriftError::MathOverflow)?;
            circle.forfeit_pool_remaining = circle
                .forfeit_pool_remaining
                .checked_sub(forfeit_amount)
                .ok_or(SolthriftError::MathOverflow)?;
            member.forfeit_claimed = true;
        }

        if refund_amount > 0 {
            require!(
                ctx.accounts.vault.amount >= refund_amount,
                SolthriftError::InsufficientVaultFunds
            );

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
                to: ctx.accounts.member_token_account.to_account_info(),
                authority: circle.to_account_info(),
            };
            let cpi_program = ctx.accounts.token_program.to_account_info();
            token::transfer(
                CpiContext::new_with_signer(cpi_program, cpi_accounts, signer_seeds),
                refund_amount,
            )?;
        }

        let now = Clock::get()?.unix_timestamp;

        if forfeit_amount > 0 {
            emit!(ForfeitClaimed {
                circle: circle.key(),
                member: member.key(),
                wallet: member.wallet,
                slot: member.slot,
                amount: forfeit_amount,
                timestamp: now,
            });
        }

        emit!(MemberLeft {
            circle: circle.key(),
            member: member.key(),
            wallet: member.wallet,
            slot: member.slot,
            refunded_amount: refund_amount,
            timestamp: now,
        });

        Ok(())
    }

    // Spec Section 5, Instruction 8: claim_refund
    pub fn claim_refund(ctx: Context<ClaimRefund>) -> Result<()> {
        let circle = &mut ctx.accounts.circle;
        let member = &mut ctx.accounts.member;

        // Allowed when circle is Closing, or is Filling with period_refundable == true
        let can_claim = circle.status == CircleStatus::Closing
            || (circle.status == CircleStatus::Filling && circle.period_refundable);
        require!(can_claim, SolthriftError::RefundNotAvailable);

        // Require current_period >= 1 (prevents drain in cancelled Open circle)
        require!(circle.current_period >= 1, SolthriftError::InvalidPeriod);

        // Member must have contributed for the current period (both must be >= 1 and equal)
        require!(
            member.last_contributed_period >= 1
                && member.last_contributed_period == circle.current_period,
            SolthriftError::NothingToClaim
        );

        // Require contributions_this_period > 0
        require!(
            circle.contributions_this_period > 0,
            SolthriftError::NoContributionsToRefund
        );

        let refund_amount = circle.contribution;

        // Never let any refund exceed what the vault holds
        require!(
            ctx.accounts.vault.amount >= refund_amount,
            SolthriftError::InsufficientVaultFunds
        );

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
            to: ctx.accounts.member_token_account.to_account_info(),
            authority: circle.to_account_info(),
        };
        let cpi_program = ctx.accounts.token_program.to_account_info();
        token::transfer(
            CpiContext::new_with_signer(cpi_program, cpi_accounts, signer_seeds),
            refund_amount,
        )?;

        // Set last_contributed_period = 0 so it cannot be claimed twice
        member.last_contributed_period = 0;
        circle.contributions_this_period = circle
            .contributions_this_period
            .checked_sub(1)
            .ok_or(SolthriftError::MathOverflow)?;

        emit!(RefundClaimed {
            circle: circle.key(),
            member: member.key(),
            wallet: member.wallet,
            slot: member.slot,
            amount: refund_amount,
            timestamp: Clock::get()?.unix_timestamp,
        });

        Ok(())
    }

    // Spec Section 5, Instruction 9: claim_forfeit
    pub fn claim_forfeit(ctx: Context<ClaimForfeit>) -> Result<()> {
        let circle = &mut ctx.accounts.circle;
        let member = &mut ctx.accounts.member;

        // Circle must be Closing
        require!(
            circle.status == CircleStatus::Closing,
            SolthriftError::CircleNotClosing
        );

        // Member must be Active
        require!(
            member.status == MemberStatus::Active,
            SolthriftError::MemberNotActive
        );

        // Member must NOT have been paid
        require!(
            !member.has_been_paid,
            SolthriftError::MemberAlreadyPaid
        );

        // forfeit_claimed must be false
        require!(
            !member.forfeit_claimed,
            SolthriftError::ForfeitAlreadyClaimed
        );

        let amount = circle.forfeit_per_claimant;
        require!(amount > 0, SolthriftError::NoForfeitToClaim);

        // Cap check against remaining forfeit pool
        require!(
            circle.forfeit_pool_remaining >= amount,
            SolthriftError::InsufficientForfeitPool
        );

        // Check the vault balance first
        require!(
            ctx.accounts.vault.amount >= amount,
            SolthriftError::InsufficientVaultFunds
        );

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
            to: ctx.accounts.member_token_account.to_account_info(),
            authority: circle.to_account_info(),
        };
        let cpi_program = ctx.accounts.token_program.to_account_info();
        token::transfer(
            CpiContext::new_with_signer(cpi_program, cpi_accounts, signer_seeds),
            amount,
        )?;

        circle.forfeit_pool_remaining = circle
            .forfeit_pool_remaining
            .checked_sub(amount)
            .ok_or(SolthriftError::MathOverflow)?;

        member.forfeit_claimed = true;

        emit!(ForfeitClaimed {
            circle: circle.key(),
            member: member.key(),
            wallet: member.wallet,
            slot: member.slot,
            amount,
            timestamp: Clock::get()?.unix_timestamp,
        });

        Ok(())
    }

    // Spec Section 5, Instruction 10: cancel_open_circle
    pub fn cancel_open_circle(ctx: Context<CancelOpenCircle>) -> Result<()> {
        let circle = &mut ctx.accounts.circle;

        // Circle must be Open
        require!(
            circle.status == CircleStatus::Open,
            SolthriftError::CircleNotOpen
        );

        // Current time must be beyond open_deadline
        let now = Clock::get()?.unix_timestamp;
        require!(
            now > circle.open_deadline,
            SolthriftError::OpenWindowNotExpired
        );

        circle.status = CircleStatus::Closing;

        emit!(CircleCancelled {
            circle: circle.key(),
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

#[derive(Accounts)]
pub struct RemoveDefaulter<'info> {
    #[account(
        mut,
        has_one = vault,
        has_one = token_mint,
    )]
    pub circle: Account<'info, Circle>,

    /// Member PDA of the defaulting member to be removed
    #[account(
        mut,
        has_one = circle,
    )]
    pub member: Account<'info, Member>,

    pub token_mint: Account<'info, Mint>,

    /// Destination token account to refund member's remaining deposit
    #[account(
        mut,
        constraint = member_token_account.mint == token_mint.key() @ SolthriftError::InvalidMint,
        constraint = member_token_account.owner == member.wallet @ SolthriftError::InvalidTokenOwner,
    )]
    pub member_token_account: Account<'info, TokenAccount>,

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

#[derive(Accounts)]
pub struct FlagLeaving<'info> {
    pub circle: Account<'info, Circle>,

    #[account(
        mut,
        has_one = circle,
        constraint = member.wallet == member_wallet.key() @ SolthriftError::InvalidMemberWallet,
    )]
    pub member: Account<'info, Member>,

    /// Member must sign to flag leaving
    pub member_wallet: Signer<'info>,
}

#[derive(Accounts)]
pub struct ExitMember<'info> {
    #[account(
        mut,
        has_one = vault,
        has_one = token_mint,
    )]
    pub circle: Account<'info, Circle>,

    #[account(
        mut,
        has_one = circle,
    )]
    pub member: Account<'info, Member>,

    pub token_mint: Account<'info, Mint>,

    /// Destination token account to refund member's remaining deposit
    #[account(
        mut,
        constraint = member_token_account.mint == token_mint.key() @ SolthriftError::InvalidMint,
        constraint = member_token_account.owner == member.wallet @ SolthriftError::InvalidTokenOwner,
    )]
    pub member_token_account: Account<'info, TokenAccount>,

    /// Program vault owned by the Circle PDA
    #[account(
        mut,
        constraint = vault.key() == circle.vault @ SolthriftError::InvalidVault,
        constraint = vault.mint == token_mint.key() @ SolthriftError::InvalidMint,
    )]
    pub vault: Account<'info, TokenAccount>,

    /// Caller can be anyone (paying the transaction fee)
    pub caller: Signer<'info>,

    pub token_program: Program<'info, Token>,
}

#[derive(Accounts)]
pub struct ClaimRefund<'info> {
    #[account(
        mut,
        has_one = vault,
        has_one = token_mint,
    )]
    pub circle: Account<'info, Circle>,

    #[account(
        mut,
        has_one = circle,
        constraint = member.wallet == member_wallet.key() @ SolthriftError::InvalidMemberWallet,
    )]
    pub member: Account<'info, Member>,

    pub token_mint: Account<'info, Mint>,

    /// Destination token account to refund member's contribution
    #[account(
        mut,
        constraint = member_token_account.mint == token_mint.key() @ SolthriftError::InvalidMint,
        constraint = member_token_account.owner == member.wallet @ SolthriftError::InvalidTokenOwner,
    )]
    pub member_token_account: Account<'info, TokenAccount>,

    /// Program vault owned by the Circle PDA
    #[account(
        mut,
        constraint = vault.key() == circle.vault @ SolthriftError::InvalidVault,
        constraint = vault.mint == token_mint.key() @ SolthriftError::InvalidMint,
    )]
    pub vault: Account<'info, TokenAccount>,

    /// Member must sign to claim their refund
    pub member_wallet: Signer<'info>,

    pub token_program: Program<'info, Token>,
}

#[derive(Accounts)]
pub struct ClaimForfeit<'info> {
    #[account(
        mut,
        has_one = vault,
        has_one = token_mint,
    )]
    pub circle: Account<'info, Circle>,

    #[account(
        mut,
        has_one = circle,
        constraint = member.wallet == member_wallet.key() @ SolthriftError::InvalidMemberWallet,
    )]
    pub member: Account<'info, Member>,

    pub token_mint: Account<'info, Mint>,

    /// Destination token account to receive forfeit share
    #[account(
        mut,
        constraint = member_token_account.mint == token_mint.key() @ SolthriftError::InvalidMint,
        constraint = member_token_account.owner == member.wallet @ SolthriftError::InvalidTokenOwner,
    )]
    pub member_token_account: Account<'info, TokenAccount>,

    /// Program vault owned by the Circle PDA
    #[account(
        mut,
        constraint = vault.key() == circle.vault @ SolthriftError::InvalidVault,
        constraint = vault.mint == token_mint.key() @ SolthriftError::InvalidMint,
    )]
    pub vault: Account<'info, TokenAccount>,

    /// Member must sign to claim forfeit
    pub member_wallet: Signer<'info>,

    pub token_program: Program<'info, Token>,
}

#[derive(Accounts)]
pub struct CancelOpenCircle<'info> {
    #[account(mut)]
    pub circle: Account<'info, Circle>,

    /// Caller can be anyone (paying the transaction fee)
    pub caller: Signer<'info>,
}

// ============================================================================
// ACCOUNT STATE DEFINITIONS (Section 3 & Section 4)
// ============================================================================

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq)]
pub enum CircleStatus {
    Open,
    Active,
    Filling,
    Closing,
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
    pub order_len: u8,
    pub expected_contributors: u8,
    pub reserve: u64,
    pub owing_count: u8,
    pub pending_owing: u8,
    pub period_refundable: bool,
    pub unpaid_count: u8,
    pub forfeit_per_claimant: u64,
    pub forfeit_pool_remaining: u64,
    pub contribution: u64,
    pub deposit_pct: u8,
    pub period_duration: i64,
    pub grace_duration: i64,
    pub fill_window_duration: i64,
    pub open_deadline: i64,
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
    pub leaving: bool,
    pub forfeit_claimed: bool,
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
    pub open_deadline: i64,
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

#[event]
pub struct MemberRemoved {
    pub circle: Pubkey,
    pub member: Pubkey,
    pub wallet: Pubkey,
    pub slot: u8,
    pub covered_amount: u64,
    pub reserved_amount: u64,
    pub refunded_amount: u64,
    pub timestamp: i64,
}

#[event]
pub struct LeavingFlagged {
    pub circle: Pubkey,
    pub member: Pubkey,
    pub wallet: Pubkey,
    pub slot: u8,
    pub timestamp: i64,
}

#[event]
pub struct MemberLeft {
    pub circle: Pubkey,
    pub member: Pubkey,
    pub wallet: Pubkey,
    pub slot: u8,
    pub refunded_amount: u64,
    pub timestamp: i64,
}

#[event]
pub struct RefundClaimed {
    pub circle: Pubkey,
    pub member: Pubkey,
    pub wallet: Pubkey,
    pub slot: u8,
    pub amount: u64,
    pub timestamp: i64,
}

#[event]
pub struct ForfeitClaimed {
    pub circle: Pubkey,
    pub member: Pubkey,
    pub wallet: Pubkey,
    pub slot: u8,
    pub amount: u64,
    pub timestamp: i64,
}

#[event]
pub struct CircleCancelled {
    pub circle: Pubkey,
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
    #[msg("Slot not found in payout order")]
    SlotNotFoundInPayoutOrder,
    #[msg("Payout order is empty (order length is zero)")]
    PayoutOrderEmpty,
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
    #[msg("Circle is not active or filling")]
    CircleNotActiveOrFilling,
    #[msg("Circle is not filling or closing")]
    CircleNotFillingOrClosing,
    #[msg("Circle is not in closing state")]
    CircleNotClosing,
    #[msg("Member is not active")]
    MemberNotActive,
    #[msg("Member has not flagged leaving and circle is not closing")]
    MemberNotEligibleToExit,
    #[msg("Refund is not available for this circle state")]
    RefundNotAvailable,
    #[msg("No refund available to claim for this period")]
    NothingToClaim,
    #[msg("Forfeit share has already been claimed by this member")]
    ForfeitAlreadyClaimed,
    #[msg("No forfeit share available to claim")]
    NoForfeitToClaim,
    #[msg("Open window for circle has not yet expired")]
    OpenWindowNotExpired,
    #[msg("Member has already contributed for the current period")]
    AlreadyContributedThisPeriod,
    #[msg("Contribution window has closed (deadline plus grace passed)")]
    ContributionWindowClosed,
    #[msg("Deadline plus grace period has not expired yet")]
    GracePeriodNotExpired,
    #[msg("Member has already contributed for this period and cannot be removed as defaulter")]
    MemberAlreadyContributed,
    #[msg("Member's remaining deposit is insufficient to cover this period's contribution")]
    InsufficientDepositForCoverage,
    #[msg("Cannot payout until all expected contributions have been received")]
    ContributionsIncomplete,
    #[msg("Recipient member slot does not match payout order for current period")]
    RecipientSlotMismatch,
    #[msg("Recipient wallet does not match member slot in circle")]
    RecipientWalletMismatch,
    #[msg("Recipient has already been paid for this round")]
    RecipientAlreadyPaid,
    #[msg("Member has already been paid for this round")]
    MemberAlreadyPaid,
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
    #[msg("No contributions recorded for this period to refund")]
    NoContributionsToRefund,
    #[msg("Insufficient forfeit pool remaining")]
    InsufficientForfeitPool,
}
