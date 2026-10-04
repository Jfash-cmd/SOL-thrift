import type { FC } from 'react';
import { useMemo, useState, useEffect } from 'react';
import { Clock } from 'lucide-react';
import type { RealCircleData, RealMemberData } from '../types';
import { formatTokenAmount } from '../types';

interface CircleRingProps {
  circle?: RealCircleData | null;
  members?: RealMemberData[];
  previewMembersTarget?: number;
  previewContribution?: string;
  previewDepositPct?: number;
  tokenSymbol?: string;
  tokenDecimals?: number;
  isPreview?: boolean;
}

function polarToCartesian(cx: number, cy: number, r: number, angleDeg: number) {
  const rad = (angleDeg * Math.PI) / 180;
  return {
    x: cx + r * Math.cos(rad),
    y: cy + r * Math.sin(rad),
  };
}

function describeArcSegment(
  cx: number,
  cy: number,
  rOuter: number,
  rInner: number,
  startAngle: number,
  endAngle: number
) {
  const p1 = polarToCartesian(cx, cy, rOuter, startAngle);
  const p2 = polarToCartesian(cx, cy, rOuter, endAngle);
  const p3 = polarToCartesian(cx, cy, rInner, endAngle);
  const p4 = polarToCartesian(cx, cy, rInner, startAngle);

  // Large arc flag is 0 because segment is always < 180 degrees (N >= 3)
  return `M ${p1.x} ${p1.y} A ${rOuter} ${rOuter} 0 0 1 ${p2.x} ${p2.y} L ${p3.x} ${p3.y} A ${rInner} ${rInner} 0 0 0 ${p4.x} ${p4.y} Z`;
}

