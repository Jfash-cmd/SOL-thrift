import type { FC, CSSProperties } from 'react';
import { useState, useRef, useEffect, useCallback } from 'react';
import { useWallet } from '@solana/wallet-adapter-react';
import { useWalletModal } from '@solana/wallet-adapter-react-ui';
import { useWalletError } from './WalletContextProvider';

interface CustomWalletButtonProps {
  className?: string;
  style?: CSSProperties;
}

export const CustomWalletButton: FC<CustomWalletButtonProps> = ({ className = '', style }) => {
  const {
    wallet,
    wallets,
    select,
    connect,
    disconnect,
    connecting,
    connected,
    publicKey,
  } = useWallet();
  const { setVisible } = useWalletModal();
  const { setWalletError, clearWalletError } = useWalletError();

  const [menuOpen, setMenuOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const attemptedWalletRef = useRef<string | null>(null);

  // Auto-connect effect: when a wallet is selected and not connected, connect automatically
  // so one click on the Phantom row in the modal is enough
  useEffect(() => {
    const currentName = wallet?.adapter.name ?? null;
    if (currentName && !connected && !connecting) {
      if (attemptedWalletRef.current !== currentName) {
        attemptedWalletRef.current = currentName;
        clearWalletError();
        connect().catch((err) => {
          console.error('Wallet auto-connect failed:', err);
        });
      }
    } else if (!wallet) {
      attemptedWalletRef.current = null;
    }
  }, [wallet, connected, connecting, connect, clearWalletError]);

  // Close dropdown on outside click or escape key
  useEffect(() => {
    if (!menuOpen) return;
    const handleOutsideClick = (event: MouseEvent | TouchEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setMenuOpen(false);
      }
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setMenuOpen(false);
      }
    };
    document.addEventListener('mousedown', handleOutsideClick);
    document.addEventListener('touchstart', handleOutsideClick);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('mousedown', handleOutsideClick);
      document.removeEventListener('touchstart', handleOutsideClick);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [menuOpen]);

  // Click on trigger button
  const handleTriggerClick = useCallback(() => {
    clearWalletError();
    if (!connected) {
      if (wallets.length === 0) {
        setWalletError('No wallet found. Install Phantom or Solflare, then reload this page.');
      }
      attemptedWalletRef.current = null;
      setVisible(true);
    } else {
      setMenuOpen((prev) => !prev);
    }
  }, [connected, wallets.length, setWalletError, clearWalletError, setVisible]);

  // Dropdown action: Copy address
  const handleCopyAddress = useCallback(async () => {
    if (!publicKey) return;
    try {
      await navigator.clipboard.writeText(publicKey.toBase58());
      setCopied(true);
      setTimeout(() => setCopied(false), 600);
    } catch (err) {
      console.error('Failed to copy address:', err);
    }
  }, [publicKey]);

  // Dropdown action: Change wallet
  const handleChangeWallet = useCallback(() => {
    setMenuOpen(false);
    attemptedWalletRef.current = null;
    setVisible(true);
  }, [setVisible]);

  // Dropdown action: Disconnect
  const handleDisconnect = useCallback(async () => {
    setMenuOpen(false);
    try {
      await disconnect();
    } catch (err) {
      console.error('Failed to disconnect:', err);
    }
    try {
      select(null as any);
    } catch {}
    attemptedWalletRef.current = null;
  }, [disconnect, select]);

  // Format short address: e.g. 7abc...9xyz
  const base58 = publicKey?.toBase58();
  const shortAddress = base58 ? `${base58.slice(0, 4)}...${base58.slice(-4)}` : '';

  // Determine button label:
  // - no wallet chosen: "Connect wallet"
  // - wallet chosen but not connected / connecting: "Connecting..."
  // - connected: short address with status dot
  let buttonLabel = 'Connect wallet';
  if (connected && shortAddress) {
    buttonLabel = shortAddress;
  } else if (connecting || (wallet && !connected)) {
    buttonLabel = 'Connecting...';
  } else {
    buttonLabel = 'Connect wallet';
  }

  return (
    <div className="wallet-adapter-dropdown" ref={dropdownRef} style={style}>
      <button
        type="button"
        className={`wallet-adapter-button wallet-adapter-button-trigger ${className}`}
        onClick={handleTriggerClick}
        aria-expanded={menuOpen}
        disabled={connecting && !wallet}
      >
        {connected && wallet?.adapter.icon ? (
          <i className="wallet-adapter-button-start-icon">
            <img src={wallet.adapter.icon} alt={`${wallet.adapter.name} icon`} />
          </i>
        ) : null}
        <span>{buttonLabel}</span>
      </button>

      {connected && menuOpen && (
        <ul className="wallet-adapter-dropdown-list wallet-adapter-dropdown-list-active" role="menu">
          <li
            className="wallet-adapter-dropdown-list-item"
            role="menuitem"
            onClick={handleCopyAddress}
          >
            {copied ? 'Copied' : 'Copy address'}
          </li>
          <li
            className="wallet-adapter-dropdown-list-item"
            role="menuitem"
            onClick={handleChangeWallet}
          >
            Change wallet
          </li>
          <li
            className="wallet-adapter-dropdown-list-item"
            role="menuitem"
            onClick={handleDisconnect}
          >
            Disconnect
          </li>
        </ul>
      )}
    </div>
  );
};
