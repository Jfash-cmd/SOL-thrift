import type { FC, ReactNode } from 'react';
import { useMemo, useState, useCallback, createContext, useContext } from 'react';
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

  const handleError = useCallback((error: any, adapter?: any) => {
    // Log full error to console as requested
    console.error('Solana wallet error:', error, adapter);

    const walletName = adapter?.name || (error?.name?.includes('Phantom') ? 'Phantom' : 'Wallet');

    if (error?.name === 'WalletNotReadyError') {
      setWalletError('No wallet found. Install Phantom or Solflare, then reload this page.');
    } else if (
      error?.name === 'WalletConnectionError' ||
      error?.name === 'WalletWindowBlockedError' ||
      error?.name === 'WalletTimeoutError'
    ) {
      setWalletError(
        `${walletName} did not connect. Open the ${walletName} extension, unlock it, and try again.`
      );
    } else if (
      error?.message?.toLowerCase().includes('user rejected') ||
      error?.message?.toLowerCase().includes('cancelled') ||
      error?.message?.toLowerCase().includes('closed')
    ) {
      setWalletError(
        `Connection request was cancelled in ${walletName}. Click "Connect wallet" to try again.`
      );
    } else {
      setWalletError(
        `${walletName} did not connect. Open the ${walletName} extension, unlock it, and try again.`
      );
    }
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

