import type { FC } from 'react';
import { useWallet } from '@solana/wallet-adapter-react';
import { WalletMultiButton } from '@solana/wallet-adapter-react-ui';
import { SolthriftLogo } from './SolthriftLogo';

interface NavbarProps {
  activeTab: 'home' | 'circle' | 'create';
  setActiveTab?: (tab: 'home' | 'circle' | 'create') => void;
  onNavigate?: (tab: 'home' | 'circle' | 'create') => void;
}

export const Navbar: FC<NavbarProps> = ({ activeTab, setActiveTab, onNavigate }) => {
  const { publicKey } = useWallet();

  const handleNav = (tab: 'home' | 'circle' | 'create') => {
    if (onNavigate) {
      onNavigate(tab);
    } else if (setActiveTab) {
      setActiveTab(tab);
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
          <div className="wallet-adapter-wrapper">
            <WalletMultiButton className="custom-wallet-btn">
              {publicKey ? undefined : 'Connect wallet'}
            </WalletMultiButton>
          </div>
        </div>
      </div>
    </header>
  );
};
