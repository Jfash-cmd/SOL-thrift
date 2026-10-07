# Solthrift

Solthrift is an on-chain rotating savings and credit association (ROSCA / *ajo* / *esusu* / *chit fund*) built on Solana. It eliminates the trusted intermediary or central collector by locking pooled funds inside program-derived token vaults and enforcing deadlines, payouts, penalties, and seat re-allocations strictly in code.

Unlike fully-collateralized savings protocols where every participant must lock 100% of their total commitments up front, Solthrift implements **parameterized partial deposits**. Members lock a percentage of what they will still owe after collecting their pot, enabling early cash-outs while capping and making visible the collective default risk from day one.

---

## 1. Core Mechanics

### How a Round Works
A circle consists of $N$ members ($3 \le N \le 10$). Each member agrees to contribute a fixed amount $c$ of an SPL token (e.g., USDC) every period (e.g., 7 days in production, minutes in demo).

1. **Formation (`Open`)**: The creator initializes the circle with parameters (contribution amount, period length, grace window, deposit percentage, member count, and join deadline). Members join by locking their initial deposit into the vault. When all $N$ seats are occupied, the circle activates automatically.
2. **Execution (`Active`)**:
   - In each period, members submit their contribution $c$.
   - Once all active members have contributed, anyone can invoke the permissionless `payout` instruction to send the pot to that period's designated recipient.
   - Payout order is deterministic and matches the sequence in which members joined.
3. **Completion & Reset (`Filling`)**:
   - Once all active members have collected their payout once, the round concludes.
   - A filling window opens. Members who flagged `leaving` can withdraw their deposit cleanly with zero penalty.
   - Open seats can be claimed by new participants (`join_open_seat`).
   - Once filled or upon window expiry, the circle restarts for the next round.
4. **Emergency / Liquidation (`Closing`)**:
   - If active membership drops below 3 (minimum safe threshold) due to removals, or if an open circle expires before filling, the circle enters `Closing` mode.
   - No further payouts occur.
   - Members recover remaining deposits via `exit_member`.
   - Contributors to the uncompleted period recover their payments via `claim_refund`.
   - Active unpaid members split remaining forfeited deposits and reserves via `claim_forfeit`.

---

## 2. The Partial Deposit Model

In traditional community savings, early recipients carry default risk because they take the full pot early and must continue paying into subsequent periods. Solthrift manages this mathematically:

### Deposit Calculation
For member at slot $k$ (1-indexed, $1 \le k \le N$):

$$\text{Deposit}(k) = \max\left(\frac{\text{deposit\_pct}}{100} \times (N - k) \times c,\; c\right)$$

- **Early slots ($k < N$)**: Still owe $(N - k)$ future contributions after their payout. Their deposit scales directly with that remaining liability.
- **Last slot ($k = N$)**: Has zero remaining liability after payout, but locks a hard floor of $1 \times c$. This guarantees that even the last slot cannot skip early rounds without consequence.
- **Deposit Persistence**: Deposits remain locked across round resets. They are returned in full when a member cleanly exits during the `Filling` window or when the circle closes.

### Worked Example
- $N = 4$ members
- Contribution $c = 10\text{ USDC}$
- Deposit percentage = $50\%$
- Total pot per period = $40\text{ USDC}$

| Slot $k$ | Remaining After Payout | Formula: $\max(0.5 \times (4 - k) \times 10, 10)$ | Locked Deposit | Cash Advantage at Payout |
|:---:|:---:|:---:|:---:|:---:|
| **Slot 1** | 3 periods ($30\text{ USDC}$) | $\max(15, 10) = 15$ | $15\text{ USDC}$ | Received $40$, locked $15$, paid $10 \implies \mathbf{+15\text{ USDC}}$ liquidity |
| **Slot 2** | 2 periods ($20\text{ USDC}$) | $\max(10, 10) = 10$ | $10\text{ USDC}$ | Received $40$, locked $10$, paid $20 \implies \mathbf{+10\text{ USDC}}$ liquidity |
| **Slot 3** | 1 period ($10\text{ USDC}$)  | $\max(5, 10) = 10$  | $10\text{ USDC}$ | Received $40$, locked $10$, paid $30 \implies \mathbf{0\text{ USDC}}$ liquidity |
| **Slot 4** | 0 periods ($0\text{ USDC}$)   | $\max(0, 10) = 10$  | $10\text{ USDC}$ | Received $40$, locked $10$, paid $40 \implies \text{Pure forced savings}$ |

---

## 3. Default Handling & Insolvency Protection

If a member fails to contribute before `period_deadline + grace_period`, any address can invoke `remove_defaulter`. The program resolves the default based on whether that member has already collected a payout:

