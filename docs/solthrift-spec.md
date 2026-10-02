# Solthrift: Build Spec (Solana, website)

Solthrift is a rotating savings circle (ajo/thrift) where a program, not a person, holds the money.
Members contribute every period, one member receives the pot each period, and
the round ends when everyone has been paid once. Then it resets and the next
round begins.

Items marked **[DECIDE]** are choices I proposed, not decisions you made.
Change them freely.

---

## 0. Positioning (decided)

Solthrift is **group savings with a real early payout, where no person or company
holds the money** and the rules are enforced by code. Deposits are partial: each
member locks a set percentage of what they would still owe after being paid. That
is what lets the first people paid get real early cash, like traditional ajo.

Example (4 members, 10 per period, 50% deposits): the first person locks 15, pays 10,
and receives the 40 pot. They are 15 ahead of what they have put in, and they owe
30 more over the next 3 periods.

The price of this is risk, and the pitch should say so plainly. If someone defaults
after being paid, their deposit covers only part of what they owe. The rest is
absorbed by members who have not been paid yet, through smaller pots. The most the
group can lose is capped by the deposit percentage that was chosen at the start.

What Solthrift offers:

- Nobody can run off with the pot: no collector, no company, no single key.
- Everyone can see who has paid and who is next, and every transaction is on record.
- Rules like removal after a missed deadline run automatically, with no argument.
- A controlled early payout, with the group's risk capped and visible up front.

Roadmap, not in the hackathon build: lighter deposits for members with a proven
record, or friends vouching for each other.

## 1. Rules already decided

- Non-custodial: funds sit in a program-owned vault. No human can move them.
- Every transaction is recorded on-chain (events emitted for each action).
- Rounds repeat: a round ends when every member has received one payout,
  then a new round opens.
- If a member misses the deadline (plus grace period) they are automatically
  removed.
- When a member is removed, the remaining members finish the round with a
  smaller pot.
- A quitter never gets back more than they deposited.

## 2. Parameters (set when the circle is created)

| Parameter | Meaning | Suggested demo value |
|---|---|---|
| token | One stablecoin per circle, chosen at creation: USDC or USDT | USDC (test mint on devnet) |
| members (N) | Number of members, minimum 3 and maximum 10 | 4 |
| contribution (c) | Amount each member pays per period. Minimum 5 USDC or USDT | 10 USDC |
| deposit_pct | Share of what a member would still owe that they lock as a deposit. Set at creation, same for everyone **[DECIDE]** | 50% (allowed range 25% to 100%) |
| period | Length of one period | 1 day for demo (weekly in real use) |
| grace | Extra time after the deadline before removal is allowed | 6 hours (demo: minutes) |
| fill_window | How long an open seat stays open before it closes | 2 days (demo: a few minutes) |
| open_window | How long a circle remains open for members to join before expiring | 7 days (demo: a few minutes) |
| min_members | Fixed at 3. If active members fall below 3, the round ends and refunds | 3 |

Use SOL only for network fees. The pot itself is in a stablecoin so payouts
keep the same value. A circle uses exactly one token for deposits, contributions
and payouts. Never mix USDC and USDT inside one circle, so nobody is paid in a
different coin than they put in. On devnet, create test mints for both, since
the real ones may not exist there.

### 3. Accounts

Because a circle never has more than 10 members, the Circle account can use a
fixed-size list of 10 member slots. That keeps account sizes and transaction
sizes predictable.

- **Circle** (PDA): parameters, status, current period, contributions_this_period, order_len, expected_contributors, reserve, owing_count, pending_owing, period_refundable (bool), unpaid_count (u8), forfeit_per_claimant (u64), forfeit_pool_remaining (u64), open_deadline (i64), payout order, member list.
  Exact space: `CIRCLE_SPACE = 530 bytes`.
- **Member** (PDA per member per circle): wallet, slot number, deposit remaining,
  has_been_paid, last_contributed_period (0 = never), status (active / removed / left), bump, leaving (bool), forfeit_claimed (bool).
  Exact space: `MEMBER_SPACE = 87 bytes`.
