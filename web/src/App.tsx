import type { FC } from 'react';
import { useState, useEffect, useCallback } from 'react';
import { WalletContextProvider, useWalletError } from './components/WalletContextProvider';
import { Navbar } from './components/Navbar';
import { CircleView } from './components/CircleView';
import { CreateCircle } from './components/CreateCircle';
import { LandingPage } from './components/LandingPage';
import { PlanetBackdrop } from './components/PlanetBackdrop';
import { SolthriftLogo } from './components/SolthriftLogo';
import { BookOpen, ExternalLink, AlertCircle, X } from 'lucide-react';

interface RouteState {
  tab: 'home' | 'circle' | 'create';
  circleAddress: string | null;
}

function parseCurrentRoute(): RouteState {
  if (typeof window === 'undefined') {
    return { tab: 'home', circleAddress: null };
  }

  const path = window.location.pathname;
  const hash = window.location.hash;

  // 1. Check pathname: /circle/<pubkey>
  const pathMatch = path.match(/^\/circle\/([A-Za-z0-9]+)/);
  if (pathMatch) {
    return { tab: 'circle', circleAddress: pathMatch[1] };
  }

  // 2. Check hash: #/circle/<pubkey>
  const hashMatch = hash.match(/^#\/circle\/([A-Za-z0-9]+)/);
  if (hashMatch) {
    return { tab: 'circle', circleAddress: hashMatch[1] };
  }

  // 3. Check /create or #/create
  if (path === '/create' || hash === '#/create') {
    return { tab: 'create', circleAddress: null };
  }

  // Default: Landing page (home route)
  return { tab: 'home', circleAddress: null };
}

const WalletErrorBanner: FC = () => {
  const { walletError, clearWalletError } = useWalletError();

  if (!walletError) return null;

  return (
    <div className="wallet-error-banner-wrapper">
      <div
        className="alert-box error-alert"
        role="alert"
        style={{ justifyContent: 'space-between', width: '100%', boxSizing: 'border-box' }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
          <AlertCircle size={18} style={{ flexShrink: 0 }} />
          <span>{walletError}</span>
        </div>
        <button
          type="button"
          onClick={clearWalletError}
          className="icon-action-btn"
          aria-label="Dismiss message"
          style={{ width: '28px', height: '28px', minWidth: '28px' }}
        >
          <X size={14} />
        </button>
      </div>
    </div>
  );
};

export const AppContent: FC = () => {
  const [route, setRoute] = useState<RouteState>(parseCurrentRoute);

  useEffect(() => {
    const handlePopState = () => {
      setRoute(parseCurrentRoute());
    };
    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, []);

  const navigateTo = useCallback((urlPath: string) => {
    window.history.pushState({}, '', urlPath);
    setRoute(parseCurrentRoute());
  }, []);

  return (
    <div className="app-shell">
      {/* Fixed Saturn Planetary Backdrop */}
      <PlanetBackdrop routeTab={route.tab} />

      {/* Top Navigation shown on subpages (/circle, /create) */}
      {route.tab !== 'home' && (
        <Navbar
          activeTab={route.tab === 'create' ? 'create' : 'circle'}
          onNavigate={(tab) => {
            if (tab === 'home') {
              navigateTo('/');
            } else if (tab === 'create') {
              navigateTo('/create');
            } else {
              if (route.circleAddress) {
                navigateTo(`/circle/${route.circleAddress}`);
              } else {
                navigateTo('/');
              }
            }
          }}
        />
      )}

      {/* Plain-English Wallet Connection Error Message */}
      <WalletErrorBanner />

      {/* Main Content Area */}
      <main className={route.tab === 'home' ? 'main-content-landing' : 'main-content'}>
        {route.tab === 'home' ? (
          <LandingPage
            onNavigateCreate={() => navigateTo('/create')}
            onSelectCircle={(addr) => navigateTo(`/circle/${addr}`)}
          />
        ) : route.tab === 'circle' ? (
          <CircleView
            circleAddress={route.circleAddress}
            onSelectCircle={(addr) => navigateTo(`/circle/${addr}`)}
            onNavigateCreate={() => navigateTo('/create')}
          />
        ) : (
          <CreateCircle
            onCreated={(newCircleAddress) => {
              if (newCircleAddress) {
                navigateTo(`/circle/${newCircleAddress}`);
              } else {
                navigateTo('/');
              }
            }}
          />
        )}
      </main>

      {/* Footer */}
      <footer className="site-footer">
        <div className="footer-container">
          <div className="footer-left">
            <div className="footer-brand">
              <SolthriftLogo size={18} className="text-accent" />
              <span>Solthrift</span>
            </div>
            <p className="footer-text">
              Savings circle on the Solana test network (devnet). Program rules hold the money, pay out each turn, and remove late members. No person or company holds the money.
            </p>
          </div>

          <div className="footer-right">
            <div className="footer-links">
              <span className="footer-links-title">Resources & Spec</span>
              <a
                href="#spec"
                onClick={(e) => {
                  e.preventDefault();
                  alert('This web build strictly follows docs/solthrift-spec.md and program/lib.rs.');
                }}
                className="footer-link"
              >
                <BookOpen size={14} />
                docs/solthrift-spec.md
              </a>
              <a
                href="https://explorer.solana.com/address/CfY1M7cdgv1AvkLPuquqbCPNxMz73icdukWQP2sKdPq4?cluster=devnet"
                target="_blank"
                rel="noreferrer"
                className="footer-link"
              >
                <ExternalLink size={14} />
                Solthrift Program on Explorer
              </a>
            </div>
          </div>
        </div>
        <div className="footer-bottom-bar">
          <span>Solana test network (devnet) only • Program CfY1M7cdgv1AvkLPuquqbCPNxMz73icdukWQP2sKdPq4 • No private keys are ever stored or exposed.</span>
        </div>
      </footer>
    </div>
  );
};

export default function App() {
  return (
    <WalletContextProvider>
      <AppContent />
    </WalletContextProvider>
  );
}
