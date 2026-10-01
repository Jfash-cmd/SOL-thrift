import type { FC, FormEvent } from 'react';
import { useState, useMemo } from 'react';
import type { TokenChoice } from '../types';
import { calculateSlotDeposit, calculateSlotShortfall } from '../types';
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
} from 'lucide-react';

interface CreateCircleProps {
  onCreated?: () => void;
}

export const CreateCircle: FC<CreateCircleProps> = ({ onCreated }) => {
  // Section 2 parameters with suggested demo defaults
  const [token, setToken] = useState<TokenChoice>('USDC');
  const [members, setMembers] = useState<number>(4);
  const [contribution, setContribution] = useState<number>(10);
  const [depositPct, setDepositPct] = useState<number>(50);
  const [period, setPeriod] = useState<string>('1 day');
  const [grace, setGrace] = useState<string>('6 hours');

  const [submittedMessage, setSubmittedMessage] = useState<string | null>(null);

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
    return errs;
  }, [members, contribution, depositPct, token]);

  const isValid = Object.keys(errors).length === 0;

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

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (!isValid) return;

    setSubmittedMessage(
      `Mock circle configuration verified! In Phase 2, this will dispatch the create_circle Anchor instruction on Solana Devnet.`
    );
    setTimeout(() => {
      setSubmittedMessage(null);
      if (onCreated) onCreated();
    }, 2800);
  };

  return (
    <div className="page-container">
      <div className="page-header">
        <h1 className="page-title">Create a Savings Circle</h1>
        <p className="page-subtitle">
          Configure on-chain rotating thrift (ajo) parameters according to Section 2 of the spec.
          Deposits are partial and program-enforced.
        </p>
      </div>

      <div className="create-layout-grid">
        {/* Form Column */}
        <section className="card form-card" aria-labelledby="form-heading">
          <h2 id="form-heading" className="card-title">
            <Coins size={18} className="text-accent" />
            Circle Parameters
          </h2>

          <form onSubmit={handleSubmit} noValidate>
            {/* Token Selector */}
            <div className="form-group">
              <label htmlFor="token-select" className="form-label">
                Stablecoin Token (Devnet test mint)
                <span className="tooltip-hint" title="Circles use exactly one token for all deposits, contributions and payouts. Never mixed.">
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
              <small className="form-hint">
                Single stablecoin per circle ensures payouts keep constant value. SOL is used only for network fees.
              </small>
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
                Share of what a member would still owe that they lock up front as a deposit.
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
                  <option value="6 hours">6 hours (demo)</option>
                  <option value="12 hours">12 hours</option>
                  <option value="24 hours">24 hours</option>
                  <option value="48 hours">48 hours</option>
                </select>
              </div>
            </div>

            {/* Submit Action */}
            <div className="form-submit-area">
              <button
                type="submit"
                id="create-circle-btn"
                className="btn-primary"
                disabled={!isValid}
              >
                Create Circle (Demo Mock)
                <ArrowRight size={16} />
              </button>
            </div>

            {submittedMessage && (
              <div className="alert-box success-alert" role="status">
                <CheckCircle2 size={18} />
                <span>{submittedMessage}</span>
              </div>
            )}
          </form>
        </section>

        {/* Breakdown Column: Section 6 Formula & Slot Schedule */}
        <section className="card summary-card" aria-labelledby="breakdown-heading">
          <div className="card-header-row">
            <h2 id="breakdown-heading" className="card-title">
              Section 6: Deposit Schedule
            </h2>
            <span className="badge-spec">Formula: max(pct × (N-k) × c, c)</span>
          </div>

          <p className="card-desc">
            A member in slot <strong>k</strong> locks{' '}
            <code>max({depositPct}% × ({members} - k) × {contribution}, {contribution})</code>.
            The floor of one contribution (<code>c</code>) guarantees every member covers at least one missed period.
          </p>

          {/* Quick Metrics */}
          <div className="metrics-banner">
            <div className="metric-box">
              <span className="metric-label">Pot per Period</span>
              <span className="metric-value">
                {slotBreakdown.potPerPeriod} <small>{token}</small>
              </span>
            </div>
            <div className="metric-box">
              <span className="metric-label">Total Deposits Locked</span>
              <span className="metric-value">
                {slotBreakdown.totalDeposits} <small>{token}</small>
              </span>
            </div>
            <div className="metric-box">
              <span className="metric-label">Rounds / Cycles</span>
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
                  <th scope="col">Payout Turn</th>
                  <th scope="col">Deposit Locked</th>
                  <th scope="col">Max Group Shortfall</th>
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
                      {item.slot === 1 ? '1st Payout' : item.slot === members ? 'Last Payout' : `Turn ${item.slot}`}
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
              <strong>Why Partial Deposits?</strong> Early slots lock higher deposits because they owe more future periods after collecting the pot. The group's risk is capped transparently up front.
            </div>
          </div>
        </section>
      </div>
    </div>
  );
};
