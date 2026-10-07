import type { FC, FormEvent } from 'react';
import { useState, useMemo, useEffect } from 'react';
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
  X,
} from 'lucide-react';

import type { TokenChoice } from '../types';
import { calculateSlotDeposit, calculateSlotShortfall } from '../types';
import { DEVNET_TOKEN_MINT, isPlaceholderMint } from '../config';
import { CircleRing } from './CircleRing';
import { GlassSelect } from './GlassSelect';
import { Reveal } from './Reveal';
import {
  getSolthriftProgram,
  getCirclePda,
  getMemberPda,
  getVaultPda,
  getOrCreateAtaInstruction,
  getMintDecimals,
  getTokenBalance,
  getExplorerUrl,
  translateProgramError,
  executeProgramMethod,
  isUserCancellation,
} from '../solthriftClient';

interface CreateCircleProps {
  onCreated?: (circleAddress: string) => void;
}

const PERIOD_OPTIONS = [
  { value: '20 seconds', label: '20 seconds (fast test)' },
  { value: '30 seconds', label: '30 seconds' },
  { value: '1 minute', label: '1 minute (test)' },
  { value: '2 minutes', label: '2 minutes (test)' },
  { value: '3 minutes', label: '3 minutes (demo)' },
  { value: '5 minutes', label: '5 minutes (test)' },
  { value: '10 minutes', label: '10 minutes (test)' },
  { value: '1 day', label: '1 day (demo)' },
  { value: '3 days', label: '3 days' },
  { value: '1 week', label: '1 week (production)' },
  { value: '2 weeks', label: '2 weeks' },
  { value: '1 month', label: '1 month' },
];

const GRACE_OPTIONS = [
  { value: '0 minutes', label: '0 minutes (instant)' },
  { value: '0 seconds', label: '0 seconds' },
  { value: '5 seconds', label: '5 seconds (extra time)' },
  { value: '10 seconds', label: '10 seconds (wait time)' },
  { value: '30 seconds', label: '30 seconds (demo grace)' },
  { value: '1 minute', label: '1 minute (test)' },
  { value: '6 hours', label: '6 hours (demo)' },
  { value: '12 hours', label: '12 hours' },
  { value: '24 hours', label: '24 hours' },
  { value: '48 hours', label: '48 hours' },
];

