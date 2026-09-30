# Solthrift

Solthrift is an on-chain rotating savings circle (ajo / thrift) on Solana featuring real early payouts, where no person or company holds the money and all rules are enforced by code.

## Project Summary

Solthrift enables group savings with partial deposits: each member locks a set percentage of what they would still owe after being paid. This structure allows members paid early in the cycle to receive real early cash—similar to traditional ajo—while capping and making visible the group's default risk up front.

### Key Highlights
- **Non-custodial & secure**: Funds sit in a program-owned vault. No collector, company, or single key holder can run off with the pot.
- **Transparent on-chain records**: Everyone can see who has contributed, who is next in line, and every transaction is verifiable on-chain.
- **Automated rule enforcement**: Deadlines, payouts, and defaulter removals are executed by program instructions without dispute.
- **Controlled early payout**: Group risk is transparently capped by the deposit percentage chosen when creating the circle.

---

> **Note**: This build follows the detailed specification outlined in [`docs/solthrift-spec.md`](docs/solthrift-spec.md).
