import type { FC, FormEvent } from 'react';
import { useState, useMemo } from 'react';
import { useConnection, useWallet, useAnchorWallet } from '@solana/wallet-adapter-react';
import { PublicKey, SystemProgram, SYSVAR_RENT_PUBKEY } from '@solana/web3.js';
import { BN } from '@coral-xyz/anchor';
import { TOKEN_PROGRAM_ID } from '@solana/spl-token';
import {
  Coins,
  Users,
  Percent,
  Clock,
  ShieldAlert,
  Info,
  CheckCircle2,
  AlertTriangle,
  ArrowRight,
  ExternalLink,
  Copy,
  Check,
  Loader2,
} from 'lucide-react';

import type { TokenChoice } from '../types';
import { calculateSlotDeposit, calculateSlotShortfall } from '../types';
import { DEVNET_TOKEN_MINT, isPlaceholderMint } from '../config';
import { CircleRing } from './CircleRing';
import {
  getSolthriftProgram,
  getCirclePda,
  getMemberPda,
  getVaultPda,
  getOrCreateAtaInstruction,
  getExplorerUrl,
  translateProgramError,
} from '../solthriftClient';

interface CreateCircleProps {
  onCreated?: (circleAddress: string) => void;
}

export const CreateCircle: FC<CreateCircleProps> = ({ onCreated }) => {
  const { connection } = useConnection();
  const wallet = useAnchorWallet();
  const { connected } = useWallet();

  // Form parameters
  const [token, setToken] = useState<TokenChoice>('USDC');
  const [members, setMembers] = useState<number>(4);
  const [contribution, setContribution] = useState<number>(10);
  const [depositPct, setDepositPct] = useState<number>(50);
  const [period, setPeriod] = useState<string>('20 seconds');
  const [grace, setGrace] = useState<string>('0 seconds');

  // Custom token mint input in case DEVNET_TOKEN_MINT is a placeholder
  const [customMintInput, setCustomMintInput] = useState<string>('');

  // Transaction states
  const [txState, setTxState] = useState<'idle' | 'pending' | 'success' | 'error'>('idle');
  const [txError, setTxError] = useState<string | null>(null);
  const [txSignature, setTxSignature] = useState<string | null>(null);
  const [createdCircleAddress, setCreatedCircleAddress] = useState<string | null>(null);
  const [copiedAddress, setCopiedAddress] = useState<boolean>(false);

  // Determine active token mint
  const hasPlaceholderConfigMint = isPlaceholderMint(DEVNET_TOKEN_MINT);
  const activeMint = useMemo(() => {
    if (customMintInput.trim()) {
      try {
        return new PublicKey(customMintInput.trim());
      } catch {
        return null;
      }
    }
    return hasPlaceholderConfigMint ? null : DEVNET_TOKEN_MINT;
  }, [customMintInput, hasPlaceholderConfigMint]);

  // Validation according to Section 2 and Section 7
  const errors = useMemo(() => {
    const errs: Record<string, string> = {};
    if (isNaN(members) || members < 3 || members > 10) {
      errs.members = 'Members must be between 3 and 10';
    }
    if (isNaN(contribution) || contribution < 5) {
      errs.contribution = 'Contribution must be at least 5 ' + token;
    }
    if (isNaN(depositPct) || depositPct < 25 || depositPct > 100) {
      errs.depositPct = 'Deposit percentage must be between 25% and 100%';
    }
    if (!activeMint) {
      errs.mint = hasPlaceholderConfigMint
        ? 'DEVNET_TOKEN_MINT is a placeholder. Please provide a Devnet token mint address.'
        : 'Invalid token mint address';
    }
    return errs;
  }, [members, contribution, depositPct, token, activeMint, hasPlaceholderConfigMint]);

  const isValid = Object.keys(errors).length === 0;

  // Period duration to seconds mapping
  const periodDurationSeconds = useMemo(() => {
    switch (period) {
      case '20 seconds':
        return 20;
      case '1 minute':
        return 60;
      case '1 day':
        return 86400;
      case '3 days':
        return 259200;
      case '1 week':
        return 604800;
      case '2 weeks':
        return 1209600;
      case '1 month':
        return 2592000;
      default:
        return 86400;
    }
  }, [period]);

  // Grace duration to seconds mapping
  const graceDurationSeconds = useMemo(() => {
    switch (grace) {
      case '0 seconds':
        return 0;
      case '6 hours':
        return 21600;
      case '12 hours':
        return 43200;
      case '24 hours':
        return 86400;
      case '48 hours':
        return 172800;
      default:
        return 0;
    }
  }, [grace]);

  // Compute breakdown for all slots based on Section 6
  const slotBreakdown = useMemo(() => {
    const validN = Math.min(Math.max(members || 3, 3), 10);
    const validC = Math.max(contribution || 5, 0);
    const validPct = Math.min(Math.max(depositPct || 25, 25), 100);

    const slots = [];
    let totalDeposits = 0;

    for (let k = 1; k <= validN; k++) {
      const deposit = calculateSlotDeposit(k, validN, validC, validPct);
      const shortfall = calculateSlotShortfall(k, validN, validC, validPct);
      totalDeposits += deposit;

      slots.push({
        slot: k,
        deposit,
        shortfall,
        formula: `max(${validPct}% × (${validN} - ${k}) × ${validC}, ${validC})`,
      });
    }

    return {
      slots,
      totalDeposits: Number(totalDeposits.toFixed(2)),
      potPerPeriod: Number((validN * validC).toFixed(2)),
    };
  }, [members, contribution, depositPct]);

  // Submit on-chain createCircle instruction
  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!isValid || !activeMint) return;

    if (!connected || !wallet || !wallet.publicKey) {
      setTxState('error');
      setTxError('Please connect your Solana wallet first to create a circle.');
      return;
    }

    try {
      setTxState('pending');
      setTxError(null);
      setTxSignature(null);
      setCreatedCircleAddress(null);

      // Section 7 Invariant: 6 decimals factor for contribution base units
      const decimals = 6;
      const baseUnitsFactor = new BN(10).pow(new BN(decimals));
      const contributionBN = new BN(contribution).mul(baseUnitsFactor);

      // Unique circle ID per circle creation
      const circleId = new BN(Math.floor(Date.now() / 1000));

      const [circlePda] = getCirclePda(wallet.publicKey, circleId);
      const [creatorMemberPda] = getMemberPda(circlePda, wallet.publicKey);
      const [vaultPda] = getVaultPda(circlePda);

      // Check if creator ATA for the token mint exists, and create if needed
      const { ata: creatorAta, instruction: createAtaIx } = await getOrCreateAtaInstruction(
        connection,
        activeMint,
        wallet.publicKey,
        wallet.publicKey
      );

      const program = getSolthriftProgram(connection, wallet);

      const method = program.methods
        .createCircle(
          circleId,
          members,
          contributionBN,
          depositPct,
          new BN(periodDurationSeconds),
          new BN(graceDurationSeconds),
          new BN(0), // fillWindowDuration (0 defaults to 2 days)
          new BN(0) // openWindowDuration (0 defaults to 7 days)
        )
        .accounts({
          circle: circlePda,
          creatorMember: creatorMemberPda,
          vault: vaultPda,
          creator: wallet.publicKey,
          tokenMint: activeMint,
          creatorTokenAccount: creatorAta,
          tokenProgram: TOKEN_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
          rent: SYSVAR_RENT_PUBKEY,
        });

      if (createAtaIx) {
        method.preInstructions([createAtaIx]);
      }

      const sig = await method.rpc();
      setTxSignature(sig);
      setCreatedCircleAddress(circlePda.toBase58());
      setTxState('success');
    } catch (err: any) {
      console.error('createCircle failed:', err);
      setTxState('error');
      const translated = translateProgramError(err);
      setTxError(`${translated.name ? translated.name + ': ' : ''}${translated.message}`);
    }
  };

  const handleCopyCircle = () => {
    if (createdCircleAddress) {
      navigator.clipboard.writeText(createdCircleAddress);
      setCopiedAddress(true);
      setTimeout(() => setCopiedAddress(false), 2000);
    }
  };

  return (
    <div className="page-container">
      <div className="page-header">
        <h1 className="page-title">
          Save together,{' '}
          <span className="font-serif-italic">without trusting anyone.</span>
        </h1>
        <p className="page-subtitle">
          Configure rotating thrift parameters with program-enforced partial deposits on Solana.
        </p>
      </div>

      <div className="create-layout-split">
        {/* Form Column */}
        <section className="card form-card" aria-labelledby="form-heading">
          <h2 id="form-heading" className="card-title">
            <Coins size={18} className="text-accent" />
            Circle parameters
          </h2>

          <form onSubmit={handleSubmit} noValidate>
            {/* Token Selector & Mint Warning */}
            <div className="form-group">
              <label htmlFor="token-select" className="form-label">
                Stablecoin Token (Devnet Mint)
                <span
                  className="tooltip-hint"
                  title="Circles use exactly one token for all deposits, contributions and payouts. Never mixed."
                >
                  <Info size={14} />
                </span>
              </label>
              <div className="token-toggle-group">
                <button
                  type="button"
                  id="token-usdc"
                  className={`token-toggle-btn ${token === 'USDC' ? 'active' : ''}`}
                  onClick={() => setToken('USDC')}
                >
                  <span className="token-dot usdc"></span>
                  USDC
                </button>
                <button
                  type="button"
                  id="token-usdt"
                  className={`token-toggle-btn ${token === 'USDT' ? 'active' : ''}`}
                  onClick={() => setToken('USDT')}
                >
                  <span className="token-dot usdt"></span>
                  USDT
                </button>
              </div>

              {hasPlaceholderConfigMint ? (
                <div className="alert-box warning-alert" style={{ marginTop: '0.6rem' }}>
                  <AlertTriangle size={16} />
                  <div>
                    <strong>TODO (Mint Placeholder):</strong> DEVNET_TOKEN_MINT in <code>config.ts</code> is not set yet.
                    Please provide the Devnet token mint address or enter one below.
                  </div>
                </div>
              ) : (
                <small className="form-hint" style={{ wordBreak: 'break-all' }}>
                  Configured Devnet Mint: <code>{DEVNET_TOKEN_MINT.toBase58()}</code>
                </small>
              )}

              {/* Optional Custom Mint Input */}
              <div style={{ marginTop: '0.5rem' }}>
                <label htmlFor="custom-mint-input" className="form-label" style={{ fontSize: '0.8rem' }}>
                  Override Token Mint Address (Devnet SPL Token):
                </label>
                <input
                  id="custom-mint-input"
                  type="text"
                  placeholder={hasPlaceholderConfigMint ? 'Paste 32-44 character Devnet Mint address' : 'Optional: override config mint'}
                  value={customMintInput}
                  onChange={(e) => setCustomMintInput(e.target.value)}
                  className={`text-input ${errors.mint ? 'input-error' : ''}`}
                  style={{ fontSize: '0.85rem', padding: '0.5rem 0.75rem' }}
                />
                {errors.mint && <p className="error-text" role="alert">{errors.mint}</p>}
              </div>
            </div>

            {/* Members (N) */}
            <div className="form-group">
              <div className="label-row">
                <label htmlFor="members-input" className="form-label">
                  <Users size={15} />
                  Members (N): <strong>{members}</strong>
                </label>
                <span className="badge-pill">3 - 10 members</span>
              </div>
              <input
                id="members-input"
                type="range"
                min="3"
                max="10"
                value={members}
                onChange={(e) => setMembers(parseInt(e.target.value, 10))}
                className="range-slider"
              />
              <div className="slider-ticks">
                {[3, 4, 5, 6, 7, 8, 9, 10].map((n) => (
                  <span
                    key={n}
                    className={`tick ${members === n ? 'active' : ''}`}
                    onClick={() => setMembers(n)}
                  >
                    {n}
                  </span>
                ))}
              </div>
              {errors.members && <p className="error-text" role="alert">{errors.members}</p>}
            </div>

            {/* Contribution (c) */}
            <div className="form-group">
              <div className="label-row">
                <label htmlFor="contribution-input" className="form-label">
                  Contribution per Period (c)
                </label>
                <span className="badge-pill">Min 5 {token}</span>
              </div>
              <div className="input-affix-wrapper">
                <input
                  id="contribution-input"
                  type="number"
                  min="5"
                  step="1"
                  value={contribution}
                  onChange={(e) => setContribution(parseFloat(e.target.value) || 0)}
                  className={`text-input ${errors.contribution ? 'input-error' : ''}`}
                  placeholder="e.g. 10"
                />
                <span className="input-suffix">{token}</span>
              </div>
              {errors.contribution && (
                <p className="error-text" role="alert">{errors.contribution}</p>
              )}
              <small className="form-hint">
                Paid each period by every active member into the program vault.
              </small>
            </div>

            {/* Deposit Percentage */}
            <div className="form-group">
              <div className="label-row">
                <label htmlFor="deposit-pct-input" className="form-label">
                  <Percent size={15} />
                  Deposit Percentage: <strong>{depositPct}%</strong>
                </label>
                <span className="badge-pill">25% - 100%</span>
              </div>
              <input
                id="deposit-pct-input"
                type="range"
                min="25"
                max="100"
                step="5"
                value={depositPct}
                onChange={(e) => setDepositPct(parseInt(e.target.value, 10))}
                className="range-slider"
              />
              <div className="slider-presets">
                {[25, 50, 75, 100].map((pct) => (
                  <button
                    key={pct}
                    type="button"
                    className={`preset-btn ${depositPct === pct ? 'active' : ''}`}
                    onClick={() => setDepositPct(pct)}
                  >
                    {pct}%
                  </button>
                ))}
              </div>
              {errors.depositPct && <p className="error-text" role="alert">{errors.depositPct}</p>}
              <small className="form-hint">
                Share of future dues locked upfront as a security deposit.
              </small>
            </div>

            {/* Period & Grace */}
            <div className="form-row-2">
              <div className="form-group">
                <label htmlFor="period-select" className="form-label">
                  <Clock size={15} /> Period Length
                </label>
                <select
                  id="period-select"
                  className="select-input"
                  value={period}
                  onChange={(e) => setPeriod(e.target.value)}
                >
                  <option value="20 seconds">20 seconds (Devnet fast test)</option>
                  <option value="1 minute">1 minute (Devnet test)</option>
                  <option value="1 day">1 day (demo)</option>
                  <option value="3 days">3 days</option>
                  <option value="1 week">1 week (production)</option>
                  <option value="2 weeks">2 weeks</option>
                  <option value="1 month">1 month</option>
                </select>
              </div>

              <div className="form-group">
                <label htmlFor="grace-select" className="form-label">
                  <ShieldAlert size={15} /> Grace Period
                </label>
                <select
                  id="grace-select"
                  className="select-input"
                  value={grace}
                  onChange={(e) => setGrace(e.target.value)}
                >
                  <option value="0 seconds">0 seconds (Devnet fast test)</option>
                  <option value="6 hours">6 hours (demo)</option>
                  <option value="12 hours">12 hours</option>
                  <option value="24 hours">24 hours</option>
                  <option value="48 hours">48 hours</option>
                </select>
              </div>
            </div>

            {/* Wallet Not Connected Notice */}
            {!connected && (
              <div className="alert-box warning-alert">
                <AlertTriangle size={16} />
                <span>Wallet not connected. Connect your wallet to create this circle.</span>
              </div>
            )}

            {/* Submit Action */}
            <div className="form-submit-area">
              <button
                type="submit"
                id="create-circle-btn"
                className="btn-primary"
                disabled={!isValid || !connected || txState === 'pending'}
              >
                {txState === 'pending' ? (
                  <>
                    <Loader2 size={16} className="spinner-icon" />
                    Creating circle...
                  </>
                ) : (
                  <>
                    Create circle
                    <ArrowRight size={16} />
                  </>
                )}
              </button>
            </div>

            {/* Transaction Pending State */}
            {txState === 'pending' && (
              <div className="alert-box action-alert">
                <Loader2 size={18} className="spinner-icon" />
                <span>Creating circle on Solana devnet. Approve the transaction in your wallet.</span>
              </div>
            )}

            {/* Transaction Success State */}
            {txState === 'success' && createdCircleAddress && (
              <div className="alert-box success-alert" style={{ flexDirection: 'column', alignItems: 'flex-start', gap: '0.6rem' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                  <CheckCircle2 size={18} className="text-green" />
                  <strong>Created circle on Solana devnet.</strong>
                </div>

                <div style={{ fontSize: '0.85rem', width: '100%', wordBreak: 'break-all' }}>
                  <div>Circle address: <code>{createdCircleAddress}</code></div>
                  <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.4rem', flexWrap: 'wrap' }}>
                    <button
                      type="button"
                      className="icon-action-btn"
                      onClick={handleCopyCircle}
                      style={{ display: 'inline-flex', alignItems: 'center', gap: '0.3rem', fontSize: '0.8rem', padding: '0.2rem 0.5rem' }}
                    >
                      {copiedAddress ? <Check size={13} /> : <Copy size={13} />}
                      {copiedAddress ? 'Copied' : 'Copy address'}
                    </button>
                    <a
                      href={getExplorerUrl('address', createdCircleAddress)}
                      target="_blank"
                      rel="noreferrer"
                      className="icon-action-btn"
                      style={{ display: 'inline-flex', alignItems: 'center', gap: '0.3rem', fontSize: '0.8rem', padding: '0.2rem 0.5rem' }}
                    >
                      <ExternalLink size={13} />
                      View on explorer
                    </a>
                    {txSignature && (
                      <a
                        href={getExplorerUrl('tx', txSignature)}
                        target="_blank"
                        rel="noreferrer"
                        className="icon-action-btn"
                        style={{ display: 'inline-flex', alignItems: 'center', gap: '0.3rem', fontSize: '0.8rem', padding: '0.2rem 0.5rem' }}
                      >
                        <ExternalLink size={13} />
                        View transaction
                      </a>
                    )}
                  </div>
                </div>

                <button
                  type="button"
                  className="btn-secondary"
                  style={{ marginTop: '0.5rem', width: '100%', padding: '0.6rem' }}
                  onClick={() => onCreated?.(createdCircleAddress)}
                >
                  Go to circle page
                  <ArrowRight size={15} />
                </button>
              </div>
            )}

            {/* Transaction Failure State */}
            {txState === 'error' && txError && (
              <div className="alert-box error-alert" role="alert">
                <AlertTriangle size={18} />
                <div>
                  <strong>Action failed</strong>
                  <p style={{ marginTop: '0.25rem' }}>{txError}. Check your SOL balance for transaction fees and try again.</p>
                </div>
              </div>
            )}
          </form>
        </section>

        {/* Right Column: Live Ring Preview + Deposit Table, stacked on phone */}
        <div className="create-layout-right" style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
          {/* Live Ring Preview Card */}
          <section className="card ring-preview-card" aria-labelledby="ring-preview-heading" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
            <div style={{ width: '100%', display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.75rem' }}>
              <h2 id="ring-preview-heading" className="card-title" style={{ margin: 0, fontSize: '1rem' }}>
                Circle ring preview
              </h2>
              <span className="badge-pill">{depositPct}% deposit</span>
            </div>

            <CircleRing
              isPreview={true}
              previewMembersTarget={members}
              previewContribution={contribution.toString()}
              previewDepositPct={depositPct}
              tokenSymbol={token}
            />

            <div style={{ width: '100%', marginTop: '1rem', paddingTop: '0.85rem', borderTop: '1px solid var(--glass-border-subtle)', display: 'flex', justifyContent: 'space-between', fontSize: '0.825rem', color: 'var(--text-muted)' }}>
              <span>Slot 1 (Creator) locks {slotBreakdown.slots[0]?.deposit} {token}</span>
              <span>Pot: {slotBreakdown.potPerPeriod} {token}</span>
            </div>
          </section>

          {/* Breakdown Column: Section 6 Formula & Slot Schedule */}
          <section className="card summary-card" aria-labelledby="breakdown-heading">
            <div className="card-header-row">
              <h2 id="breakdown-heading" className="card-title">
                Deposit schedule
              </h2>
              <span className="badge-spec">Formula: max(pct × (N-k) × c, c)</span>
            </div>

            <p className="card-desc">
              A member in slot <strong>k</strong> locks{' '}
              <code>max({depositPct}% × ({members} - k) × {contribution}, {contribution})</code>.
              The floor of one contribution guarantees every member covers at least one missed period.
            </p>

            {/* Quick Metrics */}
            <div className="metrics-banner">
              <div className="metric-box">
                <span className="metric-label">Pot per period</span>
                <span className="metric-value">
                  {slotBreakdown.potPerPeriod} <small>{token}</small>
                </span>
              </div>
              <div className="metric-box">
                <span className="metric-label">Total deposits locked</span>
                <span className="metric-value">
                  {slotBreakdown.totalDeposits} <small>{token}</small>
                </span>
              </div>
              <div className="metric-box">
                <span className="metric-label">Rounds</span>
                <span className="metric-value">
                  {members} <small>periods</small>
                </span>
              </div>
            </div>

            {/* Table of Slots */}
            <div className="table-responsive">
              <table className="slot-table" aria-label="Deposit requirements per slot">
                <thead>
                  <tr>
                    <th scope="col">Slot</th>
                    <th scope="col">Payout turn</th>
                    <th scope="col">Deposit locked</th>
                    <th scope="col">Max group shortfall</th>
                  </tr>
                </thead>
                <tbody>
                  {slotBreakdown.slots.map((item) => (
                    <tr key={item.slot} className={item.slot === 1 ? 'row-creator' : ''}>
                      <td>
                        <span className="slot-pill">Slot {item.slot}</span>
                        {item.slot === 1 && <span className="tag-creator">Creator</span>}
                      </td>
                      <td>
                        {item.slot === 1 ? '1st payout' : item.slot === members ? 'Last payout' : `Turn ${item.slot}`}
                      </td>
                      <td className="deposit-cell">
                        <strong>{item.deposit} {token}</strong>
                      </td>
                      <td className="shortfall-cell">
                        {item.shortfall > 0 ? (
                          <span className="shortfall-val">
                            <AlertTriangle size={13} className="text-amber" />
                            {item.shortfall} {token}
                          </span>
                        ) : (
                          <span className="text-muted">0 {token} (Zero risk)</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="spec-note-callout">
              <Info size={16} className="text-accent" />
              <div>
                <strong>Why partial deposits?</strong> Early slots lock higher deposits because they owe more future periods after collecting the pot. The group's risk is capped transparently up front.
              </div>
            </div>
          </section>
        </div>
      </div>
    </div>
  );
};
