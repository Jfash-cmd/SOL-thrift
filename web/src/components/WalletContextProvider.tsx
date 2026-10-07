import type { FC, ReactNode } from 'react';
import { useMemo, useState, useEffect, useCallback, createContext, useContext } from 'react';
import { ConnectionProvider, WalletProvider } from '@solana/wallet-adapter-react';
import { WalletModalProvider } from '@solana/wallet-adapter-react-ui';
import { clusterApiUrl } from '@solana/web3.js';
import { PhantomWalletAdapter } from '@solana/wallet-adapter-phantom';
import { SolflareWalletAdapter } from '@solana/wallet-adapter-solflare';

export interface WalletErrorContextType {
  walletError: string | null;
  setWalletError: (error: string | null) => void;
  clearWalletError: () => void;
}

export const WalletErrorContext = createContext<WalletErrorContextType>({
  walletError: null,
  setWalletError: () => {},
  clearWalletError: () => {},
});

export const useWalletError = () => useContext(WalletErrorContext);

interface Props {
  children: ReactNode;
}

// Cast components to avoid JSX element type definition collisions between React 18 and adapter types
const ConnectionProviderComponent = ConnectionProvider as unknown as FC<{ endpoint: string; children: ReactNode }>;
const WalletProviderComponent = WalletProvider as unknown as FC<{
  wallets: any[];
  autoConnect?: boolean;
  onError?: (error: any, adapter?: any) => void;
  children: ReactNode;
}>;
const WalletModalProviderComponent = WalletModalProvider as unknown as FC<{ children: ReactNode }>;

export const WalletContextProvider: FC<Props> = ({ children }) => {
  // Spec requirement: Devnet only
  const endpoint = useMemo(() => clusterApiUrl('devnet'), []);

  // Dedicated adapters ensure Phantom and Solflare are both available, alongside any auto-detected standard wallets
  const wallets = useMemo(
    () => [
      new PhantomWalletAdapter(),
      new SolflareWalletAdapter(),
    ],
    []
  );

  // Plain-English error state displayed on the page
  const [walletError, setWalletError] = useState<string | null>(null);

  const clearWalletError = useCallback(() => {
    setWalletError(null);
  }, []);

  // Auto-dismiss wallet error after 4 seconds
  useEffect(() => {
    if (walletError) {
      const timer = setTimeout(() => {
        setWalletError(null);
      }, 4000);
      return () => clearTimeout(timer);
    }
  }, [walletError]);

  const handleError = useCallback((error: any, adapter?: any) => {
    const timestamp = new Date().toISOString();
    const msg = String(error?.message || error || '').toLowerCase();
    const name = String(error?.name || '');
    const code = error?.code ?? error?.error?.code;

    // Requirement 1: Log every wallet error event with timestamp and error object
    console.warn(`[WalletEvent ${timestamp}] adapter.error:`, {
      name,
      message: error?.message,
      code,
      adapter: adapter?.name,
      error,
    });

    if (!error) return;

    // Requirement 3: Filter out all transient/benign events during wallet switches and cancellations
    const isBenignSwitchOrCancellation =
      code === 4001 ||
      msg.includes('user rejected') ||
      msg.includes('rejected') ||
      msg.includes('cancelled') ||
      msg.includes('canceled') ||
      msg.includes('closed') ||
      msg.includes('blocked') ||
      msg.includes('unlocked') ||
      msg.includes('already connected') ||
      msg.includes('not connected') ||
      msg.includes('disconnected') ||
      msg.includes('account changed') ||
      name === 'WalletWindowBlockedError' ||
      name === 'WalletWindowClosedError' ||
      name === 'WalletConnectionError' ||
      name === 'WalletDisconnectionError' ||
      name === 'WalletNotConnectedError' ||
      name === 'WalletTimeoutError';

    if (isBenignSwitchOrCancellation) {
      console.warn(`[Wallet Error Suppressed - Benign Switch/User Event]:`, msg || name, error);
      return;
    }

    if (name === 'WalletNotReadyError') {
      setWalletError('No wallet found. Install Solflare or Phantom to connect.');
      return;
    }

    // Only surface genuine unhandled errors
    console.error('Unhandled wallet error:', error);
  }, []);

  return (
    <WalletErrorContext.Provider value={{ walletError, setWalletError, clearWalletError }}>
      <ConnectionProviderComponent endpoint={endpoint}>
        <WalletProviderComponent wallets={wallets} autoConnect onError={handleError}>
          <WalletModalProviderComponent>{children}</WalletModalProviderComponent>
        </WalletProviderComponent>
      </ConnectionProviderComponent>
    </WalletErrorContext.Provider>
  );
};