### When the Defaulter was NOT Paid:
- Their slot is removed from the payout order (`order_len -= 1`).
- Because they never took unearned funds, their remaining deposit is returned in full to their wallet.
- Future pots adjust down to match the new active member count.

### When the Defaulter HAS Been Paid:
- **Immediate Coverage**: Exactly $c$ is deducted from the defaulter's deposit to cover the current period's pot, ensuring current contributors are not shortchanged.
- **Reserve Allocation**: The remainder of what they owe across future periods is transferred into the circle's internal `reserve`:
  $$\text{Reserve Transfer} = \min(\text{deposit\_remaining}, (\text{order\_len} - \text{current\_period}) \times c)$$
- In subsequent periods, the permissionless `payout` crank automatically draws from the reserve to make up the missing seat's contribution.
- If any deposit remains beyond future liabilities, it is refunded to the defaulter.

### Minimum Member Fallback (`Closing` State):
If removals cause the active member count to drop below 3:
- The round halts immediately and transitions to `Closing` mode.
- The defaulter forfeits their remaining deposit, and any accumulated reserve is pooled together into a shared forfeit fund.
- The forfeit fund is split evenly across all active members who had not yet received their payout (`forfeit_per_claimant`).
- Any member who already contributed to the unfinished period can call `claim_refund` to pull their contribution back from the vault.

---

## 4. On-Chain Architecture

### Program-Derived Addresses (PDAs)

| Account | Seeds | Purpose |
|---|---|---|
| **`Circle`** | `["circle", creator_pubkey, circle_id.to_le_bytes()]` | Stores configuration parameters, member list, payout order, period counters, reserve, and state machine status. Size: `530 bytes`. |
| **`Vault`** | `["vault", circle_pda]` | SPL Token Account owned by the Circle PDA. Holds locked deposits, periodic contributions, and reserve funds. |
| **`Member`** | `["member", circle_pda, member_wallet_pubkey]` | Tracks individual member state: slot number, deposit balance, payment history, payout receipt status, and flags. Size: `87 bytes`. |

### Lifecycle States

A Solthrift circle progresses through four distinct operational states:

- **`Open`**: The circle is created and waiting for members to join. Each participant deposits their calculated requirement upon entry. Once all target seats are occupied, the circle activates automatically. If the join deadline expires without reaching capacity, anyone can cancel the circle, transitioning it to `Closing` so all joined members can withdraw their deposits in full.
- **`Active`**: Normal rounds are in progress. In each period, members submit their contribution. When all active members have contributed, anyone can trigger `payout` to send the pooled pot to that period's recipient. If a member misses a payment past the grace deadline, they can be evicted via `remove_defaulter`.
- **`Filling`**: A 2-day intermission window between rounds. Once every active member has collected one payout, the round concludes. Members who previously called `flag_leaving` can exit penalty-free and retrieve their deposit (`exit_member`). New members can claim empty seats (`join_open_seat`). When ready, `start_next_round` begins the next cycle.
- **`Closing`**: Emergency shutdown state triggered if active members drop below 3, or if an open circle expires before filling. All future rounds are halted. Members recover their remaining deposits, contributors reclaim funds from unfinished periods via `claim_refund`, and unpaid members collect their share of forfeited deposits via `claim_forfeit`.

### Instruction Set

| Instruction | Signer | Callable By | Summary |
|---|---|---|---|
| `create_circle` | Creator | Anyone | Initializes Circle PDA, Vault PDA, and sets Creator as Member in Slot 1. |
| `join_circle` | Joining Wallet | Anyone | Deposits initial requirement into Vault and assigns the next open slot. |
| `contribute` | Member | Member | Transfers periodic contribution $c$ from wallet to Vault within grace window. |
| `payout` | Any (Crank) | Anyone | Transfers pot + reserve draw to current slot's recipient once period is fully funded. |
| `remove_defaulter`| Any (Crank) | Anyone | Evicts member who missed payment deadline + grace. Applies coverage / reserve logic. |
| `flag_leaving` | Member | Member | Flags intention to exit circle at the end of the round without penalty. |
| `exit_member` | Any (Crank) | Anyone | Returns deposit (+ forfeit share if Closing) and marks member status as `Left`. |
| `claim_refund` | Member | Member | Refunds contribution from Vault if current period was interrupted or cancelled. |
| `claim_forfeit` | Member | Unpaid Member | Claims pro-rata share of defaulter forfeit pool when circle enters `Closing`. |
| `cancel_open_circle`| Any (Crank) | Anyone | Transitions unfilled circle to `Closing` if `open_deadline` has passed. |
| `reset_round` | Any (Crank) | Anyone | Resets counters, handles exits, and transitions completed round to `Filling`. |
| `join_open_seat` | Joining Wallet | Anyone | Allows a new participant to take an vacated seat during `Filling`. |
| `start_next_round`| Any (Crank) | Anyone | Closes filling window and advances circle back to `Active` state. |

