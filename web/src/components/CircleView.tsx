import type { FC } from 'react';
import { useState, useEffect, useCallback } from 'react';
import { useConnection, useWallet } from '@solana/wallet-adapter-react';
import { PublicKey, TransactionInstruction } from '@solana/web3.js';
import { TOKEN_PROGRAM_ID } from '@solana/spl-token';
import { SystemProgram } from '@solana/web3.js';
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
  getExplorerUrl,
  translateProgramError,
} from '../solthriftClient';
import { isPlaceholderMint } from '../config';
import { CircleRing } from './CircleRing';
import { SolanaLogo3D } from './SolanaLogo3D';
import { Reveal } from './Reveal';

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
  const { connected, publicKey } = wallet;

  // Search input & loaded circle state
  const [inputAddress, setInputAddress] = useState<string>(circleAddress || '');
  const [loading, setLoading] = useState<boolean>(false);
  const [isRefreshing, setIsRefreshing] = useState<boolean>(false);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [circle, setCircle] = useState<RealCircleData | null>(null);
  const [tokenDecimals, setTokenDecimals] = useState<number>(6);

  // Address copy feedback
  const [copiedCircle, setCopiedCircle] = useState<boolean>(false);
  const [copiedMemberIdx, setCopiedMemberIdx] = useState<number | null>(null);

  // Transaction execution state
  const [txPending, setTxPending] = useState<boolean>(false);
  const [txPendingMsg, setTxPendingMsg] = useState<string | null>(null);
  const [txSuccess, setTxSuccess] = useState<{ signature: string; message: string } | null>(null);
  const [txError, setTxError] = useState<{ message: string; details?: string } | null>(null);

  // Live timer ticking every second for real-time countdowns without reloading
  const [nowSec, setNowSec] = useState<number>(Math.floor(Date.now() / 1000));
  useEffect(() => {
    const timer = setInterval(() => {
      setNowSec(Math.floor(Date.now() / 1000));
    }, 1000);
    return () => clearInterval(timer);
  }, []);

  /**
   * Fetch real on-chain Circle and Member data from Devnet
   * @param silent If true, updates state silently without triggering full-screen loading skeleton
   */
  const loadCircleData = useCallback(
    async (addressToLoad: string, silent: boolean = false) => {
      const trimmed = addressToLoad.trim();
      if (!trimmed) {
        setCircle(null);
        setFetchError(null);
        return;
      }

      let pubkey: PublicKey;
      try {
        pubkey = new PublicKey(trimmed);
      } catch {
        setFetchError(`The address "${trimmed}" is not a valid Solana address. Check the address and try again.`);
        setCircle(null);
        return;
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
        const program = getSolthriftProgram(connection, wallet as any);
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

        setCircle(circleData);
      } catch (err: any) {
        console.error('Failed to load on-chain circle:', err);
        if (!silent) {
          const errStr = String(err?.message || err);
          if (errStr.includes('Account does not exist')) {
            setFetchError('No circle at this address. Check the link or create a new circle.');
          } else {
            const translated = translateProgramError(err);
            setFetchError(`Could not load circle: ${translated.message} Check your network connection.`);
          }
          setCircle(null);
        }
      } finally {
        if (!silent) {
          setLoading(false);
        } else {
          setIsRefreshing(false);
        }
      }
    },
    [connection, wallet]
  );

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
    if (inputAddress.trim()) {
      onSelectCircle?.(inputAddress.trim());
      loadCircleData(inputAddress.trim());
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

  const canPayout = Boolean(
    isCircleActive &&
    circle &&
    circle.contributionsThisPeriod === circle.expectedContributors &&
    circle.currentPeriod >= 1 &&
    circle.currentPeriod <= circle.orderLen &&
    nextRecipientMember &&
    !nextRecipientMember.hasBeenPaid &&
    connected
  );

  let payoutReason = '';
  if (!connected) {
    payoutReason = 'Connect your wallet to continue.';
  } else if (!isCircleActive) {
    payoutReason = `Circle is not running`;
  } else if (circle && circle.contributionsThisPeriod < circle.expectedContributors) {
    const remainingText = nowSec <= graceDeadline ? ` (${formatCountdown(graceDeadline)} left to pay)` : ' (extra time to pay has passed)';
    payoutReason = `Waiting for payments: ${circle.contributionsThisPeriod} of ${circle.expectedContributors} members have paid for this turn${remainingText}`;
  } else if (nextRecipientMember?.hasBeenPaid) {
    payoutReason = `Recipient in seat ${currentPeriodRecipientSlot} already received the pot for this turn`;
  } else if (canPayout) {
    payoutReason = `All ${circle?.expectedContributors} payments received. Ready to pay out pot to seat ${currentPeriodRecipientSlot}.`;
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
    isCircleActive &&
    targetLateMember !== null &&
    isGraceExpired &&
    connected
  );

  let removeDefaulterReason = '';
  if (!connected) {
    removeDefaulterReason = 'Connect your wallet to continue.';
  } else if (!isCircleActive) {
    removeDefaulterReason = `Circle is not running`;
  } else if (lateMembers.length === 0 || (circle && circle.contributionsThisPeriod === circle.expectedContributors)) {
    removeDefaulterReason = `No late members: all ${circle?.expectedContributors || 0} members have paid for Turn ${circle?.currentPeriod}`;
  } else if (!isGraceExpired) {
    removeDefaulterReason = `Time has not run out yet (${formatCountdown(graceDeadline)} left)`;
  } else if (canRemoveDefaulter) {
    removeDefaulterReason = `Time to pay has passed. Seat ${targetLateMember?.slot} missed payment; anyone can remove them to settle.`;
  }

  // Start states evaluation
  const fillWindowEndTime = circle
    ? periodStartTime + Number(circle.fillWindowDuration.toString())
    : 0;

  let startButtonLabel = 'Start next turn';
  let startReason = '';

  if (isCircleOpen) {
    startButtonLabel = 'Start circle';
    startReason = `Circle is waiting for members (${circle?.currentMemberCount || 0} of ${circle?.membersTarget || 0} joined). Starts automatically when all seats fill.`;
  } else if (isCircleActive) {
    startButtonLabel = 'Start next turn';
    startReason = `Turn ${circle?.currentPeriod} of ${circle?.orderLen || circle?.membersTarget} is currently running. Next turn starts after current turn finishes.`;
  } else if (circle?.status === 'Filling') {
    startButtonLabel = 'Start next turn';
    if (nowSec <= fillWindowEndTime) {
      startReason = `Waiting window active (${formatCountdown(fillWindowEndTime)} left)`;
    } else {
      startReason = 'Waiting window ended. Seats locked; ready for next turn.';
    }
  } else {
    startButtonLabel = 'Start next turn';
    startReason = 'Circle is not active';
  }

  // Member-specific flags
  const canFlagLeaving = Boolean(
    userMember &&
    userMember.status === 'Active' &&
    !userMember.leaving &&
    (circle?.status === 'Active' || circle?.status === 'Filling')
  );

  const canExitMember = Boolean(
    userMember &&
    userMember.status === 'Active' &&
    ((circle?.status === 'Filling' && userMember.leaving) || circle?.status === 'Closing')
  );

  /**
   * Section 5, Instruction 2: Join Circle
   */
  const handleJoinCircle = async () => {
    if (!connected || !publicKey) {
      setTxError({ message: 'Connect your wallet to continue.' });
      return;
    }
    if (!circle) return;

    if (isAlreadyMember) {
      setTxError({ message: `Already a member in seat ${userMember?.slot}.` });
      return;
    }

    if (isCircleFull) {
      setTxError({ message: 'This circle is full.' });
      return;
    }

    if (isPlaceholderMint(circle.tokenMint)) {
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

      const [memberPda] = getMemberPda(circle.address, publicKey);
      const program = getSolthriftProgram(connection, wallet as any);

      const method = program.methods
        .joinCircle()
        .accounts({
          circle: circle.address,
          member: memberPda,
          memberWallet: publicKey,
          tokenMint: circle.tokenMint,
          memberTokenAccount: memberAta,
          vault: circle.vault,
          tokenProgram: TOKEN_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
        });

      if (preInstructions.length > 0) {
        method.preInstructions(preInstructions);
      }

      const sig = await method.rpc();
      setTxSuccess({
        signature: sig,
        message: `You joined the circle. Seat ${nextSlot} is locked.`,
      });

      // Refetch latest circle and member accounts from chain
      await loadCircleData(circle.address.toBase58(), true);
    } catch (err: any) {
      console.error('joinCircle failed:', err);
      const translated = translateProgramError(err);
      setTxError({ message: translated.message, details: translated.details });
    } finally {
      setTxPending(false);
      setTxPendingMsg(null);
    }
  };

  /**
   * Section 5, Instruction 3: Contribute
   * Real on-chain contribution payment by the connected member
   */
  const handleContribute = async () => {
    if (!connected || !publicKey) {
      setTxError({ message: 'Connect your wallet to continue.' });
      return;
    }
    if (!circle || !userMember) {
      setTxError({ message: 'You are not registered as an active member of this circle.' });
      return;
    }

    setTxPending(true);
    setTxPendingMsg('Paying turn...');
    setTxError(null);
    setTxSuccess(null);

    try {
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

      const program = getSolthriftProgram(connection, wallet as any);
      const method = program.methods
        .contribute()
        .accounts({
          circle: circle.address,
          member: userMember.memberPda,
          memberWallet: publicKey,
          tokenMint: circle.tokenMint,
          memberTokenAccount: memberAta,
          vault: circle.vault,
          tokenProgram: TOKEN_PROGRAM_ID,
        });

      if (preInstructions.length > 0) {
        method.preInstructions(preInstructions);
      }

      const sig = await method.rpc();
      setTxSuccess({
        signature: sig,
        message: 'You paid for this turn.',
      });

      await loadCircleData(circle.address.toBase58(), true);
    } catch (err: any) {
      console.error('contribute failed:', err);
      const translated = translateProgramError(err);
      setTxError({ message: translated.message, details: translated.details });
    } finally {
      setTxPending(false);
      setTxPendingMsg(null);
    }
  };

  /**
   * Section 5, Instruction 4: Payout
   * Callable by anyone; recipient = payout_order[current_period - 1]
   * Passes that member's account and associated token account, creating it first if missing
   */
  const handlePayout = async () => {
    if (!connected || !publicKey) {
      setTxError({ message: 'Connect your wallet to continue.' });
      return;
    }
    if (!circle) return;

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

    setTxPending(true);
    setTxPendingMsg(`Paying out to ${payoutRecipientDisplay}...`);
    setTxError(null);
    setTxSuccess(null);

    try {
      const preInstructions: TransactionInstruction[] = [];
      // Requirement 2: pass that member's ATA, creating it first if missing
      const { ata: recipientAta, instruction: createAtaIx } = await getOrCreateAtaInstruction(
        connection,
        circle.tokenMint,
        recWallet,
        publicKey // connected caller pays rent if ATA needs creation
      );
      if (createAtaIx) {
        preInstructions.push(createAtaIx);
      }

      const program = getSolthriftProgram(connection, wallet as any);
      const method = program.methods
        .payout()
        .accounts({
          circle: circle.address,
          recipientMember: recMemberPda,
          tokenMint: circle.tokenMint,
          recipientTokenAccount: recipientAta,
          vault: circle.vault,
          caller: publicKey,
          tokenProgram: TOKEN_PROGRAM_ID,
        });

      if (preInstructions.length > 0) {
        method.preInstructions(preInstructions);
      }

      const sig = await method.rpc();
      setTxSuccess({
        signature: sig,
        message: `You paid out to ${payoutRecipientDisplay}.`,
      });

      await loadCircleData(circle.address.toBase58(), true);
    } catch (err: any) {
      console.error('payout failed:', err);
      const translated = translateProgramError(err);
      setTxError({ message: translated.message, details: translated.details });
    } finally {
      setTxPending(false);
      setTxPendingMsg(null);
    }
  };

  /**
   * Section 5, Instruction 5: Remove Defaulter
   * Callable by anyone after deadline + grace against an active member who missed contribution
   */
  const handleRemoveDefaulter = async (memberToRemove?: RealMemberData) => {
    if (!connected || !publicKey) {
      setTxError({ message: 'Connect your wallet to continue.' });
      return;
    }
    if (!circle) return;

    const target = memberToRemove || targetLateMember;
    if (!target) {
      setTxError({ message: 'No late member eligible for removal.' });
      return;
    }

    setTxPending(true);
    setTxPendingMsg('Removing late member...');
    setTxError(null);
    setTxSuccess(null);

    try {
      const preInstructions: TransactionInstruction[] = [];
      const { ata: memberAta, instruction: createAtaIx } = await getOrCreateAtaInstruction(
        connection,
        circle.tokenMint,
        target.wallet,
        publicKey
      );
      if (createAtaIx) {
        preInstructions.push(createAtaIx);
      }

      const program = getSolthriftProgram(connection, wallet as any);
      const method = program.methods
        .removeDefaulter()
        .accounts({
          circle: circle.address,
          member: target.memberPda,
          tokenMint: circle.tokenMint,
          memberTokenAccount: memberAta,
          vault: circle.vault,
          caller: publicKey,
          tokenProgram: TOKEN_PROGRAM_ID,
        });

      if (preInstructions.length > 0) {
        method.preInstructions(preInstructions);
      }

      const sig = await method.rpc();
      setTxSuccess({
        signature: sig,
        message: 'You removed the late member.',
      });

      await loadCircleData(circle.address.toBase58(), true);
    } catch (err: any) {
      console.error('removeDefaulter failed:', err);
      const translated = translateProgramError(err);
      setTxError({ message: translated.message, details: translated.details });
    } finally {
      setTxPending(false);
      setTxPendingMsg(null);
    }
  };

  /**
   * Section 5, Instruction 6: Flag Leaving
   * Signed by the member while Active or Filling
   */
  const handleFlagLeaving = async (targetMember?: RealMemberData) => {
    if (!connected || !publicKey) {
      setTxError({ message: 'Connect your wallet to continue.' });
      return;
    }
    if (!circle) return;

    const memberToFlag = targetMember || userMember;
    if (!memberToFlag) {
      setTxError({ message: 'Member account not found for connected wallet.' });
      return;
    }

    setTxPending(true);
    setTxPendingMsg('Flagging leaving...');
    setTxError(null);
    setTxSuccess(null);

    try {
      const program = getSolthriftProgram(connection, wallet as any);
      const sig = await program.methods
        .flagLeaving()
        .accounts({
          circle: circle.address,
          member: memberToFlag.memberPda,
          memberWallet: publicKey,
        })
        .rpc();

      setTxSuccess({
        signature: sig,
        message: 'You flagged leaving.',
      });

      await loadCircleData(circle.address.toBase58(), true);
    } catch (err: any) {
      console.error('flagLeaving failed:', err);
      const translated = translateProgramError(err);
      setTxError({ message: translated.message, details: translated.details });
    } finally {
      setTxPending(false);
      setTxPendingMsg(null);
    }
  };

  /**
   * Section 5, Instruction 7: Exit Member
   * Callable by anyone during Filling or Closing for members who flagged leaving or when Closing
   */
  const handleExitMember = async (targetMember?: RealMemberData) => {
    if (!connected || !publicKey) {
      setTxError({ message: 'Connect your wallet to continue.' });
      return;
    }
    if (!circle) return;

    const memberToExit = targetMember || userMember;
    if (!memberToExit) {
      setTxError({ message: 'Member account not found to exit.' });
      return;
    }

    setTxPending(true);
    setTxPendingMsg('Exiting circle...');
    setTxError(null);
    setTxSuccess(null);

    try {
      const preInstructions: TransactionInstruction[] = [];
      const { ata: memberAta, instruction: createAtaIx } = await getOrCreateAtaInstruction(
        connection,
        circle.tokenMint,
        memberToExit.wallet,
        publicKey
      );
      if (createAtaIx) {
        preInstructions.push(createAtaIx);
      }

      const program = getSolthriftProgram(connection, wallet as any);
      const method = program.methods
        .exitMember()
        .accounts({
          circle: circle.address,
          member: memberToExit.memberPda,
          tokenMint: circle.tokenMint,
          memberTokenAccount: memberAta,
          vault: circle.vault,
          caller: publicKey,
          tokenProgram: TOKEN_PROGRAM_ID,
        });

      if (preInstructions.length > 0) {
        method.preInstructions(preInstructions);
      }

      const sig = await method.rpc();
      setTxSuccess({
        signature: sig,
        message: 'You exited the circle.',
      });

      await loadCircleData(circle.address.toBase58(), true);
    } catch (err: any) {
      console.error('exitMember failed:', err);
      const translated = translateProgramError(err);
      setTxError({ message: translated.message, details: translated.details });
    } finally {
      setTxPending(false);
      setTxPendingMsg(null);
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
        <div className="alert-box pending-alert" role="status">
          <Loader2 size={18} className="spinner-icon" />
          <span>{txPendingMsg || 'Transaction pending on the test network. Approve in your wallet.'}</span>
        </div>
      )}

      {txSuccess && (
        <div className="alert-box success-alert" role="status" style={{ flexDirection: 'column', alignItems: 'flex-start', gap: '0.5rem' }}>
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
      )}

      {txError && (
        <div className="alert-box error-alert" role="alert">
          <AlertTriangle size={18} />
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
        <div className="alert-box error-alert" role="alert">
          <AlertTriangle size={20} />
          <div>
            <strong>Could not load circle</strong>
            <p style={{ marginTop: '0.25rem', fontSize: '0.9rem' }}>{fetchError}</p>
          </div>
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
                        onClick={() => loadCircleData(circle.address.toBase58())}
                        title="Refresh data"
                      >
                        <RefreshCw size={14} />
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
                    <button
                      type="button"
                      id="join-circle-btn"
                      className="btn-primary"
                      style={{ width: '100%' }}
                      disabled={txPending}
                      onClick={handleJoinCircle}
                    >
                      {txPending ? (
                        <>
                          <Loader2 size={16} className="spinner-icon" />
                          Joining circle...
                        </>
                      ) : (
                        <>
                          Join circle
                        </>
                      )}
                    </button>
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
                          disabled={nowSec > graceDeadline || txPending}
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
                      disabled={txPending}
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
                      disabled={txPending}
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
                      onClick={() => loadCircleData(circle.address.toBase58(), false)}
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

              <div className="triggers-action-list" style={{ marginTop: '1rem' }}>
                {/* Trigger 1: Pay out to <member> */}
                <div className="trigger-item">
                  <button
                    type="button"
                    id="trigger-payout-btn"
                    className={`trigger-action-btn ${canPayout ? 'btn-primary' : 'btn-disabled'}`}
                    disabled={!canPayout || txPending}
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
                  <div className="trigger-status-reason">
                    <span className={`reason-text ${canPayout ? 'text-green' : 'disabled'}`}>
                      <Clock size={13} /> {payoutReason}
                    </span>
                  </div>
                </div>

                {/* Trigger 2: Remove late member */}
                <div className="trigger-item">
                  <button
                    type="button"
                    id="trigger-remove-defaulter-btn"
                    className={`trigger-action-btn ${canRemoveDefaulter ? 'btn-primary' : 'btn-disabled'}`}
                    disabled={!canRemoveDefaulter || txPending}
                    onClick={() => handleRemoveDefaulter()}
                  >
                    {txPending && txPendingMsg?.includes('Removing late member') ? (
                      <>
                        <Loader2 size={16} className="spinner-icon" />
                        Removing late member...
                      </>
                    ) : (
                      <>
                        <ShieldAlert size={16} />
                        {removeDefaulterButtonLabel}
                      </>
                    )}
                  </button>
                  <div className="trigger-status-reason">
                    <span className={`reason-text ${canRemoveDefaulter ? 'text-green' : 'disabled'}`}>
                      <Clock size={13} /> {removeDefaulterReason}
                    </span>
                  </div>
                </div>

                {/* Trigger 3: Start states */}
                <div className="trigger-item">
                  <button
                    type="button"
                    id="trigger-start-btn"
                    className="trigger-action-btn btn-disabled"
                    disabled
                  >
                    <Award size={16} />
                    {startButtonLabel}
                  </button>
                  <div className="trigger-status-reason">
                    <span className="reason-text disabled">
                      <Clock size={13} /> {startReason}
                    </span>
                  </div>
                </div>
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
      )}
    </div>
  );
};

