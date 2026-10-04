import { Buffer } from 'buffer';
import {
  PublicKey,
  Connection,
  TransactionInstruction,
} from '@solana/web3.js';
import { Program, AnchorProvider, BN } from '@coral-xyz/anchor';
import type { AnchorWallet } from '@solana/wallet-adapter-react';
import {
  getAssociatedTokenAddressSync,
  createAssociatedTokenAccountInstruction,
  getMint,
  TOKEN_PROGRAM_ID,
  ASSOCIATED_TOKEN_PROGRAM_ID,
} from '@solana/spl-token';

import idl from './idl/solthrift.json';
import { PROGRAM_ID, CLUSTER_NETWORK } from './config';

/**
 * IDL error dictionary for quick lookup by code and name
 */
interface IdlError {
  code: number;
  name: string;
  msg: string;
}

const ERROR_CODE_MAP = new Map<number, IdlError>();
const ERROR_NAME_MAP = new Map<string, IdlError>();

if (idl.errors && Array.isArray(idl.errors)) {
  for (const err of idl.errors as IdlError[]) {
    ERROR_CODE_MAP.set(err.code, err);
    ERROR_NAME_MAP.set(err.name.toLowerCase(), err);
  }
}

/**
 * 1. PDA Derivation Helpers matching exact seeds in program/lib.rs:
 * circle = ["circle", creator, circle_id u64 little-endian]
 * vault = ["vault", circle]
 * member = ["member", circle, wallet]
 */

export function getCirclePda(
  creator: PublicKey,
  circleId: BN | number | bigint
): [PublicKey, number] {
  const bn = new BN(circleId.toString());
  const circleIdBuffer = bn.toArrayLike(Buffer, 'le', 8);
  return PublicKey.findProgramAddressSync(
    [Buffer.from('circle'), creator.toBuffer(), circleIdBuffer],
    PROGRAM_ID
  );
}

export function getVaultPda(circle: PublicKey): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from('vault'), circle.toBuffer()],
    PROGRAM_ID
  );
}

export function getMemberPda(
  circle: PublicKey,
  wallet: PublicKey
): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from('member'), circle.toBuffer(), wallet.toBuffer()],
    PROGRAM_ID
  );
}

/**
 * Return an Anchor Program instance configured with the connected wallet (or read-only dummy)
 */
export function getSolthriftProgram(
  connection: Connection,
  wallet?: AnchorWallet | null
): Program {
  const provider = wallet
    ? new AnchorProvider(connection, wallet, { commitment: 'confirmed' })
    : new AnchorProvider(
        connection,
        {
          publicKey: PublicKey.default,
          signTransaction: async (tx: any) => tx,
          signAllTransactions: async (txs: any) => txs,
        },
        { commitment: 'confirmed' }
      );

  return new Program(idl as any, PROGRAM_ID, provider);
}

/**
 * Helper to check if an Associated Token Account exists, and create instruction if needed.
 */
export async function getOrCreateAtaInstruction(
  connection: Connection,
  mint: PublicKey,
  owner: PublicKey,
  payer: PublicKey
): Promise<{ ata: PublicKey; instruction: TransactionInstruction | null }> {
  const ata = getAssociatedTokenAddressSync(
    mint,
    owner,
    false,
    TOKEN_PROGRAM_ID,
    ASSOCIATED_TOKEN_PROGRAM_ID
  );

  const accountInfo = await connection.getAccountInfo(ata, 'confirmed');
  if (!accountInfo) {
    const instruction = createAssociatedTokenAccountInstruction(
      payer,
      ata,
      owner,
      mint,
      TOKEN_PROGRAM_ID,
      ASSOCIATED_TOKEN_PROGRAM_ID
    );
    return { ata, instruction };
  }

  return { ata, instruction: null };
}

/**
 * Reads token decimals from the SPL Mint account at runtime on-chain
 */
export async function getMintDecimals(
  connection: Connection,
  mint: PublicKey
): Promise<number> {
  try {
    const mintInfo = await getMint(connection, mint, 'confirmed');
    return mintInfo.decimals;
  } catch {
    try {
      const parsedInfo = await connection.getParsedAccountInfo(mint, 'confirmed');
      if (parsedInfo.value && 'parsed' in parsedInfo.value.data) {
        const dec = (parsedInfo.value.data as any).parsed?.info?.decimals;
        if (typeof dec === 'number') return dec;
      }
    } catch {
      // Fallback
    }
    return 6;
  }
}

/**
 * Explorer URL helper for Devnet transactions and addresses
 */
export function getExplorerUrl(
  type: 'tx' | 'address',
  value: string,
  network: string = CLUSTER_NETWORK
): string {
  return `https://explorer.solana.com/${type}/${value}?cluster=${network}`;
}

/**
 * Translates Solana / Anchor program errors using names and messages from the IDL
 */
export function translateProgramError(err: any): {
  code?: number;
  name?: string;
  message: string;
} {
  if (!err) {
    return { message: 'An unknown error occurred' };
  }

  // Check if user rejected the transaction
  const errStr = String(err.message || err);
  if (
    errStr.includes('User rejected the request') ||
    errStr.includes('Transaction was rejected') ||
    errStr.includes('WalletSignTransactionError') ||
    err.code === 4001
  ) {
    return { message: 'Transaction rejected in wallet.' };
  }

  // 1. Direct Anchor error structure
  if (err.error?.errorCode) {
    const codeNum = Number(err.error.errorCode.number || err.error.errorCode.code);
    if (!isNaN(codeNum) && ERROR_CODE_MAP.has(codeNum)) {
      const match = ERROR_CODE_MAP.get(codeNum)!;
      return { code: match.code, name: match.name, message: match.msg };
    }

    const codeStr = String(err.error.errorCode.code || err.error.errorCode).toLowerCase();
    if (ERROR_NAME_MAP.has(codeStr)) {
      const match = ERROR_NAME_MAP.get(codeStr)!;
      return { code: match.code, name: match.name, message: match.msg };
    }

    if (err.error.errorMessage) {
      return { message: err.error.errorMessage };
    }
  }

  // 2. Look for hex or decimal error code in error message or logs
  // e.g. "custom program error: 0x1770" (0x1770 == 6000)
  const hexMatch = errStr.match(/custom program error:\s*0x([0-9a-fA-F]+)/i);
  if (hexMatch && hexMatch[1]) {
    const parsedCode = parseInt(hexMatch[1], 16);
    if (ERROR_CODE_MAP.has(parsedCode)) {
      const match = ERROR_CODE_MAP.get(parsedCode)!;
      return {
        code: match.code,
        name: match.name,
        message: `${match.msg} (${match.name})`,
      };
    }
  }

  // 3. Scan logs for error name
  if (err.logs && Array.isArray(err.logs)) {
    for (const log of err.logs) {
      const logMatch = String(log).match(/Error Code:\s*([a-zA-Z0-9]+)/);
      if (logMatch && logMatch[1]) {
        const found = ERROR_NAME_MAP.get(logMatch[1].toLowerCase());
        if (found) {
          return { code: found.code, name: found.name, message: `${found.msg} (${found.name})` };
        }
      }
    }
  }

  // 4. Insufficient SOL for fees or rent
  if (errStr.includes('Attempt to debit an account but found no record of a prior credit') ||
      errStr.includes('insufficient funds for rent') ||
      errStr.includes('insufficient lamports')) {
    return { message: 'Insufficient SOL in wallet to pay transaction fee and rent.' };
  }

  // 5. Fallback clean message
  const cleanMsg = errStr.replace(/^Error:\s*/, '');
  return { message: cleanMsg };
}
