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

export type CircleState = 'Open' | 'Active' | 'Filling' | 'Closing' | 'Closed';

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

export type CircleStatusType = 'Open' | 'Active' | 'Filling' | 'Closing' | 'Closed';
export type RealMemberStatus = 'Active' | 'Removed' | 'Left';

import { BN } from '@coral-xyz/anchor';
import { PublicKey } from '@solana/web3.js';

export interface RealMemberData {
  slot: number;
  wallet: PublicKey;
  depositRemaining: BN;
  hasBeenPaid: boolean;
  lastContributedPeriod: number;
  status: RealMemberStatus;
  leaving: boolean;
  forfeitClaimed: boolean;
  memberPda: PublicKey;
}

export interface RealCircleData {
  address: PublicKey;
  creator: PublicKey;
  circleId: BN;
  tokenMint: PublicKey;
  vault: PublicKey;
  status: CircleStatusType;
  membersTarget: number;
  currentMemberCount: number;
  activeMemberCount: number;
  contributionsThisPeriod: number;
  orderLen: number;
  expectedContributors: number;
  reserve: BN;
  owingCount: number;
  pendingOwing: number;
  periodRefundable: boolean;
  unpaidCount: number;
  forfeitPerClaimant: BN;
  forfeitPoolRemaining: BN;
  contribution: BN;
  depositPct: number;
  periodDuration: BN;
  graceDuration: BN;
  fillWindowDuration: BN;
  openDeadline: BN;
  minMembers: number;
  currentPeriod: number;
  periodStartTime: BN;
  members: PublicKey[];
  payoutOrder: number[];
  loadedMembers: RealMemberData[];
}

/**
 * Calculates slot deposit according to Section 6 formula in lib.rs:
 * max(ceil(deposit_pct * (N - k) * c / 100), c)
 */
export function calculateSlotDepositBN(
  slot: number,
  membersTarget: number,
  contribution: BN,
  depositPct: number
): BN {
  if (slot >= membersTarget) {
    return contribution;
  }
  const remainingRounds = membersTarget - slot;
  const numerator = contribution.mul(new BN(depositPct * remainingRounds));
  const roundedUp = numerator.add(new BN(99)).div(new BN(100));
  return BN.max(roundedUp, contribution);
}

/**
 * Format raw integer token amount (with decimals) into human-readable string
 */
export function formatTokenAmount(rawAmount: BN | number | string, decimals: number = 6): string {
  const bn = new BN(rawAmount.toString());
  const factor = new BN(10).pow(new BN(decimals));
  const whole = bn.div(factor);
  const frac = bn.mod(factor).toString().padStart(decimals, '0').slice(0, 2);
  return frac === '00' ? whole.toString() : `${whole.toString()}.${frac}`;
}

/**
 * Parses Anchor 0.29 enum object or string into CircleStatusType
 */
export function parseCircleStatus(raw: any): CircleStatusType {
  if (!raw) return 'Open';
  if (typeof raw === 'string') {
    const s = raw.charAt(0).toUpperCase() + raw.slice(1).toLowerCase();
    if (['Open', 'Active', 'Filling', 'Closing', 'Closed'].includes(s)) {
      return s as CircleStatusType;
    }
  }
  if (typeof raw === 'object') {
    const keys = Object.keys(raw);
    if (keys.length > 0) {
      const k = keys[0].toLowerCase();
      if (k === 'open') return 'Open';
      if (k === 'active') return 'Active';
      if (k === 'filling') return 'Filling';
      if (k === 'closing') return 'Closing';
      if (k === 'closed') return 'Closed';
    }
  }
  return 'Open';
}

/**
 * Parses Anchor 0.29 enum object or string into MemberStatus
 */
export function parseMemberStatus(raw: any): 'Active' | 'Removed' | 'Left' {
  if (!raw) return 'Active';
  if (typeof raw === 'string') {
    const s = raw.charAt(0).toUpperCase() + raw.slice(1).toLowerCase();
    if (['Active', 'Removed', 'Left'].includes(s)) {
      return s as any;
    }
  }
  if (typeof raw === 'object') {
    const keys = Object.keys(raw);
    if (keys.length > 0) {
      const k = keys[0].toLowerCase();
      if (k === 'active') return 'Active';
      if (k === 'removed') return 'Removed';
      if (k === 'left') return 'Left';
    }
  }
  return 'Active';
}


