import type { FC } from 'react';
import { useState, useEffect, useCallback, useRef } from 'react';
import { useConnection, useWallet } from '@solana/wallet-adapter-react';
import { useWalletModal } from '@solana/wallet-adapter-react-ui';
import { PublicKey, TransactionInstruction, SystemProgram, Keypair } from '@solana/web3.js';
import { TOKEN_PROGRAM_ID } from '@solana/spl-token';
import { BN } from '@coral-xyz/anchor';
import {
  ShieldAlert,
  Clock,
  CheckCircle,
  XCircle,
  ExternalLink,
  Award,
  Wallet,
  Coins,
  Search,
  Loader2,
  AlertTriangle,
  CheckCircle2,
  Copy,
  Check,
  UserPlus,
  RefreshCw,
  Info,
  History,
  ArrowRight,
  LogOut,
  ChevronDown,
  ChevronUp,
  X,
  Sparkles,
  Play,
  Pause,
} from 'lucide-react';

import type { RealCircleData, RealMemberData } from '../types';
import {
  calculateSlotDepositBN,
  formatTokenAmount,
  parseCircleStatus,
  parseMemberStatus,
} from '../types';
import {
  getSolthriftProgram,
  getMemberPda,
  getOrCreateAtaInstruction,
  getMintDecimals,
  getTokenBalance,
  getExplorerUrl,
  translateProgramError,
  executeProgramMethod,
  isUserCancellation,
  extractSolanaAddress,
  createKeypairWallet,
  fundDemoMembers,
} from '../solthriftClient';
import { isPlaceholderMint } from '../config';
import { CircleRing } from './CircleRing';
import { SolanaLogo3D } from './SolanaLogo3D';
import { Reveal } from './Reveal';
import { useWalletError } from './WalletContextProvider';

interface CircleViewProps {
  circleAddress?: string | null;
  onSelectCircle?: (address: string) => void;
  onNavigateCreate?: () => void;
}

