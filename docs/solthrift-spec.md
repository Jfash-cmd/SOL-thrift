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
| min_members | Fixed at 3. If active members fall below 3, the round ends and refunds | 3 |

Use SOL only for network fees. The pot itself is in a stablecoin so payouts
keep the same value. A circle uses exactly one token for deposits, contributions
and payouts. Never mix USDC and USDT inside one circle, so nobody is paid in a
different coin than they put in. On devnet, create test mints for both, since
the real ones may not exist there.

## 3. Accounts

Because a circle never has more than 10 members, the Circle account can use a
fixed-size list of 10 member slots. That keeps account sizes and transaction
sizes predictable.

- **Circle** (PDA): parameters, status, current period, contributions_this_period, order_len, expected_contributors, reserve, owing_count, pending_owing, payout order, member list.
- **Member** (PDA per member per circle): wallet, slot number, deposit remaining,
  has_been_paid, last_contributed_period (0 = never), status (active / removed / left).
- **Vault** (token account owned by the Circle PDA): holds deposits,
  contributions, and reserve.

## 4. States

`Open` (members joining) -> `Active` (periods running) -> `Filling` (2-day window
after a round ends) -> `Active` again for the next round.
If active members drop below 3 (`min_members`), the circle transitions to `Closing`.
A round runs until every active member has received their payout. It then ends
and resets automatically: the same members and payout order carry over, and
the next round starts once the filling window ends. Deposits stay locked through a reset. A member who
flagged `leaving` takes their deposit out at the reset, with no penalty.

## 5. Instructions

1. **create_circle**: sets parameters. Creator becomes member 1.
2. **join_circle**: member pays their deposit into the vault and takes the next
   slot. Payout order = join order **[DECIDE]** (simple and verifiable).
   When N members have joined, the circle becomes Active automatically.
   Sets `order_len = members_target` and `expected_contributors = active_member_count`.
3. **contribute**: pays c into the vault for the current period. Signed by the
   member through their browser wallet before deadline plus grace. Sets
   `last_contributed_period = current_period` and increments `contributions_this_period`.
4. **payout**: sends the pot to that period's recipient (slot = `payout_order[current_period - 1]`).
   Callable by anyone, but allowed only when `contributions_this_period == expected_contributors`.
   Pot = `contributions_this_period * contribution` (real and covered contributions)
   + draw, where `draw = min(reserve, contribution * owing_count)`. The draw is
   subtracted from reserve. Transferred from vault signed by Circle PDA seeds.
   Sets `has_been_paid = true`. Moves `pending_owing` into `owing_count` and clears
   `pending_owing = 0` (so members removed this period begin reserve draws in the next period).
   After payout: if `current_period == order_len`, status
   transitions to `Filling`; otherwise `current_period += 1`, `contributions_this_period = 0`,
   `period_start_time = now`, and `expected_contributors = active_member_count`.
