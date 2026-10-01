export type TokenChoice = 'USDC' | 'USDT';

export interface CircleParameters {
  token: TokenChoice;
  members: number; // 3 to 10
  contribution: number; // minimum 5
  depositPct: number; // 25 to 100
  period: string; // e.g. "1 day" (demo) or "1 week"
  grace: string; // e.g. "6 hours" (demo)
  fillWindow: string; // "2 days"
  minMembers: number; // 3
}

export interface SlotDepositInfo {
  slot: number;
  depositLocked: number;
  maxShortfall: number;
  formulaDescription: string;
}

/**
 * Calculates slot deposit according to Section 6 of the spec:
 * max(deposit_pct * (N - k) * c, c)
 * where k is slot index (1 to N)
 */
export function calculateSlotDeposit(
  slotNumber: number,
  totalMembers: number,
  contribution: number,
  depositPct: number
): number {
  const depositRatio = depositPct / 100;
  const computed = depositRatio * (totalMembers - slotNumber) * contribution;
  const deposit = Math.max(computed, contribution);
  return Number(deposit.toFixed(2));
}

/**
 * Calculates max shortfall according to Section 6:
 * (1 - deposit_pct) * (N - k) * c
 */
export function calculateSlotShortfall(
  slotNumber: number,
  totalMembers: number,
  contribution: number,
  depositPct: number
): number {
  const shortfallRatio = 1 - (depositPct / 100);
  const shortfall = shortfallRatio * (totalMembers - slotNumber) * contribution;
  return Number(shortfall.toFixed(2));
}

export type MemberStatus = 'active' | 'removed' | 'left';

export interface CircleMember {
  slot: number;
  wallet: string; // shortened
  fullAddress: string;
  displayName: string;
  depositRemaining: number;
  hasContributedThisPeriod: boolean;
  hasBeenPaid: boolean;
  isNextRecipient: boolean;
  status: MemberStatus;
  missedDeadline?: boolean;
}

export type CircleState = 'Open' | 'Active' | 'Filling' | 'Closed';

export interface FakeCircleData {
  id: string;
  title: string;
  token: TokenChoice;
  membersCount: number;
  contribution: number;
  depositPct: number;
  periodLabel: string;
  graceLabel: string;
  state: CircleState;
  currentPeriod: number;
  totalPeriods: number;
  currentPot: number;
  deadlineTimestamp: number;
  graceDeadlineTimestamp: number;
  members: CircleMember[];
  recentEvents: Array<{
    id: string;
    event: string;
    description: string;
    timestamp: string;
    txHash: string;
  }>;
}