export const CircleView: FC<CircleViewProps> = ({
  circleAddress,
  onSelectCircle,
  onNavigateCreate,
}) => {
  const { connection } = useConnection();
  const wallet = useWallet();
  const { select, disconnect, connecting, connected, publicKey, wallet: currentWallet } = wallet;
  const { setVisible } = useWalletModal();
  const { clearWalletError } = useWalletError();

  // Selected seat for cockpit interaction & seamless wallet switching
  const [selectedSeat, setSelectedSeat] = useState<number>(1);

  // Request ID and cancellation tracking for wallet switching (Requirement 2)
  const walletRequestIdRef = useRef<number>(0);
  const activeAbortControllerRef = useRef<AbortController | null>(null);
  const walletDebounceTimerRef = useRef<NodeJS.Timeout | null>(null);
  const [isWalletDataLoading, setIsWalletDataLoading] = useState<boolean>(false);

  // Per-(wallet, circle, action) in-flight lock to guarantee exactly-once execution (Requirement 5)
  const actionLockRef = useRef<Record<string, boolean>>({});

  // Seamless wallet switch shortcut (Requirement 6):
  // Cleanly disconnects the adapter, resets selection, and opens the wallet picker modal in one smooth sequence
  const handlePromptSwitchWallet = useCallback(async (slotNum?: number) => {
    if (typeof slotNum === 'number') {
      setSelectedSeat(slotNum);
    }
    console.log(`[WalletEvent ${new Date().toISOString()}] handlePromptSwitchWallet called for seat:`, slotNum);
    try {
      await disconnect();
    } catch (err) {
      console.warn('[Wallet Switch Shortcut] disconnect note:', err);
    }
    try {
      select(null as any);
    } catch {}
    clearWalletError();
    setVisible(true);
  }, [disconnect, select, setVisible, clearWalletError]);

  // Search input & loaded circle state
  const [inputAddress, setInputAddress] = useState<string>(circleAddress || '');
  const [loading, setLoading] = useState<boolean>(false);
  const [isRefreshing, setIsRefreshing] = useState<boolean>(false);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [circle, setCircle] = useState<RealCircleData | null>(null);
  const [tokenDecimals, setTokenDecimals] = useState<number>(6);

  // Address copy feedback
  const [copiedCircle, setCopiedCircle] = useState<boolean>(false);
  const [copiedCircleLink, setCopiedCircleLink] = useState<boolean>(false);
  const [cockpitExpanded, setCockpitExpanded] = useState<boolean>(true);
  const [copiedMemberIdx, setCopiedMemberIdx] = useState<number | null>(null);

  // Transaction execution state
  const [txPending, setTxPending] = useState<boolean>(false);
  const [txPendingMsg, setTxPendingMsg] = useState<string | null>(null);
  const [txSuccess, setTxSuccess] = useState<{ signature?: string; message: string } | null>(null);
  const [txError, setTxError] = useState<{ message: string; details?: string } | null>(null);

  // Auto-dismiss transaction error after 5 seconds
  useEffect(() => {
    if (txError) {
      const timer = setTimeout(() => {
        setTxError(null);
      }, 5000);
      return () => clearTimeout(timer);
    }
  }, [txError]);

  // Auto-dismiss transaction success banner after 7 seconds
  useEffect(() => {
    if (txSuccess) {
      const timer = setTimeout(() => {
        setTxSuccess(null);
      }, 7000);
      return () => clearTimeout(timer);
    }
  }, [txSuccess]);

  // Clear any transaction error when user switches wallet account
  useEffect(() => {
    setTxError(null);
  }, [publicKey]);

  // Auto-Payout and Auto-Remove demo toggles
  const [autoPayoutEnabled, setAutoPayoutEnabled] = useState<boolean>(false);
  const [autoRemoveEnabled, setAutoRemoveEnabled] = useState<boolean>(false);

  // Devnet Demo Mode State (Requirement 1: Available ONLY when RPC endpoint is devnet)
  const isDevnet = connection.rpcEndpoint.toLowerCase().includes('devnet');
  const [demoMode, setDemoMode] = useState<boolean>(false);

  // Requirement 2: 3 throwaway keypairs with Keypair.generate(), kept in memory only!
  // Never write them to localStorage, sessionStorage, files, or console; never offer export; never log.
  const [demoKeypairs, setDemoKeypairs] = useState<{ [slot: number]: Keypair } | null>(null);
  const [demoBalances, setDemoBalances] = useState<{ [slot: number]: { sol: number; token: number } }>({});
  const [showFundPanel, setShowFundPanel] = useState<boolean>(false);
  const [showAutopilot, setShowAutopilot] = useState<boolean>(false);

  // Requirement 3: Editable funding amounts for each demo seat (defaults: 0.05 SOL each; seat 2: 15, seat 3: 15, seat 4: 10)
  const [fundAmounts, setFundAmounts] = useState<{ [slot: number]: { sol: number; token: number } }>({
    2: { sol: 0.05, token: 15 },
    3: { sol: 0.05, token: 15 },
    4: { sol: 0.05, token: 10 },
  });

  // Toggle Demo Mode
  const toggleDemoMode = useCallback(() => {
    setDemoMode((prev) => {
      const next = !prev;
      if (next) {
        if (!demoKeypairs) {
          const k2 = Keypair.generate();
          const k3 = Keypair.generate();
          const k4 = Keypair.generate();
          setDemoKeypairs({ 2: k2, 3: k3, 4: k4 });
        }
      }
      return next;
    });
  }, [demoKeypairs]);

  // Fetch demo balances helper
  const fetchDemoBalances = useCallback(async () => {
    if (!demoKeypairs || !circle) return;
    const nextBals: { [slot: number]: { sol: number; token: number } } = {};
    for (const slot of [2, 3, 4]) {
      const kp = demoKeypairs[slot];
      if (!kp) continue;
      try {
        const lamports = await connection.getBalance(kp.publicKey, 'confirmed');
        const sol = lamports / 1e9;
        let token = 0;
        try {
          token = await getTokenBalance(connection, circle.tokenMint, kp.publicKey);
        } catch {}
        nextBals[slot] = { sol, token };
      } catch {}
    }
    setDemoBalances(nextBals);
  }, [connection, demoKeypairs, circle]);

  useEffect(() => {
    if (demoMode && demoKeypairs && circle) {
      fetchDemoBalances();
    }
  }, [demoMode, demoKeypairs, circle, fetchDemoBalances]);

  // Requirement 3: Fund demo members handler (1 transaction signed by connected wallet)
  const handleFundDemoMembers = async () => {
    if (!connected || !publicKey) {
      setTxError({ message: 'Connect your wallet to fund demo members.' });
      return;
    }
    if (!circle) return;
    if (!demoKeypairs) {
      setTxError({ message: 'Demo keypairs not initialized. Enable Demo Mode first.' });
      return;
    }

    setTxPending(true);
    setTxPendingMsg('Funding demo members with SOL and USDC in one transaction...');
    setTxError(null);
    setTxSuccess(null);

    try {
      const sigs = await fundDemoMembers({
        connection,
        payerWallet: wallet as any,
        tokenMint: circle.tokenMint,
        tokenDecimals,
        recipients: [
          {
            publicKey: demoKeypairs[2].publicKey,
            solAmount: fundAmounts[2]?.sol ?? 0.05,
            tokenAmount: fundAmounts[2]?.token ?? 15,
          },
          {
            publicKey: demoKeypairs[3].publicKey,
            solAmount: fundAmounts[3]?.sol ?? 0.05,
            tokenAmount: fundAmounts[3]?.token ?? 15,
          },
          {
            publicKey: demoKeypairs[4].publicKey,
            solAmount: fundAmounts[4]?.sol ?? 0.05,
            tokenAmount: fundAmounts[4]?.token ?? 10,
          },
        ],
        onStatusChange: (status) => setTxPendingMsg(status),
      });

      const firstSig = sigs[0] || '';
      setTxSuccess({
        signature: firstSig,
        message: 'Funded Demo Seats 2, 3, and 4 successfully!',
      });

      await fetchDemoBalances();
    } catch (err: any) {
      console.error('fundDemoMembers failed:', err);
      if (isUserCancellation(err)) return;
      const translated = translateProgramError(err);
      setTxError({ message: translated.message, details: translated.details });
    } finally {
      setTxPending(false);
      setTxPendingMsg(null);
    }
  };

  // Requirement 6: "Run the demo for me" Autopilot Engine
  interface AutopilotStepItem {
    id: string;
    title: string;
    status: 'pending' | 'running' | 'waiting_approval' | 'done' | 'failed' | 'skipped';
    signature?: string;
    detail?: string;
  }

  const [autopilotRunning, setAutopilotRunning] = useState<boolean>(false);
  const [autopilotWaitingApproval, setAutopilotWaitingApproval] = useState<boolean>(false);
  const [autopilotApprovalPrompt, setAutopilotApprovalPrompt] = useState<string | null>(null);
  const [autopilotCountdown, setAutopilotCountdown] = useState<number | null>(null);
  const [autopilotError, setAutopilotError] = useState<string | null>(null);
  const autopilotCancelRef = useRef<boolean>(false);

  const initialAutopilotSteps: AutopilotStepItem[] = [
    { id: 'fund_check', title: 'Verify Demo Seats 2-4 Funding', status: 'pending' },
    { id: 'join_seat_2', title: 'Demo Seat 2 Joins Circle', status: 'pending' },
    { id: 'join_seat_3', title: 'Demo Seat 3 Joins Circle', status: 'pending' },
    { id: 'join_seat_4', title: 'Demo Seat 4 Joins Circle (Circle Becomes Active)', status: 'pending' },
    { id: 'turn1_seat1', title: 'Turn 1: Seat 1 Contributes (Requires Real Wallet Approval)', status: 'pending' },
    { id: 'turn1_seat2', title: 'Turn 1: Seat 2 Contributes (Demo Key)', status: 'pending' },
    { id: 'turn1_seat3', title: 'Turn 1: Seat 3 Contributes (Demo Key)', status: 'pending' },
    { id: 'turn1_seat4', title: 'Turn 1: Seat 4 Contributes (Demo Key)', status: 'pending' },
    { id: 'turn1_payout', title: 'Turn 1: Payout Distributed', status: 'pending' },
    { id: 'turn2_seat1', title: 'Turn 2: Seat 1 Contributes (Requires Real Wallet Approval)', status: 'pending' },
    { id: 'turn2_seat2', title: 'Turn 2: Seat 2 Contributes (Demo Key)', status: 'pending' },
    { id: 'turn2_seat3', title: 'Turn 2: Seat 3 Contributes (Demo Key)', status: 'pending' },
    { id: 'turn2_seat4', title: 'Turn 2: Seat 4 Misses Payment (Defaulter Scenario)', status: 'pending' },
    { id: 'turn2_wait', title: 'Turn 2: Wait for Grace Period to Expire (Live Countdown)', status: 'pending' },
    { id: 'turn2_remove', title: 'Turn 2: Remove Late Member (Seat 4 Evicted)', status: 'pending' },
    { id: 'turn2_payout', title: 'Turn 2: Payout Distributed', status: 'pending' },
  ];

  const [autopilotSteps, setAutopilotSteps] = useState<AutopilotStepItem[]>(initialAutopilotSteps);

  const updateAutopilotStep = useCallback((
    stepId: string,
    status: 'pending' | 'running' | 'waiting_approval' | 'done' | 'failed' | 'skipped',
    sig?: string,
    detail?: string
  ) => {
    setAutopilotSteps((prev) =>
      prev.map((s) => (s.id === stepId ? { ...s, status, signature: sig || s.signature, detail: detail || s.detail } : s))
    );
  }, []);

  const stopAutopilot = useCallback(() => {
    autopilotCancelRef.current = true;
    setAutopilotRunning(false);
    setAutopilotWaitingApproval(false);
    setAutopilotApprovalPrompt(null);
    setAutopilotCountdown(null);
  }, []);

  const resetAutopilot = useCallback(() => {
    stopAutopilot();
    setAutopilotSteps(initialAutopilotSteps);
    setAutopilotError(null);
  }, [stopAutopilot]);

  const continueAutopilotAfterTurn2Seat1 = async () => {
    if (!circle || !demoKeypairs || autopilotCancelRef.current) return;
    setAutopilotWaitingApproval(false);
    setAutopilotApprovalPrompt(null);

    try {
      // Step 11: Seat 2 contributes Turn 2
      const m2 = circle.loadedMembers.find((m) => m.slot === 2);
      if (m2 && m2.lastContributedPeriod < 2) {
        updateAutopilotStep('turn2_seat2', 'running');
        const s2 = await handleContribute(m2, createKeypairWallet(demoKeypairs[2]));
        updateAutopilotStep('turn2_seat2', 'done', s2);
      } else {
        updateAutopilotStep('turn2_seat2', 'done');
      }

      // Step 12: Seat 3 contributes Turn 2
      if (autopilotCancelRef.current) return;
      const m3 = circle.loadedMembers.find((m) => m.slot === 3);
      if (m3 && m3.lastContributedPeriod < 2) {
        updateAutopilotStep('turn2_seat3', 'running');
        const s3 = await handleContribute(m3, createKeypairWallet(demoKeypairs[3]));
        updateAutopilotStep('turn2_seat3', 'done', s3);
      } else {
        updateAutopilotStep('turn2_seat3', 'done');
      }

      // Step 13: Seat 4 does not contribute (defaulter scenario)
      if (autopilotCancelRef.current) return;
      updateAutopilotStep('turn2_seat4', 'skipped', undefined, 'Seat 4 deliberately misses payment');

      // Step 14: Wait for deadline with live countdown
      if (autopilotCancelRef.current) return;
      updateAutopilotStep('turn2_wait', 'running');
      const freshCircle = (await loadCircleData(circle.address.toBase58(), true)) || circle;
      const deadline = Number(freshCircle.periodStartTime) + Number(freshCircle.periodDuration) + Number(freshCircle.graceDuration);
      while (!autopilotCancelRef.current) {
        const cur = Math.floor(Date.now() / 1000);
        const rem = deadline - cur;
        setAutopilotCountdown(Math.max(rem, 0));
        if (cur > deadline + 2) break;
        await new Promise((r) => setTimeout(r, 1000));
      }
      setAutopilotCountdown(null);
      if (autopilotCancelRef.current) return;
      updateAutopilotStep('turn2_wait', 'done', undefined, 'Grace period expired');

      // Reload fresh circle
      const freshAfterWait = (await loadCircleData(circle.address.toBase58(), true)) || circle;

      // Step 15: Remove late member
      if (autopilotCancelRef.current) return;
      updateAutopilotStep('turn2_remove', 'running');
      const m4 = freshAfterWait.loadedMembers.find((m) => m.slot === 4);
      const remSig = await handleRemoveDefaulter(m4);
      updateAutopilotStep('turn2_remove', 'done', remSig);

      await loadCircleData(circle.address.toBase58(), true);

      // Step 16: Turn 2 Payout
      if (autopilotCancelRef.current) return;
      updateAutopilotStep('turn2_payout', 'running');
      const payoutSig2 = await handlePayout();
      updateAutopilotStep('turn2_payout', 'done', payoutSig2);

      setAutopilotRunning(false);
      setTxSuccess({
        signature: payoutSig2 || '',
        message: 'Demo walkthrough autopilot finished successfully!',
      });
    } catch (err: any) {
      console.error('Autopilot Turn 2 error:', err);
      const translated = translateProgramError(err);
      setAutopilotError(`Autopilot stopped at Turn 2: ${translated.message}`);
      setAutopilotRunning(false);
    }
  };

  const continueAutopilotAfterTurn1Seat1 = async () => {
    if (!circle || !demoKeypairs || autopilotCancelRef.current) return;
    setAutopilotWaitingApproval(false);
    setAutopilotApprovalPrompt(null);

    try {
      // Step 6: Seat 2 contributes Turn 1
      const m2 = circle.loadedMembers.find((m) => m.slot === 2);
      if (m2 && m2.lastContributedPeriod < 1) {
        updateAutopilotStep('turn1_seat2', 'running');
        const s2 = await handleContribute(m2, createKeypairWallet(demoKeypairs[2]));
        updateAutopilotStep('turn1_seat2', 'done', s2);
      } else {
        updateAutopilotStep('turn1_seat2', 'done');
      }

      // Step 7: Seat 3 contributes Turn 1
      if (autopilotCancelRef.current) return;
      const m3 = circle.loadedMembers.find((m) => m.slot === 3);
      if (m3 && m3.lastContributedPeriod < 1) {
        updateAutopilotStep('turn1_seat3', 'running');
        const s3 = await handleContribute(m3, createKeypairWallet(demoKeypairs[3]));
        updateAutopilotStep('turn1_seat3', 'done', s3);
      } else {
        updateAutopilotStep('turn1_seat3', 'done');
      }

      // Step 8: Seat 4 contributes Turn 1
      if (autopilotCancelRef.current) return;
      const m4 = circle.loadedMembers.find((m) => m.slot === 4);
      if (m4 && m4.lastContributedPeriod < 1) {
        updateAutopilotStep('turn1_seat4', 'running');
        const s4 = await handleContribute(m4, createKeypairWallet(demoKeypairs[4]));
        updateAutopilotStep('turn1_seat4', 'done', s4);
      } else {
        updateAutopilotStep('turn1_seat4', 'done');
      }

      // Step 9: Turn 1 Payout
      if (autopilotCancelRef.current) return;
      updateAutopilotStep('turn1_payout', 'running');
      const payoutSig1 = await handlePayout();
      updateAutopilotStep('turn1_payout', 'done', payoutSig1);

      await loadCircleData(circle.address.toBase58(), true);

      // Step 10: Turn 2 Seat 1 contributes (Requires Real Wallet)
      if (autopilotCancelRef.current) return;
      const mem1_t2 = circle.loadedMembers.find((m) => m.slot === 1);
      if (mem1_t2 && mem1_t2.lastContributedPeriod < 2) {
        updateAutopilotStep('turn2_seat1', 'waiting_approval');
        setAutopilotWaitingApproval(true);
        setAutopilotApprovalPrompt('Turn 2: Please approve Seat 1 contribution in your wallet.');
        return;
      } else {
        updateAutopilotStep('turn2_seat1', 'done', undefined, 'Seat 1 already paid for Turn 2');
      }

      await continueAutopilotAfterTurn2Seat1();
    } catch (err: any) {
      console.error('Autopilot Turn 1 error:', err);
      const translated = translateProgramError(err);
      setAutopilotError(`Autopilot stopped at Turn 1: ${translated.message}`);
      setAutopilotRunning(false);
    }
  };

  const runAutopilot = async () => {
    if (!circle) return;
    if (!demoKeypairs) {
      setTxError({ message: 'Enable Demo Mode first to initialize throwaway keys.' });
      return;
    }
    autopilotCancelRef.current = false;
    setAutopilotRunning(true);
    setAutopilotError(null);

    try {
      // Step 1: Verify funding
      updateAutopilotStep('fund_check', 'running');
      await fetchDemoBalances();
      const b2 = demoBalances[2]?.sol ?? 0;
      const b3 = demoBalances[3]?.sol ?? 0;
      const b4 = demoBalances[4]?.sol ?? 0;
      if (b2 < 0.01 || b3 < 0.01 || b4 < 0.01) {
        updateAutopilotStep('fund_check', 'failed', undefined, 'Demo seats lack SOL. Click "Fund demo members" above.');
        setAutopilotError('Demo seats 2 to 4 do not have SOL. Please click "Fund demo members" above first.');
        setAutopilotRunning(false);
        return;
      }
      updateAutopilotStep('fund_check', 'done');

      // Step 2: Seat 2 joins
      if (autopilotCancelRef.current) return;
      const mem2 = circle.loadedMembers.find((m) => m.slot === 2);
      if (!mem2) {
        updateAutopilotStep('join_seat_2', 'running');
        const sig2 = await handleJoinCircle(createKeypairWallet(demoKeypairs[2]));
        updateAutopilotStep('join_seat_2', 'done', sig2);
      } else {
        updateAutopilotStep('join_seat_2', 'done', undefined, 'Already joined');
      }

      // Step 3: Seat 3 joins
      if (autopilotCancelRef.current) return;
      const mem3 = circle.loadedMembers.find((m) => m.slot === 3);
      if (!mem3) {
        updateAutopilotStep('join_seat_3', 'running');
        const sig3 = await handleJoinCircle(createKeypairWallet(demoKeypairs[3]));
        updateAutopilotStep('join_seat_3', 'done', sig3);
      } else {
        updateAutopilotStep('join_seat_3', 'done', undefined, 'Already joined');
      }

      // Step 4: Seat 4 joins
      if (autopilotCancelRef.current) return;
      const mem4 = circle.loadedMembers.find((m) => m.slot === 4);
      if (!mem4) {
        updateAutopilotStep('join_seat_4', 'running');
        const sig4 = await handleJoinCircle(createKeypairWallet(demoKeypairs[4]));
        updateAutopilotStep('join_seat_4', 'done', sig4);
      } else {
        updateAutopilotStep('join_seat_4', 'done', undefined, 'Already joined');
      }

      await loadCircleData(circle.address.toBase58(), true);

      // Step 5: Turn 1 Seat 1 contributes (real wallet)
      if (autopilotCancelRef.current) return;
      const m1 = circle.loadedMembers.find((m) => m.slot === 1);
      if (m1 && m1.lastContributedPeriod < 1) {
        updateAutopilotStep('turn1_seat1', 'waiting_approval');
        setAutopilotWaitingApproval(true);
        setAutopilotApprovalPrompt('Turn 1: Please approve Seat 1 contribution in your wallet.');
        return;
      } else {
        updateAutopilotStep('turn1_seat1', 'done', undefined, 'Seat 1 already paid');
      }

      await continueAutopilotAfterTurn1Seat1();
    } catch (err: any) {
      console.error('Autopilot error:', err);
      const translated = translateProgramError(err);
      setAutopilotError(`Autopilot stopped: ${translated.message}`);
      setAutopilotRunning(false);
    }
  };

  const approveCurrentAutopilotStep = async () => {
    if (!circle) return;
    const m1 = circle.loadedMembers.find((m) => m.slot === 1);
    if (!m1) return;
    try {
      const sig = await handleContribute(m1);
      if (circle.currentPeriod === 1) {
        updateAutopilotStep('turn1_seat1', 'done', sig);
        await continueAutopilotAfterTurn1Seat1();
      } else {
        updateAutopilotStep('turn2_seat1', 'done', sig);
        await continueAutopilotAfterTurn2Seat1();
      }
    } catch (err: any) {
      const translated = translateProgramError(err);
      setAutopilotError(`Approval failed: ${translated.message}`);
      setAutopilotWaitingApproval(false);
    }
  };

  // Multi-Wallet Session Tracker for Demo (tracks and displays all 4 wallets simultaneously)
  const [knownWallets, setKnownWallets] = useState<Record<number, string>>(() => {
    try {
      const saved = localStorage.getItem(`solthrift_demo_wallets_${circleAddress || ''}`);
      return saved ? JSON.parse(saved) : {};
    } catch {
      return {};
    }
  });

  // Live timer ticking every second for real-time countdowns without reloading
  const [nowSec, setNowSec] = useState<number>(Math.floor(Date.now() / 1000));
  useEffect(() => {
    const timer = setInterval(() => {
      setNowSec(Math.floor(Date.now() / 1000));
    }, 1000);
    return () => clearInterval(timer);
  }, []);

  // Auto-discover and remember each wallet as user switches in Solflare/Phantom
  useEffect(() => {
    if (!publicKey) return;
    const currentPkStr = publicKey.toBase58();

    setKnownWallets((prev) => {
      // If already recorded for any slot, no need to reassign
      const existing = Object.entries(prev).find(([_, addr]) => addr === currentPkStr);
      if (existing) return prev;

      // Check if this wallet is already an on-chain member
      if (circle?.loadedMembers) {
        const mem = circle.loadedMembers.find((m) => m.wallet.equals(publicKey));
        if (mem) {
          const updated = { ...prev, [mem.slot]: currentPkStr };
          try {
            localStorage.setItem(`solthrift_demo_wallets_${circle.address.toBase58()}`, JSON.stringify(updated));
          } catch {}
          return updated;
        }
      }

      // Otherwise assign to the first empty slot (1 to membersTarget)
      const maxSlots = circle?.membersTarget || 4;
      for (let s = 1; s <= maxSlots; s++) {
        if (!prev[s]) {
          const updated = { ...prev, [s]: currentPkStr };
          if (circle?.address) {
            try {
              localStorage.setItem(`solthrift_demo_wallets_${circle.address.toBase58()}`, JSON.stringify(updated));
            } catch {}
          }
          return updated;
        }
      }
      return prev;
    });
  }, [publicKey, circle]);

  // Synchronize knownWallets with on-chain circle loaded members
  useEffect(() => {
    if (!circle?.loadedMembers || !circle?.address) return;
    setKnownWallets((prev) => {
      let changed = false;
      const next = { ...prev };
      circle.loadedMembers.forEach((m) => {
        const addr = m.wallet.toBase58();
        if (next[m.slot] !== addr) {
          next[m.slot] = addr;
          changed = true;
        }
      });
      if (changed) {
        try {
          localStorage.setItem(`solthrift_demo_wallets_${circle.address.toBase58()}`, JSON.stringify(next));
        } catch {}
        return next;
      }
      return prev;
    });
  }, [circle?.loadedMembers, circle?.address]);

  /**
   * Fetch real on-chain Circle and Member data from Devnet
   * @param silent If true, updates state silently without triggering full-screen loading skeleton
   * @param reqId Optional request id to drop late responses from previous wallet requests
   */
  const loadCircleData = useCallback(
    async (addressToLoad: string, silent: boolean = false, reqId?: number) => {
      if (reqId !== undefined && reqId !== walletRequestIdRef.current) {
        console.warn(`[loadCircleData] Dropping outdated circle fetch (reqId: ${reqId}, current: ${walletRequestIdRef.current})`);
        return null;
      }

      const trimmed = extractSolanaAddress(addressToLoad);
      if (!trimmed) {
        setCircle(null);
        setFetchError(null);
        return null;
      }

      let pubkey: PublicKey;
      try {
        pubkey = new PublicKey(trimmed);
      } catch {
        setFetchError(`The address "${trimmed}" is not a valid Solana address.`);
        return null;
      }

      if (!silent) {
        setLoading(true);
        setFetchError(null);
        setTxSuccess(null);
        setTxError(null);
      } else {
        setIsRefreshing(true);
      }

      try {
        const program = getSolthriftProgram(connection, null);
        const circleAccount = await program.account.circle.fetch(pubkey);

        // Read mint decimals at runtime from mint account
        let decimals = 6;
        try {
          decimals = await getMintDecimals(connection, circleAccount.tokenMint as PublicKey);
        } catch {
          decimals = 6;
        }
        setTokenDecimals(decimals);

        // Filter valid member public keys (skip PublicKey.default)
        const validMemberWallets = (circleAccount.members as PublicKey[]).filter(
          (m) => !m.equals(PublicKey.default) && m.toBase58() !== '11111111111111111111111111111111'
        );

        // Fetch each Member account in parallel
        const memberPromises = validMemberWallets.map(async (walletPk) => {
          const [memberPda] = getMemberPda(pubkey, walletPk);
          try {
            const memberAccount = await program.account.member.fetch(memberPda);
            const memData: RealMemberData = {
              slot: memberAccount.slot as number,
              wallet: walletPk,
              depositRemaining: memberAccount.depositRemaining as any,
              hasBeenPaid: memberAccount.hasBeenPaid as boolean,
              lastContributedPeriod: memberAccount.lastContributedPeriod as number,
              status: parseMemberStatus(memberAccount.status),
              leaving: memberAccount.leaving as boolean,
              forfeitClaimed: memberAccount.forfeitClaimed as boolean,
              memberPda,
            };
            return memData;
          } catch (err) {
            console.warn(`Could not fetch Member PDA for ${walletPk.toBase58()}:`, err);
            return null;
          }
        });

        const loadedMembers = (await Promise.all(memberPromises)).filter(
          (m): m is RealMemberData => m !== null
        );
        loadedMembers.sort((a, b) => a.slot - b.slot);

        const circleData: RealCircleData = {
          address: pubkey,
          creator: circleAccount.creator as PublicKey,
          circleId: circleAccount.circleId as any,
          tokenMint: circleAccount.tokenMint as PublicKey,
          vault: circleAccount.vault as PublicKey,
          status: parseCircleStatus(circleAccount.status),
          membersTarget: circleAccount.membersTarget as number,
          currentMemberCount: circleAccount.currentMemberCount as number,
          activeMemberCount: circleAccount.activeMemberCount as number,
          contributionsThisPeriod: circleAccount.contributionsThisPeriod as number,
          orderLen: circleAccount.orderLen as number,
          expectedContributors: circleAccount.expectedContributors as number,
          reserve: circleAccount.reserve as any,
          owingCount: circleAccount.owingCount as number,
          pendingOwing: circleAccount.pendingOwing as number,
          periodRefundable: circleAccount.periodRefundable as boolean,
          unpaidCount: circleAccount.unpaidCount as number,
          forfeitPerClaimant: circleAccount.forfeitPerClaimant as any,
          forfeitPoolRemaining: circleAccount.forfeitPoolRemaining as any,
          contribution: circleAccount.contribution as any,
          depositPct: circleAccount.depositPct as number,
          periodDuration: circleAccount.periodDuration as any,
          graceDuration: circleAccount.graceDuration as any,
          fillWindowDuration: circleAccount.fillWindowDuration as any,
          openDeadline: circleAccount.openDeadline as any,
          minMembers: circleAccount.minMembers as number,
          currentPeriod: circleAccount.currentPeriod as number,
          periodStartTime: circleAccount.periodStartTime as any,
          members: circleAccount.members as PublicKey[],
          payoutOrder: Array.from(circleAccount.payoutOrder as any),
          loadedMembers,
        };

        if (reqId !== undefined && reqId !== walletRequestIdRef.current) {
          console.warn(`[loadCircleData] Dropping late result for outdated wallet request (reqId: ${reqId}, current: ${walletRequestIdRef.current})`);
          return null;
        }

        setCircle(circleData);
        return circleData;
      } catch (err: any) {
        if (reqId !== undefined && reqId !== walletRequestIdRef.current) {
          console.warn(`[loadCircleData] Dropped error for outdated wallet request (reqId: ${reqId}):`, err);
          return null;
        }
        console.error('Failed to load on-chain circle:', err);
        if (!silent) {
          setCircle((existing) => {
            if (existing) return existing;
            const errStr = String(err?.message || err);
            if (errStr.includes('Account does not exist')) {
              setFetchError('No circle found at this address. Check the address or create a new circle.');
            } else {
              const translated = translateProgramError(err);
              setFetchError(`Could not load circle: ${translated.message}`);
            }
            return null;
          });
        }
        return null;
      } finally {
        if (!silent) {
          setLoading(false);
        } else {
          setIsRefreshing(false);
        }
      }
    },
    [connection]
  );

  // Requirement 2: Single resetForWallet handler treating a switch as one atomic event
  const resetForWallet = useCallback(
    async (newPk: PublicKey | null) => {
      const reqId = ++walletRequestIdRef.current;
      const pkStr = newPk ? newPk.toBase58() : 'none';
      console.log(`[WalletSwitch ${new Date().toISOString()}] resetForWallet starting for: ${pkStr} (reqId: ${reqId})`);

      // 1. Cancel/abort in-flight lookups or transactions for previous wallet
      if (activeAbortControllerRef.current) {
        activeAbortControllerRef.current.abort();
      }
      activeAbortControllerRef.current = new AbortController();

      // 2. Clear pending flags, error banners, and success messages
      setTxPending(false);
      setTxPendingMsg(null);
      setTxSuccess(null);
      setTxError(null);
      clearWalletError();
      actionLockRef.current = {};

      // 3. Mark wallet data loading while reloading fresh on-chain data
      setIsWalletDataLoading(true);

      try {
        if (circleAddress) {
          await loadCircleData(circleAddress, true, reqId);
        }
        if (demoMode && demoKeypairs) {
          await fetchDemoBalances();
        }
      } catch (err) {
        console.warn(`[WalletSwitch] Data reload warning for reqId ${reqId}:`, err);
      } finally {
        if (reqId === walletRequestIdRef.current) {
          setIsWalletDataLoading(false);
          console.log(`[WalletSwitch ${new Date().toISOString()}] resetForWallet completed for: ${pkStr}`);
        }
      }
    },
    [circleAddress, loadCircleData, clearWalletError, demoMode, demoKeypairs, fetchDemoBalances]
  );

  // Requirement 1 & 2: Debounced wallet switch effect (300ms)
  useEffect(() => {
    const pkStr = publicKey ? publicKey.toBase58() : 'disconnected';
    console.log(
      `[WalletEvent ${new Date().toISOString()}] state change: publicKey=${pkStr}, connected=${connected}, connecting=${connecting}`
    );

    setIsWalletDataLoading(true);
    setTxError(null);
    clearWalletError();

    if (walletDebounceTimerRef.current) {
      clearTimeout(walletDebounceTimerRef.current);
    }

    walletDebounceTimerRef.current = setTimeout(() => {
      resetForWallet(publicKey);
    }, 300);

    return () => {
      if (walletDebounceTimerRef.current) {
        clearTimeout(walletDebounceTimerRef.current);
      }
    };
  }, [publicKey, connected, connecting, resetForWallet, clearWalletError]);

  // Requirement 1 & 6: Listen to adapter connect, disconnect, and extension accountChanged events
  useEffect(() => {
    const adapter = currentWallet?.adapter;
    if (!adapter) return;

    const onConnect = (pubkey?: PublicKey) => {
      const pk = pubkey || adapter.publicKey;
      console.log(`[WalletEvent ${new Date().toISOString()}] adapter.connect:`, pk?.toBase58() || 'unknown');
    };
    const onDisconnect = () => {
      console.log(`[WalletEvent ${new Date().toISOString()}] adapter.disconnect`);
    };
    const onError = (err: any) => {
      console.log(`[WalletEvent ${new Date().toISOString()}] adapter.error:`, err?.name, err?.message, err);
    };
    const onAccountChange = (newPk?: any) => {
      const pkStr = newPk?.toBase58
        ? newPk.toBase58()
        : typeof newPk === 'string'
        ? newPk
        : adapter.publicKey?.toBase58();
      console.log(`[WalletEvent ${new Date().toISOString()}] adapter.accountChange:`, pkStr);
      setIsWalletDataLoading(true);
      setTxError(null);
      clearWalletError();
      if (walletDebounceTimerRef.current) {
        clearTimeout(walletDebounceTimerRef.current);
      }
      walletDebounceTimerRef.current = setTimeout(() => {
        resetForWallet(adapter.publicKey);
      }, 300);
    };

    adapter.on('connect', onConnect);
    adapter.on('disconnect', onDisconnect);
    adapter.on('error', onError);
    (adapter as any).on?.('accountChanged', onAccountChange);

    const win = window as any;
    if (win.solana?.on) {
      win.solana.on('accountChanged', onAccountChange);
    }
    if (win.solflare?.on) {
      win.solflare.on('accountChanged', onAccountChange);
    }

    return () => {
      adapter.off?.('connect', onConnect);
      adapter.off?.('disconnect', onDisconnect);
      adapter.off?.('error', onError);
      (adapter as any).off?.('accountChanged', onAccountChange);
      if (win.solana?.off) {
        win.solana.off('accountChanged', onAccountChange);
      }
      if (win.solflare?.off) {
        win.solflare.off('accountChanged', onAccountChange);
      }
    };
  }, [currentWallet?.adapter, resetForWallet, clearWalletError]);

  // Sync with prop when URL changes
  useEffect(() => {
    if (circleAddress) {
      setInputAddress(circleAddress);
      loadCircleData(circleAddress);
    }
  }, [circleAddress, loadCircleData]);

  // Section 9 / Requirement 6: Auto-refresh every 10 seconds silently
  useEffect(() => {
    if (!circle?.address) return;
    const interval = setInterval(() => {
      loadCircleData(circle.address.toBase58(), true);
    }, 10000);
    return () => clearInterval(interval);
  }, [circle?.address, loadCircleData]);

  // Handle Search Submission
  const handleSearchSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const cleanAddr = extractSolanaAddress(inputAddress);
    if (cleanAddr) {
      setInputAddress(cleanAddr);
      onSelectCircle?.(cleanAddr);
      loadCircleData(cleanAddr);
    }
  };

  // Handle copying circle address
  const handleCopyCircle = () => {
    if (circle) {
      navigator.clipboard.writeText(circle.address.toBase58());
      setCopiedCircle(true);
      setTimeout(() => setCopiedCircle(false), 2000);
    }
  };

  // Handle copying direct shareable circle link
  const handleCopyShareableLink = () => {
    if (circle) {
      const url = `${window.location.origin}/circle/${circle.address.toBase58()}`;
      navigator.clipboard.writeText(url);
      setCopiedCircleLink(true);
      setTimeout(() => setCopiedCircleLink(false), 2000);
    }
  };

  // Handle copying member wallet address
  const handleCopyMemberWallet = (walletPk: PublicKey, idx: number) => {
    navigator.clipboard.writeText(walletPk.toBase58());
    setCopiedMemberIdx(idx);
    setTimeout(() => setCopiedMemberIdx(null), 2000);
  };

  // Token symbol display
  const tokenSymbol =
    circle && isPlaceholderMint(circle.tokenMint)
      ? 'DEVNET-TOKEN'
      : 'USDC';

  // Section 6 Join Calculations
  const isCircleOpen = circle?.status === 'Open';
  const isCircleActive = circle?.status === 'Active';
  const nextSlot = circle ? circle.currentMemberCount + 1 : 1;
  const isCircleFull = circle ? circle.currentMemberCount >= circle.membersTarget : false;

  const userMember =
    connected && publicKey && circle
      ? circle.loadedMembers.find((m) => m.wallet.equals(publicKey))
      : null;
  const isAlreadyMember = !!userMember;

  // Compute deposit for next slot using Section 6 formula
  const requiredDepositBN =
    circle && isCircleOpen && !isCircleFull
      ? calculateSlotDepositBN(nextSlot, circle.membersTarget, circle.contribution, circle.depositPct)
      : null;

  const formattedDeposit = requiredDepositBN
    ? formatTokenAmount(requiredDepositBN, tokenDecimals)
    : '0';
  const formattedContribution = circle
    ? formatTokenAmount(circle.contribution, tokenDecimals)
    : '0';
  const formattedPotAmount = circle
    ? formatTokenAmount(
        circle.contribution.mul(new BN(circle.expectedContributors || circle.membersTarget)),
        tokenDecimals
      )
    : '0';
  const formattedReserve = circle?.reserve
    ? formatTokenAmount(circle.reserve, tokenDecimals)
    : '0';
  const hasReserve = Boolean(circle?.reserve && !new BN(circle.reserve.toString()).isZero());

  const owedPeriods = circle ? circle.membersTarget - nextSlot : 0;

  // Timing & Live countdowns from periodStartTime + periodDuration + graceDuration
  const periodStartTime = circle ? Number(circle.periodStartTime.toString()) : 0;
  const periodDuration = circle ? Number(circle.periodDuration.toString()) : 0;
  const graceDuration = circle ? Number(circle.graceDuration.toString()) : 0;
  const periodDeadline = periodStartTime + periodDuration;
  const graceDeadline = periodDeadline + graceDuration;

  const isGraceExpired = isCircleActive && nowSec > graceDeadline;
  const isPeriodExpired = isCircleActive && nowSec > periodDeadline;

  const formatCountdown = (targetSec: number) => {
    const diff = targetSec - nowSec;
    if (diff <= 0) return '0s (expired)';
    const days = Math.floor(diff / 86400);
    const hours = Math.floor((diff % 86400) / 3600);
    const minutes = Math.floor((diff % 3600) / 60);
    const seconds = diff % 60;
    if (days > 0) return `${days}d ${hours}h ${minutes}m ${seconds}s`;
    if (hours > 0) return `${hours}h ${minutes}m ${seconds}s`;
    if (minutes > 0) return `${minutes}m ${seconds}s`;
    return `${seconds}s`;
  };

  // Determine recipient member for Payout
  const currentPeriodRecipientSlot =
    circle && isCircleActive && circle.currentPeriod >= 1 && circle.currentPeriod <= circle.orderLen
      ? circle.payoutOrder[circle.currentPeriod - 1]
      : null;

  const recipientWallet =
    currentPeriodRecipientSlot && circle?.members && circle.members[currentPeriodRecipientSlot - 1]
      ? circle.members[currentPeriodRecipientSlot - 1]
      : null;

  const nextRecipientMember =
    currentPeriodRecipientSlot && circle
      ? circle.loadedMembers.find((m) => m.slot === currentPeriodRecipientSlot && m.status === 'Active')
      : null;

  const payoutRecipientDisplay = nextRecipientMember
    ? `Seat ${nextRecipientMember.slot} (${nextRecipientMember.wallet.toBase58().slice(0, 4)}...${nextRecipientMember.wallet.toBase58().slice(-4)})`
    : currentPeriodRecipientSlot
    ? `Seat ${currentPeriodRecipientSlot}`
    : 'next recipient';

  // Countdown timers formatted for the three action buttons
  const countdownGraceSec = graceDeadline - nowSec;
  const payoutCountdown =
    isCircleActive
      ? countdownGraceSec > 0
        ? `${formatCountdown(graceDeadline)} left in turn`
        : 'Turn expired'
      : isCircleOpen
      ? 'Round not started'
      : `Status: ${circle?.status || 'Unknown'}`;

  const removeDefaulterCountdown =
    isCircleActive
      ? countdownGraceSec > 0
        ? `${formatCountdown(graceDeadline)} until removal allowed`
        : 'Grace period expired'
      : isCircleOpen
      ? 'Round not started'
      : `Status: ${circle?.status || 'Unknown'}`;

  const contributeCountdown =
    isCircleActive
      ? countdownGraceSec > 0
        ? `${formatCountdown(graceDeadline)} left to pay`
        : 'Turn deadline expired'
      : isCircleOpen
      ? 'Round not started'
      : `Status: ${circle?.status || 'Unknown'}`;

  const hasSignerAvailable = Boolean((connected && publicKey) || (demoMode && demoKeypairs));

  const canPayout = Boolean(
    hasSignerAvailable &&
    isCircleActive &&
    circle &&
    circle.currentPeriod >= 1 &&
    circle.currentPeriod <= circle.orderLen &&
    circle.contributionsThisPeriod === circle.expectedContributors &&
    nextRecipientMember &&
    !nextRecipientMember.hasBeenPaid
  );

  let payoutReason = '';
  if (!hasSignerAvailable) {
    payoutReason = 'Connect your wallet or enable demo mode to call payout.';
  } else if (isCircleOpen) {
    payoutReason = 'Circle is Open. Payouts start after round begins and seats fill.';
  } else if (!isCircleActive) {
    payoutReason = `Circle is not Active (status: ${circle?.status || 'Unknown'}).`;
  } else if (circle && circle.contributionsThisPeriod < circle.expectedContributors) {
    payoutReason = `Not enough contributions: ${circle.contributionsThisPeriod} of ${circle.expectedContributors} members have paid.`;
  } else if (nextRecipientMember?.hasBeenPaid) {
    payoutReason = `Already paid: recipient in seat ${currentPeriodRecipientSlot} already received the pot.`;
  } else if (canPayout) {
    payoutReason = `All ${circle?.expectedContributors} contributions received. Ready to pay out pot to ${payoutRecipientDisplay}.`;
  } else {
    payoutReason = 'Payout conditions not met.';
  }

  // Late members evaluation for Remove Defaulter
  const lateMembers = isCircleActive && circle
    ? circle.loadedMembers.filter(
        (m) => m.status === 'Active' && m.lastContributedPeriod !== circle.currentPeriod
      )
    : [];
  const targetLateMember = lateMembers.length > 0 ? lateMembers[0] : null;

  const removeDefaulterButtonLabel = targetLateMember
    ? `Remove late member (Seat ${targetLateMember.slot})`
    : 'Remove late member';

  const canRemoveDefaulter = Boolean(
    hasSignerAvailable &&
    isCircleActive &&
    targetLateMember !== null &&
    isGraceExpired
  );

  let removeDefaulterReason = '';
  if (!hasSignerAvailable) {
    removeDefaulterReason = 'Connect your wallet or enable demo mode to remove late members.';
  } else if (isCircleOpen) {
    removeDefaulterReason = 'Circle is Open. Defaulter removal is only available during active turns.';
  } else if (!isCircleActive) {
    removeDefaulterReason = `Circle is not Active (status: ${circle?.status || 'Unknown'}).`;
  } else if (lateMembers.length === 0 || (circle && circle.contributionsThisPeriod === circle.expectedContributors)) {
    removeDefaulterReason = `No late members: all ${circle?.expectedContributors || 0} members have paid for Turn ${circle?.currentPeriod}.`;
  } else if (!isGraceExpired) {
    removeDefaulterReason = `Deadline not reached: ${formatCountdown(graceDeadline)} remaining in grace period.`;
  } else if (canRemoveDefaulter) {
    removeDefaulterReason = `Time to pay has passed. Seat ${targetLateMember?.slot} missed payment; anyone can remove them to settle.`;
  } else {
    removeDefaulterReason = 'Defaulter removal conditions not met.';
  }

  // Member-specific Contribute Evaluation
  const canContribute = Boolean(
    connected &&
    publicKey &&
    userMember &&
    userMember.status === 'Active' &&
    isCircleActive &&
    userMember.lastContributedPeriod !== circle?.currentPeriod &&
    nowSec <= graceDeadline
  );

  let contributeReason = '';
  if (!connected) {
    contributeReason = 'Connect your wallet to contribute.';
  } else if (!userMember) {
    contributeReason = 'Wallet is not a member of this circle.';
  } else if (userMember.status !== 'Active') {
    contributeReason = `Member status is ${userMember.status} (not Active).`;
  } else if (isCircleOpen) {
    contributeReason = `Circle is Open. Turn contributions start after all ${circle?.membersTarget || 0} seats fill.`;
  } else if (!isCircleActive) {
    contributeReason = `Circle is not Active (status: ${circle?.status || 'Unknown'}).`;
  } else if (userMember.lastContributedPeriod === circle?.currentPeriod) {
    contributeReason = `Already paid: you contributed for Turn ${circle?.currentPeriod}.`;
  } else if (nowSec > graceDeadline) {
    contributeReason = 'Contribution deadline has passed for this turn.';
  } else if (canContribute) {
    contributeReason = `Ready to contribute ${formattedContribution} ${tokenSymbol} for Turn ${circle?.currentPeriod}.`;
  } else {
    contributeReason = 'Contribution conditions not met.';
  }



  // Member-specific flags (Requirement 4)
  const canFlagLeaving = Boolean(
    connected &&
    publicKey &&
    userMember &&
    userMember.status === 'Active' &&
    !userMember.leaving &&
    (circle?.status === 'Active' || circle?.status === 'Filling')
  );

  let flagLeavingReason = '';
  if (!connected) {
    flagLeavingReason = 'Connect your wallet to flag leaving.';
  } else if (!userMember) {
    flagLeavingReason = 'Wallet is not a member of this circle.';
  } else if (userMember.leaving) {
    flagLeavingReason = 'Leaving already flagged for your seat.';
  } else if (circle?.status !== 'Active' && circle?.status !== 'Filling') {
    flagLeavingReason = 'Flag leaving is only available while Active or Filling.';
  } else if (canFlagLeaving) {
    flagLeavingReason = 'Flag leaving so your deposit is returned at reset.';
  }

  const canExitMember = Boolean(
    connected &&
    publicKey &&
    userMember &&
    userMember.status === 'Active' &&
    ((circle?.status === 'Filling' && userMember.leaving) || circle?.status === 'Closing')
  );

  let exitMemberReason = '';
  if (!connected) {
    exitMemberReason = 'Connect your wallet to exit circle.';
  } else if (!userMember) {
    exitMemberReason = 'Wallet is not a member of this circle.';
  } else if (circle?.status !== 'Filling' && circle?.status !== 'Closing') {
    exitMemberReason = 'Exit is only available when circle is Filling (if flagged) or Closing.';
  } else if (circle?.status === 'Filling' && !userMember.leaving) {
    exitMemberReason = 'Must flag leaving before exiting during Filling window.';
  } else if (canExitMember) {
    exitMemberReason = 'Ready to exit circle and reclaim remaining deposit.';
  }

  // Closing recovery & forfeit evaluations (Requirement 4)
  const canClaimRefund = Boolean(
    connected &&
    publicKey &&
    userMember &&
    userMember.status === 'Active' &&
    userMember.lastContributedPeriod >= 1 &&
    userMember.lastContributedPeriod === circle?.currentPeriod &&
    (circle?.contributionsThisPeriod || 0) > 0 &&
    (circle?.status === 'Closing' || (circle?.status === 'Filling' && circle?.periodRefundable))
  );

  let claimRefundReason = '';
  if (!connected) {
    claimRefundReason = 'Connect your wallet to claim refund.';
  } else if (!userMember) {
    claimRefundReason = 'Wallet is not a member of this circle.';
  } else if (circle?.status !== 'Closing' && !(circle?.status === 'Filling' && circle?.periodRefundable)) {
    claimRefundReason = 'Refunds are only available when circle is Closing or refundable.';
  } else if (userMember.lastContributedPeriod !== circle?.currentPeriod || userMember.lastContributedPeriod < 1) {
    claimRefundReason = 'No payment in the current turn to refund.';
  } else if ((circle?.contributionsThisPeriod || 0) <= 0) {
    claimRefundReason = 'No refundable contributions remaining.';
  } else if (canClaimRefund) {
    claimRefundReason = `Ready to claim refund of ${formattedContribution} ${tokenSymbol}.`;
  }

  const forfeitPerClaimantBN = circle?.forfeitPerClaimant
    ? new BN(circle.forfeitPerClaimant.toString())
    : new BN(0);
  const forfeitPoolRemainingBN = circle?.forfeitPoolRemaining
    ? new BN(circle.forfeitPoolRemaining.toString())
    : new BN(0);
  const formattedForfeitAmount = formatTokenAmount(forfeitPerClaimantBN, tokenDecimals);

  const canClaimForfeit = Boolean(
    connected &&
    publicKey &&
    userMember &&
    userMember.status === 'Active' &&
    !userMember.hasBeenPaid &&
    !userMember.forfeitClaimed &&
    circle?.status === 'Closing' &&
    forfeitPerClaimantBN.gt(new BN(0)) &&
    forfeitPoolRemainingBN.gte(forfeitPerClaimantBN)
  );

  let claimForfeitReason = '';
  if (!connected) {
    claimForfeitReason = 'Connect your wallet to claim forfeit share.';
  } else if (!userMember) {
    claimForfeitReason = 'Wallet is not a member of this circle.';
  } else if (circle?.status !== 'Closing') {
    claimForfeitReason = 'Forfeit shares are only distributed when circle is Closing.';
  } else if (userMember.hasBeenPaid) {
    claimForfeitReason = 'Member already received full pot in a previous turn.';
  } else if (userMember.forfeitClaimed) {
    claimForfeitReason = 'Forfeit compensation already claimed.';
  } else if (forfeitPerClaimantBN.isZero()) {
    claimForfeitReason = 'No forfeit compensation recorded in this circle.';
  } else if (forfeitPoolRemainingBN.lt(forfeitPerClaimantBN)) {
    claimForfeitReason = 'Forfeit pool has been fully claimed.';
  } else if (canClaimForfeit) {
    claimForfeitReason = `Ready to claim forfeit share of ${formattedForfeitAmount} ${tokenSymbol}.`;
  }

  // Wallet readiness flag: disables action buttons while switching or loading member data (Requirement 4)
  const isWalletBusy = connecting || isWalletDataLoading;

  /**
   * Centralized error handler for user-initiated actions.
   * Suppresses benign wallet switch/disconnect and cancellation errors (with console.warn),
   * while surfacing real on-chain failures to txError. (Requirement 3)
   */
  const handleActionError = (err: any, currentReqId?: number, actionName?: string) => {
    // 1. If request belonged to a previous wallet or session, drop it silently with a warning
    if (currentReqId !== undefined && currentReqId !== walletRequestIdRef.current) {
      console.warn(
        `[Action Error Suppressed - Previous Wallet Request]: '${actionName || 'Action'}' dropped because wallet switched (reqId ${currentReqId} vs current ${walletRequestIdRef.current}).`,
        err
      );
      return;
    }

    // 2. Suppress user cancellations / modal closes
    if (isUserCancellation(err)) {
      console.warn(
        `[Action Error Suppressed - User Cancellation]: '${actionName || 'Action'}' cancelled or closed by user.`,
        err
      );
      return;
    }

    const errName = String(err?.name || '');
    const errMsg = String(err?.message || err || '').toLowerCase();
    const code = err?.code ?? err?.error?.code ?? (err as any)?.cause?.code;

    // 3. User rejected code 4001
    if (code === 4001 || errMsg.includes('4001')) {
      console.warn(
        `[Action Error Suppressed - Code 4001]: '${actionName || 'Action'}' rejected by user approval prompt.`,
        err
      );
      return;
    }

    // 4. Wallet disconnect, not connected, or account changed
    if (
      errName === 'WalletNotConnectedError' ||
      errName === 'WalletDisconnectedError' ||
      errMsg.includes('wallet not connected') ||
      errMsg.includes('wallet disconnected') ||
      errMsg.includes('not connected') ||
      errMsg.includes('disconnected') ||
      errMsg.includes('account changed') ||
      errMsg.includes('active account changed')
    ) {
      console.warn(
        `[Action Error Suppressed - Wallet State Change]: '${actionName || 'Action'}' suppressed due to wallet disconnect/switch (${errName || errMsg}).`,
        err
      );
      return;
    }

    // 5. Real failure: log and display with details
    console.error(`[Action Failure] ${actionName || 'Action'} failed:`, err);
    const translated = translateProgramError(err);
    setTxError({ message: translated.message, details: translated.details });
  };

  /**
   * Section 5, Instruction 2: Join Circle
   * Exactly-once execution with in-flight lock, pre-send check, and debounced switch support
   */
  const handleJoinCircle = async (customSignerWallet?: any): Promise<string | undefined> => {
    const currentReqId = walletRequestIdRef.current;
    const activeSigner = customSignerWallet || (connected && publicKey ? wallet : null);
    if (!activeSigner || !activeSigner.publicKey) {
      console.warn('[handleJoinCircle Suppressed]: No active wallet connected.');
      return;
    }
    const activePk: PublicKey = activeSigner.publicKey;
    if (!circle) return;

    // Per-(wallet, circle, action) in-flight lock (Requirement 5)
    const lockKey = `${activePk.toBase58()}:${circle.address.toBase58()}:joinCircle`;
    if (actionLockRef.current[lockKey]) {
      console.warn(`[Action Deduplicated] joinCircle is already in-flight for ${activePk.toBase58().slice(0, 4)}...`);
      return;
    }
    actionLockRef.current[lockKey] = true;

    if (isCircleFull) {
      delete actionLockRef.current[lockKey];
      setTxError({ message: 'This circle is full.' });
      return;
    }

    if (isPlaceholderMint(circle.tokenMint)) {
      delete actionLockRef.current[lockKey];
      setTxError({
        message: 'Circle token is not configured on the test network.',
      });
      return;
    }

    setTxPending(true);
    setTxPendingMsg('Joining circle...');
    setTxError(null);
    setTxSuccess(null);

    try {
      const [memberPda] = getMemberPda(circle.address, activePk);

      // On-chain check before sending: if this wallet is already a member, do not send joinCircle
      // Show "You already joined this circle" as the success state (Requirement 5)
      const existingMemberInfo = await connection.getAccountInfo(memberPda);
      if (existingMemberInfo !== null) {
        if (currentReqId === walletRequestIdRef.current) {
          setTxSuccess({
            message: 'You already joined this circle. Your seat is confirmed.',
          });
          await loadCircleData(circle.address.toBase58(), true, currentReqId);
        }
        return;
      }

      const preInstructions: TransactionInstruction[] = [];
      const { ata: memberAta, instruction: createAtaIx } = await getOrCreateAtaInstruction(
        connection,
        circle.tokenMint,
        activePk,
        activePk
      );
      if (createAtaIx) {
        preInstructions.push(createAtaIx);
      }

      const program = getSolthriftProgram(connection, activeSigner as any);

      const method = program.methods
        .joinCircle()
        .accounts({
          circle: circle.address,
          member: memberPda,
          memberWallet: activePk,
          tokenMint: circle.tokenMint,
          memberTokenAccount: memberAta,
          vault: circle.vault,
          tokenProgram: TOKEN_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
        });

      const { signature: sig } = await executeProgramMethod({
        connection,
        wallet: activeSigner,
        method,
        preInstructions: preInstructions.length > 0 ? preInstructions : undefined,
        onStatusChange: (status) => {
          if (currentReqId === walletRequestIdRef.current) {
            setTxPendingMsg(status);
          }
        },
      });

      if (currentReqId === walletRequestIdRef.current) {
        setTxSuccess({
          signature: sig,
          message: `You joined the circle. Seat ${nextSlot} is locked.`,
        });

        // Refetch latest circle and member accounts from chain
        await loadCircleData(circle.address.toBase58(), true, currentReqId);
        if (demoMode) {
          fetchDemoBalances();
        }
      }
      return sig;
    } catch (err: any) {
      handleActionError(err, currentReqId, 'joinCircle');
    } finally {
      delete actionLockRef.current[lockKey];
      if (currentReqId === walletRequestIdRef.current) {
        setTxPending(false);
        setTxPendingMsg(null);
      }
    }
  };

  /**
   * Section 5, Instruction 3: Contribute
   * Real on-chain contribution payment by the connected member (or specified member seat)
   */
  const handleContribute = async (
    specificMember?: RealMemberData | any,
    customSignerWallet?: any
  ): Promise<string | undefined> => {
    if (!circle) return;
    const currentReqId = walletRequestIdRef.current;

    const targetMember: RealMemberData | null =
      specificMember && typeof specificMember === 'object' && 'slot' in specificMember
        ? (specificMember as RealMemberData)
        : userMember;

    if (!targetMember) {
      setTxError({ message: 'Select an active member seat to pay for this turn.' });
      return;
    }

    // Determine signer: customSignerWallet, or if targetMember is a demo key, or connected wallet
    let activeSigner = customSignerWallet;
    if (!activeSigner && demoMode && demoKeypairs && demoKeypairs[targetMember.slot]) {
      activeSigner = createKeypairWallet(demoKeypairs[targetMember.slot]);
    }
    if (!activeSigner && connected && publicKey && targetMember.wallet.equals(publicKey)) {
      activeSigner = wallet as any;
    }

    if (!activeSigner || !activeSigner.publicKey) {
      handlePromptSwitchWallet(targetMember.slot);
      setTxError({
        message: `Please connect Account ${targetMember.slot} (${targetMember.wallet.toBase58().slice(0, 4)}...) to pay for this seat.`,
      });
      return;
    }

    const activePk: PublicKey = activeSigner.publicKey;
    if (!targetMember.wallet.equals(activePk)) {
      setTxError({
        message: `Signer (${activePk.toBase58().slice(0, 4)}...) does not match Seat ${targetMember.slot} (${targetMember.wallet.toBase58().slice(0, 4)}...).`,
      });
      return;
    }

    // Per-(wallet, circle, action) in-flight lock (Requirement 5)
    const lockKey = `${activePk.toBase58()}:${circle.address.toBase58()}:contribute:${targetMember.slot}`;
    if (actionLockRef.current[lockKey]) {
      console.warn(`[Action Deduplicated] contribute is already in-flight for Seat ${targetMember.slot}`);
      return;
    }
    actionLockRef.current[lockKey] = true;

    setTxPending(true);
    setTxPendingMsg(`Paying turn for Seat ${targetMember.slot}...`);
    setTxError(null);
    setTxSuccess(null);

    try {
      const program = getSolthriftProgram(connection, activeSigner as any);

      // On-chain check: if the member already paid this turn, do not send contribute (Requirement 5)
      try {
        const onChainMem = await program.account.member.fetchNullable(targetMember.memberPda);
        if (onChainMem && (onChainMem as any).lastContributedPeriod >= circle.currentPeriod) {
          if (currentReqId === walletRequestIdRef.current) {
            setTxSuccess({
              message: `Seat ${targetMember.slot} has already contributed for Turn ${circle.currentPeriod}.`,
            });
            await loadCircleData(circle.address.toBase58(), true, currentReqId);
          }
          return;
        }
      } catch (checkErr) {
        console.warn('[handleContribute] Could not pre-check member account:', checkErr);
      }

      const preInstructions: TransactionInstruction[] = [];
      const { ata: memberAta, instruction: createAtaIx } = await getOrCreateAtaInstruction(
        connection,
        circle.tokenMint,
        activePk,
        activePk
      );
      if (createAtaIx) {
        preInstructions.push(createAtaIx);
      }

      const method = program.methods
        .contribute()
        .accounts({
          circle: circle.address,
          member: targetMember.memberPda,
          memberWallet: activePk,
          tokenMint: circle.tokenMint,
          memberTokenAccount: memberAta,
          vault: circle.vault,
          tokenProgram: TOKEN_PROGRAM_ID,
        });

      const { signature: sig } = await executeProgramMethod({
        connection,
        wallet: activeSigner,
        method,
        preInstructions: preInstructions.length > 0 ? preInstructions : undefined,
        onStatusChange: (status) => {
          if (currentReqId === walletRequestIdRef.current) {
            setTxPendingMsg(status);
          }
        },
      });

      if (currentReqId === walletRequestIdRef.current) {
        setTxSuccess({
          signature: sig,
          message: `Paid turn for Seat ${targetMember.slot}.`,
        });

        await loadCircleData(circle.address.toBase58(), true, currentReqId);
        if (demoMode) {
          fetchDemoBalances();
        }
      }
      return sig;
    } catch (err: any) {
      handleActionError(err, currentReqId, `contribute(Seat ${targetMember.slot})`);
    } finally {
      delete actionLockRef.current[lockKey];
      if (currentReqId === walletRequestIdRef.current) {
        setTxPending(false);
        setTxPendingMsg(null);
      }
    }
  };

  /**
   * Section 5, Instruction 4: Payout
   * Callable by anyone; recipient = payout_order[current_period - 1]
   */
  const handlePayout = async (): Promise<string | undefined> => {
    if (!circle) return;
    const currentReqId = walletRequestIdRef.current;

    if (!currentPeriodRecipientSlot) {
      setTxError({ message: 'No recipient seat determined for current turn.' });
      return;
    }

    const recWallet = recipientWallet || (nextRecipientMember ? nextRecipientMember.wallet : null);
    if (!recWallet) {
      setTxError({ message: `Could not find recipient wallet address for seat ${currentPeriodRecipientSlot}.` });
      return;
    }

    const [recMemberPda] = getMemberPda(circle.address, recWallet);

    // Caller can be connected wallet or any funded demo key
    let callerSigner: any = connected && publicKey ? wallet : null;
    if (!callerSigner && demoMode && demoKeypairs) {
      for (const s of [2, 3, 4]) {
        if (demoKeypairs[s]) {
          callerSigner = createKeypairWallet(demoKeypairs[s]);
          break;
        }
      }
    }

    if (!callerSigner || !callerSigner.publicKey) {
      setTxError({ message: 'No wallet or demo key available to trigger payout.' });
      return;
    }
    const callerPk: PublicKey = callerSigner.publicKey;

    // Per-(wallet, circle, action) in-flight lock (Requirement 5)
    const lockKey = `${callerPk.toBase58()}:${circle.address.toBase58()}:payout:${circle.currentPeriod}`;
    if (actionLockRef.current[lockKey]) {
      console.warn(`[Action Deduplicated] payout is already in-flight for turn ${circle.currentPeriod}`);
      return;
    }
    actionLockRef.current[lockKey] = true;

    setTxPending(true);
    setTxPendingMsg(`Paying out to ${payoutRecipientDisplay}...`);
    setTxError(null);
    setTxSuccess(null);

    try {
      const program = getSolthriftProgram(connection, callerSigner as any);

      // On-chain check: if already paid, do not send payout (Requirement 5)
      try {
        const recAccount = await program.account.member.fetchNullable(recMemberPda);
        if (recAccount && (recAccount as any).hasBeenPaid) {
          if (currentReqId === walletRequestIdRef.current) {
            setTxSuccess({
              message: `Payout for Seat ${currentPeriodRecipientSlot} has already been disbursed.`,
            });
            await loadCircleData(circle.address.toBase58(), true, currentReqId);
          }
          return;
        }
      } catch (checkErr) {
        console.warn('[handlePayout] Could not pre-check recipient account:', checkErr);
      }

      const preInstructions: TransactionInstruction[] = [];
      const { ata: recipientAta, instruction: createAtaIx } = await getOrCreateAtaInstruction(
        connection,
        circle.tokenMint,
        recWallet,
        callerPk
      );
      if (createAtaIx) {
        preInstructions.push(createAtaIx);
      }

      const method = program.methods
        .payout()
        .accounts({
          circle: circle.address,
          recipientMember: recMemberPda,
          tokenMint: circle.tokenMint,
          recipientTokenAccount: recipientAta,
          vault: circle.vault,
          caller: callerPk,
          tokenProgram: TOKEN_PROGRAM_ID,
        });

      const { signature: sig } = await executeProgramMethod({
        connection,
        wallet: callerSigner,
        method,
        preInstructions: preInstructions.length > 0 ? preInstructions : undefined,
        onStatusChange: (status) => {
          if (currentReqId === walletRequestIdRef.current) {
            setTxPendingMsg(status);
          }
        },
      });

      if (currentReqId === walletRequestIdRef.current) {
        setTxSuccess({
          signature: sig,
          message: `Payout of ${formattedPotAmount} ${tokenSymbol} distributed to Seat ${currentPeriodRecipientSlot}.`,
        });

        await loadCircleData(circle.address.toBase58(), true, currentReqId);
        if (demoMode) {
          fetchDemoBalances();
        }
      }
      return sig;
    } catch (err: any) {
      handleActionError(err, currentReqId, 'payout');
    } finally {
      delete actionLockRef.current[lockKey];
      if (currentReqId === walletRequestIdRef.current) {
        setTxPending(false);
        setTxPendingMsg(null);
      }
    }
  };

  /**
   * Section 5, Instruction 5: Remove Defaulter
   * Callable by anyone after deadline + grace against an active member who missed contribution
   */
  const handleRemoveDefaulter = async (memberToRemove?: RealMemberData): Promise<string | undefined> => {
    if (!circle) return;
    const currentReqId = walletRequestIdRef.current;

    const target = memberToRemove || targetLateMember;
    if (!target) {
      setTxError({ message: 'No late member eligible for removal.' });
      return;
    }

    let callerSigner: any = connected && publicKey ? wallet : null;
    if (!callerSigner && demoMode && demoKeypairs) {
      for (const s of [2, 3, 4]) {
        if (demoKeypairs[s]) {
          callerSigner = createKeypairWallet(demoKeypairs[s]);
          break;
        }
      }
    }

    if (!callerSigner || !callerSigner.publicKey) {
      setTxError({ message: 'No wallet or demo key available to remove late member.' });
      return;
    }
    const callerPk: PublicKey = callerSigner.publicKey;

    // Per-(wallet, circle, action) in-flight lock (Requirement 5)
    const lockKey = `${callerPk.toBase58()}:${circle.address.toBase58()}:removeDefaulter:${target.slot}`;
    if (actionLockRef.current[lockKey]) {
      console.warn(`[Action Deduplicated] removeDefaulter is already in-flight for Seat ${target.slot}`);
      return;
    }
    actionLockRef.current[lockKey] = true;

    setTxPending(true);
    setTxPendingMsg('Removing late member...');
    setTxError(null);
    setTxSuccess(null);

    try {
      const program = getSolthriftProgram(connection, callerSigner as any);

      // On-chain check: if already removed, do not send tx (Requirement 5)
      try {
        const targetAcc = await program.account.member.fetchNullable(target.memberPda);
        if (targetAcc && (targetAcc.status as any).removed) {
          if (currentReqId === walletRequestIdRef.current) {
            setTxSuccess({
              message: `Seat ${target.slot} has already been removed.`,
            });
            await loadCircleData(circle.address.toBase58(), true, currentReqId);
          }
          return;
        }
      } catch (checkErr) {
        console.warn('[handleRemoveDefaulter] Could not pre-check target member:', checkErr);
      }

      const preInstructions: TransactionInstruction[] = [];
      const { ata: memberAta, instruction: createAtaIx } = await getOrCreateAtaInstruction(
        connection,
        circle.tokenMint,
        target.wallet,
        callerPk
      );
      if (createAtaIx) {
        preInstructions.push(createAtaIx);
      }

      const method = program.methods
        .removeDefaulter()
        .accounts({
          circle: circle.address,
          member: target.memberPda,
          tokenMint: circle.tokenMint,
          memberTokenAccount: memberAta,
          vault: circle.vault,
          caller: callerPk,
          tokenProgram: TOKEN_PROGRAM_ID,
        });

      const { signature: sig } = await executeProgramMethod({
        connection,
        wallet: callerSigner,
        method,
        preInstructions: preInstructions.length > 0 ? preInstructions : undefined,
        onStatusChange: (status) => {
          if (currentReqId === walletRequestIdRef.current) {
            setTxPendingMsg(status);
          }
        },
      });

      if (currentReqId === walletRequestIdRef.current) {
        setTxSuccess({
          signature: sig,
          message: 'You removed the late member.',
        });

        await loadCircleData(circle.address.toBase58(), true, currentReqId);
        if (demoMode) {
          fetchDemoBalances();
        }
      }
      return sig;
    } catch (err: any) {
      handleActionError(err, currentReqId, 'removeDefaulter');
    } finally {
      delete actionLockRef.current[lockKey];
      if (currentReqId === walletRequestIdRef.current) {
        setTxPending(false);
        setTxPendingMsg(null);
      }
    }
  };

  /**
   * Section 5, Instruction 6: Flag Leaving
   * Signed by the member while Active or Filling
   */
  const handleFlagLeaving = async (targetMember?: RealMemberData) => {
    if (!circle) return;
    const currentReqId = walletRequestIdRef.current;

    const memberToFlag = targetMember || userMember;
    if (!memberToFlag) {
      setTxError({ message: 'Member account not found to flag leaving.' });
      return;
    }

    let activeSigner: any = null;
    if (demoMode && demoKeypairs && demoKeypairs[memberToFlag.slot]) {
      activeSigner = createKeypairWallet(demoKeypairs[memberToFlag.slot]);
    } else if (connected && publicKey && memberToFlag.wallet.equals(publicKey)) {
      activeSigner = wallet;
    }

    if (!activeSigner || !activeSigner.publicKey) {
      setTxError({ message: 'Connect your wallet or use demo key to flag leaving.' });
      return;
    }
    const activePk: PublicKey = activeSigner.publicKey;

    // Per-(wallet, circle, action) in-flight lock (Requirement 5)
    const lockKey = `${activePk.toBase58()}:${circle.address.toBase58()}:flagLeaving:${memberToFlag.slot}`;
    if (actionLockRef.current[lockKey]) {
      console.warn(`[Action Deduplicated] flagLeaving is already in-flight for Seat ${memberToFlag.slot}`);
      return;
    }
    actionLockRef.current[lockKey] = true;

    setTxPending(true);
    setTxPendingMsg('Flagging leaving...');
    setTxError(null);
    setTxSuccess(null);

    try {
      const program = getSolthriftProgram(connection, activeSigner as any);

      // On-chain check (Requirement 5)
      try {
        const memAcc = await program.account.member.fetchNullable(memberToFlag.memberPda);
        if (memAcc && (memAcc.leaving || (memAcc.status as any).flaggedLeaving)) {
          if (currentReqId === walletRequestIdRef.current) {
            setTxSuccess({
              message: `Seat ${memberToFlag.slot} is already flagged leaving.`,
            });
            await loadCircleData(circle.address.toBase58(), true, currentReqId);
          }
          return;
        }
      } catch (checkErr) {
        console.warn('[handleFlagLeaving] Could not pre-check member account:', checkErr);
      }

      const method = program.methods
        .flagLeaving()
        .accounts({
          circle: circle.address,
          member: memberToFlag.memberPda,
          memberWallet: activePk,
        });

      const { signature: sig } = await executeProgramMethod({
        connection,
        wallet: activeSigner,
        method,
        onStatusChange: (status) => {
          if (currentReqId === walletRequestIdRef.current) {
            setTxPendingMsg(status);
          }
        },
      });

      if (currentReqId === walletRequestIdRef.current) {
        setTxSuccess({
          signature: sig,
          message: `Seat ${memberToFlag.slot} flagged leaving.`,
        });

        await loadCircleData(circle.address.toBase58(), true, currentReqId);
      }
    } catch (err: any) {
      handleActionError(err, currentReqId, 'flagLeaving');
    } finally {
      delete actionLockRef.current[lockKey];
      if (currentReqId === walletRequestIdRef.current) {
        setTxPending(false);
        setTxPendingMsg(null);
      }
    }
  };

  /**
   * Section 5, Instruction 7: Exit Member
   * Callable by anyone during Filling or Closing for members who flagged leaving or when Closing
   */
  const handleExitMember = async (targetMember?: RealMemberData) => {
    if (!circle) return;
    const currentReqId = walletRequestIdRef.current;

    const memberToExit = targetMember || userMember;
    if (!memberToExit) {
      setTxError({ message: 'Member account not found to exit.' });
      return;
    }

    let callerSigner: any = connected && publicKey ? wallet : null;
    if (!callerSigner && demoMode && demoKeypairs) {
      for (const s of [2, 3, 4]) {
        if (demoKeypairs[s]) {
          callerSigner = createKeypairWallet(demoKeypairs[s]);
          break;
        }
      }
    }

    if (!callerSigner || !callerSigner.publicKey) {
      setTxError({ message: 'Connect your wallet or enable demo mode to exit circle.' });
      return;
    }
    const callerPk: PublicKey = callerSigner.publicKey;

    // Per-(wallet, circle, action) in-flight lock (Requirement 5)
    const lockKey = `${callerPk.toBase58()}:${circle.address.toBase58()}:exitMember:${memberToExit.slot}`;
    if (actionLockRef.current[lockKey]) {
      console.warn(`[Action Deduplicated] exitMember is already in-flight for Seat ${memberToExit.slot}`);
      return;
    }
    actionLockRef.current[lockKey] = true;

    setTxPending(true);
    setTxPendingMsg('Exiting circle...');
    setTxError(null);
    setTxSuccess(null);

    try {
      const program = getSolthriftProgram(connection, callerSigner as any);

      // On-chain check (Requirement 5)
      try {
        const memAcc = await program.account.member.fetchNullable(memberToExit.memberPda);
        if (memAcc && (memAcc.status as any).exited) {
          if (currentReqId === walletRequestIdRef.current) {
            setTxSuccess({
              message: `Seat ${memberToExit.slot} has already exited the circle.`,
            });
            await loadCircleData(circle.address.toBase58(), true, currentReqId);
          }
          return;
        }
      } catch (checkErr) {
        console.warn('[handleExitMember] Could not pre-check member account:', checkErr);
      }

      const preInstructions: TransactionInstruction[] = [];
      const { ata: memberAta, instruction: createAtaIx } = await getOrCreateAtaInstruction(
        connection,
        circle.tokenMint,
        memberToExit.wallet,
        callerPk
      );
      if (createAtaIx) {
        preInstructions.push(createAtaIx);
      }

      const method = program.methods
        .exitMember()
        .accounts({
          circle: circle.address,
          member: memberToExit.memberPda,
          tokenMint: circle.tokenMint,
          memberTokenAccount: memberAta,
          vault: circle.vault,
          caller: callerPk,
          tokenProgram: TOKEN_PROGRAM_ID,
        });

      const { signature: sig } = await executeProgramMethod({
        connection,
        wallet: callerSigner,
        method,
        preInstructions: preInstructions.length > 0 ? preInstructions : undefined,
        onStatusChange: (status) => {
          if (currentReqId === walletRequestIdRef.current) {
            setTxPendingMsg(status);
          }
        },
      });

      if (currentReqId === walletRequestIdRef.current) {
        setTxSuccess({
          signature: sig,
          message: `Seat ${memberToExit.slot} exited circle; deposit refunded.`,
        });

        await loadCircleData(circle.address.toBase58(), true, currentReqId);
        if (demoMode) {
          fetchDemoBalances();
        }
      }
    } catch (err: any) {
      handleActionError(err, currentReqId, 'exitMember');
    } finally {
      delete actionLockRef.current[lockKey];
      if (currentReqId === walletRequestIdRef.current) {
        setTxPending(false);
        setTxPendingMsg(null);
      }
    }
  };

  /**
   * Section 5, Instruction 8: Claim Refund
   * Allowed when circle is Closing or Filling with periodRefundable
   */
  const handleClaimRefund = async () => {
    if (!connected || !publicKey) {
      console.warn('[handleClaimRefund Suppressed]: Wallet not connected.');
      return;
    }
    if (!circle || !userMember) {
      setTxError({ message: 'You are not a registered member of this circle.' });
      return;
    }
    const currentReqId = walletRequestIdRef.current;

    // Per-(wallet, circle, action) in-flight lock (Requirement 5)
    const lockKey = `${publicKey.toBase58()}:${circle.address.toBase58()}:claimRefund`;
    if (actionLockRef.current[lockKey]) {
      console.warn('[Action Deduplicated] claimRefund is already in-flight');
      return;
    }
    actionLockRef.current[lockKey] = true;

    setTxPending(true);
    setTxPendingMsg('Claiming contribution refund...');
    setTxError(null);
    setTxSuccess(null);

    try {
      const program = getSolthriftProgram(connection, wallet as any);

      // On-chain check (Requirement 5)
      try {
        const memAcc = await program.account.member.fetchNullable(userMember.memberPda);
        if (memAcc && (memAcc as any).depositRemaining?.isZero?.()) {
          if (currentReqId === walletRequestIdRef.current) {
            setTxSuccess({
              message: 'You have already claimed your contribution refund.',
            });
            await loadCircleData(circle.address.toBase58(), true, currentReqId);
          }
          return;
        }
      } catch (checkErr) {
        console.warn('[handleClaimRefund] Could not pre-check member account:', checkErr);
      }

      const preInstructions: TransactionInstruction[] = [];
      const { ata: memberAta, instruction: createAtaIx } = await getOrCreateAtaInstruction(
        connection,
        circle.tokenMint,
        publicKey,
        publicKey
      );
      if (createAtaIx) {
        preInstructions.push(createAtaIx);
      }

      const method = program.methods
        .claimRefund()
        .accounts({
          circle: circle.address,
          member: userMember.memberPda,
          tokenMint: circle.tokenMint,
          memberTokenAccount: memberAta,
          vault: circle.vault,
          memberWallet: publicKey,
          tokenProgram: TOKEN_PROGRAM_ID,
        });

      const { signature: sig } = await executeProgramMethod({
        connection,
        wallet,
        method,
        preInstructions: preInstructions.length > 0 ? preInstructions : undefined,
        onStatusChange: (status) => {
          if (currentReqId === walletRequestIdRef.current) {
            setTxPendingMsg(status);
          }
        },
      });

      if (currentReqId === walletRequestIdRef.current) {
        setTxSuccess({
          signature: sig,
          message: 'You claimed your contribution refund.',
        });

        await loadCircleData(circle.address.toBase58(), true, currentReqId);
      }
    } catch (err: any) {
      handleActionError(err, currentReqId, 'claimRefund');
    } finally {
      delete actionLockRef.current[lockKey];
      if (currentReqId === walletRequestIdRef.current) {
        setTxPending(false);
        setTxPendingMsg(null);
      }
    }
  };

  /**
   * Section 5, Instruction 9: Claim Forfeit
   * Allowed when circle is Closing to distribute forfeited deposit pool to unpaid members
   */
  const handleClaimForfeit = async () => {
    if (!connected || !publicKey) {
      console.warn('[handleClaimForfeit Suppressed]: Wallet not connected.');
      return;
    }
    if (!circle || !userMember) {
      setTxError({ message: 'You are not a registered member of this circle.' });
      return;
    }
    const currentReqId = walletRequestIdRef.current;

    // Per-(wallet, circle, action) in-flight lock (Requirement 5)
    const lockKey = `${publicKey.toBase58()}:${circle.address.toBase58()}:claimForfeit`;
    if (actionLockRef.current[lockKey]) {
      console.warn('[Action Deduplicated] claimForfeit is already in-flight');
      return;
    }
    actionLockRef.current[lockKey] = true;

    setTxPending(true);
    setTxPendingMsg('Claiming forfeit compensation...');
    setTxError(null);
    setTxSuccess(null);

    try {
      const program = getSolthriftProgram(connection, wallet as any);

      // On-chain check (Requirement 5)
      try {
        const memAcc = await program.account.member.fetchNullable(userMember.memberPda);
        if (memAcc && (memAcc as any).forfeitClaimed) {
          if (currentReqId === walletRequestIdRef.current) {
            setTxSuccess({
              message: 'You have already claimed your forfeit compensation.',
            });
            await loadCircleData(circle.address.toBase58(), true, currentReqId);
          }
          return;
        }
      } catch (checkErr) {
        console.warn('[handleClaimForfeit] Could not pre-check member account:', checkErr);
      }

      const preInstructions: TransactionInstruction[] = [];
      const { ata: memberAta, instruction: createAtaIx } = await getOrCreateAtaInstruction(
        connection,
        circle.tokenMint,
        publicKey,
        publicKey
      );
      if (createAtaIx) {
        preInstructions.push(createAtaIx);
      }

      const method = program.methods
        .claimForfeit()
        .accounts({
          circle: circle.address,
          member: userMember.memberPda,
          tokenMint: circle.tokenMint,
          memberTokenAccount: memberAta,
          vault: circle.vault,
          memberWallet: publicKey,
          tokenProgram: TOKEN_PROGRAM_ID,
        });

      const { signature: sig } = await executeProgramMethod({
        connection,
        wallet,
        method,
        preInstructions: preInstructions.length > 0 ? preInstructions : undefined,
        onStatusChange: (status) => {
          if (currentReqId === walletRequestIdRef.current) {
            setTxPendingMsg(status);
          }
        },
      });

      if (currentReqId === walletRequestIdRef.current) {
        setTxSuccess({
          signature: sig,
          message: 'You claimed your forfeit share.',
        });

        await loadCircleData(circle.address.toBase58(), true, currentReqId);
      }
    } catch (err: any) {
      handleActionError(err, currentReqId, 'claimForfeit');
    } finally {
      delete actionLockRef.current[lockKey];
      if (currentReqId === walletRequestIdRef.current) {
        setTxPending(false);
        setTxPendingMsg(null);
      }
    }
  };

  return (
    <div className="page-container">
      {/* Search Bar */}
      <section className="circle-search-card" aria-label="Load circle by address">
        <form onSubmit={handleSearchSubmit} className="circle-search-row">
          <div className="circle-search-input-wrap">
            <Search size={16} className="search-input-icon" />
            <input
              type="text"
              className="circle-search-input"
              placeholder="Enter circle address on the Solana test network"
              value={inputAddress}
              onChange={(e) => setInputAddress(e.target.value)}
              aria-label="Circle address"
            />
          </div>
          <button type="submit" className="search-btn" disabled={loading}>
            {loading ? <Loader2 size={15} className="spinner-icon" /> : <Search size={15} />}
            Load circle
          </button>
          <button
            type="button"
            className="btn-secondary"
            onClick={onNavigateCreate}
          >
            <UserPlus size={15} />
            Create circle
          </button>
        </form>
      </section>

      {/* Global Notifications */}
      {txPending && (
        <div className="alert-box pending-alert" role="status" style={{ border: '1px solid rgba(255, 255, 255, 0.25)', background: 'rgba(255, 255, 255, 0.06)' }}>
          <Loader2 size={18} className="spinner-icon" />
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
            <span style={{ fontWeight: 600 }}>{txPendingMsg || 'Transaction pending on the test network.'}</span>
            {txPendingMsg?.toLowerCase().includes('wallet') && (
              <span style={{ fontSize: '0.82rem', color: 'rgba(255, 255, 255, 0.85)' }}>
                Please check your browser toolbar or taskbar for the Phantom/Solflare extension popup to approve.
              </span>
            )}
          </div>
        </div>
      )}

      {txSuccess && (
        <div className="alert-box success-alert" role="status" style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', gap: '0.75rem' }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <CheckCircle2 size={18} className="text-green" />
              <strong>{txSuccess.message}</strong>
            </div>
            <div style={{ fontSize: '0.85rem' }}>
              Transaction signature:{' '}
              <a
                href={getExplorerUrl('tx', txSuccess.signature)}
                target="_blank"
                rel="noreferrer"
                style={{ color: '#ffffff', textDecoration: 'underline', fontFamily: 'monospace' }}
              >
                {txSuccess.signature.slice(0, 16)}...{txSuccess.signature.slice(-16)}
                <ExternalLink size={12} style={{ display: 'inline', marginLeft: '4px' }} />
              </a>
            </div>
          </div>
          <button
            type="button"
            onClick={() => setTxSuccess(null)}
            className="icon-action-btn"
            aria-label="Dismiss message"
            style={{ width: '28px', height: '28px', minWidth: '28px' }}
          >
            <X size={14} />
          </button>
        </div>
      )}

      {txError && (
        <div className="alert-box error-alert" role="alert" style={{ justifyContent: 'space-between', alignItems: 'flex-start' }}>
          <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'flex-start' }}>
            <AlertTriangle size={18} style={{ flexShrink: 0, marginTop: '2px' }} />
            <div>
              <strong>Action failed</strong>
              <p style={{ marginTop: '0.2rem', fontSize: '0.9rem' }}>{txError.message}</p>
              {txError.details && (
                <details className="error-details" style={{ marginTop: '0.4rem', fontSize: '0.75rem' }}>
                  <summary style={{ cursor: 'pointer' }}>Details</summary>
                  <code style={{ display: 'block', marginTop: '0.25rem', whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>
                    {txError.details}
                  </code>
                </details>
              )}
            </div>
          </div>
          <button
            type="button"
            onClick={() => setTxError(null)}
            className="icon-action-btn"
            aria-label="Dismiss error"
            style={{ width: '28px', height: '28px', minWidth: '28px' }}
          >
            <X size={14} />
          </button>
        </div>
      )}

      {/* Loading View */}
      {loading && (
        <div className="loading-view-card">
          <Loader2 size={36} className="loading-spinner-large" />
          <h2 style={{ fontSize: '1.25rem', color: 'white' }}>Fetching circle data</h2>
          <p style={{ color: 'var(--text-body)', fontSize: '0.9rem' }}>
            Reading circle and member accounts from the Solana test network.
          </p>
        </div>
      )}

      {/* Fetch Error State */}
      {!loading && fetchError && (
        <div className="alert-box error-alert" role="alert" style={{ justifyContent: 'space-between', alignItems: 'flex-start' }}>
          <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'flex-start' }}>
            <AlertTriangle size={20} style={{ flexShrink: 0, marginTop: '2px' }} />
            <div>
              <strong>Could not load circle</strong>
              <p style={{ marginTop: '0.25rem', fontSize: '0.9rem' }}>{fetchError}</p>
            </div>
          </div>
          <button
            type="button"
            onClick={() => setFetchError(null)}
            className="icon-action-btn"
            aria-label="Dismiss error"
            style={{ width: '28px', height: '28px', minWidth: '28px' }}
          >
            <X size={14} />
          </button>
        </div>
      )}

      {/* EMPTY / LANDING STATE: SPLIT LAYOUT */}
      {!loading && !fetchError && !circle && (
        <div className="landing-split-layout">
          {/* Left Hero Card */}
          <div className="glass-panel" style={{ padding: '2.5rem 2rem' }}>
            <div className="circle-emblem-badge" style={{ width: '92px', height: '92px', marginBottom: '1.25rem' }}>
              <SolanaLogo3D size={44} />
            </div>

            <Reveal revealKey="circle-view-lookup-title">
              <h1 className="page-title" style={{ fontSize: '2.4rem', lineHeight: '1.15' }}>
                Save together,{' '}
                <span className="font-serif-italic">without trusting anyone.</span>
              </h1>
            </Reveal>

            <Reveal revealKey="circle-view-lookup-desc">
              <p style={{ color: 'var(--text-body)', fontSize: '0.95rem', margin: '1rem 0 1.75rem', lineHeight: '1.6' }}>
                Solthrift is a savings circle on Solana. A program holds the money, pays one person each turn, and removes anyone who misses a payment. Everyone can see every payment.
              </p>
            </Reveal>

            <Reveal revealKey="circle-view-lookup-btn">
              <button type="button" className="btn-primary" onClick={onNavigateCreate}>
                Create circle
                <ArrowRight size={16} />
              </button>
            </Reveal>
          </div>

          {/* Right Explainer / Lookup Card */}
          <div className="card" style={{ padding: '2.25rem 2rem' }}>
            <Reveal revealKey="circle-view-explainer-heading">
              <h2 className="card-title" style={{ fontSize: '1.25rem' }}>
                How savings circles work
              </h2>
            </Reveal>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem', marginTop: '1rem' }}>
              <div style={{ display: 'flex', gap: '0.85rem' }}>
                <span className="slot-badge-circle" style={{ width: '28px', height: '28px', fontSize: '0.75rem', flexShrink: 0 }}>1</span>
                <div>
                  <strong style={{ color: '#ffffff', fontSize: '0.9rem', display: 'block' }}>Your seat sets your turn</strong>
                  <span style={{ fontSize: '0.825rem', color: 'var(--text-body)' }}>
                    Members join in order. Your seat determines which turn you get the full pot.
                  </span>
                </div>
              </div>

              <div style={{ display: 'flex', gap: '0.85rem' }}>
                <span className="slot-badge-circle" style={{ width: '28px', height: '28px', fontSize: '0.75rem', flexShrink: 0 }}>2</span>
                <div>
                  <strong style={{ color: '#ffffff', fontSize: '0.9rem', display: 'block' }}>Deposits protect the group</strong>
                  <span style={{ fontSize: '0.825rem', color: 'var(--text-body)' }}>
                    Members lock an upfront deposit. Members who miss a payment lose their deposit.
                  </span>
                </div>
              </div>

              <div style={{ display: 'flex', gap: '0.85rem' }}>
                <span className="slot-badge-circle" style={{ width: '28px', height: '28px', fontSize: '0.75rem', flexShrink: 0 }}>3</span>
                <div>
                  <strong style={{ color: '#ffffff', fontSize: '0.9rem', display: 'block' }}>Automatic execution</strong>
                  <span style={{ fontSize: '0.825rem', color: 'var(--text-body)' }}>
                    Anyone can trigger payout once payments arrive, or remove members who miss a payment.
                  </span>
                </div>
              </div>
            </div>

            <div style={{ marginTop: '1.5rem', paddingTop: '1.25rem', borderTop: '1px solid var(--glass-border-subtle)' }}>
              <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                Have a circle address? Paste it in the top search bar to inspect live on-chain state.
              </span>
            </div>
          </div>
        </div>
      )}

      {/* REAL CIRCLE CONTENT: SPLIT LAYOUT */}
      {!loading && circle && (
        <>
          {/* DEMO MODE SWITCH & CONTROLS (Devnet only per Requirement 1) */}
          {isDevnet && (
            <div style={{ marginBottom: '1.5rem' }}>
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  flexWrap: 'wrap',
                  gap: '0.75rem',
                  background: 'rgba(255, 255, 255, 0.03)',
                  border: '1px solid var(--glass-border-subtle)',
                  borderRadius: '16px',
                  padding: '0.75rem 1.25rem',
                  marginBottom: demoMode ? '0.85rem' : 0,
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.65rem' }}>
                  <Sparkles size={18} style={{ color: 'rgba(255, 255, 255, 0.9)' }} />
                  <div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                      <strong style={{ fontSize: '0.95rem', color: '#ffffff' }}>Demo Mode</strong>
                      <span
                        className="badge-pill"
                        style={{
                          fontSize: '0.68rem',
                          color: 'rgba(255, 255, 255, 0.9)',
                          borderColor: 'rgba(255, 255, 255, 0.25)',
                          padding: '1px 7px',
                        }}
                      >
                        Devnet only
                      </span>
                    </div>
                    <span style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>
                      Test 4-member circles end-to-end without opening secondary browser wallets.
                    </span>
                  </div>
                </div>

                <div style={{ display: 'flex', alignItems: 'center', gap: '0.65rem', flexWrap: 'wrap' }}>
                  {demoMode && (
                    <>
                      <button
                        type="button"
                        className="btn-secondary"
                        style={{ fontSize: '0.78rem', padding: '0.4rem 0.85rem', gap: '0.35rem' }}
                        onClick={() => setShowFundPanel(!showFundPanel)}
                        title="Fund Demo Seats 2, 3, 4 with SOL and USDC in a single transaction"
                      >
                        <Coins size={14} />
                        {showFundPanel ? 'Hide Funding Panel' : 'Fund demo members'}
                      </button>

                      <button
                        type="button"
                        className="btn-primary"
                        style={{
                          fontSize: '0.78rem',
                          padding: '0.4rem 0.95rem',
                          height: 'auto',
                          minHeight: 'unset',
                          gap: '0.4rem',
                          background: autopilotRunning ? 'rgba(255, 255, 255, 0.15)' : undefined,
                          borderColor: autopilotRunning ? 'rgba(255, 255, 255, 0.4)' : undefined,
                        }}
                        onClick={() => {
                          setShowAutopilot(true);
                          if (!autopilotRunning) {
                            runAutopilot();
                          }
                        }}
                        title="Run automated walkthrough demo"
                      >
                        {autopilotRunning ? (
                          <>
                            <Loader2 size={14} className="spinner-icon" />
                            Autopilot running...
                          </>
                        ) : (
                          <>
                            <Play size={14} />
                            Run the demo for me
                          </>
                        )}
                      </button>
                    </>
                  )}

                  <button
                    type="button"
                    className={`demo-mode-toggle-btn ${demoMode ? 'active' : ''}`}
                    onClick={toggleDemoMode}
                    aria-pressed={demoMode}
                  >
                    <span
                      style={{
                        width: '8px',
                        height: '8px',
                        borderRadius: '50%',
                        background: demoMode ? '#ffffff' : 'rgba(255, 255, 255, 0.35)',
                        boxShadow: demoMode ? '0 0 8px rgba(255, 255, 255, 0.8)' : 'none',
                      }}
                    />
                    <span>Demo mode: {demoMode ? 'ON' : 'OFF'}</span>
                  </button>
                </div>
              </div>

              {/* Requirement 1: Permanent Banner when Demo mode is ON */}
              {demoMode && (
                <div className="demo-mode-banner">
                  <div
                    style={{
                      display: 'flex',
                      flexDirection: 'column',
                      gap: '0.65rem',
                    }}
                  >
                    <div>
                      <strong
                        style={{
                          color: '#ffffff',
                          fontSize: '0.92rem',
                          display: 'flex',
                          alignItems: 'center',
                          gap: '0.45rem',
                        }}
                      >
                        <Sparkles size={16} style={{ color: 'rgba(255, 255, 255, 0.9)' }} />
                        Demo mode: seats 2 to 4 use throwaway test keys. Seat 1 is your real wallet.
                      </strong>
                      <p
                        style={{
                          margin: '0.3rem 0 0',
                          fontSize: '0.8rem',
                          color: 'rgba(255, 255, 255, 0.65)',
                        }}
                      >
                        Note: In-memory test keypairs are session-based. Refreshing or closing this tab resets them.
                      </p>
                    </div>

                    {demoKeypairs && (
                      <div className="demo-keys-grid">
                        {[2, 3, 4].map((slot) => {
                          const kp = demoKeypairs[slot];
                          const b = demoBalances[slot];
                          return (
                            <div key={slot} className="demo-key-pill">
                              <span style={{ color: 'var(--text-muted)' }}>Seat {slot}</span>
                              <span style={{ color: '#ffffff', fontWeight: 600 }}>
                                {kp.publicKey.toBase58().slice(0, 4)}...{kp.publicKey.toBase58().slice(-4)}
                              </span>
                              {b ? (
                                <span style={{ color: 'rgba(255, 255, 255, 0.75)', fontSize: '0.72rem' }}>
                                  ({b.sol.toFixed(2)} SOL · {b.token} {tokenSymbol})
                                </span>
                              ) : null}
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* Requirement 3: "Fund demo members" Panel */}
              {demoMode && showFundPanel && (
                <div className="demo-funding-card">
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.75rem' }}>
                    <div>
                      <h3 style={{ margin: 0, fontSize: '1.05rem', color: '#ffffff', display: 'flex', alignItems: 'center', gap: '0.45rem' }}>
                        <Coins size={17} style={{ color: 'rgba(255, 255, 255, 0.9)' }} />
                        Fund Demo Members
                      </h3>
                      <p style={{ margin: '0.2rem 0 0', fontSize: '0.82rem', color: 'var(--text-muted)' }}>
                        A single transaction signed by your connected wallet funds Seats 2, 3, and 4 with SOL, creates missing token accounts, and transfers test tokens.
                      </p>
                    </div>
                    <button
                      type="button"
                      className="icon-action-btn"
                      onClick={() => setShowFundPanel(false)}
                      title="Close funding panel"
                    >
                      <X size={15} />
                    </button>
                  </div>

                  <table className="demo-funding-table">
                    <thead>
                      <tr>
                        <th>Seat</th>
                        <th>Test Key Address</th>
                        <th>SOL Amount</th>
                        <th>{tokenSymbol} Amount</th>
                        <th>Current Balance</th>
                      </tr>
                    </thead>
                    <tbody>
                      {[2, 3, 4].map((slot) => {
                        const kp = demoKeypairs?.[slot];
                        const b = demoBalances[slot];
                        return (
                          <tr key={slot}>
                            <td>
                              <strong>Seat {slot}</strong>
                            </td>
                            <td style={{ fontFamily: 'var(--font-mono)', fontSize: '0.78rem' }}>
                              {kp ? `${kp.publicKey.toBase58().slice(0, 6)}...${kp.publicKey.toBase58().slice(-6)}` : 'Generating...'}
                            </td>
                            <td>
                              <input
                                type="number"
                                step="0.01"
                                min="0"
                                className="demo-input-num"
                                value={fundAmounts[slot]?.sol ?? 0.05}
                                onChange={(e) => {
                                  const val = parseFloat(e.target.value) || 0;
                                  setFundAmounts((prev) => ({
                                    ...prev,
                                    [slot]: { ...prev[slot], sol: val },
                                  }));
                                }}
                              />{' '}
                              <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>SOL</span>
                            </td>
                            <td>
                              <input
                                type="number"
                                step="1"
                                min="0"
                                className="demo-input-num"
                                value={fundAmounts[slot]?.token ?? (slot === 4 ? 10 : 15)}
                                onChange={(e) => {
                                  const val = parseFloat(e.target.value) || 0;
                                  setFundAmounts((prev) => ({
                                    ...prev,
                                    [slot]: { ...prev[slot], token: val },
                                  }));
                                }}
                              />{' '}
                              <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>{tokenSymbol}</span>
                            </td>
                            <td style={{ fontSize: '0.78rem' }}>
                              {b ? (
                                <span style={{ color: b.sol >= 0.01 ? '#ffffff' : 'var(--text-muted)' }}>
                                  {b.sol.toFixed(3)} SOL · {b.token} {tokenSymbol}
                                </span>
                              ) : (
                                <span style={{ color: 'var(--text-muted)' }}>Checking...</span>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>

                  <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.75rem', marginTop: '1rem' }}>
                    <button
                      type="button"
                      className="btn-secondary"
                      onClick={() => setShowFundPanel(false)}
                      style={{ fontSize: '0.82rem', padding: '0.45rem 1rem' }}
                    >
                      Cancel
                    </button>
                    <button
                      type="button"
                      className="btn-primary"
                      disabled={txPending || !connected}
                      onClick={handleFundDemoMembers}
                      style={{ fontSize: '0.82rem', padding: '0.45rem 1.25rem', height: 'auto', minHeight: 'unset' }}
                    >
                      {txPending ? (
                        <>
                          <Loader2 size={14} className="spinner-icon" />
                          Funding Demo Members...
                        </>
                      ) : (
                        <>
                          <Coins size={14} />
                          Approve & Fund Test Members
                        </>
                      )}
                    </button>
                  </div>
                </div>
              )}

              {/* Requirement 6: "Run the demo for me" Autopilot Card */}
              {demoMode && showAutopilot && (
                <div className="autopilot-card">
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem', flexWrap: 'wrap', gap: '0.5rem' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                      <Play size={18} style={{ color: '#ffffff' }} />
                      <h3 style={{ margin: 0, fontSize: '1.05rem', color: '#ffffff' }}>
                        Autopilot Demo Walkthrough
                      </h3>
                      {autopilotRunning && (
                        <span
                          className="badge-pill"
                          style={{
                            fontSize: '0.7rem',
                            color: '#ffffff',
                            borderColor: 'rgba(255, 255, 255, 0.35)',
                            background: 'rgba(255, 255, 255, 0.08)',
                          }}
                        >
                          Running
                        </span>
                      )}
                    </div>

                    <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                      {!autopilotRunning ? (
                        <button
                          type="button"
                          className="btn-primary"
                          style={{ fontSize: '0.78rem', padding: '0.35rem 0.85rem', height: 'auto', minHeight: 'unset' }}
                          onClick={runAutopilot}
                        >
                          <Play size={13} />
                          Start Autopilot
                        </button>
                      ) : (
                        <button
                          type="button"
                          className="btn-secondary"
                          style={{ fontSize: '0.78rem', padding: '0.35rem 0.85rem' }}
                          onClick={stopAutopilot}
                        >
                          <Pause size={13} />
                          Pause Autopilot
                        </button>
                      )}
                      <button
                        type="button"
                        className="btn-secondary"
                        style={{ fontSize: '0.78rem', padding: '0.35rem 0.85rem' }}
                        onClick={resetAutopilot}
                      >
                        <RefreshCw size={13} />
                        Reset
                      </button>
                      <button
                        type="button"
                        className="icon-action-btn"
                        onClick={() => setShowAutopilot(false)}
                        title="Close autopilot card"
                      >
                        <X size={15} />
                      </button>
                    </div>
                  </div>

                  {/* Autopilot Paused for Real Wallet Approval Prompt */}
                  {autopilotWaitingApproval && (
                    <div
                      style={{
                        background: 'rgba(255, 255, 255, 0.06)',
                        border: '1px solid rgba(255, 255, 255, 0.25)',
                        borderRadius: '14px',
                        padding: '1rem 1.25rem',
                        marginBottom: '1rem',
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center',
                        gap: '1rem',
                        flexWrap: 'wrap',
                      }}
                    >
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                        <Wallet size={20} style={{ color: '#ffffff', flexShrink: 0 }} />
                        <div>
                          <strong style={{ color: '#ffffff', fontSize: '0.92rem', display: 'block' }}>
                            Approval Required: Seat 1 is Your Real Wallet
                          </strong>
                          <span style={{ fontSize: '0.82rem', color: 'rgba(255, 255, 255, 0.75)' }}>
                            {autopilotApprovalPrompt || 'Please approve Seat 1 contribution in your connected wallet.'}
                          </span>
                        </div>
                      </div>
                      <button
                        type="button"
                        className="btn-primary"
                        style={{
                          fontSize: '0.82rem',
                          padding: '0.5rem 1.25rem',
                          height: 'auto',
                          minHeight: 'unset',
                          background: '#ffffff',
                          borderColor: '#ffffff',
                          color: '#000000',
                          fontWeight: 700,
                        }}
                        disabled={txPending}
                        onClick={approveCurrentAutopilotStep}
                      >
                        {txPending ? (
                          <>
                            <Loader2 size={14} className="spinner-icon" />
                            Approving in Wallet...
                          </>
                        ) : (
                          'Approve in Real Wallet'
                        )}
                      </button>
                    </div>
                  )}

                  {/* Live Countdown Box */}
                  {autopilotCountdown !== null && (
                    <div
                      style={{
                        background: 'rgba(255, 255, 255, 0.05)',
                        border: '1px solid rgba(255, 255, 255, 0.2)',
                        boxShadow: '0 0 16px rgba(255, 255, 255, 0.06)',
                        borderRadius: '14px',
                        padding: '0.85rem 1.25rem',
                        marginBottom: '1rem',
                        display: 'flex',
                        alignItems: 'center',
                        gap: '0.75rem',
                      }}
                    >
                      <Clock size={18} style={{ color: '#ffffff' }} />
                      <div>
                        <strong style={{ color: '#ffffff', fontSize: '0.9rem' }}>
                          Waiting for Turn 2 grace period deadline...
                        </strong>
                        <div style={{ fontSize: '0.82rem', color: 'rgba(255, 255, 255, 0.85)' }}>
                          Live countdown: <strong>{autopilotCountdown}s</strong> remaining before Seat 4 can be removed on-chain.
                        </div>
                      </div>
                    </div>
                  )}

                  {/* Readable Error State if Autopilot Fails */}
                  {autopilotError && (
                    <div
                      style={{
                        background: 'rgba(239, 68, 68, 0.12)',
                        border: '1px solid rgba(239, 68, 68, 0.45)',
                        borderRadius: '14px',
                        padding: '0.85rem 1.25rem',
                        marginBottom: '1rem',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        gap: '0.75rem',
                      }}
                    >
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.65rem' }}>
                        <AlertTriangle size={18} style={{ color: '#ef4444', flexShrink: 0 }} />
                        <div>
                          <strong style={{ color: '#ef4444', fontSize: '0.88rem' }}>Autopilot Stopped</strong>
                          <p style={{ margin: '0.15rem 0 0', fontSize: '0.82rem', color: '#fca5a5' }}>{autopilotError}</p>
                        </div>
                      </div>
                      <button
                        type="button"
                        className="btn-secondary"
                        style={{ fontSize: '0.75rem', padding: '0.35rem 0.75rem' }}
                        onClick={() => setAutopilotError(null)}
                      >
                        Dismiss
                      </button>
                    </div>
                  )}

                  {/* Autopilot Step Progress Log */}
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '0.45rem', maxHeight: '380px', overflowY: 'auto' }}>
                    {autopilotSteps.map((step, idx) => {
                      const isDone = step.status === 'done';
                      const isRunning = step.status === 'running';
                      const isWaiting = step.status === 'waiting_approval';
                      const isFailed = step.status === 'failed';
                      const isSkipped = step.status === 'skipped';

                      const itemClass = isRunning
                        ? 'autopilot-step-item active'
                        : isWaiting
                        ? 'autopilot-step-item waiting'
                        : isDone
                        ? 'autopilot-step-item done'
                        : isFailed
                        ? 'autopilot-step-item failed'
                        : 'autopilot-step-item';

                      return (
                        <div key={step.id} className={itemClass}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '0.65rem' }}>
                            <div style={{ width: '22px', display: 'flex', justifyContent: 'center' }}>
                              {isRunning && <Loader2 size={15} className="spinner-icon" style={{ color: '#ffffff' }} />}
                              {isDone && <CheckCircle2 size={16} style={{ color: '#ffffff' }} />}
                              {isWaiting && <Clock size={16} style={{ color: 'rgba(255, 255, 255, 0.75)' }} />}
                              {isFailed && <AlertTriangle size={16} className="text-red" />}
                              {isSkipped && <Info size={16} style={{ color: '#94a3b8' }} />}
                              {!isRunning && !isDone && !isWaiting && !isFailed && !isSkipped && (
                                <span style={{ fontSize: '0.75rem', color: 'var(--text-faint)' }}>{idx + 1}</span>
                              )}
                            </div>
                            <div>
                              <span
                                style={{
                                  fontWeight: isRunning || isWaiting ? 600 : 500,
                                  color: isDone ? '#ffffff' : isRunning ? '#ffffff' : isWaiting ? '#ffffff' : 'var(--text-muted)',
                                }}
                              >
                                {step.title}
                              </span>
                              {step.detail && (
                                <span style={{ display: 'block', fontSize: '0.75rem', color: 'var(--text-faint)' }}>
                                  {step.detail}
                                </span>
                              )}
                            </div>
                          </div>

                          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                            {step.signature && (
                              <a
                                href={getExplorerUrl('tx', step.signature)}
                                target="_blank"
                                rel="noreferrer"
                                style={{
                                  fontSize: '0.72rem',
                                  fontFamily: 'var(--font-mono)',
                                  color: '#ffffff',
                                  textDecoration: 'underline',
                                  display: 'flex',
                                  alignItems: 'center',
                                  gap: '3px',
                                }}
                                title="View transaction on Solana Explorer"
                              >
                                {step.signature.slice(0, 6)}...{step.signature.slice(-4)}
                                <ExternalLink size={11} />
                              </a>
                            )}
                            <span
                              style={{
                                fontSize: '0.7rem',
                                fontWeight: 600,
                                textTransform: 'uppercase',
                                color: isDone
                                  ? '#ffffff'
                                  : isRunning
                                  ? '#ffffff'
                                  : isWaiting
                                  ? 'rgba(255, 255, 255, 0.75)'
                                  : isFailed
                                  ? '#ef4444'
                                  : 'var(--text-faint)',
                              }}
                            >
                              {step.status}
                            </span>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* 4-SEAT LIVE DEMO COCKPIT */}
          <div
            className="card demo-cockpit-card"
            style={{
              marginBottom: '1.75rem',
              padding: '1.25rem 1.5rem',
            }}
          >
            {/* Header row */}
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                flexWrap: 'wrap',
                gap: '0.75rem',
                marginBottom: cockpitExpanded ? '1.25rem' : 0,
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                <div
                  style={{
                    width: '36px',
                    height: '36px',
                    borderRadius: 'var(--radius-pill)',
                    background: 'var(--glass-bg)',
                    border: '1px solid var(--glass-border)',
                    boxShadow: 'var(--glass-highlight)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    color: '#ffffff',
                  }}
                >
                  <Wallet size={16} />
                </div>
                <div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                    <h2 className="card-title" style={{ fontSize: '1.1rem', margin: 0 }}>
                      4-Seat live demo cockpit
                    </h2>
                    <span className="badge-pill">
                      Multi-wallet
                    </span>
                  </div>
                  <p className="card-desc" style={{ fontSize: '0.825rem', margin: '0.2rem 0 0 0' }}>
                    Switch accounts in Solflare or Phantom to control each seat with zero page reloads.
                  </p>
                </div>
              </div>

              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                <button
                  type="button"
                  className="search-btn"
                  style={{
                    padding: '0.45rem 1rem',
                    fontSize: '0.8rem',
                  }}
                  onClick={handleCopyShareableLink}
                  title="Copy direct shareable circle URL"
                >
                  {copiedCircleLink ? <Check size={14} className="text-green" /> : <Copy size={14} />}
                  {copiedCircleLink ? 'Copied link' : 'Copy circle link'}
                </button>

                <button
                  type="button"
                  className="icon-action-btn"
                  onClick={() => setCockpitExpanded(!cockpitExpanded)}
                  title={cockpitExpanded ? 'Collapse Cockpit' : 'Expand Cockpit'}
                  style={{ padding: '0.45rem' }}
                >
                  {cockpitExpanded ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
                </button>
              </div>
            </div>

            {cockpitExpanded && (
              <>
                {/* 4 Seat Columns */}
                <div className="demo-cockpit-grid">
                  {Array.from({ length: circle.membersTarget }, (_, i) => i + 1).map((slotNum) => {
                    const member = circle.loadedMembers.find((m) => m.slot === slotNum);
                    const isTaken = !!member;
                    const isDemoSeat = Boolean(demoMode && slotNum >= 2 && slotNum <= 4 && demoKeypairs && demoKeypairs[slotNum]);
                    const demoKp = isDemoSeat && demoKeypairs ? demoKeypairs[slotNum] : null;
                    const demoBal = isDemoSeat ? demoBalances[slotNum] : null;
                    const assignedAddress = member
                      ? member.wallet.toBase58()
                      : isDemoSeat && demoKp
                      ? demoKp.publicKey.toBase58()
                      : knownWallets[slotNum] || null;
                    const isWalletConnected = Boolean(assignedAddress);
                    const isActiveNow = Boolean(
                      connected && publicKey && assignedAddress && assignedAddress === publicKey.toBase58()
                    );
                    const isSelected = selectedSeat === slotNum;
                    const canJoinThisSeat = Boolean(
                      connected &&
                      publicKey &&
                      !isAlreadyMember &&
                      isCircleOpen &&
                      nextSlot === slotNum
                    );
                    const isPaidThisTurn = Boolean(
                      isCircleActive && member && member.lastContributedPeriod === circle.currentPeriod
                    );

                    const cardBg = isActiveNow
                      ? 'rgba(255, 255, 255, 0.08)'
                      : isSelected
                      ? 'rgba(255, 255, 255, 0.06)'
                      : isDemoSeat
                      ? 'rgba(255, 255, 255, 0.03)'
                      : isWalletConnected
                      ? 'rgba(255, 255, 255, 0.04)'
                      : 'rgba(255, 255, 255, 0.015)';

                    const cardBorder = isActiveNow
                      ? '1px solid rgba(255, 255, 255, 0.45)'
                      : isSelected
                      ? '1px solid rgba(255, 255, 255, 0.55)'
                      : isDemoSeat
                      ? '1px solid rgba(255, 255, 255, 0.22)'
                      : canJoinThisSeat
                      ? '1px solid rgba(255, 255, 255, 0.22)'
                      : isWalletConnected
                      ? '1px solid var(--glass-border)'
                      : '1px dashed var(--glass-border-subtle)';

                    return (
                      <div
                        key={slotNum}
                        onClick={() => {
                          setSelectedSeat(slotNum);
                          if (!isActiveNow && !isDemoSeat) {
                            handlePromptSwitchWallet(slotNum);
                          }
                        }}
                        style={{
                          background: cardBg,
                          border: cardBorder,
                          boxShadow: isSelected
                            ? '0 0 16px rgba(255, 255, 255, 0.2), var(--glass-highlight)'
                            : isActiveNow
                            ? 'var(--glass-highlight)'
                            : 'none',
                          borderRadius: '14px',
                          padding: '0.9rem 1rem',
                          display: 'flex',
                          flexDirection: 'column',
                          justifyContent: 'space-between',
                          gap: '0.75rem',
                          transition: 'all 0.2s ease',
                          cursor: 'pointer',
                        }}
                        title={`Click to select Seat ${slotNum}`}
                      >
                        {/* Seat header */}
                        <div>
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.35rem' }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
                              <span style={{ fontWeight: 600, fontSize: '0.875rem', color: '#ffffff' }}>
                                Seat {slotNum} {slotNum === 1 ? '(Creator)' : ''}
                              </span>
                              {isDemoSeat && (
                                <span
                                  className="badge-pill"
                                  style={{
                                    margin: 0,
                                    fontSize: '0.65rem',
                                    padding: '1px 5px',
                                    color: '#ffffff',
                                    borderColor: 'rgba(255, 255, 255, 0.3)',
                                    background: 'rgba(255, 255, 255, 0.08)',
                                  }}
                                >
                                  Demo Key
                                </span>
                              )}
                            </div>
                            {isActiveNow ? (
                              <span className="badge-status paid" style={{ margin: 0, fontSize: '0.68rem', padding: '2px 8px' }}>
                                <Check size={11} /> Active Now
                              </span>
                            ) : isDemoSeat ? (
                              <span className="badge-pill" style={{ margin: 0, fontSize: '0.68rem', padding: '2px 8px', color: 'rgba(255, 255, 255, 0.85)', borderColor: 'rgba(255, 255, 255, 0.25)' }}>
                                Ready
                              </span>
                            ) : isWalletConnected ? (
                              <span className="badge-pill" style={{ margin: 0, fontSize: '0.68rem', padding: '2px 8px', color: '#ffffff', borderColor: 'rgba(255, 255, 255, 0.35)' }}>
                                <Check size={11} /> Connected
                              </span>
                            ) : (
                              <span className="badge-pill" style={{ margin: 0, fontSize: '0.68rem', padding: '2px 8px', color: 'var(--text-faint)' }}>
                                Unconnected
                              </span>
                            )}
                          </div>

                          {/* Wallet info & Balances */}
                          <div style={{ fontSize: '0.78rem', fontFamily: 'var(--font-mono)', color: 'var(--text-muted)' }}>
                            {assignedAddress ? (
                              <span title={assignedAddress}>
                                {assignedAddress.slice(0, 4)}...{assignedAddress.slice(-4)}
                              </span>
                            ) : (
                              <span style={{ color: 'var(--text-faint)' }}>Switch wallet to Account {slotNum}</span>
                            )}
                            {demoBal && (
                              <div style={{ fontSize: '0.72rem', color: demoBal.sol >= 0.01 ? 'rgba(255, 255, 255, 0.85)' : 'var(--text-muted)', marginTop: '2px' }}>
                                {demoBal.sol.toFixed(3)} SOL · {demoBal.token} {tokenSymbol}
                              </div>
                            )}
                          </div>
                        </div>

                        {/* Status Indicator */}
                        <div style={{ fontSize: '0.78rem' }}>
                          {member?.status === 'Removed' ? (
                            <span className="badge-status removed" style={{ margin: 0, fontSize: '0.72rem' }}>
                              Removed
                            </span>
                          ) : member?.hasBeenPaid ? (
                            <span className="badge-status settled" style={{ margin: 0, fontSize: '0.72rem' }}>
                              Paid out
                            </span>
                          ) : isCircleActive ? (
                            isPaidThisTurn ? (
                              <span className="badge-status paid" style={{ margin: 0, fontSize: '0.72rem' }}>
                                Turn {circle.currentPeriod} paid
                              </span>
                            ) : (
                              <span className="badge-status pending" style={{ margin: 0, fontSize: '0.72rem' }}>
                                Not paid yet
                              </span>
                            )
                          ) : isCircleOpen ? (
                            isTaken ? (
                              <span className="badge-status joined" style={{ margin: 0, fontSize: '0.72rem' }}>
                                Joined
                              </span>
                            ) : slotNum === nextSlot ? (
                              <span className="badge-status queue" style={{ margin: 0, fontSize: '0.72rem' }}>
                                Next seat to join
                              </span>
                            ) : (
                              <span style={{ color: 'var(--text-faint)', fontSize: '0.72rem' }}>
                                Waiting for Seat {slotNum - 1}
                              </span>
                            )
                          ) : (
                            <span style={{ color: 'var(--text-muted)', fontSize: '0.72rem' }}>
                              Status: {member?.status || 'Pending'}
                            </span>
                          )}
                        </div>

                        {/* Action Buttons */}
                        <div style={{ marginTop: 'auto', paddingTop: '0.25rem' }} onClick={(e) => e.stopPropagation()}>
                          {/* Active seat loading wallet indicator (Requirement 4) */}
                          {isActiveNow && isWalletBusy && (
                            <div className="wallet-loading-indicator" style={{ marginBottom: '0.35rem', justifyContent: 'center' }}>
                              <Loader2 size={12} className="spinner-icon" />
                              <span>Loading this wallet...</span>
                            </div>
                          )}

                          {/* 1. Demo Seat Join */}
                          {isCircleOpen && isDemoSeat && demoKp && !isTaken && slotNum === nextSlot && (
                            <button
                              type="button"
                              className="btn-primary"
                              style={{ width: '100%', padding: '0.45rem', fontSize: '0.78rem', minHeight: '34px', height: 'auto' }}
                              disabled={txPending || isWalletBusy}
                              onClick={() => handleJoinCircle(createKeypairWallet(demoKp))}
                            >
                              Join Seat {slotNum} (Demo)
                            </button>
                          )}

                          {/* 2. Real Wallet Join */}
                          {isCircleOpen && !isDemoSeat && canJoinThisSeat && (
                            <button
                              type="button"
                              className="btn-primary"
                              style={{ width: '100%', padding: '0.45rem', fontSize: '0.78rem', minHeight: '34px', height: 'auto' }}
                              disabled={txPending || isWalletBusy}
                              onClick={handleJoinCircle}
                            >
                              {isWalletBusy ? (
                                <>
                                  <Loader2 size={13} className="spinner-icon" />
                                  Loading this wallet...
                                </>
                              ) : (
                                `Join Seat ${slotNum}`
                              )}
                            </button>
                          )}

                          {/* 3. If Open and this is next seat to join, but need to switch wallet account (when not in demo) */}
                          {isCircleOpen && !isDemoSeat && !isTaken && slotNum === nextSlot && !canJoinThisSeat && (
                            <button
                              type="button"
                              className="btn-secondary"
                              style={{ width: '100%', padding: '0.45rem', fontSize: '0.76rem', minHeight: '34px', height: 'auto' }}
                              disabled={txPending}
                              onClick={() => handlePromptSwitchWallet(slotNum)}
                              title="Switch wallet account to join this seat"
                            >
                              Switch to Account {slotNum} to join
                            </button>
                          )}

                          {/* 4. If Open and waiting for earlier seats to join first */}
                          {isCircleOpen && !isTaken && slotNum > nextSlot && (
                            <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', textAlign: 'center', padding: '0.25rem' }}>
                              Fills after Seat {slotNum - 1}
                            </div>
                          )}

                          {/* 5. Demo Seat Contribute */}
                          {isCircleActive && isDemoSeat && demoKp && member && member.status === 'Active' && !isPaidThisTurn && (
                            <button
                              type="button"
                              className="btn-primary"
                              style={{ width: '100%', padding: '0.45rem', fontSize: '0.78rem', minHeight: '34px', height: 'auto' }}
                              disabled={nowSec > graceDeadline || txPending || isWalletBusy}
                              onClick={() => handleContribute(member, createKeypairWallet(demoKp))}
                            >
                              Pay Turn ({formattedContribution} {tokenSymbol})
                            </button>
                          )}

                          {/* 6. Real Wallet Contribute */}
                          {isCircleActive && !isDemoSeat && member && member.status === 'Active' && !isPaidThisTurn && (
                            isActiveNow ? (
                              <button
                                type="button"
                                className="btn-primary"
                                style={{ width: '100%', padding: '0.45rem', fontSize: '0.78rem', minHeight: '34px', height: 'auto' }}
                                disabled={nowSec > graceDeadline || txPending || isWalletBusy}
                                onClick={() => handleContribute(member)}
                              >
                                {isWalletBusy ? (
                                  <>
                                    <Loader2 size={13} className="spinner-icon" />
                                    Loading this wallet...
                                  </>
                                ) : (
                                  `Pay turn (${formattedContribution} ${tokenSymbol})`
                                )}
                              </button>
                            ) : (
                              <button
                                type="button"
                                className="btn-secondary"
                                style={{ width: '100%', padding: '0.45rem', fontSize: '0.76rem', minHeight: '34px', height: 'auto' }}
                                disabled={nowSec > graceDeadline || txPending}
                                onClick={() => handlePromptSwitchWallet(slotNum)}
                                title="Switch wallet to this seat's account to pay"
                              >
                                Switch & Pay Seat {slotNum}
                              </button>
                            )
                          )}

                          {/* 7. If Active and already paid */}
                          {isCircleActive && isPaidThisTurn && (
                            <div style={{ fontSize: '0.72rem', color: 'var(--status-paid)', textAlign: 'center', fontWeight: 500 }}>
                              Payment confirmed in vault
                            </div>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>

                {/* Helper Footer */}
                <div
                  style={{
                    marginTop: '0.85rem',
                    paddingTop: '0.75rem',
                    borderTop: '1px solid var(--glass-border-subtle)',
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    fontSize: '0.75rem',
                    color: 'var(--text-muted)',
                    flexWrap: 'wrap',
                    gap: '0.5rem',
                  }}
                >
                  <span>
                    Tip: Click any seat to switch to it and prompt your wallet directly, with zero manual disconnects needed.
                  </span>
                  {publicKey && (
                    <span style={{ fontFamily: 'var(--font-mono)' }}>
                      Active: {publicKey.toBase58().slice(0, 4)}...{publicKey.toBase58().slice(-4)}
                    </span>
                  )}
                </div>
              </>
            )}
          </div>

          <div className="circle-layout-split">
          {/* LEFT COLUMN: THE RING PANEL */}
          <div className="circle-layout-left">
            <Reveal revealKey={`circle-ring-card-${circle.address.toBase58()}`}>
              <div className="card" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
                <div style={{ width: '100%', display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
                  <span className={`badge-state ${circle.status.toLowerCase()}`}>
                    {circle.status === 'Open'
                      ? 'Open: waiting for members'
                      : circle.status === 'Active'
                      ? 'Running'
                      : circle.status === 'Filling'
                      ? 'Waiting for new members'
                      : circle.status === 'Closing'
                      ? 'Ending: refunds are open'
                      : circle.status}
                  </span>
                  <span className="badge-pill">
                    {circle.depositPct}% deposit
                  </span>
                </div>

                {/* The SVG Ring */}
                <CircleRing
                  circle={circle}
                  members={circle.loadedMembers}
                  tokenSymbol={tokenSymbol}
                  tokenDecimals={tokenDecimals}
                />

                {/* Ring Subtext & Address Info */}
                <div style={{ width: '100%', marginTop: '1.5rem', paddingTop: '1.25rem', borderTop: '1px solid var(--glass-border-subtle)' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.825rem', marginBottom: '0.5rem' }}>
                    <span style={{ color: 'var(--text-muted)' }}>Payment</span>
                    <strong style={{ color: '#ffffff' }}>{formattedContribution} {tokenSymbol} / turn</strong>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.825rem', marginBottom: '0.5rem' }}>
                    <span style={{ color: 'var(--text-muted)' }}>Active members</span>
                    <strong style={{ color: '#ffffff' }}>{circle.activeMemberCount} of {circle.membersTarget}</strong>
                  </div>
                  {hasReserve && (
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.825rem', marginBottom: '0.5rem', background: 'rgba(255, 255, 255, 0.06)', border: '1px solid rgba(255, 255, 255, 0.15)', padding: '0.3rem 0.5rem', borderRadius: '6px' }}>
                      <span style={{ color: '#ffffff', display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
                        <Coins size={13} /> On-chain reserve pool
                      </span>
                      <strong style={{ color: '#ffffff', fontFamily: 'monospace' }}>+{formattedReserve} {tokenSymbol}</strong>
                    </div>
                  )}

                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: '0.75rem', fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                    <span style={{ fontFamily: 'var(--font-mono)' }}>
                      {circle.address.toBase58().slice(0, 6)}...{circle.address.toBase58().slice(-6)}
                    </span>
                    <div style={{ display: 'flex', gap: '0.25rem' }}>
                      <button
                        type="button"
                        className="icon-action-btn"
                        onClick={handleCopyCircle}
                        title="Copy circle address"
                      >
                        {copiedCircle ? <Check size={14} className="text-green" /> : <Copy size={14} />}
                      </button>
                      <a
                        href={getExplorerUrl('address', circle.address.toBase58())}
                        target="_blank"
                        rel="noreferrer"
                        className="icon-action-btn"
                        title="View circle on explorer"
                      >
                        <ExternalLink size={14} />
                      </a>
                      <button
                        type="button"
                        className="icon-action-btn"
                        onClick={() => loadCircleData(circle.address.toBase58(), true)}
                        title="Refresh data"
                      >
                        <RefreshCw size={14} className={isRefreshing ? 'spinner-icon' : ''} />
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            </Reveal>
          </div>

          {/* RIGHT COLUMN: ACTIONS, MEMBERS & ACTIVITY */}
          <div className="circle-layout-right" style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
            {/* Header Title Card */}
            <Reveal revealKey={`circle-header-title-${circle.address.toBase58()}`}>
              <div className="glass-panel" style={{ padding: '1.5rem 1.75rem' }}>
                <div className="circle-badges-row" style={{ marginBottom: '0.5rem' }}>
                  <span className="badge-pill">
                    {isCircleOpen
                      ? `${circle.currentMemberCount} of ${circle.membersTarget} seats filled`
                      : `Turn ${circle.currentPeriod} of ${circle.orderLen || circle.membersTarget}`}
                  </span>
                  <span className="badge-pill">{tokenSymbol}</span>
                </div>
                <h1 className="circle-title" style={{ fontSize: '1.85rem' }}>
                  Savings circle #{circle.circleId.toString()}
                </h1>
                <p style={{ color: 'var(--text-body)', fontSize: '0.875rem', marginTop: '0.25rem' }}>
                  Rules enforced by the program on the Solana test network (devnet).
                </p>
              </div>
            </Reveal>

            {/* ACTION PANEL 1: JOIN CARD (when Open) */}
            {isCircleOpen && (
              <div className="card join-card" aria-labelledby="join-heading">
                <Reveal revealKey={`circle-join-heading-${circle.address.toBase58()}`}>
                  <div className="join-card-header">
                    <div>
                      <h2 id="join-heading" className="card-title" style={{ margin: 0 }}>
                        Join circle
                      </h2>
                      <p className="card-desc" style={{ margin: '0.25rem 0 0 0' }}>
                        Joining assigns seat {nextSlot} of {circle.membersTarget} and locks your deposit upfront.
                      </p>
                    </div>
                    <span className="badge-spec">Deposit formula</span>
                  </div>
                </Reveal>

                {/* Section 6 Formula Breakdown */}
                <div className="deposit-math-box">
                  <div className="formula-header">
                    <Info size={14} />
                    <span>Deposit calculation</span>
                  </div>
                  <div className="formula-expression">
                    deposit = max(ceil(deposit_pct * (N - k) * c / 100), c)
                  </div>

                  <div className="formula-breakdown-list">
                    <div className="formula-breakdown-item">
                      <span>Assigned seat (k)</span>
                      <strong>Seat {nextSlot}</strong>
                    </div>
                    <div className="formula-breakdown-item">
                      <span>Turns remaining (N - k)</span>
                      <strong>{circle.membersTarget} - {nextSlot} = {owedPeriods}</strong>
                    </div>
                    <div className="formula-breakdown-item">
                      <span>Payment each turn (c)</span>
                      <strong>{formattedContribution} {tokenSymbol}</strong>
                    </div>
                  </div>

                  <div className="deposit-total-row">
                    <span>Deposit you lock</span>
                    <span className="deposit-total-amount">
                      {formattedDeposit} {tokenSymbol}
                    </span>
                  </div>
                </div>

                {/* Join Button */}
                <div>
                  {!connected ? (
                    <div className="alert-box warning-alert">
                      <AlertTriangle size={16} />
                      <span>Connect your wallet to continue.</span>
                    </div>
                  ) : isAlreadyMember ? (
                    <div className="alert-box success-alert">
                      <CheckCircle size={16} />
                      <span>You are registered in this circle in seat {userMember?.slot}. Your turn is scheduled.</span>
                    </div>
                  ) : isCircleFull ? (
                    <div className="alert-box warning-alert">
                      <AlertTriangle size={16} />
                      <span>This circle is full.</span>
                    </div>
                  ) : (
                    <div>
                      {isWalletBusy && (
                        <div className="wallet-loading-indicator" style={{ marginBottom: '0.65rem' }}>
                          <Loader2 size={13} className="spinner-icon" />
                          <span>Loading this wallet...</span>
                        </div>
                      )}
                      <button
                        type="button"
                        id="join-circle-btn"
                        className="btn-primary"
                        style={{ width: '100%' }}
                        disabled={txPending || isWalletBusy}
                        onClick={handleJoinCircle}
                      >
                        {txPending ? (
                          <>
                            <Loader2 size={16} className="spinner-icon" />
                            Joining circle...
                          </>
                        ) : isWalletBusy ? (
                          <>
                            <Loader2 size={16} className="spinner-icon" />
                            Loading this wallet...
                          </>
                        ) : (
                          <>
                            Join circle
                          </>
                        )}
                      </button>
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* ACTION PANEL 1.5: MEMBER ACTIONS (when connected user is a circle member) */}
            {userMember && (
              <div className="card member-action-card" style={{ border: '1px solid rgba(255, 255, 255, 0.15)' }}>
                <Reveal revealKey={`circle-member-action-${circle.address.toBase58()}`}>
                  <div className="card-header-row" style={{ marginBottom: '0.75rem' }}>
                    <div>
                      <h2 className="card-title" style={{ fontSize: '1.15rem', margin: 0 }}>
                        Your member actions (Seat {userMember.slot})
                      </h2>
                      <p className="card-desc" style={{ margin: '0.2rem 0 0 0' }}>
                        Actions for your seat in this circle.
                      </p>
                    </div>
                    <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                      {userMember.slot === 1 && <span className="tag-creator">Creator</span>}
                      {userMember.leaving && <span className="badge-status removed">Leaving flagged</span>}
                    </div>
                  </div>
                </Reveal>

                {isWalletBusy && (
                  <div className="wallet-loading-indicator" style={{ marginBottom: '0.65rem' }}>
                    <Loader2 size={13} className="spinner-icon" />
                    <span>Loading this wallet...</span>
                  </div>
                )}

                {/* Contribute Section for Connected Member */}
                {isCircleActive && (
                  <div style={{ marginBottom: '1rem' }}>
                    {userMember.lastContributedPeriod === circle.currentPeriod ? (
                      <div className="alert-box success-alert" style={{ margin: 0 }}>
                        <CheckCircle size={16} />
                        <span>
                          You paid for Turn {circle.currentPeriod} (<strong>{formattedContribution} {tokenSymbol}</strong> locked in vault).
                        </span>
                      </div>
                    ) : (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                        <button
                          type="button"
                          id="member-contribute-btn"
                          className="btn-primary"
                          style={{ width: '100%' }}
                          disabled={nowSec > graceDeadline || txPending || isWalletBusy}
                          onClick={handleContribute}
                        >
                          {txPending && txPendingMsg?.includes('Paying turn') ? (
                            <>
                              <Loader2 size={16} className="spinner-icon" />
                              Paying turn...
                            </>
                          ) : (
                            <>
                              <Coins size={16} />
                              Pay turn ({formattedContribution} {tokenSymbol})
                            </>
                          )}
                        </button>
                        <span style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>
                          {nowSec > graceDeadline
                            ? 'The time to pay for this turn has passed.'
                            : `Time to pay ends in ${formatCountdown(graceDeadline)}.`}
                        </span>
                      </div>
                    )}
                  </div>
                )}

                {/* flagLeaving and exitMember buttons */}
                <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap' }}>
                  {canFlagLeaving && (
                    <button
                      type="button"
                      id="member-flag-leaving-btn"
                      className="btn-secondary"
                      disabled={txPending || isWalletBusy}
                      onClick={() => handleFlagLeaving()}
                      title="Flag leaving so your deposit is returned when the circle resets"
                    >
                      <LogOut size={14} />
                      Flag leaving
                    </button>
                  )}

                  {canExitMember && (
                    <button
                      type="button"
                      id="member-exit-btn"
                      className="btn-primary"
                      disabled={txPending || isWalletBusy}
                      onClick={() => handleExitMember()}
                      title="Reclaim your deposit and exit this circle"
                    >
                      <LogOut size={14} />
                      Exit circle
                    </button>
                  )}
                </div>
              </div>
            )}

            {/* ACTION PANEL 1.6: MANUAL PAYMENT FOR ALL SEATS (Available when circle is Active) */}
            {isCircleActive && (!userMember || demoMode) && (
              <div className="card member-action-card" style={{ border: '1px solid rgba(255, 255, 255, 0.15)' }}>
                <Reveal revealKey={`circle-manual-pay-${circle.address.toBase58()}`}>
                  <div className="card-header-row" style={{ marginBottom: '0.75rem' }}>
                    <div>
                      <h2 className="card-title" style={{ fontSize: '1.15rem', margin: 0 }}>
                        Manual turn payments
                      </h2>
                      <p className="card-desc" style={{ margin: '0.2rem 0 0 0' }}>
                        Select a seat to switch wallet or trigger instant demo payment for Turn {circle.currentPeriod}.
                      </p>
                    </div>
                  </div>
                </Reveal>

                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '0.65rem' }}>
                  {circle.loadedMembers
                    .filter((m) => m.status === 'Active')
                    .map((m) => {
                      const isPaid = m.lastContributedPeriod === circle.currentPeriod;
                      const isDemo = Boolean(demoMode && demoKeypairs && demoKeypairs[m.slot]);
                      return (
                        <button
                          key={m.slot}
                          type="button"
                          className={isPaid ? 'btn-secondary' : 'btn-primary'}
                          style={{
                            fontSize: '0.78rem',
                            padding: '0.55rem',
                            opacity: isPaid ? 0.6 : 1,
                            minHeight: '38px',
                          }}
                          disabled={isPaid || txPending || isWalletBusy}
                          onClick={() => {
                            if (publicKey && m.wallet.equals(publicKey)) {
                              handleContribute(m);
                            } else if (isDemo && demoKeypairs) {
                              handleContribute(m, createKeypairWallet(demoKeypairs[m.slot]));
                            } else {
                              handlePromptSwitchWallet(m.slot);
                            }
                          }}
                        >
                          {isPaid
                            ? `Seat ${m.slot} Paid`
                            : isDemo
                            ? `Pay Seat ${m.slot} (Demo)`
                            : `Pay Seat ${m.slot} (${formattedContribution} ${tokenSymbol})`}
                        </button>
                      );
                    })}
                </div>
              </div>
            )}

            {/* ACTION PANEL 2: PROTOCOL TRIGGER ACTIONS */}
            <div className="card triggers-card" aria-labelledby="triggers-title">
              <Reveal revealKey={`circle-triggers-heading-${circle.address.toBase58()}`}>
                <div className="triggers-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <div>
                    <h2 id="triggers-title" className="card-title" style={{ margin: 0 }}>
                      Circle actions
                    </h2>
                    <p className="card-desc" style={{ margin: '0.2rem 0 0 0' }}>
                      Actions callable by anyone once conditions are met.
                    </p>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                    <button
                      type="button"
                      id="manual-refresh-btn"
                      className="btn-secondary"
                      onClick={() => loadCircleData(circle.address.toBase58(), true)}
                      disabled={isRefreshing || loading}
                      style={{ padding: '0.35rem 0.75rem', fontSize: '0.75rem', gap: '0.35rem' }}
                      title="Refresh circle state from the Solana test network"
                    >
                      <RefreshCw size={12} className={isRefreshing ? 'spinner-icon' : ''} />
                      <span>Refresh</span>
                      <span style={{ fontSize: '0.68rem', opacity: 0.65 }}>• 10s auto</span>
                    </button>
                  </div>
                </div>
              </Reveal>

              {/* Live Turn & Countdown Banner */}
              {isCircleActive && (
                <div
                  className="period-countdown-banner"
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    background: 'rgba(255, 255, 255, 0.03)',
                    border: '1px solid var(--glass-border-subtle)',
                    borderRadius: '12px',
                    padding: '0.75rem 1rem',
                    marginTop: '0.75rem',
                    fontSize: '0.85rem',
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                    <Clock size={16} className="text-amber" />
                    <span>
                      Turn {circle.currentPeriod} time left:{' '}
                      <strong style={{ color: '#ffffff', fontFamily: 'monospace' }}>
                        {formatCountdown(graceDeadline)}
                      </strong>
                    </span>
                  </div>
                  <span className={`badge-status ${isGraceExpired ? 'removed' : 'pending'}`} style={{ margin: 0 }}>
                    {isGraceExpired ? 'Time passed' : isPeriodExpired ? 'Extra time' : 'Turn active'}
                  </span>
                </div>
              )}

              {/* Auto-Payout & Auto-Evict Toggles for Live Demos */}
              {isCircleActive && (
                <div className="demo-automation-box">
                  <div className="demo-automation-header">
                    <Sparkles size={14} style={{ color: '#ffffff' }} />
                    <span>Demo Automation Controls</span>
                  </div>

                  <div className="demo-automation-row">
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                      <RefreshCw size={14} style={{ color: '#ffffff' }} />
                      <div style={{ display: 'flex', flexDirection: 'column' }}>
                        <span style={{ fontSize: '0.82rem', fontWeight: 600, color: '#ffffff' }}>
                          Auto-payout pot on completion
                        </span>
                        <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>
                          Automatically triggers payout prompt as soon as all turn contributions arrive
                        </span>
                      </div>
                    </div>
                    <button
                      type="button"
                      style={{
                        padding: '0.25rem 0.75rem',
                        fontSize: '0.75rem',
                        borderRadius: '20px',
                        background: autoPayoutEnabled ? '#ffffff' : 'rgba(255, 255, 255, 0.05)',
                        color: autoPayoutEnabled ? '#000000' : 'var(--text-muted)',
                        fontWeight: 700,
                        border: `1px solid ${autoPayoutEnabled ? '#ffffff' : 'var(--glass-border-subtle)'}`,
                        cursor: 'pointer',
                        transition: 'all 0.2s ease',
                      }}
                      onClick={() => setAutoPayoutEnabled(!autoPayoutEnabled)}
                    >
                      {autoPayoutEnabled ? 'Active' : 'Off'}
                    </button>
                  </div>

                  <div className="demo-automation-row">
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                      <ShieldAlert size={15} style={{ color: '#ffffff' }} />
                      <div style={{ display: 'flex', flexDirection: 'column' }}>
                        <span style={{ fontSize: '0.82rem', fontWeight: 600, color: '#ffffff' }}>
                          Auto-evict defaulter when grace expires
                        </span>
                        <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>
                          Automatically prompts removal of delinquent member once grace period expires
                        </span>
                      </div>
                    </div>
                    <button
                      type="button"
                      style={{
                        padding: '0.25rem 0.75rem',
                        fontSize: '0.75rem',
                        borderRadius: '20px',
                        background: autoRemoveEnabled ? '#ffffff' : 'rgba(255, 255, 255, 0.05)',
                        color: autoRemoveEnabled ? '#000000' : 'var(--text-muted)',
                        fontWeight: 700,
                        border: `1px solid ${autoRemoveEnabled ? '#ffffff' : 'var(--glass-border-subtle)'}`,
                        cursor: 'pointer',
                        transition: 'all 0.2s ease',
                      }}
                      onClick={() => setAutoRemoveEnabled(!autoRemoveEnabled)}
                    >
                      {autoRemoveEnabled ? 'Active' : 'Off'}
                    </button>
                  </div>
                </div>
              )}

              <div className="triggers-action-list" style={{ marginTop: '1rem', display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                {isWalletBusy && (
                  <div className="wallet-loading-indicator" style={{ marginBottom: '0.45rem' }}>
                    <Loader2 size={13} className="spinner-icon" />
                    <span>Loading this wallet...</span>
                  </div>
                )}

                {/* 1. Pay out to <member> */}
                <div className="trigger-item">
                  <button
                    type="button"
                    id="trigger-payout-btn"
                    className={`trigger-action-btn ${canPayout ? 'btn-primary' : 'btn-disabled'}`}
                    disabled={!canPayout || txPending || isWalletBusy}
                    onClick={handlePayout}
                  >
                    {txPending && txPendingMsg?.includes('Paying out') ? (
                      <>
                        <Loader2 size={16} className="spinner-icon" />
                        Paying out to {payoutRecipientDisplay}...
                      </>
                    ) : (
                      <>
                        <Coins size={16} />
                        Pay out to {payoutRecipientDisplay}
                      </>
                    )}
                  </button>
                  <div className="trigger-status-reason" style={{ display: 'flex', flexDirection: 'column', gap: '0.2rem' }}>
                    <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
                      <Clock size={12} className="text-amber" />
                      <span>Countdown: <strong style={{ color: '#ffffff', fontFamily: 'monospace' }}>{payoutCountdown}</strong></span>
                    </span>
                    <span className={`reason-text ${canPayout ? 'text-green' : 'disabled'}`}>
                      {canPayout ? <CheckCircle size={13} /> : <AlertTriangle size={13} />} {payoutReason}
                    </span>
                  </div>
                </div>

                {/* 2. Remove late member */}
                <div className="trigger-item">
                  <button
                    type="button"
                    id="trigger-remove-defaulter-btn"
                    className={`trigger-action-btn ${canRemoveDefaulter ? 'btn-primary' : 'btn-disabled'}`}
                    disabled={!canRemoveDefaulter || txPending || isWalletBusy}
                    onClick={() => handleRemoveDefaulter()}
                  >
                    {txPending && (txPendingMsg?.toLowerCase().includes('late member') || txPendingMsg?.toLowerCase().includes('wallet') || txPendingMsg?.toLowerCase().includes('simulating') || txPendingMsg?.toLowerCase().includes('solana')) ? (
                      <>
                        <Loader2 size={16} className="spinner-icon" />
                        {txPendingMsg || 'Removing late member...'}
                      </>
                    ) : (
                      <>
                        <ShieldAlert size={16} />
                        {removeDefaulterButtonLabel}
                      </>
                    )}
                  </button>
                  <div className="trigger-status-reason" style={{ display: 'flex', flexDirection: 'column', gap: '0.2rem' }}>
                    <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
                      <Clock size={12} className="text-amber" />
                      <span>Countdown: <strong style={{ color: '#ffffff', fontFamily: 'monospace' }}>{removeDefaulterCountdown}</strong></span>
                    </span>
                    <span className={`reason-text ${canRemoveDefaulter ? 'text-green' : 'disabled'}`}>
                      {canRemoveDefaulter ? <CheckCircle size={13} /> : <AlertTriangle size={13} />} {removeDefaulterReason}
                    </span>
                  </div>
                </div>

                {/* 3. Contribute <amount> */}
                <div className="trigger-item">
                  <button
                    type="button"
                    id="trigger-contribute-btn"
                    className={`trigger-action-btn ${canContribute ? 'btn-primary' : 'btn-disabled'}`}
                    disabled={!canContribute || txPending || isWalletBusy}
                    onClick={handleContribute}
                  >
                    {txPending && txPendingMsg?.includes('Paying turn') ? (
                      <>
                        <Loader2 size={16} className="spinner-icon" />
                        Paying turn...
                      </>
                    ) : (
                      <>
                        <Coins size={16} />
                        Contribute {formattedContribution} {tokenSymbol}
                      </>
                    )}
                  </button>
                  <div className="trigger-status-reason" style={{ display: 'flex', flexDirection: 'column', gap: '0.2rem' }}>
                    <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
                      <Clock size={12} className="text-amber" />
                      <span>Countdown: <strong style={{ color: '#ffffff', fontFamily: 'monospace' }}>{contributeCountdown}</strong></span>
                    </span>
                    <span className={`reason-text ${canContribute ? 'text-green' : 'disabled'}`}>
                      {canContribute ? <CheckCircle size={13} /> : <AlertTriangle size={13} />} {contributeReason}
                    </span>
                  </div>
                </div>

                {/* 4. Closing Recovery & Settlement Actions (Requirement 4) */}
                {circle.status === 'Closing' && (
                  <div
                    className="closing-actions-box"
                    style={{
                      marginTop: '0.5rem',
                      padding: '1rem',
                      borderRadius: '12px',
                      background: 'rgba(239, 68, 68, 0.05)',
                      border: '1px solid rgba(239, 68, 68, 0.2)',
                      display: 'flex',
                      flexDirection: 'column',
                      gap: '0.75rem',
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                      <AlertTriangle size={16} className="text-red" />
                      <strong style={{ fontSize: '0.85rem', color: '#ffffff' }}>Circle is Closing: Settlements & Claims</strong>
                    </div>

                    {/* Claim Refund */}
                    <div className="trigger-item">
                      <button
                        type="button"
                        id="claim-refund-btn"
                        className={`trigger-action-btn ${canClaimRefund ? 'btn-primary' : 'btn-disabled'}`}
                        disabled={!canClaimRefund || txPending || isWalletBusy}
                        onClick={handleClaimRefund}
                      >
                        {txPending && txPendingMsg?.includes('Claiming contribution refund') ? (
                          <>
                            <Loader2 size={16} className="spinner-icon" />
                            Claiming refund...
                          </>
                        ) : (
                          <>
                            <Coins size={16} />
                            Claim contribution refund ({formattedContribution} {tokenSymbol})
                          </>
                        )}
                      </button>
                      <div className="trigger-status-reason">
                        <span className={`reason-text ${canClaimRefund ? 'text-green' : 'disabled'}`}>
                          <Info size={13} /> {claimRefundReason}
                        </span>
                      </div>
                    </div>

                    {/* Claim Forfeit */}
                    <div className="trigger-item">
                      <button
                        type="button"
                        id="claim-forfeit-btn"
                        className={`trigger-action-btn ${canClaimForfeit ? 'btn-primary' : 'btn-disabled'}`}
                        disabled={!canClaimForfeit || txPending || isWalletBusy}
                        onClick={handleClaimForfeit}
                      >
                        {txPending && txPendingMsg?.includes('Claiming forfeit compensation') ? (
                          <>
                            <Loader2 size={16} className="spinner-icon" />
                            Claiming forfeit share...
                          </>
                        ) : (
                          <>
                            <Award size={16} />
                            Claim forfeit compensation ({formattedForfeitAmount} {tokenSymbol})
                          </>
                        )}
                      </button>
                      <div className="trigger-status-reason">
                        <span className={`reason-text ${canClaimForfeit ? 'text-green' : 'disabled'}`}>
                          <Info size={13} /> {claimForfeitReason}
                        </span>
                      </div>
                    </div>

                    {/* Exit Member during Closing */}
                    {userMember && userMember.status === 'Active' && (
                      <div className="trigger-item">
                        <button
                          type="button"
                          id="closing-exit-btn"
                          className={`trigger-action-btn ${canExitMember ? 'btn-primary' : 'btn-disabled'}`}
                          disabled={!canExitMember || txPending || isWalletBusy}
                          onClick={() => handleExitMember()}
                        >
                          {txPending && txPendingMsg?.includes('Exiting circle') ? (
                            <>
                              <Loader2 size={16} className="spinner-icon" />
                              Exiting circle...
                            </>
                          ) : (
                            <>
                              <LogOut size={16} />
                              Exit circle & reclaim deposit
                            </>
                          )}
                        </button>
                        <div className="trigger-status-reason">
                          <span className={`reason-text ${canExitMember ? 'text-green' : 'disabled'}`}>
                            <Info size={13} /> {exitMemberReason}
                          </span>
                        </div>
                      </div>
                    )}
                  </div>
                )}

                {/* 5. Member Lifecycle: flagLeaving and exitMember where program allows */}
                {userMember && userMember.status === 'Active' && circle.status !== 'Closing' && (
                  <div style={{ marginTop: '0.5rem', display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
                    {canFlagLeaving && (
                      <div className="trigger-item" style={{ flex: 1, minWidth: '180px' }}>
                        <button
                          type="button"
                          id="member-flag-leaving-btn"
                          className="btn-secondary trigger-action-btn"
                          disabled={txPending || isWalletBusy}
                          onClick={() => handleFlagLeaving()}
                          title="Flag leaving so your deposit is returned when the circle resets"
                        >
                          <LogOut size={14} />
                          Flag leaving
                        </button>
                        <div className="trigger-status-reason">
                          <span className="reason-text text-green" style={{ fontSize: '0.72rem' }}>
                            <Info size={12} /> {flagLeavingReason}
                          </span>
                        </div>
                      </div>
                    )}

                    {canExitMember && (
                      <div className="trigger-item" style={{ flex: 1, minWidth: '180px' }}>
                        <button
                          type="button"
                          id="member-exit-btn"
                          className="btn-primary trigger-action-btn"
                          disabled={txPending || isWalletBusy}
                          onClick={() => handleExitMember()}
                          title="Reclaim your deposit and exit this circle"
                        >
                          <LogOut size={14} />
                          Exit circle
                        </button>
                        <div className="trigger-status-reason">
                          <span className="reason-text text-green" style={{ fontSize: '0.72rem' }}>
                            <Info size={12} /> {exitMemberReason}
                          </span>
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>

            {/* MEMBERS LINEUP SECTION */}
            <section className="card members-section" aria-labelledby="members-heading">
              <Reveal revealKey={`circle-members-heading-${circle.address.toBase58()}`}>
                <div className="card-header-row">
                  <div>
                    <h2 id="members-heading" className="card-title">
                      Circle members ({circle.loadedMembers.length} of {circle.membersTarget} seats)
                    </h2>
                    <p className="card-desc" style={{ margin: 0 }}>
                      Public records of deposits, payment turns, and member statuses.
                    </p>
                  </div>
                  <div className="legend-pills">
                    <span className="legend-item"><span className="legend-dot green"></span> Paid</span>
                    <span className="legend-item"><span className="legend-dot purple"></span> Gets the pot next</span>
                    <span className="legend-item"><span className="legend-dot red"></span> Removed</span>
                  </div>
                </div>
              </Reveal>

              <div className="members-grid">
                {circle.loadedMembers.map((member, idx) => {
                  const isRemoved = member.status === 'Removed';
                  const isRecipient =
                    isCircleActive &&
                    currentPeriodRecipientSlot === member.slot &&
                    member.status === 'Active';
                  const hasPaidThisPeriod =
                    isCircleActive &&
                    member.lastContributedPeriod === circle.currentPeriod;

                  const shortened = `${member.wallet.toBase58().slice(0, 4)}...${member.wallet.toBase58().slice(-4)}`;

                  return (
                    <Reveal
                      key={member.slot}
                      revealKey={`circle-member-${circle.address.toBase58()}-${member.slot}`}
                      staggerIndex={idx}
                    >
                      <div
                        className={`member-card ${isRecipient ? 'card-recipient' : ''} ${
                          isRemoved ? 'card-removed' : ''
                        }`}
                      >
                        <div className="member-card-header">
                          <div className="slot-badge-circle">#{member.slot}</div>
                          <div className="member-title-col">
                            <div className="member-display-name">
                              <span>Seat {member.slot}</span>
                              {member.slot === 1 && <span className="tag-creator">Creator</span>}
                              {isRecipient && <span className="tag-recipient">Gets the pot next</span>}
                              {member.hasBeenPaid && !isRecipient && (
                                <span className="tag-paidout">Paid out</span>
                              )}
                              {member.leaving && (
                                <span className="badge-status removed" style={{ fontSize: '0.7rem', padding: '0.15rem 0.45rem' }}>
                                  Leaving
                                </span>
                              )}
                            </div>
                            <div className="member-wallet-row">
                              <Wallet size={12} />
                              <span className="member-wallet" title={member.wallet.toBase58()}>
                                {shortened}
                              </span>
                              <button
                                type="button"
                                className="icon-action-btn"
                                onClick={() => handleCopyMemberWallet(member.wallet, idx)}
                                title="Copy wallet address"
                              >
                                {copiedMemberIdx === idx ? (
                                  <Check size={12} className="text-green" />
                                ) : (
                                  <Copy size={12} />
                                )}
                              </button>
                              <a
                                href={getExplorerUrl('address', member.wallet.toBase58())}
                                target="_blank"
                                rel="noreferrer"
                                className="explorer-link"
                                title="View wallet on explorer"
                              >
                                <ExternalLink size={12} />
                              </a>
                            </div>
                          </div>
                        </div>

                        <div className="member-card-body">
                          {/* Period Status (Who Paid) */}
                          <div className="member-info-row">
                            <span className="info-label">
                              {isCircleOpen ? 'Join status' : `Turn ${circle.currentPeriod} status`}
                            </span>
                            {isRemoved ? (
                              <span className="badge-status removed">
                                <XCircle size={13} /> Removed for missing a payment
                              </span>
                            ) : isCircleOpen ? (
                              <span className="badge-status joined">
                                <CheckCircle size={13} /> Joined (deposit locked)
                              </span>
                            ) : hasPaidThisPeriod ? (
                              <span className="badge-status paid">
                                <CheckCircle size={13} /> Paid ({formattedContribution} {tokenSymbol})
                              </span>
                            ) : (
                              <span className="badge-status pending">
                                <Clock size={13} /> Not paid yet
                              </span>
                            )}
                          </div>

                          {/* Payout Status (Who is Next) */}
                          <div className="member-info-row">
                            <span className="info-label">Payout status</span>
                            {isRecipient ? (
                              <span className="badge-status next-recipient">
                                <Award size={13} /> Gets the pot next
                              </span>
                            ) : member.hasBeenPaid ? (
                              <span className="badge-status settled">
                                <CheckCircle size={13} /> Paid out
                              </span>
                            ) : (
                              <span className="badge-status queue">
                                Turn: seat {member.slot}
                              </span>
                            )}
                          </div>

                          {/* Deposit Locked */}
                          <div className="member-info-row">
                            <span className="info-label">Deposit you lock</span>
                            <span className="deposit-locked-val">
                              <strong>{formatTokenAmount(member.depositRemaining, tokenDecimals)}</strong> {tokenSymbol}
                            </span>
                          </div>

                          {isRemoved && (
                            <div className="removal-explanation">
                              <AlertTriangle size={13} className="text-red" />
                              <span>Missed payment deadline. Removed from circle and deposit lost.</span>
                            </div>
                          )}

                          {/* Member Contextual Actions */}
                          {member.status === 'Active' && (
                            <div style={{ marginTop: '0.75rem', paddingTop: '0.75rem', borderTop: '1px solid var(--glass-border-subtle)', display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
                              {/* Connected wallet buttons */}
                              {connected && publicKey && member.wallet.equals(publicKey) && (
                                <>
                                  {isCircleActive && !hasPaidThisPeriod && (
                                    <button
                                      type="button"
                                      id={`member-card-contribute-${member.slot}`}
                                      className="btn-primary"
                                      style={{ padding: '0.35rem 0.75rem', fontSize: '0.75rem', gap: '0.3rem' }}
                                      disabled={nowSec > graceDeadline || txPending}
                                      onClick={handleContribute}
                                      title={`Pay ${formattedContribution} ${tokenSymbol}`}
                                    >
                                      <Coins size={12} /> Pay turn
                                    </button>
                                  )}
                                  {!member.leaving && (circle.status === 'Active' || circle.status === 'Filling') && (
                                    <button
                                      type="button"
                                      id={`member-card-flag-leaving-${member.slot}`}
                                      className="btn-secondary"
                                      style={{ padding: '0.35rem 0.75rem', fontSize: '0.75rem', gap: '0.3rem' }}
                                      disabled={txPending}
                                      onClick={() => handleFlagLeaving(member)}
                                      title="Flag leaving to exit at reset"
                                    >
                                      <LogOut size={12} /> Flag leaving
                                    </button>
                                  )}
                                  {((circle.status === 'Filling' && member.leaving) || circle.status === 'Closing') && (
                                    <button
                                      type="button"
                                      id={`member-card-exit-${member.slot}`}
                                      className="btn-primary"
                                      style={{ padding: '0.35rem 0.75rem', fontSize: '0.75rem', gap: '0.3rem' }}
                                      disabled={txPending}
                                      onClick={() => handleExitMember(member)}
                                      title="Exit circle and reclaim deposit"
                                    >
                                      <LogOut size={12} /> Exit circle
                                    </button>
                                  )}
                                  {circle.status === 'Closing' && canClaimRefund && (
                                    <button
                                      type="button"
                                      id={`member-card-claim-refund-${member.slot}`}
                                      className="btn-primary"
                                      style={{ padding: '0.35rem 0.75rem', fontSize: '0.75rem', gap: '0.3rem' }}
                                      disabled={txPending}
                                      onClick={handleClaimRefund}
                                      title="Claim contribution refund"
                                    >
                                      <Coins size={12} /> Claim refund
                                    </button>
                                  )}
                                  {circle.status === 'Closing' && canClaimForfeit && (
                                    <button
                                      type="button"
                                      id={`member-card-claim-forfeit-${member.slot}`}
                                      className="btn-primary"
                                      style={{ padding: '0.35rem 0.75rem', fontSize: '0.75rem', gap: '0.3rem' }}
                                      disabled={txPending}
                                      onClick={handleClaimForfeit}
                                      title="Claim forfeit share"
                                    >
                                      <Award size={12} /> Claim forfeit
                                    </button>
                                  )}
                                </>
                              )}

                              {/* Permissionless triggers for this member */}
                              {circle.status === 'Closing' && (!connected || !publicKey || !member.wallet.equals(publicKey)) && (
                                <button
                                  type="button"
                                  className="btn-secondary"
                                  style={{ padding: '0.35rem 0.75rem', fontSize: '0.75rem', gap: '0.3rem' }}
                                  disabled={txPending}
                                  onClick={() => handleExitMember(member)}
                                  title="Exit member from circle"
                                >
                                  <LogOut size={12} /> Exit member
                                </button>
                              )}

                              {isCircleActive && !hasPaidThisPeriod && isGraceExpired && (
                                <button
                                  type="button"
                                  className="btn-secondary"
                                  style={{ padding: '0.35rem 0.75rem', fontSize: '0.75rem', gap: '0.3rem', borderColor: 'var(--status-removed)', color: 'var(--status-removed)' }}
                                  disabled={txPending}
                                  onClick={() => handleRemoveDefaulter(member)}
                                  title="Remove late member"
                                >
                                  <ShieldAlert size={12} /> Remove late member
                                </button>
                              )}
                            </div>
                          )}
                        </div>
                      </div>
                    </Reveal>
                  );
                })}
              </div>
            </section>

            {/* DISBURSEMENT RECORDS & PROOF OF POT CARD */}
            <section className="card disbursements-section" aria-labelledby="disbursements-heading">
              <Reveal revealKey={`circle-disbursements-heading-${circle.address.toBase58()}`}>
                <div className="card-header-row">
                  <div>
                    <h2 id="disbursements-heading" className="card-title" style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                      <Award size={18} className="text-accent" />
                      Disbursement records & pot distribution
                    </h2>
                    <p className="card-desc" style={{ margin: 0 }}>
                      Verifiable on-chain record of pot payouts disbursed to each scheduled recipient seat.
                    </p>
                  </div>
                  <span
                    className="badge-pill"
                    style={{
                      borderColor: 'rgba(255, 255, 255, 0.35)',
                      color: '#ffffff',
                      background: 'rgba(255, 255, 255, 0.08)',
                    }}
                  >
                    {circle.loadedMembers.filter((m) => m.hasBeenPaid).length} of {circle.orderLen || circle.membersTarget} disbursed
                  </span>
                </div>
              </Reveal>

              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem', marginTop: '1rem' }}>
                {Array.from({ length: circle.orderLen || circle.membersTarget }, (_, idx) => {
                  const turnNum = idx + 1;
                  const recipientSlot =
                    circle.payoutOrder && circle.payoutOrder[idx] ? circle.payoutOrder[idx] : turnNum;
                  const member = circle.loadedMembers.find((m) => m.slot === recipientSlot);
                  const isPaid = member ? member.hasBeenPaid : false;
                  const isCurrent = isCircleActive && circle.currentPeriod === turnNum;
                  const potAmountFormatted = formatTokenAmount(
                    circle.contribution.mul(new BN(circle.expectedContributors || circle.membersTarget)),
                    tokenDecimals
                  );

                  return (
                    <div
                      key={`disbursement-turn-${turnNum}`}
                      style={{
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center',
                        background: isPaid
                          ? 'rgba(255, 255, 255, 0.07)'
                          : isCurrent
                          ? 'rgba(255, 255, 255, 0.04)'
                          : 'rgba(255, 255, 255, 0.02)',
                        border: isPaid
                          ? '1px solid rgba(255, 255, 255, 0.35)'
                          : isCurrent
                          ? '1px solid rgba(255, 255, 255, 0.20)'
                          : '1px solid var(--glass-border-subtle)',
                        borderRadius: '12px',
                        padding: '0.85rem 1.1rem',
                      }}
                    >
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.85rem' }}>
                        <div
                          style={{
                            width: '32px',
                            height: '32px',
                            borderRadius: '50%',
                            background: isPaid ? '#ffffff' : isCurrent ? 'rgba(255, 255, 255, 0.20)' : 'rgba(255, 255, 255, 0.08)',
                            color: isPaid ? '#000000' : isCurrent ? '#ffffff' : 'var(--text-muted)',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            fontWeight: 700,
                            fontSize: '0.85rem',
                          }}
                        >
                          {isPaid ? <Check size={16} /> : turnNum}
                        </div>
                        <div>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                            <strong style={{ color: '#ffffff', fontSize: '0.9rem' }}>
                              Turn {turnNum}: Seat {recipientSlot}
                            </strong>
                            {member && (
                              <span style={{ fontSize: '0.75rem', fontFamily: 'var(--font-mono)', color: 'var(--text-muted)' }}>
                                ({member.wallet.toBase58().slice(0, 4)}...{member.wallet.toBase58().slice(-4)})
                              </span>
                            )}
                          </div>
                          <span style={{ fontSize: '0.78rem', color: isPaid ? '#ffffff' : isCurrent ? 'rgba(255, 255, 255, 0.85)' : 'var(--text-muted)' }}>
                            {isPaid
                              ? `Pot disbursed on-chain (${potAmountFormatted} ${tokenSymbol})`
                              : isCurrent
                              ? `In progress (Turn ${turnNum} recipient · Pot: ${potAmountFormatted} ${tokenSymbol})`
                              : `Upcoming turn recipient`}
                          </span>
                        </div>
                      </div>

                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.65rem' }}>
                        <span
                          style={{
                            fontSize: '0.72rem',
                            fontWeight: 700,
                            padding: '0.25rem 0.6rem',
                            borderRadius: '6px',
                            background: isPaid
                              ? 'rgba(255, 255, 255, 0.12)'
                              : isCurrent
                              ? 'rgba(255, 255, 255, 0.06)'
                              : 'rgba(255, 255, 255, 0.05)',
                            color: isPaid ? '#ffffff' : isCurrent ? 'rgba(255, 255, 255, 0.85)' : 'var(--text-muted)',
                            border: `1px solid ${isPaid ? 'rgba(255, 255, 255, 0.35)' : isCurrent ? 'rgba(255, 255, 255, 0.20)' : 'rgba(255, 255, 255, 0.08)'}`,
                          }}
                        >
                          {isPaid ? 'DISBURSED' : isCurrent ? 'CURRENT POT' : 'QUEUED'}
                        </span>
                        {member && (
                          <a
                            href={getExplorerUrl('address', member.wallet.toBase58())}
                            target="_blank"
                            rel="noreferrer"
                            className="icon-action-btn"
                            title="Verify recipient wallet on Solana Explorer"
                          >
                            <ExternalLink size={13} />
                          </a>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </section>

            {/* ACTIVITY RECORD */}
            <section className="card events-section" aria-labelledby="events-heading">
              <Reveal revealKey={`circle-activity-heading-${circle.address.toBase58()}`}>
                <div className="card-header-row">
                  <div>
                    <h2 id="events-heading" className="card-title">
                      <History size={18} />
                      Activity record
                    </h2>
                    <p className="card-desc" style={{ margin: 0 }}>
                      Events recorded on the Solana test network.
                    </p>
                  </div>
                </div>
              </Reveal>

              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem', marginTop: '1rem' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: 'rgba(255, 255, 255, 0.03)', padding: '0.75rem 1rem', borderRadius: '12px', border: '1px solid var(--glass-border-subtle)' }}>
                  <div>
                    <span style={{ fontSize: '0.85rem', fontWeight: 600, color: '#ffffff' }}>Circle created</span>
                    <p style={{ fontSize: '0.775rem', color: 'var(--text-muted)' }}>Circle started with {circle.membersTarget} seats and {circle.depositPct}% deposit rate.</p>
                  </div>
                  <a
                    href={getExplorerUrl('address', circle.address.toBase58())}
                    target="_blank"
                    rel="noreferrer"
                    className="icon-action-btn"
                    title="View on explorer"
                  >
                    <ExternalLink size={14} />
                  </a>
                </div>
              </div>
            </section>
          </div>
        </div>
        </>
      )}
    </div>
  );
};

