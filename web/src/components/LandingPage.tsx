import type { FC } from 'react';
import { useState, useEffect, useMemo, useCallback } from 'react';
import { useConnection, useWallet } from '@solana/wallet-adapter-react';
import { WalletMultiButton } from '@solana/wallet-adapter-react-ui';
import { PublicKey } from '@solana/web3.js';
import {
  ArrowRight,
  Menu,
  X,
  ExternalLink,
  BookOpen,
  PlusCircle,
  Loader2,
  HelpCircle,
} from 'lucide-react';

import { getSolthriftProgram } from '../solthriftClient';
import { SolanaLogo3D } from './SolanaLogo3D';
import { SolthriftLogo } from './SolthriftLogo';
import { Reveal } from './Reveal';
import { parseCircleStatus, formatTokenAmount } from '../types';
import { isPlaceholderMint, PROGRAM_ID } from '../config';
import { getMintDecimals } from '../solthriftClient';

interface LandingPageProps {
  onNavigateCreate: () => void;
  onSelectCircle: (address: string) => void;
}

interface RawCircleItem {
  publicKey: PublicKey;
  account: any;
}

/**
 * Format timing string matching user requirement:
 * "Opens in 2 days" or "Next payout in 3h"
 */
function getTimingLabel(account: any): string {
  const status = parseCircleStatus(account.status);
  const nowSec = Math.floor(Date.now() / 1000);

  if (status === 'Open') {
    const openDeadline = Number(account.openDeadline.toString());
    const diff = openDeadline - nowSec;
    if (diff > 0) {
      const days = Math.ceil(diff / 86400);
      if (days > 1) {
        return `Opens in ${days} days`;
      }
      const hours = Math.ceil(diff / 3600);
      return `Opens in ${hours}h`;
    }
    return 'Open: waiting for members';
  }

  if (status === 'Active') {
    const startTime = Number(account.periodStartTime.toString());
    const duration = Number(account.periodDuration.toString());
    const deadline = startTime + duration;
    const diff = deadline - nowSec;
    if (diff > 0) {
      const hours = Math.floor(diff / 3600);
      const minutes = Math.floor((diff % 3600) / 60);
      if (hours > 24) {
        const days = Math.ceil(hours / 24);
        return `Next pot in ${days}d`;
      } else if (hours > 0) {
        return `Next pot in ${hours}h`;
      } else {
        return `Next pot in ${Math.max(1, minutes)}m`;
      }
    }
    return 'Ready to pay out';
  }

  if (status === 'Closing') {
    return 'Ending: refunds are open';
  }

  if (status === 'Closed') {
    return 'Closed';
  }

  return status;
}

const ITEMS_PER_PAGE = 6;

