# Solthrift
Solthrift is a savings circle built on the Solana blockchain. It removes the need for a human collector or a central company. All group funds are locked inside program vaults on the blockchain. The program enforces payment deadlines, pot payouts, late penalties, and seat changes in code.
Most crypto savings programs make every user lock one hundred percent of their total commitment on day one. Solthrift uses partial deposits instead. Each member locks a fraction of what they will still owe after collecting their payout. This gives members early access to cash, while showing and limiting the risk of someone missing a payment from the start.

## 1. Core mechanics
### How a round works
A circle has between 3 and 10 members. Each member agrees to pay a fixed amount of an SPL token, such as USDC, every turn. A turn can be 7 days in normal use, or a few minutes in demo mode.
1. Formation (Open): A creator sets up the circle. They pick the payment amount, turn length, grace period, deposit percentage, seat count, and join deadline. The join deadline defaults to 7 days. Members join by locking their deposit into the circle vault. When every seat is filled, the circle starts automatically.
2. Running the round (Active):
- In every turn, each member pays their contribution.
- When all active members have paid, anyone can press the payout button. The program sends the collected pot to the member whose turn it is.
- The order of payouts follows the exact order in which members joined. Seat 1 receives the first pot, seat 2 receives the second, and so on.
3. Completion and reset (Filling):
- When every active member has collected their pot once, the round finishes.
- Members who marked themselves as leaving can pull out their deposit with no penalty.
- In the future design, new members will be able to take empty seats, and the circle will restart for another round. These reset and seat refill instructions are planned for future versions.
4. Early closing (Closing):
- If member removals cause the group to drop below 3 active members, or if an open circle expires before all seats fill, the circle switches to Closing mode.
- All future payouts stop.
- Members get their remaining deposits back.
- Members who paid into an unfinished turn can take their payment back using the refund button.
- Members who never received a pot split any forfeited deposits and leftover reserve funds equally.

## 2. The partial deposit model
In ordinary group savings, members who get paid early create risk for the group. They take out a full pot early, but still owe payments in later turns. Solthrift controls this risk with a simple deposit rule.
### Deposit rule
For a member in seat k out of N total seats:
The deposit equals the higher of two numbers: the deposit percentage applied to remaining future payments, or the cost of a single payment.
- Early seats: After receiving their pot, members in early seats still owe payments for the remaining turns. Their deposit scales directly with the payments they still owe.
- Last seat: The member in the last seat owes zero payments after receiving their pot. They still lock a minimum deposit equal to one payment. This ensures the last seat cannot skip early payments without a penalty.
- Deposit return: Deposits stay locked during the round. They are returned when a member cleanly exits or when the circle closes.
### Worked example
Here is an example with 4 members, a 10 USDC payment per turn, a 50 percent deposit rate, and a 40 USDC pot per turn:
- Seat 1: Still owes 3 future turns after payout (30 USDC). 50 percent of 30 USDC is 15 USDC. Seat 1 locks 15 USDC. When seat 1 collects the 40 USDC pot, they have paid 10 USDC and locked 15 USDC, leaving 15 USDC in immediate pocket cash.
- Seat 2: Still owes 2 future turns after payout (20 USDC). 50 percent of 20 USDC is 10 USDC. Seat 2 locks 10 USDC. After collecting the 40 USDC pot, seat 2 has paid 20 USDC in total and locked 10 USDC, leaving 10 USDC in net liquidity.
- Seat 3: Still owes 1 future turn after payout (10 USDC). 50 percent of 10 USDC is 5 USDC. Because the minimum deposit is one payment (10 USDC), seat 3 locks 10 USDC.
- Seat 4: Owes 0 future turns after payout. The minimum deposit rule applies, so seat 4 locks 10 USDC. Seat 4 acts as pure disciplined savings.

## 3. Handling missed payments and member default
Every turn has a payment deadline and an extra grace period. If a member does not pay before both deadlines expire, anyone can call the removal instruction. The program checks whether that member has already received a pot:
### When the late member was not paid yet
- The member is removed from the payout list.
- Because they never took an early pot, their remaining deposit is returned in full to their wallet.
- Future pots become smaller to match the lower number of active members.
### When the late member was already paid
- Immediate coverage: One payment is taken from their locked deposit to complete the current turn's pot. This protects members who already paid for that turn.
- Reserve fund: Any remaining deposit needed for future turns is moved into the circle's internal reserve.
- In future turns, the payout instruction draws money from this reserve to cover the missing seat's contribution.
- If the member had extra deposit money beyond what they owed, the surplus is returned to them.
### Minimum member limit
If removals cause the number of active members to drop below 3:
- The round stops right away and the circle switches to Closing mode.
- The late member forfeits their remaining deposit. This deposit and any leftover reserve are put into a shared forfeit fund.
- The forfeit fund is split equally among all active members who have not yet received a pot.
- Any member who already paid into the unfinished turn can use the refund instruction to withdraw their contribution from the vault.
 
