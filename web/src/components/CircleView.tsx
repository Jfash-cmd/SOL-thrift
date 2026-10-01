import type { FC } from 'react';
import { useState, useEffect } from 'react';
import type { FakeCircleData } from '../types';
import { initialMockCircle } from '../data/mockCircle';
import {
  ShieldAlert,
  Clock,
  CheckCircle,
  XCircle,
  ExternalLink,
  Award,
  Wallet,
  Coins,
  History,
  AlertOctagon,
  RotateCcw,
  Sparkles,
} from 'lucide-react';

export const CircleView: FC = () => {
  const [circle, setCircle] = useState<FakeCircleData>(initialMockCircle);
  const [selectedScenario, setSelectedScenario] = useState<string>('demo');
  const [actionNotice, setActionNotice] = useState<string | null>(null);

  // Live countdown timer calculation
  const [timeLeft, setTimeLeft] = useState<{ hours: number; minutes: number; seconds: number }>({
    hours: 0,
    minutes: 42,
    seconds: 15,
  });

  useEffect(() => {
    const timer = setInterval(() => {
      setTimeLeft((prev) => {
        if (prev.seconds > 0) {
          return { ...prev, seconds: prev.seconds - 1 };
        } else if (prev.minutes > 0) {
          return { ...prev, minutes: prev.minutes - 1, seconds: 59 };
        } else if (prev.hours > 0) {
          return { hours: prev.hours - 1, minutes: 59, seconds: 59 };
        }
        return { hours: 0, minutes: 0, seconds: 0 };
      });
    }, 1000);
    return () => clearInterval(timer);
  }, []);

  // Determine trigger button states per Section 9
  // 1. "Pay out to [next member]": callable once all active members have contributed, OR deadline + grace passed
  const activeMembers = circle.members.filter((m) => m.status === 'active');
  const allActiveContributed = activeMembers.every((m) => m.hasContributedThisPeriod);
  const deadlineGracePassed = selectedScenario === 'demo' || selectedScenario === 'defaulter';
  const nextRecipient = circle.members.find((m) => m.isNextRecipient && m.status === 'active');

  const canPayout = (allActiveContributed || deadlineGracePassed) && !!nextRecipient && circle.state === 'Active';

  // 2. "Remove late member": callable after deadline plus grace against a member who has not contributed
  const hasLateDefaulter = circle.members.some(
    (m) => m.status === 'active' && m.missedDeadline && !m.hasContributedThisPeriod
  ) || (selectedScenario === 'demo' && circle.members.some((m) => m.status === 'removed'));

  const canRemoveLate = hasLateDefaulter && deadlineGracePassed && circle.state === 'Active';

  // 3. "Start next round": callable once the last payout is done and the filling window ended
  const canStartNextRound = circle.state === 'Filling' || selectedScenario === 'round_ended';

  // Handle Scenario switching for reviewer exploration
  const handleScenarioChange = (scenario: string) => {
    setSelectedScenario(scenario);
    if (scenario === 'demo') {
      setCircle(initialMockCircle);
    } else if (scenario === 'pending') {
      // Charlie has not contributed yet, deadline not passed
      setCircle({
        ...initialMockCircle,
        currentPot: 20,
        members: initialMockCircle.members.map((m) => {
          if (m.slot === 3) return { ...m, hasContributedThisPeriod: false };
          if (m.slot === 4) return { ...m, status: 'active', missedDeadline: false };
          return m;
        }),
      });
    } else if (scenario === 'round_ended') {
      // All payouts finished, filling window active
      setCircle({
        ...initialMockCircle,
        state: 'Filling',
        currentPeriod: 4,
        members: initialMockCircle.members.map((m) => ({
          ...m,
          hasBeenPaid: true,
          isNextRecipient: false,
        })),
      });
    }
  };

  const triggerPayout = () => {
    if (!canPayout) return;
    setActionNotice(
      `Triggered payout: Sent ${circle.currentPot} ${circle.token} to ${nextRecipient?.displayName} (${nextRecipient?.wallet}) on Devnet.`
    );
    setTimeout(() => setActionNotice(null), 4000);
  };

  const triggerRemoveDefaulter = () => {
    if (!canRemoveLate) return;
    setActionNotice(
      `Triggered remove_defaulter: Dave was removed for missed contribution. Unused deposit refunded, pot adjusted.`
    );
    setTimeout(() => setActionNotice(null), 4000);
  };

  const triggerStartNextRound = () => {
    if (!canStartNextRound) return;
    setActionNotice(
      `Triggered start_next_round: Initialized new round cycle with active members.`
    );
    setTimeout(() => setActionNotice(null), 4000);
  };

  return (
    <div className="page-container">
      {/* Top Banner & Scenario Switcher */}
      <div className="circle-header-section">
        <div className="circle-header-info">
          <div className="circle-badges-row">
            <span className="badge-state active">{circle.state}</span>
            <span className="badge-pill">Period {circle.currentPeriod} of {circle.totalPeriods}</span>
            <span className="badge-pill">{circle.token} Circle</span>
            <span className="badge-pill">Deposit: {circle.depositPct}%</span>
          </div>
          <h1 className="circle-title">{circle.title}</h1>
          <p className="circle-meta">
            Circle PDA: <code>8bQz...4pL2</code> • Non-custodial Vault • All transactions recorded on Devnet
          </p>
        </div>

        {/* Interactive Scenario Explorer */}
        <div className="scenario-selector-box">
          <span className="scenario-label">Demo Scenario:</span>
          <div className="scenario-btn-group">
            <button
              type="button"
              className={`scenario-btn ${selectedScenario === 'demo' ? 'active' : ''}`}
              onClick={() => handleScenarioChange('demo')}
            >
              1. Spec Demo (Defaulter Dave)
            </button>
            <button
              type="button"
              className={`scenario-btn ${selectedScenario === 'pending' ? 'active' : ''}`}
              onClick={() => handleScenarioChange('pending')}
            >
              2. Waiting for Contributions
            </button>
            <button
              type="button"
              className={`scenario-btn ${selectedScenario === 'round_ended' ? 'active' : ''}`}
              onClick={() => handleScenarioChange('round_ended')}
            >
              3. Round Ended (Filling Window)
            </button>
          </div>
        </div>
      </div>

      {actionNotice && (
        <div className="alert-box action-alert" role="status">
          <Sparkles size={18} />
          <span>{actionNotice}</span>
        </div>
      )}

      {/* Main Grid: Pot & Countdown + Trigger Buttons */}
      <div className="circle-dashboard-grid">
        {/* Left Column: Pot & Countdown */}
        <div className="card hero-stat-card">
          <div className="hero-stat-row">
            <div>
              <span className="hero-stat-label">Current Period Pot</span>
              <div className="hero-stat-amount">
                {circle.currentPot} <span className="stat-currency">{circle.token}</span>
              </div>
              <small className="stat-subtext">
                Contribution: {circle.contribution} {circle.token} / period • {activeMembers.length} active members
              </small>
            </div>

            {/* Countdown Component */}
            <div className="countdown-card" aria-label="Contribution deadline countdown">
              <div className="countdown-header">
                <Clock size={16} className="text-accent" />
                <span>Period Deadline</span>
              </div>
              <div className="countdown-digits">
                <div className="time-block">
                  <span className="time-val">{String(timeLeft.hours).padStart(2, '0')}</span>
                  <span className="time-unit">hr</span>
                </div>
                <span className="time-colon">:</span>
                <div className="time-block">
                  <span className="time-val">{String(timeLeft.minutes).padStart(2, '0')}</span>
                  <span className="time-unit">min</span>
                </div>
                <span className="time-colon">:</span>
                <div className="time-block">
                  <span className="time-val">{String(timeLeft.seconds).padStart(2, '0')}</span>
                  <span className="time-unit">sec</span>
                </div>
              </div>
              <div className="countdown-grace">
                Grace period: +{circle.graceLabel} before removal
              </div>
            </div>
          </div>
        </div>

        {/* Section 9: Trigger Buttons Card */}
        <div className="card triggers-card" aria-labelledby="triggers-title">
          <div className="triggers-header">
            <h2 id="triggers-title" className="card-title">
              Section 9: Trigger Buttons
            </h2>
            <span className="badge-spec">Callable by anyone</span>
          </div>
          <p className="card-desc">
            Solana programs cannot run on internal timers. Any member or bot can submit transactions when conditions are met.
          </p>

          <div className="triggers-action-list">
            {/* Button 1: Payout */}
            <div className="trigger-item">
              <button
                type="button"
                id="trigger-payout-btn"
                className={`trigger-action-btn ${canPayout ? 'btn-active-payout' : 'btn-disabled'}`}
                disabled={!canPayout}
                onClick={triggerPayout}
              >
                <Coins size={16} />
                Pay out to {nextRecipient ? nextRecipient.displayName : '[Next Member]'}
              </button>
              <div className="trigger-status-reason">
                {canPayout ? (
                  <span className="reason-text active">
                    <CheckCircle size={13} /> Active: All active members contributed for Period {circle.currentPeriod}
                  </span>
                ) : (
                  <span className="reason-text disabled">
                    <XCircle size={13} /> Disabled: Awaiting contributions or round completion
                  </span>
                )}
              </div>
            </div>

            {/* Button 2: Remove late member */}
            <div className="trigger-item">
              <button
                type="button"
                id="trigger-remove-defaulter-btn"
                className={`trigger-action-btn ${canRemoveLate ? 'btn-active-remove' : 'btn-disabled'}`}
                disabled={!canRemoveLate}
                onClick={triggerRemoveDefaulter}
              >
                <ShieldAlert size={16} />
                Remove late member
              </button>
              <div className="trigger-status-reason">
                {canRemoveLate ? (
                  <span className="reason-text active">
                    <CheckCircle size={13} /> Active: Dave missed deadline + grace; deposit covers shortfall
                  </span>
                ) : (
                  <span className="reason-text disabled">
                    <XCircle size={13} /> Disabled: No members past deadline + grace
                  </span>
                )}
              </div>
            </div>

            {/* Button 3: Start next round */}
            <div className="trigger-item">
              <button
                type="button"
                id="trigger-next-round-btn"
                className={`trigger-action-btn ${canStartNextRound ? 'btn-active-next-round' : 'btn-disabled'}`}
                disabled={!canStartNextRound}
                onClick={triggerStartNextRound}
              >
                <RotateCcw size={16} />
                Start next round
              </button>
              <div className="trigger-status-reason">
                {canStartNextRound ? (
                  <span className="reason-text active">
                    <CheckCircle size={13} /> Active: Final payout complete and filling window ended
                  </span>
                ) : (
                  <span className="reason-text disabled">
                    <XCircle size={13} /> Disabled: Round still in progress (Period {circle.currentPeriod} of {circle.totalPeriods})
                  </span>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Members Section (Who has paid, Who is next, Who is removed) */}
      <section className="card members-section" aria-labelledby="members-heading">
        <div className="card-header-row">
          <div>
            <h2 id="members-heading" className="card-title">
              Circle Members & Lineup ({circle.members.length} Slots)
            </h2>
            <p className="card-desc">
              Join order determines payout turn. Transparent on-chain records of contributions, payouts, and deposit balances.
            </p>
          </div>
          <div className="legend-pills">
            <span className="legend-item"><span className="legend-dot green"></span> Paid</span>
            <span className="legend-item"><span className="legend-dot purple"></span> Next Recipient</span>
            <span className="legend-item"><span className="legend-dot red"></span> Removed</span>
          </div>
        </div>

        <div className="members-grid">
          {circle.members.map((member) => {
            const isRemoved = member.status === 'removed';
            const isRecipient = member.isNextRecipient && member.status === 'active';

            return (
              <div
                key={member.slot}
                className={`member-card ${isRecipient ? 'card-recipient' : ''} ${
                  isRemoved ? 'card-removed' : ''
                }`}
              >
                <div className="member-card-header">
                  <div className="slot-badge-circle">
                    #{member.slot}
                  </div>
                  <div className="member-title-col">
                    <div className="member-display-name">
                      {member.displayName}
                      {isRecipient && <span className="tag-recipient">Next Pot</span>}
                      {member.hasBeenPaid && !isRecipient && (
                        <span className="tag-paidout">Paid in P1</span>
                      )}
                    </div>
                    <div className="member-wallet-row">
                      <Wallet size={12} />
                      <span className="member-wallet" title={member.fullAddress}>
                        {member.wallet}
                      </span>
                      <a
                        href={`https://explorer.solana.com/address/${member.fullAddress}?cluster=devnet`}
                        target="_blank"
                        rel="noreferrer"
                        className="explorer-link"
                        title="View address on Solana Explorer"
                      >
                        <ExternalLink size={12} />
                      </a>
                    </div>
                  </div>
                </div>

                <div className="member-card-body">
                  {/* Contribution Status */}
                  <div className="member-info-row">
                    <span className="info-label">Period {circle.currentPeriod} Status</span>
                    {isRemoved ? (
                      <span className="badge-status removed">
                        <XCircle size={13} /> Removed (Defaulted)
                      </span>
                    ) : member.hasContributedThisPeriod ? (
                      <span className="badge-status paid">
                        <CheckCircle size={13} /> Paid (10 {circle.token})
                      </span>
                    ) : (
                      <span className="badge-status pending">
                        <Clock size={13} /> Pending Contribution
                      </span>
                    )}
                  </div>

                  {/* Payout Status */}
                  <div className="member-info-row">
                    <span className="info-label">Payout Status</span>
                    {isRecipient ? (
                      <span className="badge-status next-recipient">
                        <Award size={13} /> Receiving Pot Now
                      </span>
                    ) : member.hasBeenPaid ? (
                      <span className="badge-status settled">
                        <CheckCircle size={13} /> Received 40 {circle.token}
                      </span>
                    ) : (
                      <span className="badge-status queue">
                        Turn: Slot {member.slot}
                      </span>
                    )}
                  </div>

                  {/* Deposit Locked */}
                  <div className="member-info-row">
                    <span className="info-label">Locked Deposit</span>
                    <span className="deposit-locked-val">
                      <strong>{member.depositRemaining}</strong> {circle.token}
                    </span>
                  </div>

                  {isRemoved && (
                    <div className="removal-explanation">
                      <AlertOctagon size={13} className="text-red" />
                      <span>Missed contribution deadline. Forfeits line; remaining deposit returned.</span>
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </section>

      {/* Section 8 & 9: Public Circle On-Chain Events Ledger ("Nobody Can Lie") */}
      <section className="card events-section" aria-labelledby="events-heading">
        <div className="card-header-row">
          <div>
            <h2 id="events-heading" className="card-title">
              <History size={18} className="text-accent" />
              On-Chain Activity Record ("Nobody Can Lie")
            </h2>
            <p className="card-desc">
              Events emitted on Solana Devnet for every action. Verifiable by anyone on the block explorer.
            </p>
          </div>
        </div>

        <div className="events-list">
          {circle.recentEvents.map((evt) => (
            <div key={evt.id} className="event-item">
              <div className="event-pill-col">
                <span className={`event-name-pill ${evt.event}`}>
                  {evt.event}
                </span>
                <span className="event-time">{evt.timestamp}</span>
              </div>
              <div className="event-desc-col">
                <span className="event-description">{evt.description}</span>
              </div>
              <div className="event-tx-col">
                <a
                  href={`https://explorer.solana.com/tx/${evt.txHash}?cluster=devnet`}
                  target="_blank"
                  rel="noreferrer"
                  className="tx-link"
                  title="View transaction on Solana Explorer"
                >
                  <code>{evt.txHash}</code>
                  <ExternalLink size={12} />
                </a>
              </div>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
};