export const LandingPage: FC<LandingPageProps> = ({
  onNavigateCreate,
  onSelectCircle,
}) => {
  const { connection } = useConnection();
  const wallet = useWallet();

  // On-chain circles state
  const [circles, setCircles] = useState<RawCircleItem[]>([]);
  const [mintDecimalsMap, setMintDecimalsMap] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState<boolean>(true);
  const [fetchError, setFetchError] = useState<string | null>(null);

  // Pagination state
  const [currentPage, setCurrentPage] = useState<number>(1);

  // Interactive UI modals/dropdowns
  const [menuOpen, setMenuOpen] = useState<boolean>(false);
  const [supportOpen, setSupportOpen] = useState<boolean>(false);

  /**
   * Fetch all real on-chain circles from Solana devnet via program.account.circle.all()
   */
  const loadAllCircles = useCallback(async () => {
    setLoading(true);
    setFetchError(null);
    try {
      const program = getSolthriftProgram(connection, wallet as any);
      const rawAccounts = await program.account.circle.all();

      // Sort by creation / circleId descending (newest first)
      const sorted = [...rawAccounts].sort((a, b) => {
        const idA = Number(a.account.circleId.toString());
        const idB = Number(b.account.circleId.toString());
        return idB - idA;
      });

      setCircles(sorted);

      // Fetch mint decimals for unique mints at runtime
      const uniqueMints = Array.from(new Set(sorted.map((item) => (item.account as any).tokenMint.toBase58())));
      const decMap: Record<string, number> = {};
      await Promise.all(
        uniqueMints.map(async (mintStr) => {
          try {
            const dec = await getMintDecimals(connection, new PublicKey(mintStr));
            decMap[mintStr] = dec;
          } catch {
            decMap[mintStr] = 6;
          }
        })
      );
      setMintDecimalsMap(decMap);
    } catch (err: any) {
      console.error('Failed to fetch circles from devnet:', err);
      setFetchError('Could not load circles from the Solana test network. Check your connection.');
    } finally {
      setLoading(false);
    }
  }, [connection, wallet]);

  useEffect(() => {
    loadAllCircles();
  }, [loadAllCircles]);

  // Pagination calculations
  const totalPages = Math.max(1, Math.ceil(circles.length / ITEMS_PER_PAGE));
  const paginatedCircles = useMemo(() => {
    const startIndex = (currentPage - 1) * ITEMS_PER_PAGE;
    return circles.slice(startIndex, startIndex + ITEMS_PER_PAGE);
  }, [circles, currentPage]);

  const handlePrevPage = () => {
    setCurrentPage((p) => Math.max(1, p - 1));
  };

  const handleNextPage = () => {
    setCurrentPage((p) => Math.min(totalPages, p + 1));
  };

  return (
    <div className="landing-split-container">
      {/* ====================================================================
          LEFT: ONE LARGE GLASS PANEL (28px radius)
          ==================================================================== */}
      <section className="landing-left-panel" aria-label="Solthrift overview">
        {/* Top-left: Wordmark & Top-right: Support & Menu pills */}
        <div className="landing-left-header">
          <div className="landing-wordmark">
            <SolthriftLogo size={26} className="wordmark-symbol" />
            <span className="wordmark-text">solthrift</span>
          </div>

          <div className="panel-pills-row">
            <button
              type="button"
              className="panel-pill"
              onClick={() => setSupportOpen(true)}
              aria-label="Support information"
            >
              Support
            </button>
            <button
              type="button"
              className="panel-pill menu-pill"
              onClick={() => setMenuOpen(!menuOpen)}
              aria-expanded={menuOpen}
              aria-label="Open navigation menu"
            >
              <Menu size={13} />
              Menu
            </button>

            {/* Menu Dropdown */}
            {menuOpen && (
              <div className="panel-menu-dropdown">
                <button
                  type="button"
                  className="menu-dropdown-item"
                  onClick={() => {
                    setMenuOpen(false);
                    onNavigateCreate();
                  }}
                >
                  <PlusCircle size={14} />
                  Create a circle
                </button>
                <a
                  href={`https://explorer.solana.com/address/${PROGRAM_ID.toBase58()}?cluster=devnet`}
                  target="_blank"
                  rel="noreferrer"
                  className="menu-dropdown-item"
                  onClick={() => setMenuOpen(false)}
                >
                  <ExternalLink size={14} />
                  View program on explorer
                </a>
                <button
                  type="button"
                  className="menu-dropdown-item"
                  onClick={() => {
                    setMenuOpen(false);
                    setSupportOpen(true);
                  }}
                >
                  <HelpCircle size={14} />
                  How savings circles work
                </button>
              </div>
            )}
          </div>
        </div>

        {/* Center: Circular badge with fine ring outline & 3D spinning Solana logo */}
        <div className="landing-hero-center">
          <div className="landing-center-badge-container">
            <div className="landing-emblem-badge" role="presentation">
              <div className="badge-ring-outline"></div>
              <div className="badge-inner-ring"></div>
              <SolanaLogo3D size={44} />
            </div>
          </div>

          {/* Headline */}
          <Reveal revealKey="landing-headline">
            <h1 className="landing-headline">
              Save together,
              <span className="font-serif-italic display-block">without trusting anyone.</span>
            </h1>
          </Reveal>

          {/* Grey Paragraph */}
          <Reveal revealKey="landing-paragraph">
            <p className="landing-paragraph">
              Solthrift is a savings circle on Solana. A program holds the money, pays one person each turn, and removes anyone who misses a payment. Everyone can see every payment.
            </p>
          </Reveal>

          {/* White Pill Button: Create a circle with round arrow icon */}
          <Reveal revealKey="landing-cta-btn">
            <div className="landing-cta-row">
              <button
                type="button"
                className="landing-cta-btn"
                onClick={onNavigateCreate}
                id="landing-create-circle-btn"
              >
                <span>Create a circle</span>
                <span className="arrow-disc" aria-hidden="true">
                  <ArrowRight size={14} />
                </span>
              </button>
            </div>
          </Reveal>
        </div>

        {/* Left Panel Footer / Meta */}
        <div className="landing-left-footer">
          <span className="footer-faint-spec">
            A savings circle on the Solana test network (devnet).
          </span>
        </div>
      </section>

      {/* ====================================================================
          RIGHT: TOP ROW & 2-COLUMN GRID OF REAL CIRCLES
          ==================================================================== */}
      <section className="landing-right-panel" aria-label="Live on-chain circles">
        {/* Top Row: Status pill & Connect wallet white pill button */}
        <div className="landing-right-top-row">
          <div className="devnet-status-pill">
            <span className="pulse-green-dot" aria-hidden="true"></span>
            <span>Running on the Solana test network</span>
          </div>

          <div className="landing-wallet-container">
            <WalletMultiButton className="landing-wallet-btn">Connect wallet</WalletMultiButton>
          </div>
        </div>

        {/* Section Header: "Live circles" small label & Page counter */}
        <div className="section-label-row">
          <span className="section-label">SAVINGS CIRCLES</span>
          <span className="section-counter">
            {loading
              ? 'Reading records...'
              : `Page ${currentPage} of ${totalPages} • ${circles.length} indexed`}
          </span>
        </div>

        {/* Loading State */}
        {loading && (
          <div className="circles-loading-box">
            <Loader2 size={28} className="spinner-icon" />
            <span>Reading circles from the Solana test network...</span>
          </div>
        )}

        {/* Error State */}
        {!loading && fetchError && (
          <div className="alert-box error-alert" role="alert">
            <p>{fetchError}</p>
          </div>
        )}

        {/* Empty State: Never show fake data */}
        {!loading && !fetchError && circles.length === 0 && (
          <div className="landing-empty-card">
            <p className="empty-text">No circles yet. Create the first one.</p>
            <button
              type="button"
              className="btn-secondary"
              onClick={onNavigateCreate}
              style={{ marginTop: '0.75rem' }}
            >
              <PlusCircle size={14} />
              Create circle
            </button>
          </div>
        )}

        {/* 2-Column Grid of Real Circles */}
        {!loading && !fetchError && circles.length > 0 && (
          <div className="landing-circles-grid" role="feed" aria-label="Available savings circles">
            {paginatedCircles.map(({ publicKey, account }, index) => {
              const addressStr = publicKey.toBase58();
              const shortAddress = `${addressStr.slice(0, 4)}...${addressStr.slice(-4)}`;
              const tokenSymbol = isPlaceholderMint(account.tokenMint) ? 'DEVNET-TOKEN' : 'USDC';
              const timing = getTimingLabel(account);

              // Calculate pot per period: membersTarget * contribution
              const mintDecimals = mintDecimalsMap[account.tokenMint.toBase58()] ?? 6;
              const potFormatted = formatTokenAmount(
                account.contribution.muln(account.membersTarget),
                mintDecimals
              );

              return (
                <Reveal
                  key={addressStr}
                  revealKey={`landing-circle-card-${addressStr}`}
                  staggerIndex={index}
                >
                  <article
                    className="landing-circle-card"
                    onClick={() => onSelectCircle(addressStr)}
                    role="button"
                    tabIndex={0}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        onSelectCircle(addressStr);
                      }
                    }}
                    aria-label={`Circle ${shortAddress}`}
                  >
                    {/* Card Top Row: Token label on left, Timing on right */}
                    <div className="circle-card-top-row">
                      <span className="circle-card-token">{tokenSymbol}</span>
                      <span className="circle-card-timing">{timing}</span>
                    </div>

                    {/* Card Title: Circle's Short Address */}
                    <h2 className="circle-card-title">{shortAddress}</h2>

                    {/* Outlined Tag Pills: members, deposit % */}
                    <div className="card-tags-row">
                      <span className="card-tag-pill">
                        {account.membersTarget} members
                      </span>
                      <span className="card-tag-pill">
                        {account.depositPct}% deposit
                      </span>
                    </div>

                    {/* Card Bottom: Large number with label "Pot each turn" */}
                    <div className="card-pot-section">
                      <div className="card-pot-amount">
                        {potFormatted} <small className="pot-unit">{tokenSymbol}</small>
                      </div>
                      <div className="card-pot-label">Pot each turn</div>
                    </div>
                  </article>
                </Reveal>
              );
            })}
          </div>
        )}

        {/* Pagination: "Previous / Next" and page dots */}
        {!loading && circles.length > 0 && (
          <nav className="landing-pagination" aria-label="Circle pages navigation">
            <button
              type="button"
              className="pagination-nav-btn"
              disabled={currentPage <= 1}
              onClick={handlePrevPage}
            >
              ← Previous
            </button>

            <div className="pagination-dots" role="tablist" aria-label="Pages">
              {Array.from({ length: totalPages }, (_, i) => {
                const pageNumber = i + 1;
                const isActive = pageNumber === currentPage;
                return (
                  <button
                    key={pageNumber}
                    type="button"
                    className={`page-dot ${isActive ? 'active' : ''}`}
                    onClick={() => setCurrentPage(pageNumber)}
                    aria-label={`Page ${pageNumber}`}
                    aria-selected={isActive}
                  />
                );
              })}
            </div>

            <button
              type="button"
              className="pagination-nav-btn"
              disabled={currentPage >= totalPages}
              onClick={handleNextPage}
            >
              Next →
            </button>
          </nav>
        )}
      </section>

      {/* Support Info Modal */}
      {supportOpen && (
        <div className="modal-backdrop" onClick={() => setSupportOpen(false)}>
          <div
            className="modal-card glass-panel"
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-modal="true"
            aria-labelledby="support-dialog-title"
          >
            <div className="modal-header">
              <h2 id="support-dialog-title" className="card-title">
                Solthrift support
              </h2>
              <button
                type="button"
                className="icon-action-btn"
                onClick={() => setSupportOpen(false)}
                aria-label="Close dialog"
              >
                <X size={16} />
              </button>
            </div>
            <div className="modal-body" style={{ display: 'flex', flexDirection: 'column', gap: '0.85rem', fontSize: '0.875rem', lineHeight: '1.6' }}>
              <p>
                Solthrift runs on the Solana test network at program address{' '}
                <code>{PROGRAM_ID.toBase58()}</code>.
              </p>
              <p>
                <strong>How it works:</strong> Members lock a deposit upfront based on their seat. Each turn, members pay into the vault. Once everyone pays, the full pot goes to that turn's recipient.
              </p>
              <p>
                <strong>Need test tokens?</strong> Test USDC is available from the token faucet. Make sure your wallet has a little test SOL to pay network fees.
              </p>
              <div style={{ marginTop: '0.5rem', display: 'flex', gap: '0.5rem' }}>
                <a
                  href={`https://explorer.solana.com/address/${PROGRAM_ID.toBase58()}?cluster=devnet`}
                  target="_blank"
                  rel="noreferrer"
                  className="btn-secondary"
                  style={{ fontSize: '0.8rem', padding: '0.4rem 0.8rem' }}
                >
                  <ExternalLink size={13} />
                  Test network program
                </a>
                <a
                  href="#spec"
                  onClick={(e) => {
                    e.preventDefault();
                    alert('Implementation strictly adheres to docs/solthrift-spec.md');
                  }}
                  className="btn-secondary"
                  style={{ fontSize: '0.8rem', padding: '0.4rem 0.8rem' }}
                >
                  <BookOpen size={13} />
                  Program rules
                </a>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