export const CreateCircle: FC<CreateCircleProps> = ({ onCreated }) => {
  const { connection } = useConnection();
  const wallet = useWallet();
  const anchorWallet = useAnchorWallet();
  const { connected } = wallet;

  // Form parameters (defaulted to 4-Member Demo Preset: 3m turn, 10s wait time, 5 USDC)
  const [token, setToken] = useState<TokenChoice>('USDC');
  const [members, setMembers] = useState<number>(4);
  const [contribution, setContribution] = useState<number>(5);
  const [depositPct, setDepositPct] = useState<number>(50);
  const [period, setPeriod] = useState<string>('3 minutes');
  const [grace, setGrace] = useState<string>('10 seconds');

  // Custom token mint input in case DEVNET_TOKEN_MINT is a placeholder
  const [customMintInput, setCustomMintInput] = useState<string>('');
  const [mintDecimals, setMintDecimals] = useState<number>(6);

  // Transaction states
  const [txState, setTxState] = useState<'idle' | 'pending' | 'success' | 'error'>('idle');
  const [txError, setTxError] = useState<{ message: string; details?: string } | null>(null);
  const [txSignature, setTxSignature] = useState<string | null>(null);
  const [createdCircleAddress, setCreatedCircleAddress] = useState<string | null>(null);
  const [copiedAddress, setCopiedAddress] = useState<boolean>(false);

  // Auto-dismiss transaction error after 5 seconds
  useEffect(() => {
    if (txError) {
      const timer = setTimeout(() => {
        setTxError(null);
        setTxState((s) => (s === 'error' ? 'idle' : s));
      }, 5000);
      return () => clearTimeout(timer);
    }
  }, [txError]);

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

  // Read mint decimals and user token balance at runtime
  const [userTokenBalance, setUserTokenBalance] = useState<number | null>(null);
  const [userSolBalance, setUserSolBalance] = useState<number | null>(null);

  useEffect(() => {
    if (activeMint) {
      getMintDecimals(connection, activeMint)
        .then((dec) => setMintDecimals(dec))
        .catch(() => setMintDecimals(6));
    }
  }, [activeMint, connection]);

  useEffect(() => {
    if (connected && wallet?.publicKey) {
      connection
        .getBalance(wallet.publicKey)
        .then((lamports) => setUserSolBalance(lamports / 1e9))
        .catch(() => setUserSolBalance(null));

      if (activeMint) {
        getTokenBalance(connection, activeMint, wallet.publicKey)
          .then((bal) => setUserTokenBalance(bal))
          .catch(() => setUserTokenBalance(0));
      }
    } else {
      setUserTokenBalance(null);
      setUserSolBalance(null);
    }
  }, [connected, wallet?.publicKey, activeMint, connection]);

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
        ? 'Token mint address is a placeholder. Please provide a token mint address for the test network.'
        : 'Invalid token mint address';
    }
    return errs;
  }, [members, contribution, depositPct, token, activeMint, hasPlaceholderConfigMint]);

  const isValid = Object.keys(errors).length === 0;

  // Period duration to seconds mapping (Section 2 & hackathon demo tests)
  const periodDurationSeconds = useMemo(() => {
    switch (period) {
      case '20 seconds':
        return 20;
      case '30 seconds':
        return 30;
      case '1 minute':
        return 60;
      case '2 minutes':
        return 120;
      case '3 minutes':
        return 180;
      case '5 minutes':
        return 300;
      case '10 minutes':
        return 600;
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
      case '0 minutes':
        return 0;
      case '5 seconds':
        return 5;
      case '10 seconds':
        return 10;
      case '30 seconds':
        return 30;
      case '1 minute':
        return 60;
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

  const creatorRequiredDeposit = slotBreakdown.slots[0]?.deposit ?? 0;
  const hasInsufficientTokens =
    userTokenBalance !== null && userTokenBalance < creatorRequiredDeposit;

  // Submit on-chain createCircle instruction
  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!isValid || !activeMint) return;

    if (!connected || !wallet || !wallet.publicKey) {
      setTxState('error');
      setTxError({ message: 'Connect your wallet to continue.' });
      return;
    }

    if (hasInsufficientTokens) {
      setTxState('error');
      setTxError({
        message: `You need at least ${creatorRequiredDeposit} ${token} in your wallet to cover the creator deposit for Slot 1. Your wallet currently has ${userTokenBalance} ${token}.`,
        details: `Your wallet (${wallet.publicKey.toBase58()}) has ${
          userSolBalance !== null ? userSolBalance.toFixed(2) : '10'
        } SOL for network fees, but circle savings require test ${token}. Request test tokens from the faucet to proceed.`,
      });
      return;
    }

    try {
      setTxState('pending');
      setTxError(null);
      setTxSignature(null);
      setCreatedCircleAddress(null);

      // Section 7 Invariant: Decimals factor read at runtime from mint account
      const decimals = activeMint ? await getMintDecimals(connection, activeMint) : mintDecimals;
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

      const program = getSolthriftProgram(connection, anchorWallet);

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

      const { signature: sig } = await executeProgramMethod({
        connection,
        wallet,
        method,
        preInstructions: createAtaIx ? [createAtaIx] : undefined,
      });

      setTxSignature(sig);
      setCreatedCircleAddress(circlePda.toBase58());
      setTxState('success');
    } catch (err: any) {
      console.error('createCircle failed:', err);
      if (isUserCancellation(err)) {
        setTxState('idle');
        return;
      }
      setTxState('error');
      const translated = translateProgramError(err);
      setTxError({ message: translated.message, details: translated.details });
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
      <Reveal revealKey="create-circle-header">
        <div className="page-header">
          <h1 className="page-title">
            Save together,{' '}
            <span className="font-serif-italic">without trusting anyone.</span>
          </h1>
          <p className="page-subtitle">
            Configure savings circle parameters on Solana.
          </p>
        </div>
      </Reveal>

      <div className="create-layout-split">
        {/* Form Column */}
        <Reveal revealKey="create-circle-form" style={{ flex: 1, minWidth: 0 }}>
          <section className="card form-card" aria-labelledby="form-heading">
          <h2 id="form-heading" className="card-title">
            <Coins size={18} className="text-accent" />
            Circle parameters
          </h2>

          <form onSubmit={handleSubmit} noValidate className="create-circle-form">
            {/* Demo Preset Panel */}
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                background: 'rgba(255, 255, 255, 0.04)',
                backdropFilter: 'blur(20px)',
                WebkitBackdropFilter: 'blur(20px)',
                border: '1px solid var(--glass-border, rgba(255, 255, 255, 0.10))',
                boxShadow: 'var(--glass-highlight, inset 0 1px 0 rgba(255, 255, 255, 0.08))',
                borderRadius: '16px',
                padding: '0.85rem 1.15rem',
                marginBottom: '1.25rem',
              }}
            >
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.2rem' }}>
                <span style={{ fontWeight: 600, color: '#ffffff', display: 'flex', alignItems: 'center', gap: '0.4rem', fontSize: '0.9rem' }}>
                  4-Member Demo Preset (3-min turns, 10s grace)
                </span>
                <span style={{ fontSize: '0.8rem', color: 'var(--text-muted, rgba(255, 255, 255, 0.60))' }}>
                  4 members · 3m turn (time to switch test accounts & pay) · 10s grace window.
                </span>
              </div>
              <button
                type="button"
                className="btn-secondary"
                style={{
                  fontSize: '0.78rem',
                  padding: '0.45rem 0.85rem',
                  borderColor: 'rgba(255, 255, 255, 0.16)',
                  color: '#ffffff',
                  background: 'rgba(255, 255, 255, 0.06)',
                  whiteSpace: 'nowrap',
                  cursor: 'pointer',
                  borderRadius: '10px',
                  fontWeight: 500,
                  transition: 'all 0.15s ease',
                }}
                onClick={() => {
                  setMembers(4);
                  setContribution(5);
                  setDepositPct(50);
                  setPeriod('3 minutes');
                  setGrace('10 seconds');
                }}
              >
                Apply Preset
              </button>
            </div>

            {/* Token Selector & Mint Warning */}
            <div className="form-group">
              <label htmlFor="token-select" className="form-label">
                Token on the test network
                <span
                  className="tooltip-hint"
                  title="Circles use one token for all deposits, payments, and payouts."
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
                    <strong>Token address missing:</strong> Token mint in <code>config.ts</code> is not set yet.
                    Please provide the token mint address or enter one below.
                  </div>
                </div>
              ) : (
                <small className="form-hint" style={{ wordBreak: 'break-all' }}>
                  Configured token mint: <code>{DEVNET_TOKEN_MINT.toBase58()}</code>
                </small>
              )}

              {/* Optional Custom Mint Input */}
              <div style={{ marginTop: '0.5rem' }}>
                <label htmlFor="custom-mint-input" className="form-label" style={{ fontSize: '0.8rem' }}>
                  Override token mint address (test network SPL token):
                </label>
                <input
                  id="custom-mint-input"
                  type="text"
                  placeholder={hasPlaceholderConfigMint ? 'Paste 32-44 character token address' : 'Optional: override config mint'}
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
                  Members: <strong>{members}</strong>
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
                  Payment each turn
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
                Paid each turn by every member into the program vault.
              </small>
            </div>

            {/* Deposit Percentage */}
            <div className="form-group">
              <div className="label-row">
                <label htmlFor="deposit-pct-input" className="form-label">
                  <Percent size={15} />
                  Deposit percentage: <strong>{depositPct}%</strong>
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
                Share of future payments locked upfront as a deposit.
              </small>
            </div>

            {/* Period & Grace */}
            <div className="form-row-2">
              <div className="form-group">
                <label htmlFor="period-select" className="form-label">
                  <Clock size={15} /> Time per turn
                </label>
                <GlassSelect
                  id="period-select"
                  value={period}
                  options={PERIOD_OPTIONS}
                  onChange={setPeriod}
                  ariaLabel="Time per turn"
                />
              </div>

              <div className="form-group">
                <label htmlFor="grace-select" className="form-label">
                  <ShieldAlert size={15} /> Extra time to pay
                </label>
                <GlassSelect
                  id="grace-select"
                  value={grace}
                  options={GRACE_OPTIONS}
                  onChange={setGrace}
                  ariaLabel="Extra time to pay"
                />
              </div>
            </div>

            {/* Token Balance & Slot 1 Deposit Status */}
            {connected && (
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  fontSize: '0.82rem',
                  padding: '0.65rem 0.85rem',
                  background: 'rgba(255, 255, 255, 0.03)',
                  borderRadius: '12px',
                  border: '1px solid rgba(255, 255, 255, 0.08)',
                  margin: '0.5rem 0',
                }}
              >
                <span style={{ color: 'var(--text-muted)' }}>
                  Slot 1 deposit required: <strong style={{ color: '#fff' }}>{creatorRequiredDeposit} {token}</strong>
                </span>
                <span
                  style={{
                    color:
                      userTokenBalance !== null && userTokenBalance >= creatorRequiredDeposit
                        ? '#ffffff'
                        : 'var(--text-muted)',
                  }}
                >
                  Your balance:{' '}
                  <strong>
                    {userTokenBalance !== null ? `${userTokenBalance} ${token}` : 'Checking...'}
                  </strong>
                </span>
              </div>
            )}

            {/* Faucet Guidance Banner when user has SOL but lacks tokens */}
            {connected && hasInsufficientTokens && (
              <div
                className="alert-box warning-alert"
                style={{
                  flexDirection: 'column',
                  alignItems: 'flex-start',
                  gap: '0.5rem',
                  margin: '0.5rem 0 1rem',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                  <AlertTriangle size={16} />
                  <strong>Need test {token} for initial deposit</strong>
                </div>
                <p style={{ margin: 0, fontSize: '0.82rem', lineHeight: '1.45' }}>
                  You have {userSolBalance !== null ? `${userSolBalance.toFixed(2)} SOL` : 'SOL'} to pay for Solana network transaction fees, but savings circles operate in test {token}. Creating this circle requires an upfront Slot 1 deposit of {creatorRequiredDeposit} {token} into the vault.
                </p>
                <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', marginTop: '0.25rem' }}>
                  <a
                    href="https://faucet.circle.com/"
                    target="_blank"
                    rel="noreferrer"
                    className="btn-secondary"
                    style={{ fontSize: '0.75rem', padding: '0.35rem 0.65rem' }}
                  >
                    <ExternalLink size={12} />
                    Circle USDC Faucet
                  </a>
                  <a
                    href="https://spl-token-faucet.com/?token-name=USDC-Dev"
                    target="_blank"
                    rel="noreferrer"
                    className="btn-secondary"
                    style={{ fontSize: '0.75rem', padding: '0.35rem 0.65rem' }}
                  >
                    <ExternalLink size={12} />
                    SPL Token Faucet
                  </a>
                </div>
              </div>
            )}

            {/* Bottom action area pushed to bottom with margin-top: auto on desktop */}
            <div className="create-form-bottom">
              {/* Wallet Not Connected Notice */}
              {!connected && (
                <div className="alert-box warning-alert">
                  <AlertTriangle size={16} />
                  <span>Connect your wallet to continue.</span>
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
                  <span>Creating circle on the Solana test network. Approve the transaction in your wallet.</span>
                </div>
              )}

              {/* Transaction Success State */}
              {txState === 'success' && createdCircleAddress && (
                <div className="alert-box success-alert" style={{ flexDirection: 'column', alignItems: 'flex-start', gap: '0.6rem' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                    <CheckCircle2 size={18} className="text-green" />
                    <strong>You created the circle.</strong>
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
                    Go to circle
                    <ArrowRight size={15} />
                  </button>
                </div>
              )}

              {/* Transaction Failure State */}
              {txState === 'error' && txError && (
                <div className="alert-box error-alert" role="alert" style={{ justifyContent: 'space-between', alignItems: 'flex-start' }}>
                  <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'flex-start' }}>
                    <AlertTriangle size={18} style={{ flexShrink: 0, marginTop: '2px' }} />
                    <div>
                      <strong>Could not create circle</strong>
                      <p style={{ marginTop: '0.25rem' }}>{txError.message}</p>
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
                    onClick={() => {
                      setTxError(null);
                      setTxState('idle');
                    }}
                    className="icon-action-btn"
                    aria-label="Dismiss error"
                    style={{ width: '28px', height: '28px', minWidth: '28px' }}
                  >
                    <X size={14} />
                  </button>
                </div>
              )}
            </div>
          </form>
          </section>
        </Reveal>

        {/* Right Column: Live Ring Preview + Deposit Table, stacked on phone */}
        <div className="create-layout-right">
          {/* Live Ring Preview Card */}
          <Reveal revealKey="create-circle-ring-preview">
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
                tokenDecimals={mintDecimals}
              />

              <div style={{ width: '100%', marginTop: '1rem', paddingTop: '0.85rem', borderTop: '1px solid var(--glass-border-subtle)', display: 'flex', justifyContent: 'space-between', fontSize: '0.825rem', color: 'var(--text-muted)' }}>
                <span>Seat 1 (Creator) locks {slotBreakdown.slots[0]?.deposit} {token}</span>
                <span>Pot each turn: {slotBreakdown.potPerPeriod} {token}</span>
              </div>
            </section>
          </Reveal>

          {/* Breakdown Column: Section 6 Formula & Seat Schedule */}
          <Reveal revealKey="create-circle-summary">
            <section className="card summary-card" aria-labelledby="breakdown-heading">
              <div className="card-header-row">
                <h2 id="breakdown-heading" className="card-title">
                  Deposit schedule
                </h2>
                <span className="badge-spec">Formula: max(pct × (N-k) × c, c)</span>
              </div>

              <p className="card-desc">
                A member in seat <strong>k</strong> locks{' '}
                <code>max({depositPct}% × ({members} - k) × {contribution}, {contribution})</code>.
                The minimum deposit covers at least one missed payment.
              </p>

              {/* Quick Metrics */}
              <div className="metrics-banner">
                <div className="metric-box">
                  <span className="metric-label">Pot each turn</span>
                  <span className="metric-value">
                    {slotBreakdown.potPerPeriod} <small>{token}</small>
                  </span>
                </div>
                <div className="metric-box">
                  <span className="metric-label">Deposits locked in total</span>
                  <span className="metric-value">
                    {slotBreakdown.totalDeposits} <small>{token}</small>
                  </span>
                </div>
                <div className="metric-box">
                  <span className="metric-label">Number of turns</span>
                  <span className="metric-value">
                    {members} <small>turns</small>
                  </span>
                </div>
              </div>

              {/* Table of Seats */}
              <div className="table-responsive">
                <table className="slot-table" aria-label="Deposit requirements per seat">
                  <thead>
                    <tr>
                      <th scope="col">Seat</th>
                      <th scope="col">Gets the pot</th>
                      <th scope="col">Deposit you lock</th>
                      <th scope="col">Most the group could lose</th>
                    </tr>
                  </thead>
                  <tbody>
                    {slotBreakdown.slots.map((item) => (
                      <tr key={item.slot} className={item.slot === 1 ? 'row-creator' : ''}>
                        <td>
                          <span className="slot-pill">Seat {item.slot}</span>
                          {item.slot === 1 && <span className="tag-creator">Creator</span>}
                        </td>
                        <td>
                          {item.slot === 1 ? 'Turn 1' : item.slot === members ? `Turn ${members} (last)` : `Turn ${item.slot}`}
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
                            <span className="text-muted">0 {token}</span>
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
                  <strong>Why the deposits are different.</strong> People who get the pot early still owe more turns afterward, so they lock a bigger deposit. The most the group can lose is shown here before anyone joins.
                </div>
              </div>
            </section>
          </Reveal>
        </div>
      </div>
    </div>
  );
};