- **Vault** (token account owned by the Circle PDA): holds deposits,
  contributions, and reserve.

## 4. States

`Open` (members joining) -> `Active` (periods running) -> `Filling` (2-day window
after a round ends) -> `Active` again for the next round.
If active members drop below 3 (`min_members`), the circle transitions to `Closing`.
Closing takes priority over Filling. When a circle is Closing, no more payouts happen, members can retrieve their remaining deposit via `exit_member`, any member who contributed for the current uncompleted period can reclaim their contribution via `claim_refund`, and active unpaid members can claim their share of any forfeit via `claim_forfeit`.
If an `Open` circle reaches `open_deadline` before filling, anyone can call `cancel_open_circle` to transition it to `Closing`, allowing all joined members to retrieve their deposits in full via `exit_member`.
A round runs until every active member has received their payout. It then ends
and resets automatically: the same members and payout order carry over, and
the next round starts once the filling window ends. Deposits stay locked through a reset. A member who
flagged `leaving` takes their deposit out during Filling via `exit_member`, with no penalty.

## 5. Instructions

1. **create_circle**: sets parameters including `open_window_duration` (default 7 days / 604,800s if <= 0) and computes `open_deadline = now + open_window_duration`. Creator becomes member 1. Initializes `period_refundable = false`, `unpaid_count = 0`, `forfeit_per_claimant = 0`, `leaving = false`, and `forfeit_claimed = false`.
2. **join_circle**: member pays their deposit into the vault and takes the next
   slot. Payout order = join order **[DECIDE]** (simple and verifiable).
   Initializes `member.forfeit_claimed = false`.
   When N members have joined, the circle becomes Active automatically.
   Sets `order_len = members_target`, `expected_contributors = active_member_count`, `unpaid_count = members_target`, and `forfeit_per_claimant = 0`.
3. **contribute**: pays c into the vault for the current period. Signed by the
   member through their browser wallet before deadline plus grace. Sets
   `last_contributed_period = current_period` and increments `contributions_this_period`.
4. **payout**: sends the pot to that period's recipient (slot = `payout_order[current_period - 1]`).
   Callable by anyone, but allowed only when `contributions_this_period == expected_contributors`.
   Pot = `contributions_this_period * contribution` (real and covered contributions)
   + draw. **Reserve sweep:** if `current_period == order_len`, `draw = reserve` (the entire reserve is swept into the final pot); otherwise `draw = min(reserve, contribution * owing_count)`. The draw is
   subtracted from reserve. Transferred from vault signed by Circle PDA seeds.
   Sets `has_been_paid = true` and decrements `unpaid_count -= 1`. Moves `pending_owing` into `owing_count`, clears
   `pending_owing = 0`, and resets `period_refundable = false` when the period advances.
   After payout: if `current_period == order_len`, status
   transitions to `Filling`; otherwise `current_period += 1`, `contributions_this_period = 0`,
   `period_start_time = now`, and `expected_contributors = active_member_count`.
