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

const PLAIN_ENGLISH_ERROR_MAP: Record<number, string> = {
  6000: 'Members must be between 3 and 10.',
  6001: 'Deposit percentage must be between 25% and 100%.',
  6002: 'Payment must be at least 5 tokens.',
  6003: 'Turn time must be greater than zero.',
  6004: 'Extra time to pay cannot be negative.',
  6005: 'Time to find new members cannot be negative.',
  6006: 'Seat number must be between 1 and the member count.',
  6007: 'Seat was not found in the payout order.',
  6008: 'Payout order has no members.',
  6009: 'Turn number is not valid.',
  6010: 'Calculation exceeded number limits.',
  6011: 'This circle is not open for new members.',
  6012: 'This circle is full.',
  6013: 'This circle is not currently running.',
  6014: 'This circle is not running or waiting for new members.',
  6015: 'This circle is not waiting for new members or ending.',
  6016: 'This circle is not ending.',
  6017: 'This member is not active.',
  6018: 'Flag leaving first, or wait until the circle is ending.',
  6019: 'Refunds are not available in this state.',
  6020: 'No refund is available to claim for this turn.',
  6021: 'You already claimed your share of lost deposits.',
  6022: 'No lost deposit money is available to claim.',
  6023: 'The signup window has not closed yet.',
  6024: 'You already paid for this turn.',
  6025: 'The time to pay for this turn has passed.',
  6026: 'The deadline has not passed yet. Try again after the countdown ends.',
  6027: 'This member already paid for this turn, so they cannot be removed.',
  6028: 'Your deposit is too small to cover this payment.',
  6029: "Not everyone has paid yet, so the pot can't be paid out.",
  6030: 'This seat does not match the recipient scheduled for this turn.',
  6031: 'Wallet address does not match this seat.',
  6032: 'The pot for this turn was already paid out.',
  6033: 'This member was already paid.',
  6034: 'The scheduled recipient is no longer active.',
  6035: 'This member account does not belong to this circle.',
  6036: 'Member address is not valid for this circle.',
  6037: 'Connected wallet does not match this member account.',
  6038: "That token account does not belong to this circle's token.",
  6039: 'Token account owner does not match.',
  6040: 'Vault account does not match this circle.',
  6041: 'Vault owner does not match.',
  6042: 'You already joined this circle.',
  6043: 'Not enough funds in the vault to pay out the pot.',
  6044: 'Payout amount does not match total turn payments.',
  6045: 'No payments found for this turn to refund.',
  6046: 'Not enough lost deposit funds left in the pool.',
};

/**
 * Translates Solana / Anchor program errors using names and messages from the IDL into plain English
 */
export function translateProgramError(err: any): {
  code?: number;
  name?: string;
  message: string;
  details?: string;
} {
  if (!err) {
    return { message: 'Action failed. Check your wallet connection and try again.' };
  }

  // Check if user rejected the transaction
  const errStr = String(err.message || err);
  if (
    errStr.includes('User rejected the request') ||
    errStr.includes('Transaction was rejected') ||
    errStr.includes('WalletSignTransactionError') ||
    err.code === 4001
  ) {
    return { message: 'Transaction rejected in wallet. Approve the prompt to continue.' };
  }

  // 1. Direct Anchor error structure
  if (err.error?.errorCode) {
    const codeNum = Number(err.error.errorCode.number || err.error.errorCode.code);
    if (!isNaN(codeNum) && PLAIN_ENGLISH_ERROR_MAP[codeNum]) {
      const match = ERROR_CODE_MAP.get(codeNum);
      return {
        code: codeNum,
        name: match?.name,
        message: PLAIN_ENGLISH_ERROR_MAP[codeNum],
        details: `${match?.name || 'ProgramError'}: ${match?.msg || err.error.errorMessage || errStr}`,
      };
    }

    const codeStr = String(err.error.errorCode.code || err.error.errorCode).toLowerCase();
    if (ERROR_NAME_MAP.has(codeStr)) {
      const match = ERROR_NAME_MAP.get(codeStr)!;
      const plain = PLAIN_ENGLISH_ERROR_MAP[match.code] || match.msg;
      return {
        code: match.code,
        name: match.name,
        message: plain,
        details: `${match.name}: ${match.msg}`,
      };
    }

    if (err.error.errorMessage) {
      return { message: err.error.errorMessage, details: errStr };
    }
  }

  // 2. Look for hex or decimal error code in error message or logs
  // e.g. "custom program error: 0x1770" (0x1770 == 6000)
  const hexMatch = errStr.match(/custom program error:\s*0x([0-9a-fA-F]+)/i);
  if (hexMatch && hexMatch[1]) {
    const parsedCode = parseInt(hexMatch[1], 16);
    if (PLAIN_ENGLISH_ERROR_MAP[parsedCode]) {
      const match = ERROR_CODE_MAP.get(parsedCode);
      return {
        code: parsedCode,
        name: match?.name,
        message: PLAIN_ENGLISH_ERROR_MAP[parsedCode],
        details: `0x${hexMatch[1]} (${match?.name || 'Code ' + parsedCode}): ${match?.msg || errStr}`,
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
          const plain = PLAIN_ENGLISH_ERROR_MAP[found.code] || found.msg;
          return {
            code: found.code,
            name: found.name,
            message: plain,
            details: `${found.name} (${found.code}): ${found.msg}`,
          };
        }
      }
    }
  }

  // 4. Insufficient SOL for fees or rent
  if (
    errStr.includes('Attempt to debit an account but found no record of a prior credit') ||
    errStr.includes('insufficient funds for rent') ||
    errStr.includes('insufficient lamports')
  ) {
    return {
      message: 'Not enough SOL in wallet to pay network fee and account rent.',
      details: errStr,
    };
  }

  // 5. Fallback clean message
  const cleanMsg = errStr.replace(/^Error:\s*/, '');
  return { message: cleanMsg, details: errStr !== cleanMsg ? errStr : undefined };
}
