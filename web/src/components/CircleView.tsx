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
  Calendar,
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
        setFetchError(`"${trimmed}" is not a valid Solana public key.`);
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
          setFetchError(`Circle account not found on Solana Devnet at address: ${trimmed}`);
        } else {
          const translated = translateProgramError(err);
          setFetchError(`Failed to load circle: ${translated.message}`);
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

  // Format token symbol
  const tokenSymbol =
    circle && isPlaceholderMint(circle.tokenMint)
      ? 'DEVNET-TOKEN'
      : 'USDC';

  // Section 6 Join Calculations
  const isCircleOpen = circle?.status === 'Open';
  const nextSlot = circle ? circle.currentMemberCount + 1 : 1;
  const isCircleFull = circle ? circle.currentMemberCount >= circle.membersTarget : false;

  const userMember =
    connected && publicKey && circle
      ? circle.loadedMembers.find((m) => m.wallet.equals(publicKey))
      : null;
  const isAlreadyMember = !!userMember;

  // Compute deposit for the next slot using Section 6 formula
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

  // Determine next payout recipient in Active round
  const currentPeriodRecipientSlot =
    circle && circle.status === 'Active' && circle.currentPeriod >= 1 && circle.currentPeriod <= circle.orderLen
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
      setTxError('Please connect your Solana wallet to join.');
      return;
    }
    if (!circle) return;

    if (isAlreadyMember) {
      setTxError(`You are already a member of this circle in Slot #${userMember?.slot}.`);
      return;
    }

    if (isCircleFull) {
      setTxError('This circle has reached maximum member capacity.');
      return;
    }

    if (isPlaceholderMint(circle.tokenMint)) {
      setTxError(
        'Circle was initialized with placeholder token mint 11111111111111111111111111111111. Please provide a real SPL Token Mint on Devnet in config.ts.'
      );
      return;
    }

    setTxPending(true);
    setTxPendingMsg('Preparing Associated Token Account & submitting joinCircle to Devnet...');
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
        message: `Successfully joined circle! Assigned Slot #${nextSlot}. Deposit of ${formattedDeposit} ${tokenSymbol} locked in vault.`,
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
      {/* Top Address Search & Lookup Card */}
      <section className="circle-search-card" aria-label="Load Circle by Address">
        <form onSubmit={handleSearchSubmit} className="circle-search-row">
          <div className="circle-search-input-wrap">
            <Search size={16} className="search-input-icon" />
            <input
              type="text"
              className="circle-search-input"
              placeholder="Enter Circle PDA address on Solana Devnet (e.g., CfY1M7...)"
              value={inputAddress}
              onChange={(e) => setInputAddress(e.target.value)}
              aria-label="Circle PDA Address"
            />
          </div>
          <button type="submit" className="search-btn" disabled={loading}>
            {loading ? <Loader2 size={15} className="spinner-icon" /> : <Search size={15} />}
            Load Circle
          </button>
          <button
            type="button"
            className="btn-secondary"
            onClick={onNavigateCreate}
            style={{ padding: '0.65rem 1rem', fontSize: '0.85rem' }}
          >
            <UserPlus size={15} />
            Create Circle
          </button>
        </form>
      </section>

      {/* Wallet Not Connected Global Warning */}
      {!connected && (
        <div className="alert-box warning-alert" role="status">
          <AlertTriangle size={18} />
          <span>
            Wallet not connected. Connect your Solana Devnet wallet in the top bar to join or interact with this savings circle.
          </span>
        </div>
      )}

      {/* Loading State */}
      {loading && (
        <div className="loading-view-card">
          <Loader2 size={36} className="loading-spinner-large" />
          <h2 style={{ fontSize: '1.2rem', color: 'white' }}>Fetching Real On-Chain Circle Data</h2>
          <p style={{ color: 'var(--text-muted)', fontSize: '0.9rem' }}>
            Reading Circle account and Member PDAs directly from Solana Devnet RPC...
          </p>
        </div>
      )}

      {/* Fetch Error State */}
      {!loading && fetchError && (
        <div className="alert-box error-alert" role="alert">
          <AlertTriangle size={20} />
          <div>
            <strong>Unable to Load Circle</strong>
            <p style={{ marginTop: '0.25rem', fontSize: '0.9rem' }}>{fetchError}</p>
          </div>
        </div>
      )}

      {/* Empty State: No address or circle loaded */}
      {!loading && !fetchError && !circle && (
        <div className="empty-view-card">
          <div className="circle-emblem-badge" style={{ width: '100px', height: '100px' }} aria-label="Solthrift emblem">
            <span className="emblem-count">THRIFT</span>
            <span className="emblem-label">Devnet Savings</span>
          </div>
          <h2 style={{ fontSize: '1.9rem', color: 'white', letterSpacing: '-0.02em', textAlign: 'center' }}>
            Decentralized savings circles,{' '}
            <span className="font-serif-italic">enforced by code.</span>
          </h2>
          <p style={{ color: 'var(--text-body)', maxWidth: '520px', fontSize: '0.95rem' }}>
            Enter a Circle PDA address in the search box above to load real on-chain data from Solana Devnet,
            or create a new savings circle.
          </p>
          <button type="button" className="btn-primary" onClick={onNavigateCreate}>
            <UserPlus size={16} />
            Create a New Circle
          </button>
        </div>
      )}

      {/* Transaction Notifications */}
      {txPending && (
        <div className="alert-box pending-alert" role="status">
          <Loader2 size={18} className="spinner-icon" />
          <span>{txPendingMsg || 'Transaction pending on Solana Devnet. Please approve in your wallet...'}</span>
        </div>
      )}

      {txSuccess && (
        <div className="alert-box success-alert" role="status" style={{ flexDirection: 'column', alignItems: 'flex-start', gap: '0.5rem' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <CheckCircle2 size={18} className="text-green" />
            <strong>{txSuccess.message}</strong>
          </div>
          <div style={{ fontSize: '0.85rem' }}>
            Transaction Signature:{' '}
            <a
              href={getExplorerUrl('tx', txSuccess.signature)}
              target="_blank"
              rel="noreferrer"
              style={{ color: 'var(--accent-cyan)', textDecoration: 'underline', fontFamily: 'monospace' }}
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
            <strong>Transaction Failed:</strong>
            <p style={{ marginTop: '0.2rem', fontSize: '0.9rem' }}>{txError}</p>
          </div>
        </div>
      )}

      {/* REAL CIRCLE CONTENT */}
      {!loading && circle && (
        <>
          {/* Header Info Banner */}
          <div className="circle-header-section">
            <div className="circle-header-info">
              {/* Concentric Circle Emblem Motif echoing reference */}
              <div className="circle-emblem-badge" aria-label="Circle slots emblem">
                <span className="emblem-count">{circle.loadedMembers.length}/{circle.membersTarget}</span>
                <span className="emblem-label">Slots Filled</span>
              </div>

              <div className="circle-badges-row">
                <span className={`badge-state ${circle.status.toLowerCase()}`}>
                  {circle.status}
                </span>
                <span className="badge-pill">
                  {circle.status === 'Open'
                    ? `Open (${circle.currentMemberCount} / ${circle.membersTarget} Slots Filled)`
                    : `Period ${circle.currentPeriod} of ${circle.orderLen || circle.membersTarget}`}
                </span>
                <span className="badge-pill">{tokenSymbol}</span>
                <span className="badge-pill">Deposit: {circle.depositPct}%</span>
                <span className="badge-pill">
                  Contribution: {formattedContribution} {tokenSymbol}
                </span>
              </div>

              <h1 className="circle-title">
                Savings Circle #{circle.circleId.toString()},{' '}
                <span className="font-serif-italic">on-chain thrift.</span>
              </h1>

              <div className="circle-meta" style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: '0.5rem' }}>
                <span>Circle PDA:</span>
                <code>{circle.address.toBase58()}</code>
                <button
                  type="button"
                  className="icon-action-btn"
                  onClick={handleCopyCircle}
                  title="Copy Circle Address"
                >
                  {copiedCircle ? <Check size={14} className="text-green" /> : <Copy size={14} />}
                </button>
                <a
                  href={getExplorerUrl('address', circle.address.toBase58())}
                  target="_blank"
                  rel="noreferrer"
                  className="icon-action-btn"
                  title="View Circle on Solana Explorer"
                >
                  <ExternalLink size={14} />
                </a>
                <button
                  type="button"
                  className="icon-action-btn"
                  onClick={() => loadCircleData(circle.address.toBase58())}
                  title="Refresh on-chain data"
                  style={{ marginLeft: 'auto' }}
                >
                  <RefreshCw size={14} />
                </button>
              </div>
            </div>
          </div>

          {/* Section 6: Join Circle Card (Active when Open & has capacity) */}
          {isCircleOpen && (
            <div className="card join-card" aria-labelledby="join-heading">
              <div className="join-card-header">
                <div>
                  <h2 id="join-heading" className="card-title" style={{ margin: 0 }}>
                    <UserPlus size={18} className="text-accent" />
                    Join Savings Circle (Slot #{nextSlot} of {circle.membersTarget})
                  </h2>
                  <p className="card-desc" style={{ margin: '0.25rem 0 0 0' }}>
                    Calculate your locked security deposit per Section 6 of the spec and join the on-chain thrift.
                  </p>
                </div>
                <span className="badge-spec">Section 6 Formula</span>
              </div>

              {/* Section 6 Formula Breakdown */}
              <div className="deposit-math-box">
                <div className="formula-header">
                  <Info size={14} />
                  <span>Section 6 Security Deposit Formula</span>
                </div>
                <div className="formula-expression">
                  deposit = max(ceil(deposit_pct * (N - k) * c / 100), c)
                </div>

                <div className="formula-breakdown-list">
                  <div className="formula-breakdown-item">
                    <span>Deposit Rate (deposit_pct):</span>
                    <strong>{circle.depositPct}%</strong>
                  </div>
                  <div className="formula-breakdown-item">
                    <span>Target Total Members (N):</span>
                    <strong>{circle.membersTarget} members</strong>
                  </div>
                  <div className="formula-breakdown-item">
                    <span>Assigned Join Slot (k):</span>
                    <strong>Slot #{nextSlot}</strong>
                  </div>
                  <div className="formula-breakdown-item">
                    <span>Owed Periods Remaining (N - k):</span>
                    <strong>
                      {circle.membersTarget} - {nextSlot} = {owedPeriods} periods
                    </strong>
                  </div>
                  <div className="formula-breakdown-item">
                    <span>Periodic Contribution (c):</span>
                    <strong>
                      {formattedContribution} {tokenSymbol}
                    </strong>
                  </div>
                </div>

                <div className="deposit-total-row">
                  <span>Required Locked Deposit Upfront:</span>
                  <span className="deposit-total-amount">
                    {formattedDeposit} {tokenSymbol}
                  </span>
                </div>
              </div>

              {/* Join Action Buttons / States */}
              <div>
                {!connected ? (
                  <div className="alert-box warning-alert" style={{ marginBottom: 0 }}>
                    <AlertTriangle size={16} />
                    <span>Connect your wallet above to join this circle as Slot #{nextSlot}.</span>
                  </div>
                ) : isAlreadyMember ? (
                  <div className="alert-box success-alert" style={{ marginBottom: 0 }}>
                    <CheckCircle size={16} />
                    <span>
                      You are already registered in this circle (Slot #{userMember?.slot}). Payout turn is scheduled on-chain.
                    </span>
                  </div>
                ) : isCircleFull ? (
                  <div className="alert-box warning-alert" style={{ marginBottom: 0 }}>
                    <AlertTriangle size={16} />
                    <span>This circle has reached full capacity ({circle.membersTarget} of {circle.membersTarget} members).</span>
                  </div>
                ) : (
                  <button
                    type="button"
                    id="join-circle-btn"
                    className="btn-join-circle"
                    disabled={txPending}
                    onClick={handleJoinCircle}
                  >
                    {txPending ? (
                      <>
                        <Loader2 size={18} className="spinner-icon" />
                        Joining Circle on Devnet...
                      </>
                    ) : (
                      <>
                        <UserPlus size={18} />
                        Join Circle as Slot #{nextSlot} (Lock {formattedDeposit} {tokenSymbol})
                      </>
                    )}
                  </button>
                )}
              </div>
            </div>
          )}

          {/* Main Dashboard Stats: Current Pot & Next Recipient */}
          <div className="circle-dashboard-grid">
            <div className="card hero-stat-card">
              <div className="hero-stat-row">
                <div>
                  <span className="hero-stat-label">
                    {circle.status === 'Open' ? 'Current Period Pot (Starts on Fill)' : 'Current Period Pot'}
                  </span>
                  <div className="hero-stat-amount">
                    {circle.status === 'Open'
                      ? '0'
                      : formatTokenAmount(
                          circle.contribution.muln(circle.contributionsThisPeriod),
                          tokenDecimals
                        )}{' '}
                    <span className="stat-currency">{tokenSymbol}</span>
                  </div>
                  <small className="stat-subtext">
                    Target Pot: {formatTokenAmount(circle.contribution.muln(circle.membersTarget), tokenDecimals)} {tokenSymbol} •{' '}
                    {circle.activeMemberCount} Active Members
                  </small>
                </div>

                <div className="countdown-card" aria-label="Circle status indicator">
                  <div className="countdown-header">
                    <Calendar size={16} className="text-accent" />
                    <span>Round Status</span>
                  </div>
                  <div style={{ marginTop: '0.5rem', fontSize: '0.95rem', fontWeight: 600, color: 'white' }}>
                    {circle.status === 'Open' ? (
                      <span>Waiting for {circle.membersTarget - circle.currentMemberCount} more member(s)</span>
                    ) : circle.status === 'Active' ? (
                      <span>Period {circle.currentPeriod} of {circle.orderLen} in Progress</span>
                    ) : (
                      <span>Round Status: {circle.status}</span>
                    )}
                  </div>
                  <div className="countdown-grace" style={{ marginTop: '0.5rem' }}>
                    Vault PDA: <code>{circle.vault.toBase58().slice(0, 8)}...</code>
                  </div>
                </div>
              </div>
            </div>

            {/* Section 9: Next Step Protocol Triggers (Disabled for this step) */}
            <div className="card triggers-card" aria-labelledby="triggers-title">
              <div className="triggers-header">
                <h2 id="triggers-title" className="card-title">
                  Section 9: Protocol Actions
                </h2>
                <span className="badge-pill" style={{ color: 'var(--accent-amber)' }}>
                  Next Step (Disabled)
                </span>
              </div>
              <p className="card-desc">
                Contribute, Payout, and Defaulter triggers will be fully wired for live execution in the next step.
              </p>

              <div className="triggers-action-list">
                {/* Button 1: Contribute */}
                <div className="trigger-item">
                  <button
                    type="button"
                    className="trigger-action-btn btn-disabled"
                    disabled
                    title="Will be enabled in next step"
                  >
                    <Coins size={16} />
                    Contribute {formattedContribution} {tokenSymbol} (Next Step)
                  </button>
                  <div className="trigger-status-reason">
                    <span className="reason-text disabled">
                      <Clock size={13} /> Next step: Active members submit periodic contribution
                    </span>
                  </div>
                </div>

                {/* Button 2: Payout */}
                <div className="trigger-item">
                  <button
                    type="button"
                    className="trigger-action-btn btn-disabled"
                    disabled
                    title="Will be enabled in next step"
                  >
                    <Coins size={16} />
                    Pay out to {nextRecipientMember ? `Slot #${nextRecipientMember.slot}` : '[Next Recipient]'} (Next Step)
                  </button>
                  <div className="trigger-status-reason">
                    <span className="reason-text disabled">
                      <Clock size={13} /> Next step: Callable once period contributions reach target or deadline passes
                    </span>
                  </div>
                </div>

                {/* Button 3: Remove Defaulter */}
                <div className="trigger-item">
                  <button
                    type="button"
                    className="trigger-action-btn btn-disabled"
                    disabled
                    title="Will be enabled in next step"
                  >
                    <ShieldAlert size={16} />
                    Remove late member (Next Step)
                  </button>
                  <div className="trigger-status-reason">
                    <span className="reason-text disabled">
                      <Clock size={13} /> Next step: Callable after period duration + grace expires against late members
                    </span>
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Members Lineup & Status (Who Paid, Who Is Next, Who Was Removed) */}
          <section className="card members-section" aria-labelledby="members-heading">
            <div className="card-header-row">
              <div>
                <h2 id="members-heading" className="card-title">
                  Circle Members & Lineup ({circle.loadedMembers.length} / {circle.membersTarget} Slots Registered)
                </h2>
                <p className="card-desc">
                  Real on-chain Member accounts. Transparent records of deposit balances, payment turns, and removal statuses.
                </p>
              </div>
              <div className="legend-pills">
                <span className="legend-item">
                  <span className="legend-dot green"></span> Paid
                </span>
                <span className="legend-item">
                  <span className="legend-dot purple"></span> Next Recipient
                </span>
                <span className="legend-item">
                  <span className="legend-dot red"></span> Removed
                </span>
              </div>
            </div>

            <div className="members-grid">
              {circle.loadedMembers.map((member, idx) => {
                const isRemoved = member.status === 'Removed';
                const isRecipient =
                  circle.status === 'Active' &&
                  currentPeriodRecipientSlot === member.slot &&
                  member.status === 'Active';
                const hasPaidThisPeriod =
                  circle.status === 'Active' &&
                  member.lastContributedPeriod === circle.currentPeriod;

                const shortened = `${member.wallet.toBase58().slice(0, 4)}...${member.wallet.toBase58().slice(-4)}`;

                return (
                  <div
                    key={member.slot}
                    className={`member-card ${isRecipient ? 'card-recipient' : ''} ${
                      isRemoved ? 'card-removed' : ''
                    }`}
                  >
                    <div className="member-card-header">
                      <div className="slot-badge-circle">#{member.slot}</div>
                      <div className="member-title-col">
                        <div className="member-display-name">
                          <span>Slot #{member.slot}</span>
                          {member.slot === 1 && <span className="tag-creator">Creator</span>}
                          {isRecipient && <span className="tag-recipient">Next Pot</span>}
                          {member.hasBeenPaid && !isRecipient && (
                            <span className="tag-paidout">Paid Out</span>
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
                            title="Copy Wallet Public Key"
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
                            title="View wallet on Solana Explorer"
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
                          {circle.status === 'Open' ? 'Join Status' : `Period ${circle.currentPeriod} Status`}
                        </span>
                        {isRemoved ? (
                          <span className="badge-status removed">
                            <XCircle size={13} /> Removed (Defaulted)
                          </span>
                        ) : circle.status === 'Open' ? (
                          <span className="badge-status joined">
                            <CheckCircle size={13} /> Joined (Deposit Locked)
                          </span>
                        ) : hasPaidThisPeriod ? (
                          <span className="badge-status paid">
                            <CheckCircle size={13} /> Paid ({formattedContribution} {tokenSymbol})
                          </span>
                        ) : (
                          <span className="badge-status pending">
                            <Clock size={13} /> Pending Contribution
                          </span>
                        )}
                      </div>

                      {/* Payout Status (Who is Next) */}
                      <div className="member-info-row">
                        <span className="info-label">Payout Status</span>
                        {isRecipient ? (
                          <span className="badge-status next-recipient">
                            <Award size={13} /> Next Pot Recipient
                          </span>
                        ) : member.hasBeenPaid ? (
                          <span className="badge-status settled">
                            <CheckCircle size={13} /> Already Paid Out
                          </span>
                        ) : (
                          <span className="badge-status queue">
                            Turn: Slot #{member.slot}
                          </span>
                        )}
                      </div>

                      {/* Deposit Locked */}
                      <div className="member-info-row">
                        <span className="info-label">Locked Deposit</span>
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
                );
              })}
            </div>
          </section>
        </>
      )}
    </div>
  );
};