## 4. On-chain architecture
### Program accounts
The program uses three kinds of program accounts to manage state:
- Circle account: Stores the circle rules, member list, payout order, turn counters, reserve balance, and current state.
- Vault account: A token account owned by the circle account. It securely holds all locked deposits, turn contributions, and reserve funds.
- Member account: Tracks an individual participant, including their seat number, locked deposit balance, payment record, and payout status.
### Lifecycle states
A circle moves through four distinct states:
- Open: The circle is waiting for members to join. Each participant locks their deposit upon joining. When all seats are filled, the circle starts. If the 7 day join deadline passes before the circle fills, anyone can cancel it so members can withdraw their deposits.
- Active: The round is running. In each turn, members submit their payments. Once all members pay, anyone can trigger the payout. If someone misses a payment past the grace period, anyone can trigger their removal.
- Filling: The intermission state between rounds once every active member has collected a pot. Members who flagged that they are leaving can exit and take their deposits. In the planned full system, new members can join open seats before starting the next round.
- Closing: The shutdown state triggered when active membership drops below 3, or when an unfilled circle is cancelled. Future payouts stop, members withdraw their deposits, and unpaid members share any forfeited deposits.
### Instructions in the smart contract
The Solana smart contract currently has 10 instructions:
- create_circle: Creates the circle account and vault, and places the creator in seat 1.
- join_circle: Deposits the required funds into the vault and assigns the user to the next open seat.
- contribute: Transfers the periodic turn payment from a member's wallet to the vault.
- payout: Sends the pot and any reserve draw to the recipient for the current turn.
- remove_defaulter: Removes a member who missed their payment deadline and grace period, applying deposit coverage and reserve rules.
- flag_leaving: Marks a member's intent to exit the circle at the end of the round without penalty.
- exit_member: Returns remaining deposits to a member and marks their status as left.
- claim_refund: Returns a member's turn payment from the vault if the turn was cancelled or interrupted.
- claim_forfeit: Lets an unpaid member claim their share of the defaulter forfeit pool during circle shutdown.
- cancel_open_circle: Cancels an open circle if the join deadline passes before all seats are filled.
The following instructions are planned for future versions to support multi-round cycles:
- reset_round: Resets turn counters and transitions a finished round into the filling state.
- join_open_seat: Lets a new member take a vacated seat during the filling state.
- start_next_round: Closes the filling window and starts the next active round.
- 
## 5. Repository structure
The project is organized into four main folders:
- program: Contains the Solana smart contract source code written in Rust with Anchor.
- web: Contains the user interface website built with React, Vite, and TypeScript.
- tests: Contains the TypeScript integration tests that verify contract behavior.
- docs: Contains the detailed specification of the economic model and protocol rules.

## 6. Local development setup
### Prerequisites
- Node.js version 18 or higher.
- Rust version 1.75 or higher.
- Solana command line tools version 1.18 or higher.
- Anchor framework version 0.29.
### Running the website
To run the website on your local machine:
1. Clone the repository using git clone https://github.com/Jfash-cmd/SOL-thrift.git.
2. Open the web folder using cd SOL-thrift/web.
3. Install the dependencies by running npm install.
4. Start the local server by running npm run dev.
5. Open http://localhost:5173 in your browser.
Connect a browser wallet set to the Solana devnet test network. You will need test SOL from faucet.solana.com for network fees, and test USDC from faucet.circle.com.
The website also has a built-in demo mode on the circle page. It generates temporary keys in memory for seats 2, 3, and 4 so you can test the full flow in one browser tab without extra wallet extensions.
### Building the contract
The smart contract was built and tested using Anchor version 0.29. You can build and deploy the contract using standard Anchor commands, or by pasting the contract into Solana Playground at beta.solpg.io and deploying to devnet.

## 7. Deployment guide
### Deploying to GitHub Pages
The website deploys directly to GitHub Pages using an automated GitHub Actions workflow:
1. Pushing new changes to the main branch automatically starts the deployment workflow.
2. The workflow installs project dependencies, builds the production bundle, and copies the main page to handle client-side routing.
3. The built files are published automatically to GitHub Pages.
To enable GitHub Pages for this repository:
1. Open repository Settings on GitHub.
2. Select Pages from the left menu.
3. Under Build and deployment, set the Source option to GitHub Actions.
4. Once the action finishes, the site is live at https://jfash-cmd.github.io/SOL-thrift/.

## 8. Network and contract addresses
- Network cluster: Solana devnet test network.
- Program address: CfY1M7cdgv1AvkLPuquqbCPNxMz73icdukWQP2sKdPq4.
- Token mint: Circle devnet test USDC at 4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU.
- Fee token: Devnet SOL, available for free from the Solana test faucet.
This project is a test prototype and runs only on the Solana test network. Do not send real funds to these addresses.

## 9. Security and trust assumptions
- Program custody: Program accounts hold all member deposits, payments, and reserves. No private wallet or developer key can withdraw funds outside of the program rules.
- Permissionless triggers: Solana programs cannot run on a background clock. Actions like paying out a turn, removing a late member, or cancelling an unfilled circle can be called by anyone as soon as the deadline conditions are met.
- Single token enforcement: Each circle uses a single token mint. Payments, deposits, and payouts never mix different tokens.
- Fixed seat order: The order of payouts is fixed when members join and cannot be changed later.
- Upgrade authority: The wallet that deployed the program holds the authority to upgrade it on devnet. In a production launch, this authority would be permanently removed or handed over to a multi-signature group before accepting real funds.

## 10. License
This project is licensed under the MIT License. See the LICENSE file for details.