---

## 5. Repository Structure

```
SOL-thrift/
├── program/                 # Solana on-chain program (Anchor / Rust)
│   └── lib.rs               # Anchor program source (PDAs, instructions, state, errors)
├── tests/                   # Integration test suite (Anchor / Mocha / TypeScript)
│   ├── solthrift-happy-path.test.ts   # Full round creation, join, contributions, and payout
│   ├── solthrift-removal.test.ts      # Defaulter eviction, reserve allocation, and coverage
│   ├── solthrift-closing.test.ts      # Minimum member collapse, refunds, and forfeit split
│   └── solthrift-cancel.test.ts       # Open circle deadline expiry and clean exit
├── web/                     # Frontend client application (React 18 + Vite + TypeScript)
│   ├── src/
│   │   ├── components/      # UI components (CircleView, CreateCircle, LandingPage, etc.)
│   │   ├── idl/             # Compiled Anchor IDL for client bindings
│   │   ├── config.ts        # Program ID, cluster network, and default RPC endpoints
│   │   └── solthriftClient.ts # Web3 / Anchor RPC interaction layer and PDA derivations
│   ├── public/              # Static assets and SPA routing rules (_redirects)
│   ├── vercel.json          # Vercel SPA rewrite configuration
│   └── vite.config.ts       # Vite bundler configuration with Node.js polyfills
└── docs/
    └── solthrift-spec.md    # Formal protocol specification and economic parameters
```

---

## 6. Local Development Setup

### Prerequisites
- **Node.js**: v18.0.0 or higher
- **Rust**: `rustc` 1.75.0 or higher
- **Solana CLI**: `solana-cli` 1.18.0 or higher
- **Anchor CLI**: `anchor-cli` 0.29.0

### 1. Build and Test the Program
```bash
# Clone the repository
git clone https://github.com/Jfash-cmd/SOL-thrift.git
cd SOL-thrift

# Run integration tests against a local test validator
anchor test
```

### 2. Run the Web Application
```bash
cd web

# Install dependencies
npm install

# Start local development server
npm run dev
```
The application will be accessible at `http://localhost:5173`.

### 3. Production Build
```bash
cd web
npm run build
```
This runs `tsc -b` for strict typechecking and bundles production assets into `web/dist/`.

---

## 7. Deployment Guide

### Deploying the Web Client to Vercel
Because this repository is structured as a monorepo with the frontend inside `web/`, configure your deployment settings as follows:

1. Import `Jfash-cmd/SOL-thrift` on [Vercel](https://vercel.com).
2. Under **Project Settings** > **General**:
   - **Root Directory**: `web` *(Required)*
   - **Framework Preset**: `Vite`
   - **Build Command**: `npm run build`
   - **Output Directory**: `dist`
3. Deploy. The bundled [web/vercel.json](web/vercel.json) and [web/public/_redirects](web/public/_redirects) automatically configure client-side SPA routing for deep paths like `/circle/:address` and `/create`.

### Deploying to Netlify
1. Connect repository on [Netlify](https://netlify.com).
2. Set **Base directory** to `web`.
3. Set **Build command** to `npm run build`.
4. Set **Publish directory** to `web/dist`.

---

## 8. Network & Contract Addresses

| Parameter | Devnet Deployment |
|---|---|
| **Cluster** | Solana Devnet |
| **Program ID** | `CfY1M7cdgv1AvkLPuquqbCPNxMz73icdukWQP2sKdPq4` |
| **Explorer** | [View on Solana Explorer](https://explorer.solana.com/address/CfY1M7cdgv1AvkLPuquqbCPNxMz73icdukWQP2sKdPq4?cluster=devnet) |
| **Token Standard** | SPL Token (USDC / USDT test mints) |
| **Network Gas Token** | SOL (devnet airdrop for transaction fees) |

---

## 9. Security & Trust Assumptions

- **Non-Custodial**: Program-Derived Addresses (PDAs) custody all deposits, contributions, and reserves. No private key, multi-sig, or developer wallet can withdraw funds outside the codified instructions.
- **Permissionless Automation**: Solana does not have native cron execution. State transitions like `payout`, `remove_defaulter`, and `cancel_open_circle` are permissionless: any participant or automated crank bot can execute them as soon as their timestamp and balance preconditions are met.
- **Strict Token Isolation**: Each circle accepts exactly one designated SPL token mint. Contributions and payouts never mix denominations.
- **Deterministic Ordering**: Member payout positions are fixed upon joining and cannot be rearranged mid-cycle, eliminating favoritism.