export const CircleRing: FC<CircleRingProps> = ({
  circle,
  members = [],
  previewMembersTarget = 4,
  previewContribution = '10',
  previewDepositPct = 50,
  tokenSymbol = 'USDC',
  tokenDecimals = 6,
  isPreview = false,
}) => {
  const N = isPreview ? previewMembersTarget : circle ? circle.membersTarget : 4;
  const currentPeriod = circle?.currentPeriod || 0;
  const isCircleOpen = circle?.status === 'Open';
  const isCircleActive = circle?.status === 'Active';

  // Live countdown state for Active circles
  const [countdownStr, setCountdownStr] = useState<string>('');

  useEffect(() => {
    if (!circle || !isCircleActive) {
      setCountdownStr('');
      return;
    }

    const calcTime = () => {
      const startTime = Number(circle.periodStartTime.toString());
      const duration = Number(circle.periodDuration.toString());
      const deadline = startTime + duration;
      const nowSec = Math.floor(Date.now() / 1000);
      const diff = deadline - nowSec;

      if (diff <= 0) {
        setCountdownStr('Turn ended');
        return;
      }

      const hours = Math.floor(diff / 3600);
      const minutes = Math.floor((diff % 3600) / 60);
      const seconds = diff % 60;

      if (hours > 24) {
        const days = Math.floor(hours / 24);
        setCountdownStr(`${days}d ${hours % 24}h left`);
      } else if (hours > 0) {
        setCountdownStr(`${hours}h ${minutes}m left`);
      } else {
        setCountdownStr(`${minutes}m ${seconds}s left`);
      }
    };

    calcTime();
    const interval = setInterval(calcTime, 1000);
    return () => clearInterval(interval);
  }, [circle, isCircleActive]);

  // Determine recipient slot
  const recipientSlot = useMemo(() => {
    if (!circle || !isCircleActive || currentPeriod < 1 || currentPeriod > circle.orderLen) {
      return null;
    }
    return circle.payoutOrder[currentPeriod - 1];
  }, [circle, isCircleActive, currentPeriod]);

  // Center constants
  const cx = 200;
  const cy = 200;
  const rOuter = 158;
  const rInner = 126;
  const gapDeg = N <= 4 ? 4.5 : N <= 6 ? 3.5 : 2.5;
  const segmentAngle = 360 / N;

  // Build segments
  const segments = useMemo(() => {
    return Array.from({ length: N }, (_, i) => {
      const slot = i + 1;
      const startAngle = -90 + i * segmentAngle + gapDeg / 2;
      const endAngle = -90 + (i + 1) * segmentAngle - gapDeg / 2;
      const midAngle = (startAngle + endAngle) / 2;

      const pathData = describeArcSegment(cx, cy, rOuter, rInner, startAngle, endAngle);

      let state: 'paid' | 'waiting' | 'removed' | 'unfilled' = 'unfilled';

      if (isPreview) {
        // In preview mode: Slot 1 is Creator (paid), remaining are waiting
        state = slot === 1 ? 'paid' : 'waiting';
      } else if (circle) {
        const member = members.find((m) => m.slot === slot);
        if (member) {
          if (member.status === 'Removed') {
            state = 'removed';
          } else if (isCircleActive) {
            state = member.lastContributedPeriod === currentPeriod ? 'paid' : 'waiting';
          } else if (isCircleOpen) {
            state = 'paid'; // Joined and deposit locked
          } else {
            state = 'paid';
          }
        } else {
          state = isCircleOpen ? 'unfilled' : 'waiting';
        }
      }

      const isRecipient = isPreview ? slot === 1 : slot === recipientSlot;

      // Strike-through line coordinates if removed
      const strikeP1 = polarToCartesian(cx, cy, rInner - 4, midAngle - 3.5);
      const strikeP2 = polarToCartesian(cx, cy, rOuter + 4, midAngle + 3.5);

      // Recipient arrow/marker coordinates
      const markerPos = polarToCartesian(cx, cy, rOuter + 14, midAngle);
      const markerTip = polarToCartesian(cx, cy, rOuter + 5, midAngle);

      return {
        slot,
        pathData,
        state,
        isRecipient,
        strikeP1,
        strikeP2,
        markerPos,
        markerTip,
        midAngle,
      };
    });
  }, [
    N,
    segmentAngle,
    gapDeg,
    cx,
    cy,
    rOuter,
    rInner,
    isPreview,
    circle,
    members,
    recipientSlot,
    isCircleActive,
    isCircleOpen,
    currentPeriod,
  ]);

  // Center display calculations
  const centerPot = isPreview
    ? `${(parseFloat(previewContribution) * previewMembersTarget).toFixed(0)} ${tokenSymbol}`
    : circle && circle.contribution
    ? `${formatTokenAmount(circle.contribution.muln(circle.membersTarget), tokenDecimals)} ${tokenSymbol}`
    : '0 USDC';

  return (
    <div className="svg-ring-container" aria-label="Savings circle status ring">
      <svg
        viewBox="0 0 400 400"
        className="svg-ring-element ring-draw-in"
        role="img"
        aria-hidden="true"
      >
        <defs>
          <filter id="ring-glow" x="-20%" y="-20%" width="140%" height="140%">
            <feDropShadow dx="0" dy="0" stdDeviation="4" floodColor="#10b981" floodOpacity="0.4" />
          </filter>
        </defs>

        {/* Background track circle */}
        <circle
          cx={cx}
          cy={cy}
          r={(rOuter + rInner) / 2}
          fill="none"
          stroke="rgba(255, 255, 255, 0.03)"
          strokeWidth={rOuter - rInner}
        />

        {/* Member Segments */}
        {segments.map((seg) => {
          let fill = 'transparent';
          let stroke = 'rgba(255, 255, 255, 0.15)';
          let strokeDasharray: string | undefined = undefined;

          if (seg.state === 'paid') {
            fill = '#10b981';
            stroke = '#10b981';
          } else if (seg.state === 'waiting') {
            fill = 'transparent';
            stroke = '#f59e0b';
          } else if (seg.state === 'removed') {
            fill = 'rgba(239, 68, 68, 0.16)';
            stroke = '#ef4444';
          } else if (seg.state === 'unfilled') {
            fill = 'transparent';
            stroke = 'rgba(255, 255, 255, 0.20)';
            strokeDasharray = '5 4';
          }

          return (
            <g key={seg.slot} className="ring-segment-group">
              {/* Main Arc Segment */}
              <path
                d={seg.pathData}
                fill={fill}
                stroke={stroke}
                strokeWidth={seg.state === 'waiting' ? 2.5 : 2}
                strokeDasharray={strokeDasharray}
                className={`ring-segment ${seg.state}`}
              />

              {/* Struck-through line if removed */}
              {seg.state === 'removed' && (
                <line
                  x1={seg.strikeP1.x}
                  y1={seg.strikeP1.y}
                  x2={seg.strikeP2.x}
                  y2={seg.strikeP2.y}
                  stroke="#ef4444"
                  strokeWidth="3.5"
                  strokeLinecap="round"
                />
              )}

              {/* Next Pot Recipient Indicator */}
              {seg.isRecipient && (
                <g className="next-pot-indicator">
                  <circle
                    cx={seg.markerPos.x}
                    cy={seg.markerPos.y}
                    r="5"
                    fill="#c084fc"
                    stroke="#ffffff"
                    strokeWidth="1.5"
                  />
                  <line
                    x1={seg.markerPos.x}
                    y1={seg.markerPos.y}
                    x2={seg.markerTip.x}
                    y2={seg.markerTip.y}
                    stroke="#c084fc"
                    strokeWidth="2"
                    strokeLinecap="round"
                  />
                </g>
              )}
            </g>
          );
        })}

        {/* Center Circular Disc with Glass Highlight */}
        <circle
          cx={cx}
          cy={cy}
          r={rInner - 8}
          fill="rgba(11, 13, 12, 0.85)"
          stroke="rgba(255, 255, 255, 0.08)"
          strokeWidth="1"
        />

        {/* Faint Inner Ring Motif */}
        <circle
          cx={cx}
          cy={cy}
          r={rInner - 24}
          fill="none"
          stroke="rgba(255, 255, 255, 0.03)"
          strokeDasharray="4 6"
        />
      </svg>

      {/* HTML Center Overlay for Crisp Text & Countdown */}
      <div className="svg-ring-center-content">
        {isPreview ? (
          <>
            <span className="ring-center-sub">{previewMembersTarget} seats total</span>
            <div className="ring-center-title">{centerPot}</div>
            <span className="ring-center-tag">Deposit {previewDepositPct}%</span>
          </>
        ) : isCircleOpen ? (
          <>
            <span className="ring-center-sub">Pot each turn: {centerPot}</span>
            <div className="ring-center-title" style={{ fontSize: '1.25rem', lineHeight: '1.25', margin: '4px 0' }}>
              {circle ? `${circle.currentMemberCount} of ${circle.membersTarget} seats filled` : 'Open: waiting for members'}
            </div>
            <span className="ring-center-tag">Deposit: {circle?.depositPct}%</span>
          </>
        ) : isCircleActive ? (
          <>
            <span className="ring-center-sub">
              Turn {circle?.currentPeriod} of {circle?.orderLen || circle?.membersTarget}
            </span>
            <div className="ring-center-title">{centerPot}</div>
            <div className="ring-center-countdown">
              <Clock size={12} style={{ display: 'inline', marginRight: '4px' }} />
              {countdownStr || 'Turn in progress'}
            </div>
          </>
        ) : (
          <>
            <span className="ring-center-sub">Status: {circle?.status === 'Closing' ? 'Ending: refunds are open' : circle?.status === 'Closed' ? 'Closed' : circle?.status}</span>
            <div className="ring-center-title">{centerPot}</div>
            <span className="ring-center-tag">All turns finished</span>
          </>
        )}
      </div>
    </div>
  );
};