5. **remove_defaulter**: callable by anyone after deadline plus grace against an
   active member whose `last_contributed_period != current_period`.
   - **If unpaid and only remaining unpaid entry (`order_len == 1` or `current_period == order_len`):**
     1. Marks member `removed` and decrements `active_member_count`.
     2. Deletes their entry from `payout_order` (`order_len -= 1`).
     3. Does not cover this period and does not move any deposit.
     4. Refunds their full `deposit_remaining` to their connected wallet.
     5. Sets status to `Filling` (leaving this period's contributions in the vault for a refund instruction in a later chunk).
     6. Emits `member_removed` event (covered = 0, reserved = 0, refunded = full deposit).
   - **Otherwise (standard removal):**
     1. Marks member `removed` and decrements `active_member_count`.
     2. Covers this period: `contributions_this_period += 1` and subtracts `contribution`
        from the member's `deposit_remaining`.
     3. If member has not been paid: deletes their entry from `payout_order` (`order_len -= 1`)
        by shifting later entries left, and refunds any remaining `deposit_remaining`.
     4. If member has been paid: moves `min(deposit_remaining, (order_len - current_period) * contribution)`
        into `reserve`, increments `pending_owing += 1` (reserve draws begin next period in payout,
        preventing double charging this period), and refunds any remaining deposit.
     5. If `active_member_count < min_members`, sets status to `Closing`.
     6. If removal leaves no unpaid entries (`current_period > order_len`), sets status to `Filling`.
     7. Emits `member_removed` event with amounts covered, reserved, and refunded.
6. **flag_leaving**: a member marks that they want out. It takes effect at the
   next reset, with no penalty. Their unused deposit is sent to their wallet then.
7. **reset_round**: callable by anyone once the last payout is done. Clears the
   period counters, pays out deposits of members who flagged `leaving`, and drops
   removed members. Every seat that opened this way (up to the 10-seat maximum)
   goes into the 2-day filling window. If fewer than 3 members remain and the
   window ends without enough new members, the circle closes and all deposits
   are returned.
8. **join_open_seat**: during the filling window a new member pays the deposit
   for their slot and takes the next free position at the end of the order.
   The next round starts as soon as all seats are filled or the window ends,
   whichever comes first. Seats still empty then are closed for good, and the
   round runs with fewer members (at least 3).
   Seats that open mid-round are not filled until the next window, because a
   member joining late could collect a full pot without paying earlier periods.
9. **start_next_round**: callable by anyone once the window has ended or the
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

1. **If unpaid and the only remaining unpaid entry (`order_len == 1` or `current_period == order_len`):**
   No payout will occur for this period as there are no subsequent unpaid members.
   - Do not cover this period and do not move any deposit into reserve.
   - Mark member `removed` and decrement `active_member_count`.
   - Delete their entry from `payout_order` (`order_len -= 1`).
   - Refund their full `deposit_remaining` to their connected wallet.
   - Transition circle status to `Filling` (leaving this period's collected contributions from other members in the vault awaiting a refund instruction in a later chunk).
   - Emit `member_removed` event with covered = 0, reserved = 0, refunded = full deposit.

2. **Otherwise (standard removal):**
   - Their missing contribution for the current period is taken from their deposit
     (`contributions_this_period += 1`, `deposit_remaining -= c`), so the current
     recipient gets the full pot whenever possible.
   - They are marked `removed` and `active_member_count` decrements.
   - **If removed before being paid:** their slot is deleted from `payout_order`
     by shifting later entries left (`order_len -= 1`). Any remaining deposit is
     refunded to their connected wallet.
   - **If removed after being paid:** they already received a pot. Remaining periods
     owed = `order_len - current_period`. Funds equal to
     `min(deposit_remaining, remaining_periods * c)` are moved into the circle's
     `reserve`, `pending_owing` is incremented (so reserve draws begin on the NEXT period
     in payout, preventing double-charging for the current period), and any remainder of the
     deposit is refunded to their connected wallet.
   - In each subsequent payout, `draw = min(reserve, c * owing_count)` is taken
     from `reserve` and added to the pot. When the period advances in `payout`,
     `owing_count += pending_owing` and `pending_owing = 0`. If the reserve runs out, unpaid
     members absorb the shortfall through smaller pots.
   - If active members fall below `min_members` (3), the circle transitions to
     `Closing`.
   - If a removal leaves no unpaid entries (`current_period > order_len`), the circle
     transitions to `Filling`.

No separate percentage penalty is needed, because forfeiting contributions or
deposit is already the cost of quitting.

## 7. Invariants (test these)

- The vault balance always equals unspent deposits plus contributions not yet
  paid out.
- No instruction can move funds to any address except a member's own wallet.
- Each member is paid at most once per round.
- A member's locked deposit is never below `max(deposit_pct * (N - k) * c, c)`.
- `deposit_pct` is between 25% and 100% and cannot change after the circle is created.
- Circle size is always between 3 and 10 when the round starts.
- No contributions or payouts happen during the filling window.
- Contribution is never below 5 USDC/USDT. Reject `create_circle` if it is.
- A removed member cannot contribute or be paid again in that round.
- `payout` and `remove_defaulter` cannot run before their deadlines.

## 8. Events to emit (the on-chain record)

`circle_created`, `member_joined`, `round_started`, `contributed`,
`paid_out`, `member_removed`, `member_left`, `round_reset`, `seat_opened`, `seat_filled`, `seat_closed`, `circle_closed`.

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
    to `owing_count` upon advancing the period.
  - "Remove late member" (active after deadline plus grace has passed against an active member who has not contributed).
    If the defaulter is the only remaining unpaid member, refunds their full deposit without covering
    and transitions the circle to `Filling`.
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
