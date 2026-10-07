import type { FC, CSSProperties } from 'react';
import { useState, useRef, useEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { useWallet } from '@solana/wallet-adapter-react';
import { useWalletModal } from '@solana/wallet-adapter-react-ui';
import { Copy, Check, RefreshCw, LogOut, ExternalLink, X } from 'lucide-react';
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
  useEffect(() => {
    const currentName = wallet?.adapter.name ?? null;
    if (currentName && !connected && !connecting) {
      if (attemptedWalletRef.current !== currentName) {
        attemptedWalletRef.current = currentName;
        clearWalletError();
        connect().catch((err) => {
          console.warn('Wallet connect note:', err?.message || err);
          attemptedWalletRef.current = null;
        });
      }
    } else if (!wallet) {
      attemptedWalletRef.current = null;
    }
  }, [wallet, connected, connecting, connect, clearWalletError]);

  // Safety timeout: if connecting remains true for more than 6 seconds without succeeding, reset so user is never stuck
  useEffect(() => {
    if (!connecting) return;
    const timeoutId = setTimeout(() => {
      console.warn('Wallet connection timed out (6s), resetting connecting state.');
      attemptedWalletRef.current = null;
      disconnect().catch(() => {});
      try {
        select(null as any);
      } catch {}
    }, 6000);
    return () => clearTimeout(timeoutId);
  }, [connecting, disconnect, select]);

  // Clear wallet error whenever connection succeeds
  useEffect(() => {
    if (connected) {
      clearWalletError();
      attemptedWalletRef.current = null;
    }
  }, [connected, clearWalletError]);

  // Close modal on Escape key press
  useEffect(() => {
    if (!menuOpen) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setMenuOpen(false);
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [menuOpen]);

  // Lock body scroll while modal is active
  useEffect(() => {
    if (!menuOpen) return;
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = prevOverflow;
    };
  }, [menuOpen]);

  // Click on trigger button: handles connecting, reconnecting, opening modal, and resetting stuck states
  const handleTriggerClick = useCallback(async () => {
    clearWalletError();
    if (connected) {
      setMenuOpen((prev) => !prev);
      return;
    }

    // If currently stuck in "connecting", clicking aborts it and opens the modal fresh
    if (connecting) {
      attemptedWalletRef.current = null;
      try {
        await disconnect();
      } catch {}
      try {
        select(null as any);
      } catch {}
      setVisible(true);
      return;
    }

    if (wallets.length === 0) {
      setWalletError('No wallet found. Install Solflare or Phantom to connect.');
    }

    // If a wallet is already selected, try to connect directly; if that fails, open modal
    if (wallet && !connected) {
      attemptedWalletRef.current = wallet.adapter.name;
      try {
        await connect();
        return;
      } catch (err) {
        console.warn('Direct connect attempt failed, opening wallet modal:', err);
        attemptedWalletRef.current = null;
        try {
          select(null as any);
        } catch {}
        setVisible(true);
        return;
      }
    }

    // No wallet selected: reset attempt ref and open modal
    attemptedWalletRef.current = null;
    try {
      select(null as any);
    } catch {}
    setVisible(true);
  }, [connected, connecting, wallet, wallets.length, setWalletError, clearWalletError, setVisible, connect, disconnect, select]);

  // Modal action: Copy address
  const handleCopyAddress = useCallback(async () => {
    if (!publicKey) return;
    try {
      await navigator.clipboard.writeText(publicKey.toBase58());
      setCopied(true);
      setTimeout(() => setCopied(false), 900);
    } catch (err) {
      console.error('Failed to copy address:', err);
    }
  }, [publicKey]);

  // Modal action: Change wallet
  const handleChangeWallet = useCallback(async () => {
    setMenuOpen(false);
    attemptedWalletRef.current = null;
    try {
      await disconnect();
    } catch {}
    try {
      select(null as any);
    } catch {}
    setVisible(true);
  }, [disconnect, select, setVisible]);

  // Modal action: Disconnect
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

  // Determine button label: ONLY show "Connecting..." if actually connecting
  let buttonLabel = 'Connect wallet';
  if (connected && shortAddress) {
    buttonLabel = shortAddress;
  } else if (connecting) {
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
      >
        {connected && wallet?.adapter.icon ? (
          <i className="wallet-adapter-button-start-icon">
            <img src={wallet.adapter.icon} alt={`${wallet.adapter.name} icon`} />
          </i>
        ) : null}
        <span>{buttonLabel}</span>
      </button>

      {/* Render connected wallet modal dialog via portal to avoid any stacking context or panel overlap issues */}
      {connected && menuOpen && typeof document !== 'undefined' && createPortal(
        <div
          className="wallet-adapter-modal wallet-adapter-modal-fade-in wallet-connected-modal-root"
          role="dialog"
          aria-modal="true"
          aria-labelledby="wallet-connected-modal-title"
        >
          {/* Dimmed backdrop overlay covering the full viewport - matches "Connect a wallet" modal */}
          <div
            className="wallet-adapter-modal-overlay wallet-connected-modal-overlay"
            onClick={() => setMenuOpen(false)}
            aria-hidden="true"
          />

          {/* Centered dialog container */}
          <div className="wallet-adapter-modal-container wallet-connected-modal-container">
            <div
              className="wallet-adapter-modal-wrapper wallet-connected-modal-card"
              onClick={(e) => e.stopPropagation()}
            >
              {/* Circular glass close button top-right - matches screenshot */}
              <button
                type="button"
                onClick={() => setMenuOpen(false)}
                className="wallet-adapter-modal-button-close wallet-connected-modal-close"
                aria-label="Close wallet dialog"
              >
                <X size={18} />
              </button>

              {/* Modal Header: Title & Subtitle */}
              <div className="wallet-dropdown-modal-header">
                <div>
                  <h3 id="wallet-connected-modal-title" className="wallet-dropdown-modal-title">
                    {wallet?.adapter.name || 'Solana'} Wallet
                  </h3>
                  <p className="wallet-dropdown-modal-subtitle">
                    Connected to the Solana test network (devnet).
                  </p>
                </div>
              </div>

              {/* Action Rows: styled identical to Solflare/Phantom capsule rows in screenshot */}
              <div className="wallet-dropdown-modal-list">
                <button
                  type="button"
                  className="wallet-dropdown-modal-row"
                  onClick={handleCopyAddress}
                >
                  <div className="wallet-dropdown-row-icon">
                    {copied ? <Check size={18} className="text-green" /> : <Copy size={18} />}
                  </div>
                  <span className="wallet-dropdown-row-name">
                    {copied ? 'Address copied!' : 'Copy address'}
                  </span>
                  <span className="wallet-dropdown-row-pill">
                    {shortAddress || 'Copy'}
                  </span>
                </button>

                <button
                  type="button"
                  className="wallet-dropdown-modal-row"
                  onClick={handleChangeWallet}
                >
                  <div className="wallet-dropdown-row-icon">
                    <RefreshCw size={18} />
                  </div>
                  <span className="wallet-dropdown-row-name">Change wallet</span>
                  <span className="wallet-dropdown-row-pill">Switch</span>
                </button>

                {publicKey && (
                  <button
                    type="button"
                    className="wallet-dropdown-modal-row"
                    onClick={() => {
                      window.open(
                        `https://explorer.solana.com/address/${publicKey.toBase58()}?cluster=devnet`,
                        '_blank',
                        'noopener,noreferrer'
                      );
                    }}
                  >
                    <div className="wallet-dropdown-row-icon">
                      <ExternalLink size={18} />
                    </div>
                    <span className="wallet-dropdown-row-name">Solana Explorer</span>
                    <span className="wallet-dropdown-row-pill">Devnet</span>
                  </button>
                )}

                <button
                  type="button"
                  className="wallet-dropdown-modal-row wallet-dropdown-modal-row-disconnect"
                  onClick={handleDisconnect}
                >
                  <div className="wallet-dropdown-row-icon">
                    <LogOut size={18} />
                  </div>
                  <span className="wallet-dropdown-row-name">Disconnect</span>
                  <span className="wallet-dropdown-row-pill">Exit</span>
                </button>
              </div>
            </div>
          </div>
        </div>,
        document.body
      )}
    </div>
  );
};
