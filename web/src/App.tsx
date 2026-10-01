import type { FC } from 'react';
import { useState } from 'react';
import { WalletContextProvider } from './components/WalletContextProvider';
import { Navbar } from './components/Navbar';
import { CircleView } from './components/CircleView';
import { CreateCircle } from './components/CreateCircle';
import { ShieldCheck, BookOpen, ExternalLink } from 'lucide-react';

export const AppContent: FC = () => {
  const [activeTab, setActiveTab] = useState<'circle' | 'create'>('circle');

  return (
    <div className="app-shell">
      {/* Top Navigation */}
      <Navbar activeTab={activeTab} setActiveTab={setActiveTab} />

      {/* Main Content Area */}
      <main className="main-content">
        {activeTab === 'circle' ? (
          <CircleView />
        ) : (
          <CreateCircle onCreated={() => setActiveTab('circle')} />
        )}
      </main>

      {/* Footer */}
      <footer className="site-footer">
        <div className="footer-container">
          <div className="footer-left">
            <div className="footer-brand">
              <ShieldCheck size={18} className="text-accent" />
              <span>Solthrift</span>
            </div>
            <p className="footer-text">
              Decentralized, non-custodial rotating savings circle (ajo/thrift) on Solana.
              Rules enforced by code. No person or company holds the money.
            </p>
          </div>

          <div className="footer-right">
            <div className="footer-links">
              <span className="footer-links-title">Resources & Spec</span>
              <a
                href="#spec"
                onClick={(e) => {
                  e.preventDefault();
                  alert('This build strictly follows docs/solthrift-spec.md located in the root repository.');
                }}
                className="footer-link"
              >
                <BookOpen size={14} />
                docs/solthrift-spec.md
              </a>
              <a
                href="https://explorer.solana.com/?cluster=devnet"
                target="_blank"
                rel="noreferrer"
                className="footer-link"
              >
                <ExternalLink size={14} />
                Solana Devnet Explorer
              </a>
            </div>
          </div>
        </div>
        <div className="footer-bottom-bar">
          <span>Devnet Only • Mock Data Demo • All keys and test tokens must never be exposed or requested without approval.</span>
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
