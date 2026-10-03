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
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [circle, setCircle] = useState<RealCircleData | null>(null);
  const [tokenDecimals, setTokenDecimals] = useState<number>(6);

  // Address copy feedback
  const [copiedCircle, setCopiedCircle] = useState<boolean>(false);
  const [copiedMemberIdx, setCopiedMemberIdx] = useState<number | null>(null);

  // Transaction execution state for joinCircle
  const [txPending, setTxPending] = useState<boolean>(false);
  const [txPendingMsg, setTxPendingMsg] = useState<string | null>(null);
  const [txSuccess, setTxSuccess] = useState<{ signature: string; message: string } | null>(null);
  const [txError, setTxError] = useState<string | null>(null);

  /**
   * Fetch real on-chain Circle and Member data from Devnet
   */
  const loadCircleData = useCallback(
    async (addressToLoad: string) => {
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
        setFetchError(`The address "${trimmed}" is not a valid Solana public key. Check the address and try again.`);
        setCircle(null);
        return;
      }

      setLoading(true);
      setFetchError(null);
      setTxSuccess(null);
      setTxError(null);

      try {
        const program = getSolthriftProgram(connection, wallet as any);
        const circleAccount = await program.account.circle.fetch(pubkey);

        // Fetch mint decimals
        let decimals = 6;
        try {
          const mintInfo = await connection.getParsedAccountInfo(circleAccount.tokenMint as PublicKey);
          if (mintInfo.value && 'parsed' in mintInfo.value.data) {
            decimals = mintInfo.value.data.parsed.info.decimals;
          }
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
        const errStr = String(err?.message || err);
        if (errStr.includes('Account does not exist')) {
          setFetchError(`Circle account not found on Solana devnet at address ${trimmed}. Verify the address or create a new circle.`);
        } else {
          const translated = translateProgramError(err);
          setFetchError(`Failed to load circle: ${translated.message}. Check your network connection.`);
        }
        setCircle(null);
      } finally {
        setLoading(false);
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

  // Determine recipient member
  const currentPeriodRecipientSlot =
    circle && isCircleActive && circle.currentPeriod >= 1 && circle.currentPeriod <= circle.orderLen
      ? circle.payoutOrder[circle.currentPeriod - 1]
      : null;

  const nextRecipientMember =
    currentPeriodRecipientSlot && circle
      ? circle.loadedMembers.find((m) => m.slot === currentPeriodRecipientSlot && m.status === 'Active')
      : null;

  /**
   * Section 5, Instruction 2: Join Circle
   */
  const handleJoinCircle = async () => {
    if (!connected || !publicKey) {
      setTxError('Wallet not connected. Connect your wallet to proceed.');
      return;
    }
    if (!circle) return;

    if (isAlreadyMember) {
      setTxError(`Already a member in slot ${userMember?.slot}.`);
      return;
    }

    if (isCircleFull) {
      setTxError('Circle has reached maximum member capacity.');
      return;
    }

    if (isPlaceholderMint(circle.tokenMint)) {
      setTxError(
        'Circle token mint is not configured. Provide an SPL token mint on devnet.'
      );
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
        message: `Joined circle as slot ${nextSlot}. Locked deposit of ${formattedDeposit} ${tokenSymbol} in vault.`,
      });

      // Refetch latest circle and member accounts from chain
      await loadCircleData(circle.address.toBase58());
    } catch (err: any) {
      console.error('joinCircle failed:', err);
      const translated = translateProgramError(err);
      setTxError(`${translated.name ? translated.name + ': ' : ''}${translated.message}`);
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
              placeholder="Enter circle address on Solana devnet"
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
          <span>{txPendingMsg || 'Transaction pending on Solana devnet. Approve in your wallet.'}</span>
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
            <p style={{ marginTop: '0.2rem', fontSize: '0.9rem' }}>{txError}</p>
          </div>
        </div>
      )}

      {/* Loading View */}
      {loading && (
        <div className="loading-view-card">
          <Loader2 size={36} className="loading-spinner-large" />
          <h2 style={{ fontSize: '1.25rem', color: 'white' }}>Fetching on-chain circle data</h2>
          <p style={{ color: 'var(--text-body)', fontSize: '0.9rem' }}>
            Reading circle account and member accounts from Solana devnet.
          </p>
        </div>
      )}

      {/* Fetch Error State */}
      {!loading && fetchError && (
        <div className="alert-box error-alert" role="alert">
          <AlertTriangle size={20} />
          <div>
            <strong>Unable to load circle</strong>
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
                Decentralized rotating savings circles on Solana. Code enforces contribution deadlines,
                payout turns, and collateral deposits without intermediaries.
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
                How rotating thrift works
              </h2>
            </Reveal>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem', marginTop: '1rem' }}>
              <div style={{ display: 'flex', gap: '0.85rem' }}>
                <span className="slot-badge-circle" style={{ width: '28px', height: '28px', fontSize: '0.75rem', flexShrink: 0 }}>1</span>
                <div>
                  <strong style={{ color: '#ffffff', fontSize: '0.9rem', display: 'block' }}>Join order sets payout turn</strong>
                  <span style={{ fontSize: '0.825rem', color: 'var(--text-body)' }}>
                    Members join in sequence. Join order determines which round you receive the full pot.
                  </span>
                </div>
              </div>

              <div style={{ display: 'flex', gap: '0.85rem' }}>
                <span className="slot-badge-circle" style={{ width: '28px', height: '28px', fontSize: '0.75rem', flexShrink: 0 }}>2</span>
                <div>
                  <strong style={{ color: '#ffffff', fontSize: '0.9rem', display: 'block' }}>Partial deposit covers defaults</strong>
                  <span style={{ fontSize: '0.825rem', color: 'var(--text-body)' }}>
                    Members lock an upfront deposit scaled to future dues. Defaulting members forfeit their deposit.
                  </span>
                </div>
              </div>

              <div style={{ display: 'flex', gap: '0.85rem' }}>
                <span className="slot-badge-circle" style={{ width: '28px', height: '28px', fontSize: '0.75rem', flexShrink: 0 }}>3</span>
                <div>
                  <strong style={{ color: '#ffffff', fontSize: '0.9rem', display: 'block' }}>Automated on-chain execution</strong>
                  <span style={{ fontSize: '0.825rem', color: 'var(--text-body)' }}>
                    Anyone can trigger payout once contributions arrive or trigger removal if grace expires.
                  </span>
                </div>
              </div>
            </div>

            <div style={{ marginTop: '1.5rem', paddingTop: '1.25rem', borderTop: '1px solid var(--glass-border-subtle)' }}>
              <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                Have an existing circle address? Paste it in the top search bar to inspect live on-chain state.
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
                    {circle.status}
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
                    <span style={{ color: 'var(--text-muted)' }}>Contribution</span>
                    <strong style={{ color: '#ffffff' }}>{formattedContribution} {tokenSymbol} / period</strong>
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
                      : `Period ${circle.currentPeriod} of ${circle.orderLen || circle.membersTarget}`}
                  </span>
                  <span className="badge-pill">{tokenSymbol}</span>
                </div>
                <h1 className="circle-title" style={{ fontSize: '1.85rem' }}>
                  Savings circle #{circle.circleId.toString()},{' '}
                  <span className="font-serif-italic">on-chain thrift.</span>
                </h1>
                <p style={{ color: 'var(--text-body)', fontSize: '0.875rem', marginTop: '0.25rem' }}>
                  Rules enforced by program CfY1M7cdgv1AvkLPuquqbCPNxMz73icdukWQP2sKdPq4 on Solana devnet.
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
                        Joining assigns slot {nextSlot} of {circle.membersTarget} and locks collateral upfront.
                      </p>
                    </div>
                    <span className="badge-spec">Section 6 deposit</span>
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
                      <span>Assigned join slot (k)</span>
                      <strong>Slot {nextSlot}</strong>
                    </div>
                    <div className="formula-breakdown-item">
                      <span>Owed periods remaining (N - k)</span>
                      <strong>{circle.membersTarget} - {nextSlot} = {owedPeriods}</strong>
                    </div>
                    <div className="formula-breakdown-item">
                      <span>Periodic contribution (c)</span>
                      <strong>{formattedContribution} {tokenSymbol}</strong>
                    </div>
                  </div>

                  <div className="deposit-total-row">
                    <span>Deposit to lock</span>
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
                      <span>Connect your wallet above to join this circle as slot {nextSlot}.</span>
                    </div>
                  ) : isAlreadyMember ? (
                    <div className="alert-box success-alert">
                      <CheckCircle size={16} />
                      <span>You are registered in this circle as slot {userMember?.slot}. Payout turn is scheduled on-chain.</span>
                    </div>
                  ) : isCircleFull ? (
                    <div className="alert-box warning-alert">
                      <AlertTriangle size={16} />
                      <span>This circle has reached full capacity ({circle.membersTarget} members).</span>
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

            {/* ACTION PANEL 2: TRIGGER BUTTONS (Next Step buttons) */}
            <div className="card triggers-card" aria-labelledby="triggers-title">
              <Reveal revealKey={`circle-triggers-heading-${circle.address.toBase58()}`}>
                <div className="triggers-header">
                  <h2 id="triggers-title" className="card-title">
                    Protocol actions
                  </h2>
                  <span className="badge-pill">Next step</span>
                </div>
              </Reveal>
              <p className="card-desc">
                Contribute, payout, and defaulter triggers will execute on-chain transactions in the next step.
              </p>

              <div className="triggers-action-list">
                {/* Button 1: Contribute */}
                <div className="trigger-item">
                  <button
                    type="button"
                    className="trigger-action-btn btn-disabled"
                    disabled
                  >
                    <Coins size={16} />
                    Contribute {formattedContribution} {tokenSymbol}
                  </button>
                  <div className="trigger-status-reason">
                    <span className="reason-text disabled">
                      <Clock size={13} /> Active members submit periodic contribution
                    </span>
                  </div>
                </div>

                {/* Button 2: Payout */}
                <div className="trigger-item">
                  <button
                    type="button"
                    className="trigger-action-btn btn-disabled"
                    disabled
                  >
                    <Coins size={16} />
                    Pay out to {nextRecipientMember ? `slot ${nextRecipientMember.slot}` : 'next recipient'}
                  </button>
                  <div className="trigger-status-reason">
                    <span className="reason-text disabled">
                      <Clock size={13} /> Callable once period contributions reach target or deadline passes
                    </span>
                  </div>
                </div>

                {/* Button 3: Remove Defaulter */}
                <div className="trigger-item">
                  <button
                    type="button"
                    className="trigger-action-btn btn-disabled"
                    disabled
                  >
                    <ShieldAlert size={16} />
                    Remove late member
                  </button>
                  <div className="trigger-status-reason">
                    <span className="reason-text disabled">
                      <Clock size={13} /> Callable after period duration and grace expire against late members
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
                      Circle members ({circle.loadedMembers.length} of {circle.membersTarget} slots)
                    </h2>
                    <p className="card-desc" style={{ margin: 0 }}>
                      Transparent on-chain records of deposit balances, payment turns, and removal statuses.
                    </p>
                  </div>
                  <div className="legend-pills">
                    <span className="legend-item"><span className="legend-dot green"></span> Paid</span>
                    <span className="legend-item"><span className="legend-dot purple"></span> Next recipient</span>
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
                              <span>Slot {member.slot}</span>
                              {member.slot === 1 && <span className="tag-creator">Creator</span>}
                              {isRecipient && <span className="tag-recipient">Next pot</span>}
                              {member.hasBeenPaid && !isRecipient && (
                                <span className="tag-paidout">Paid out</span>
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
                              {isCircleOpen ? 'Join status' : `Period ${circle.currentPeriod} status`}
                            </span>
                            {isRemoved ? (
                              <span className="badge-status removed">
                                <XCircle size={13} /> Removed
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
                                <Clock size={13} /> Pending
                              </span>
                            )}
                          </div>

                          {/* Payout Status (Who is Next) */}
                          <div className="member-info-row">
                            <span className="info-label">Payout status</span>
                            {isRecipient ? (
                              <span className="badge-status next-recipient">
                                <Award size={13} /> Next recipient
                              </span>
                            ) : member.hasBeenPaid ? (
                              <span className="badge-status settled">
                                <CheckCircle size={13} /> Paid out
                              </span>
                            ) : (
                              <span className="badge-status queue">
                                Turn: slot {member.slot}
                              </span>
                            )}
                          </div>

                          {/* Deposit Locked */}
                          <div className="member-info-row">
                            <span className="info-label">Locked deposit</span>
                            <span className="deposit-locked-val">
                              <strong>{formatTokenAmount(member.depositRemaining, tokenDecimals)}</strong> {tokenSymbol}
                            </span>
                          </div>

                          {isRemoved && (
                            <div className="removal-explanation">
                              <AlertTriangle size={13} className="text-red" />
                              <span>Missed contribution deadline. Forfeited line; deposit drawn per Section 7.</span>
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
                      On-chain activity record
                    </h2>
                    <p className="card-desc" style={{ margin: 0 }}>
                      Events emitted on Solana devnet for circle operations.
                    </p>
                  </div>
                </div>
              </Reveal>

              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem', marginTop: '1rem' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: 'rgba(255, 255, 255, 0.03)', padding: '0.75rem 1rem', borderRadius: '12px', border: '1px solid var(--glass-border-subtle)' }}>
                  <div>
                    <span style={{ fontSize: '0.85rem', fontWeight: 600, color: '#ffffff' }}>Circle created</span>
                    <p style={{ fontSize: '0.775rem', color: 'var(--text-muted)' }}>Circle initialized with {circle.membersTarget} member target and {circle.depositPct}% deposit rate.</p>
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