5. **remove_defaulter**: callable by anyone after deadline plus grace against an
   active member whose `last_contributed_period != current_period`.
   - If member has not been paid, decrements `unpaid_count -= 1` and deletes their entry from `payout_order` (`order_len -= 1`).
   - **Closing takes priority (Forfeit on Closing):** In BOTH branches below, after removal (`active_member_count -= 1`),
     if `active_member_count < min_members`, set `status = Closing` (not Filling). In that case, do NOT
     cover this period from the defaulter's deposit.
     If the removed member HAS been paid:
     `forfeited = min(deposit_remaining, (order_len - current_period + 1) * contribution)`.
     Refund only the rest (`deposit_remaining - forfeited`) to their wallet token account.
     Add the entire `circle.reserve` to the forfeited amount (`total_forfeited = forfeited + reserve`) and set `reserve = 0`.
     `forfeit_per_claimant = total_forfeited / unpaid_count` (if `unpaid_count == 0`, forfeit nothing and refund full deposit).
     `forfeit_pool_remaining = total_forfeited` (or 0 if unpaid_count == 0 or member was NOT paid).
     If the removed member was NOT paid, keep current behavior (full deposit refund).
     Closing means no more payouts happen.
   - **If unpaid and only remaining unpaid entry (`order_len == 1` or `current_period > order_len` after deletion):**
     1. Marks member `removed` and decrements `active_member_count`.
     2. Deletes their entry from `payout_order` (`order_len -= 1`).
     3. Does not cover this period and does not move any deposit.
     4. Refunds their full `deposit_remaining` to their wallet token account (verifying owner and mint).
     5. Sets status to `Filling` and sets `period_refundable = true` (leaving this period's contributions
        in the vault to be reclaimed by contributors via `claim_refund`).
     6. Emits `member_removed` event (covered = 0, reserved = 0, refunded = full deposit).
   - **Otherwise (standard removal):**
     1. Marks member `removed` and decrements `active_member_count`.
     2. **Coverage check:** Covers this period: requires `covered_amount == contribution` (erroring if deposit is insufficient), increments `contributions_this_period += 1`, and subtracts `contribution` from the member's `deposit_remaining`.
     3. If member has not been paid: refunds any remaining `deposit_remaining`.
     4. If member has been paid: moves `min(deposit_remaining, (order_len - current_period) * contribution)`
        into `reserve`, increments `pending_owing += 1` (reserve draws begin next period in payout,
        preventing double charging this period), and refunds any remaining deposit.
     5. If removal leaves no unpaid entries (`current_period > order_len`), sets status to `Filling`.
     6. Emits `member_removed` event with amounts covered, reserved, and refunded.
6. **flag_leaving**: signed by the member. Allowed while the circle is Active or Filling.
   Sets `leaving = true`. Emits `leaving_flagged`.
7. **exit_member**: callable by anyone for a given member. Allowed only when the circle is
   Filling or Closing, and either the member has `leaving == true` or the circle is Closing.
   When the circle is Closing, the member is not paid, `forfeit_claimed == false`, `forfeit_per_claimant > 0`, and the pool has enough (`forfeit_pool_remaining >= forfeit_per_claimant`): adds `forfeit_per_claimant` to the refund transfer, subtracts it from `forfeit_pool_remaining` using checked subtraction, and sets `forfeit_claimed = true`.
   Refunds the member's full `deposit_remaining` (plus any forfeit share) to their wallet token account (verifying owner and mint after checking vault balance),
   sets `deposit_remaining = 0`, sets status `Left`, and decrements `active_member_count`.
   Emits `member_left` (and `forfeit_claimed` if forfeit share was paid).
8. **claim_refund**: signed by the member. Allowed when the circle is Closing, or is Filling with
   `period_refundable == true`. Requires `current_period >= 1`, `member.last_contributed_period >= 1`, `member.last_contributed_period == current_period`, and `contributions_this_period > 0` (preventing repeated drain on cancelled Open circles). Returns
   exactly `contribution` from the vault (signed by Circle PDA seeds) to their wallet token account
   (verifying owner and mint after checking vault balance), then sets `last_contributed_period = 0` so it cannot be claimed twice, and decrements `contributions_this_period` with checked subtraction.
   Errors clearly if there is nothing to claim. Emits `refund_claimed`.
9. **claim_forfeit**: signed by the member. Allowed only when the circle is `Closing`. The member must
   be `Active`, not yet paid (`has_been_paid == false`), and `forfeit_claimed == false` (available for active unpaid members who have not exited). Requires `forfeit_pool_remaining >= amount` (`amount = forfeit_per_claimant`). Checks vault balance first, transfers
   `forfeit_per_claimant` from the vault (signed by Circle PDA seeds) to their wallet token account
   (verifying owner and mint), subtracts `amount` from `forfeit_pool_remaining` with checked subtraction, and sets `forfeit_claimed = true`. Emits `forfeit_claimed`.
