import type { FC, ReactNode } from 'react';
import { useMemo } from 'react';
import { ConnectionProvider, WalletProvider } from '@solana/wallet-adapter-react';
import { WalletModalProvider } from '@solana/wallet-adapter-react-ui';
import { clusterApiUrl } from '@solana/web3.js';


interface Props {
  children: ReactNode;
}

// Cast components to avoid JSX element type definition collisions between React 18 and adapter types
const ConnectionProviderComponent = ConnectionProvider as unknown as FC<{ endpoint: string; children: ReactNode }>;
const WalletProviderComponent = WalletProvider as unknown as FC<{ wallets: any[]; autoConnect?: boolean; children: ReactNode }>;
const WalletModalProviderComponent = WalletModalProvider as unknown as FC<{ children: ReactNode }>;

export const WalletContextProvider: FC<Props> = ({ children }) => {
  // Spec requirement: Devnet only
  const endpoint = useMemo(() => clusterApiUrl('devnet'), []);

  // Standard wallets (Phantom, Solflare, Backpack, etc.) are auto-detected via Wallet Standard
  const wallets = useMemo(() => [], []);

  return (
    <ConnectionProviderComponent endpoint={endpoint}>
      <WalletProviderComponent wallets={wallets} autoConnect>
        <WalletModalProviderComponent>{children}</WalletModalProviderComponent>
      </WalletProviderComponent>
    </ConnectionProviderComponent>
  );
};
