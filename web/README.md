# Solthrift Web Application

Frontend for Solthrift: on-chain rotating savings circle on Solana.
Built with **Vite**, **React**, and **TypeScript**. Configured for **Solana Devnet**.

## Getting Started Locally

### Prerequisites
- Node.js (v18+)
- npm (v9+)

### Installation
From the repository root or the `web/` directory:

```bash
cd web
npm install
```

### Running Local Development Server
To launch the Vite development server:

```bash
npm run dev
```

Open [http://localhost:5173](http://localhost:5173) in your browser.

### Building for Production
To verify TypeScript compilation and create an optimized static production bundle:

```bash
npm run build
```

Production static assets will be output to `web/dist/`, suitable for deployment to any free static host (e.g. Vercel, Netlify, GitHub Pages, Cloudflare Pages).

### Previewing the Production Build
```bash
npm run preview
```

---

## Features Implemented (Mock Data)
1. **Solana Wallet Adapter**:
   - Configured for Solana Devnet.
   - Connect modal supporting standard browser wallets (Phantom, Solflare, etc.).
   - Displays shortened wallet address (`7xKX...gAs1`), quick copy action, and disconnect options.
2. **Create Circle Page**:
   - Parameter configuration per Section 2: Token (USDC or USDT), Members (3 to 10), Contribution (minimum 5), Deposit Percentage (25% to 100%), Period, Grace.
   - Real-time limit validation.
   - Dynamic Section 6 Deposit Schedule calculation: evaluates `max(deposit_pct * (N - k) * c, c)` and max group shortfall for each slot $k \in [1, N]$.
3. **Circle Dashboard Page**:
   - 4-member rotating savings circle fake data: Alice (Creator/Paid), Bob (Current Recipient), Charlie (Paid), Dave (Defaulted/Removed).
   - Dynamic countdown timer to period deadline and grace window.
   - Section 9 Trigger Buttons with reactive active/disabled states:
     - `Pay out to [Recipient]`
     - `Remove late member`
     - `Start next round`
   - Interactive Scenario Switcher to test trigger states across lifecycle phases.
   - On-chain activity ledger ("Nobody Can Lie" explorer links).