10. **cancel_open_circle**: callable by anyone. Allowed only when the circle is `Open` and `now > open_deadline`.
    Transitions the circle to `Closing`. Once `Closing`, every active member can call `exit_member` to receive
    their full deposit refund. Emits `circle_cancelled`.
11. **reset_round**: callable by anyone once the last payout is done. Clears the
    period counters, pays out deposits of members who flagged `leaving` via `exit_member`, and drops
    removed members. Every seat that opened this way (up to the 10-seat maximum)
    goes into the 2-day filling window. If fewer than 3 members remain and the
    window ends without enough new members, the circle closes and all deposits
    are returned.
12. **join_open_seat**: during the filling window a new member pays the deposit
    for their slot and takes the next free position at the end of the order.
    The next round starts as soon as all seats are filled or the window ends,
    whichever comes first. Seats still empty then are closed for good, and the
    round runs with fewer members (at least 3).
    Seats that open mid-round are not filled until the next window, because a
    member joining late could collect a full pot without paying earlier periods.
13. **start_next_round**: callable by anyone once the window has ended or the
    seats are full.

Solana programs cannot run on a timer. Removal and payout only happen when
someone submits a transaction, which is why they are callable by anyone. The app
should call them automatically when a deadline passes.

## 6. Default handling

**Deposit size (decided: partial deposits):** a member in slot k locks
`max(deposit_pct * (N - k) * c, c)`. The first part is the chosen share of what they
would still owe after being paid. The floor of one contribution (`c`) means every
member, including the last slot, has enough locked to cover one missed contribution.
(An earlier version of this spec gave the last slot no deposit, which left the pot
short if that member defaulted before being paid. This fixes that.)

The deposit is locked, not spent, and stays locked across resets. It is returned
when the member leaves or the circle closes.

Example, 4 members, c = 10, 50%: slot 1 locks 15, slots 2 to 4 lock 10 each.

**When the deposit is not enough:** if a removed member owes more than their deposit
covers, the shortfall reduces the pots of the members who have not yet been paid.
Members already paid are not affected. The maximum shortfall is
`(1 - deposit_pct) * (N - k) * c` for a member in slot k.

When a member misses the contribution deadline plus grace:

1. **Closing takes priority (Forfeit on Closing):**
   In BOTH branches below, if after removal `active_member_count < min_members`, status is set to `Closing` (not `Filling`). In that case, do NOT cover this period from the defaulter's deposit.
   - If the removed member HAS been paid:
     `forfeited = min(deposit_remaining, (order_len - current_period + 1) * contribution)`.
     Refund only the rest (`deposit_remaining - forfeited`) to their wallet token account.
     Add the whole `circle.reserve` to the forfeited amount (`total_forfeited = forfeited + reserve`) and set `reserve = 0`.
     `forfeit_per_claimant = total_forfeited / unpaid_count` (if `unpaid_count == 0`, forfeit nothing and refund full deposit).
     `forfeit_pool_remaining = total_forfeited` (capped and tracked for claims).
   - If the removed member was NOT paid, keep current behavior (full refund).
   Closing means no more payouts happen.

