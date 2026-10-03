import { PublicKey } from '@solana/web3.js';

/**
 * Solthrift Program ID on Solana Devnet
 */
export const PROGRAM_ID = new PublicKey('CfY1M7cdgv1AvkLPuquqbCPNxMz73icdukWQP2sKdPq4');

/**
 * Devnet SPL Token Mint address
 */
export const DEVNET_TOKEN_MINT = new PublicKey('4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU');

/**
 * Cluster configuration: Devnet only per specification
 */
export const CLUSTER_NETWORK = 'devnet';
export const RPC_ENDPOINT = 'https://api.devnet.solana.com';

/**
 * Check whether DEVNET_TOKEN_MINT is still the placeholder.
 */
export function isPlaceholderMint(mint: PublicKey): boolean {
  return (
    mint.equals(new PublicKey('11111111111111111111111111111111')) ||
    mint.equals(PublicKey.default)
  );
}
