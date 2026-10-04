import type { FC } from 'react';
import { useState } from 'react';
import { useWallet } from '@solana/wallet-adapter-react';
import { WalletMultiButton } from '@solana/wallet-adapter-react-ui';
import { Copy, Check, ExternalLink } from 'lucide-react';
import { SolthriftLogo } from './SolthriftLogo';

interface NavbarProps {
  activeTab: 'home' | 'circle' | 'create';
  setActiveTab?: (tab: 'home' | 'circle' | 'create') => void;
  onNavigate?: (tab: 'home' | 'circle' | 'create') => void;
}

export const Navbar: FC<NavbarProps> = ({ activeTab, setActiveTab, onNavigate }) => {
  const { publicKey, disconnect, connected } = useWallet();
  const [copied, setCopied] = useState(false);

  const handleNav = (tab: 'home' | 'circle' | 'create') => {
    if (onNavigate) {
      onNavigate(tab);
    } else if (setActiveTab) {
      setActiveTab(tab);
    }
  };

  const shortenedAddress = publicKey
    ? `${publicKey.toBase58().slice(0, 4)}...${publicKey.toBase58().slice(-4)}`
    : null;

  const handleCopy = () => {
    if (publicKey) {
      navigator.clipboard.writeText(publicKey.toBase58());
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  return (
    <header className="site-header">
      <div className="header-container">
        {/* Brand / Logo */}
        <div className="brand-group" onClick={() => handleNav('home')} style={{ cursor: 'pointer' }}>
          <div className="brand-icon">
            <SolthriftLogo size={22} className="brand-icon-svg" />
          </div>
          <div className="brand-text">
            <span className="brand-name">Solthrift</span>
            <span className="badge-devnet">Test network (devnet)</span>
          </div>
        </div>

        {/* Navigation Tabs */}
        <nav className="nav-links">
          <button
            type="button"
            className={`nav-btn ${activeTab === 'circle' ? 'active' : ''}`}
            onClick={() => handleNav('circle')}
            id="nav-tab-circle"
          >
            Circle
          </button>
          <button
            type="button"
            className={`nav-btn ${activeTab === 'create' ? 'active' : ''}`}
            onClick={() => handleNav('create')}
            id="nav-tab-create"
          >
            Create circle
          </button>
        </nav>

        {/* Wallet Connection */}
        <div className="wallet-header-area">
          {connected && publicKey ? (
            <div className="connected-wallet-box">
              <div className="wallet-chip" title={publicKey.toBase58()}>
                <span className="status-dot green"></span>
                <span className="wallet-address" id="shortened-wallet-address">{shortenedAddress}</span>
                <button
                  type="button"
                  className="icon-action-btn"
                  onClick={handleCopy}
                  title="Copy full public key"
                  aria-label="Copy public key"
                >
                  {copied ? <Check size={14} className="text-green" /> : <Copy size={14} />}
                </button>
                <a
                  href={`https://explorer.solana.com/address/${publicKey.toBase58()}?cluster=devnet`}
                  target="_blank"
                  rel="noreferrer"
                  className="icon-action-btn"
                  title="View on Solana Explorer"
                >
                  <ExternalLink size={14} />
                </a>
              </div>
              <button
                type="button"
                className="disconnect-btn"
                onClick={() => disconnect()}
                title="Disconnect wallet"
              >
                Disconnect
              </button>
            </div>
          ) : (
            <div className="wallet-adapter-wrapper">
              <WalletMultiButton className="custom-wallet-btn">Connect wallet</WalletMultiButton>
            </div>
          )}
        </div>
      </div>
    </header>
  );
};