2. **If unpaid and the only remaining unpaid entry (`order_len == 1` or `current_period > order_len` after deletion):**
   No payout will occur for this period as there are no subsequent unpaid members.
   - Do not cover this period and do not move any deposit into reserve.
   - Mark member `removed` and decrement `active_member_count` and `unpaid_count`.
   - Delete their entry from `payout_order` (`order_len -= 1`).
   - Refund their full `deposit_remaining` to their wallet token account.
   - Transition circle status to `Filling` and set `period_refundable = true` (leaving this period's collected contributions from other members in the vault awaiting reclamation via `claim_refund`).
   - Emit `member_removed` event with covered = 0, reserved = 0, refunded = full deposit.

3. **Otherwise (standard removal):**
   - **Coverage check:** Require `covered_amount == contribution` with a clear error if the member's remaining deposit cannot cover this period.
   - Their missing contribution for the current period is taken from their deposit
     (`contributions_this_period += 1`, `deposit_remaining -= c`), so the current
     recipient gets the full pot whenever possible.
   - They are marked `removed` and `active_member_count` decrements.
   - **If removed before being paid:** their slot is deleted from `payout_order`
     by shifting later entries left (`order_len -= 1`), and `unpaid_count -= 1`. Any remaining deposit is
     refunded to their wallet token account.
   - **If removed after being paid:** they already received a pot. Remaining periods
     owed = `order_len - current_period`. Funds equal to
     `min(deposit_remaining, remaining_periods * c)` are moved into the circle's
     `reserve`, `pending_owing` is incremented (so reserve draws begin on the NEXT period
     in payout, preventing double-charging for the current period), and any remainder of the
     deposit is refunded to their wallet token account.
   - In each subsequent payout, `draw = min(reserve, c * owing_count)` is taken
     from `reserve` and added to the pot. On the last period (`current_period == order_len`), the entire remaining reserve is swept into the pot (`draw = reserve`). When the period advances in `payout`,
     `owing_count += pending_owing`, `pending_owing = 0`, and `period_refundable = false`. If the reserve runs out, unpaid
     members absorb the shortfall through smaller pots.
   - If a removal leaves no unpaid entries (`current_period > order_len`), the circle
     transitions to `Filling`.

No separate percentage penalty is needed, because forfeiting contributions or
deposit is already the cost of quitting.

**Known limitation (decided, not to fix now):**
When a circle closes because it fell below the minimum (`active_member_count < min_members`), members who had not yet been paid lose the contributions they already paid out to earlier recipients. Unpaid members receive only their remaining deposit back (and any contribution made for the current uncompleted period via `claim_refund`, plus any forfeit share via `claim_forfeit`), while past contributions paid to earlier recipients cannot be recovered.

## 7. Invariants (test these)

- The vault balance always equals deposits still held, plus contributions not yet paid out, plus reserve, plus forfeited amounts not yet claimed.
- Never let any refund or payout exceed what the vault holds. Every vault transfer is preceded by a check verifying the vault token account has sufficient balance.
- No instruction can move funds to any address except a member's own wallet.
- Each member is paid at most once per round.
- A member's locked deposit is never below `max(deposit_pct * (N - k) * c, c)`.
- `deposit_pct` is between 25% and 100% and cannot change after the circle is created.
- Circle size is always between 3 and 10 when the round starts.
- No contributions or payouts happen during the filling window.
- Contribution is never below 5 USDC/USDT. Reject `create_circle` if it is.
- A removed member cannot contribute or be paid again in that round.
- `payout` and `remove_defaulter` cannot run before their deadlines.

### Test Checklist

1. **Cancelled-Circle Drain Test:**
   - **Scenario:** Creator creates circle (`Open`, `current_period = 0`, locks slot 1 deposit). Members may join or deadline expires.
   - `now > open_deadline` passes without reaching `members_target`.
   - `cancel_open_circle` transitions circle from `Open` to `Closing`.
   - At this state: `current_period == 0`, every member's `last_contributed_period == 0`, and `contributions_this_period == 0`.
   - **Verification 1:** Calling `claim_refund` MUST fail:
     - Fails check `current_period >= 1` (`SolthriftError::InvalidPeriod`).
     - Fails check `last_contributed_period >= 1` (`SolthriftError::NothingToClaim`).
     - Fails check `contributions_this_period > 0` (`SolthriftError::NoContributionsToRefund`).
     - Repeated drain is impossible.
   - **Verification 2:** Each joined member calls `exit_member`:
     - Receives their full deposit refund.
     - `deposit_remaining` becomes 0, `status` becomes `Left`.
     - Repeated `exit_member` fails with `SolthriftError::MemberNotActive`.
   - **Verification 3:** Final vault balance equals exactly 0.

2. **Paid Member Default in a 3-Member Circle Test (Detailed Amounts):**
   - **Parameters:** $N = 3$, $c = 10$, $deposit\_pct = 50\%$.
   - **Deposit Calculations ($k = 1, 2, 3$):**
     - Slot 1 ($k=1$): owed periods = $3 - 1 = 2$. $50\% \times 2 \times 10 = 10$ (floor 10) $\implies$ deposit = 10.
     - Slot 2 ($k=2$): owed periods = $3 - 2 = 1$. $50\% \times 1 \times 10 = 5$ (floor 10) $\implies$ deposit = 10.
     - Slot 3 ($k=3$): owed periods = $3 - 3 = 0$. $50\% \times 0 \times 10 = 0$ (floor 10) $\implies$ deposit = 10.
     - Total deposits locked in vault = $10 + 10 + 10 = 30$.
   - **Period 1:**
     - Members 1, 2, 3 each contribute 10. Total contributions = 30. Vault balance = $30 + 30 = 60$.
     - `payout` pays Period 1 pot to Member 1 (Slot 1): Pot = 30.
     - Member 1: `has_been_paid = true`. Circle: `unpaid_count = 2`, `current_period = 2`.
     - Vault balance remaining = $60 - 30 = 30$ (the 3 deposits).
   - **Period 2 Default & Removal:**
     - Member 1 defaults (does not contribute).
     - Period 2 deadline plus grace expires.
     - `remove_defaulter` is called for Member 1.
     - `active_member_count` decrements from 3 to 2.
     - Because $2 < min\_members$ (3), circle transitions to `Closing`.
     - **Forfeit & Refund Calculation:**
       - Member 1 has been paid, `unpaid_count` = 2 ($> 0$).
       - $order\_len = 3$, $current\_period = 2$.
       - Periods owed = $3 - 2 + 1 = 2$.
       - Amount owed = $2 \times 10 = 20$.
       - Member 1 `deposit_remaining` = 10.
       - Forfeited from deposit = $\min(10, 20) = 10$.
       - Refund to defaulter = $10 - 10 = 0$.
       - Defaulter `deposit_remaining` becomes 0; receives 0 refund.
       - `circle.reserve` was 0 $\implies total\_forfeited = 10 + 0 = 10$.
       - `circle.forfeit_pool_remaining = 10`.
       - `circle.forfeit_per_claimant = 10 / 2 = 5$.
     - Defaulter marked `Removed`.
     - Vault holds: 30 (Member 2 deposit 10 + Member 3 deposit 10 + forfeit pool 10) + any Period 2 contributions.
   - **Period 2 Contribution Refund Check:**
     - If Member 2 had contributed 10 before removal: vault holds 40, `contributions_this_period = 1`.
     - Member 2 calls `claim_refund`: receives 10; `contributions_this_period` drops from 1 to 0; vault drops to 30.
   - **Unpaid Member Exit & Forfeit Check:**
     - **Case A (Exit directly):**
       - Member 2 calls `exit_member`: receives deposit (10) + forfeit share (5) = 15.
       - `forfeit_pool_remaining` drops from 10 to 5. `member.forfeit_claimed = true`.
       - Member 3 calls `exit_member`: receives deposit (10) + forfeit share (5) = 15.
       - `forfeit_pool_remaining` drops from 5 to 0. `member.forfeit_claimed = true`.
       - Vault balance drops from 30 to 15, then from 15 to 0.
     - **Case B (Claim forfeit first, then exit):**
       - Member 2 calls `claim_forfeit`: receives 5. `forfeit_pool_remaining` drops from 10 to 5; vault drops to 25.
       - Member 2 calls `exit_member`: receives deposit (10). Vault drops to 15.
       - Member 3 exits: receives 15 (or claims 5 then 10). Vault drops to 0.
   - **Double-Claim Prevention:**
     - Once `forfeit_claimed == true`, neither `claim_forfeit` nor `exit_member` can grant forfeit again.

3. **Vault Balance is Never Negative Test:**
   - **Pre-transfer Check:** Every vault transfer in `payout`, `remove_defaulter`, `exit_member`, `claim_refund`, and `claim_forfeit` executes `require!(vault.amount >= amount, InsufficientVaultFunds)`.
   - **Conservation of Value:** At every state transition, vault balance strictly equals $\sum \text{deposit\_remaining} + \sum \text{unrefunded contributions} + \text{reserve} + \text{forfeit\_pool\_remaining}$.
   - **Safe Math:** All subtractions on balances, deposits, reserves, and forfeit pools use checked integer arithmetic (`checked_sub`).
   - **Rounding Truncation Dust:** If `total_forfeited` is not evenly divisible by `unpaid_count`, integer division truncates (`forfeit_per_claimant * unpaid_count <= total_forfeited`), leaving dust in `forfeit_pool_remaining` and vault, never overdrawing.

## 8. Events to emit (the on-chain record)

`circle_created`, `member_joined`, `round_started`, `contributed`,
`paid_out`, `member_removed`, `leaving_flagged`, `member_left`, `refund_claimed`, `forfeit_claimed`, `circle_cancelled`, `round_reset`, `seat_opened`, `seat_filled`, `seat_closed`, `circle_closed`.

## 9. Website layer

- A responsive website (works well on a phone browser, since many users will open
  it there). Deployed on a free static host.
- Connect and sign through a browser Solana wallet (wallet adapter).
- Show members by a shortened wallet address, with an optional display name.
- **Trigger buttons** on the circle page, because the program cannot run on a timer.
  Any member can press them; the program checks conditions and refuses if invalid:
  - "Pay out to [next member]" (active only when `contributions_this_period == expected_contributors`.
    There is no deadline path inside payout; late members must first be removed via `remove_defaulter`,
    which covers their contribution from their deposit and completes the contribution count).
    Draws from reserve for `owing_count` previously removed paid members, and adds `pending_owing`
    to `owing_count` upon advancing the period. On the final period, sweeps the entire reserve.
  - "Remove late member" (active after deadline plus grace has passed against an active member who has not contributed).
    If removing drops active members below minimum (3), sets status to `Closing`. Forfeits defaulting paid member's deposit and reserve to unpaid members, or refunds full deposit if unpaid.
    If the defaulter is the only remaining unpaid member and members >= 3, sets status to `Filling`, sets `period_refundable = true`, and refunds full deposit without covering.
  - "Flag leaving" (active while circle is Active or Filling; sets leaving flag so member can exit).
  - "Exit circle" (active when circle is Filling or Closing, and member has flagged leaving or circle is Closing; refunds deposit).
  - "Claim refund" (active when circle is Closing, or Filling with `period_refundable == true`, and member paid for current period).
  - "Claim forfeit share" (active when circle is Closing, for active unpaid members when forfeit is available).
  - "Cancel expired circle" (active when circle is Open and open window has expired).
  - "Start next round" (active when round is in `Filling` state and the filling window has ended).
  A free scheduled job that presses them automatically is optional [DECIDE].
- Join a circle through an invite link or QR code.
- A public circle page anyone can open: who has paid, who is next, who was removed,
  and every transaction linking to the block explorer. This is the "nobody can lie"
  view, and it should be the centerpiece of the demo.
- Optional [DECIDE]: a simple reliability record per wallet (rounds completed,
  times removed).

## 10. Scope for the hackathon

Build first: create, join, contribute, payout, remove_defaulter, reset_round.
A working live demo on the deployed site: 4 members, one round, one member removed.

Leave out: naira on/off-ramp, notifications backend, reputation across circles,
swaps, and multiple simultaneous circles UI polish.

## 11. Open decisions

- Default deposit percentage and allowed range (I suggested 50%, 25% to 100%).
- Who absorbs a shortfall when a deposit does not cover a default (currently the
  members not yet paid).
- Payout order (join order vs random).
- Whether removed-before-paid members get any partial refund.
- Whether a seat that opens mid-round should be fillable right away (needs a
  catch-up rule) or, as written, only at the next reset.
- Whether devnet counts for the submission. Confirm on the official form.
