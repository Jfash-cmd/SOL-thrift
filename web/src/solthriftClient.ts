import { Buffer } from 'buffer';
import {
  PublicKey,
  Connection,
  Transaction,
  VersionedTransaction,
  TransactionInstruction,
  Keypair,
  SystemProgram,
  LAMPORTS_PER_SOL,
} from '@solana/web3.js';
import { Program, AnchorProvider, BN } from '@coral-xyz/anchor';
import type { AnchorWallet } from '@solana/wallet-adapter-react';
import {
  getAssociatedTokenAddressSync,
  createAssociatedTokenAccountInstruction,
  createTransferInstruction,
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
  6026: 'The deadline and grace period have not expired on Solana yet. The cluster clock is slightly behind—please wait a few seconds and try again.',
  6027: 'This member already paid for this turn, so they cannot be removed.',
  6028: "Member's remaining deposit is insufficient to cover this period's contribution.",
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
 * Reads token balance for a given wallet and mint
 */
export async function getTokenBalance(
  connection: Connection,
  mint: PublicKey,
  owner: PublicKey
): Promise<number> {
  try {
    const ata = getAssociatedTokenAddressSync(
      mint,
      owner,
      false,
      TOKEN_PROGRAM_ID,
      ASSOCIATED_TOKEN_PROGRAM_ID
    );
    const balance = await connection.getTokenAccountBalance(ata, 'confirmed');
    return balance.value.uiAmount ?? 0;
  } catch {
    return 0;
  }
}

/**
 * Wallet interface supporting sign-and-send (sendTransaction) and legacy fallback (signTransaction)
 */
export interface WalletSignAndSend {
  publicKey: PublicKey | null;
  sendTransaction?: (
    transaction: Transaction,
    connection: Connection,
    options?: any
  ) => Promise<string>;
  signTransaction?: (transaction: Transaction) => Promise<Transaction>;
}

export interface ExecuteProgramMethodOptions {
  connection: Connection;
  wallet: WalletSignAndSend;
  method: any; // Anchor MethodsBuilder
  preInstructions?: TransactionInstruction[];
  postInstructions?: TransactionInstruction[];
  onStatusChange?: (status: string) => void;
}

/**
 * Creates an in-memory signer wallet wrapping a Keypair.
 * Signs transactions locally using keypair.partialSign() and broadcasts raw transactions,
 * without opening browser wallet modals.
 * Secrets remain strictly in memory and are never serialized, exported, or logged.
 */
export function createKeypairWallet(keypair: Keypair): WalletSignAndSend & AnchorWallet {
  return {
    publicKey: keypair.publicKey,
    signTransaction: async <T extends Transaction | VersionedTransaction>(tx: T): Promise<T> => {
      if ('partialSign' in tx) {
        (tx as Transaction).partialSign(keypair);
      }
      return tx;
    },
    signAllTransactions: async <T extends Transaction | VersionedTransaction>(txs: T[]): Promise<T[]> => {
      for (const tx of txs) {
        if ('partialSign' in tx) {
          (tx as Transaction).partialSign(keypair);
        }
      }
      return txs;
    },
    sendTransaction: async (tx: Transaction, connection: Connection): Promise<string> => {
      tx.partialSign(keypair);
      return await connection.sendRawTransaction(tx.serialize(), {
        skipPreflight: false,
        preflightCommitment: 'confirmed',
      });
    },
  };
}

export interface DemoRecipientFunding {
  publicKey: PublicKey;
  solAmount: number;
  tokenAmount: number;
}

/**
 * Funds demo member keypairs with SOL for gas/rent, creates their token accounts if missing,
 * and transfers the specified USDC amounts from the connected payer wallet.
 * Fits in a single transaction whenever possible; falls back to 2 transactions if size exceeds limits.
 */
export async function fundDemoMembers({
  connection,
  payerWallet,
  tokenMint,
  tokenDecimals,
  recipients,
  onStatusChange,
}: {
  connection: Connection;
  payerWallet: WalletSignAndSend;
  tokenMint: PublicKey;
  tokenDecimals: number;
  recipients: DemoRecipientFunding[];
  onStatusChange?: (status: string) => void;
}): Promise<string[]> {
  if (!payerWallet.publicKey) {
    throw new Error('Connected wallet is not available to fund demo members.');
  }

  onStatusChange?.('Preparing demo member funding transactions...');

  const payerAta = getAssociatedTokenAddressSync(
    tokenMint,
    payerWallet.publicKey,
    false,
    TOKEN_PROGRAM_ID,
    ASSOCIATED_TOKEN_PROGRAM_ID
  );

  const instructions: TransactionInstruction[] = [];

  for (const r of recipients) {
    // 1. SOL transfer for gas & rent
    if (r.solAmount > 0) {
      instructions.push(
        SystemProgram.transfer({
          fromPubkey: payerWallet.publicKey,
          toPubkey: r.publicKey,
          lamports: Math.round(r.solAmount * LAMPORTS_PER_SOL),
        })
      );
    }

    // 2. ATA creation if missing
    const recipientAta = getAssociatedTokenAddressSync(
      tokenMint,
      r.publicKey,
      false,
      TOKEN_PROGRAM_ID,
      ASSOCIATED_TOKEN_PROGRAM_ID
    );

    const accountInfo = await connection.getAccountInfo(recipientAta);
    if (!accountInfo) {
      instructions.push(
        createAssociatedTokenAccountInstruction(
          payerWallet.publicKey,
          recipientAta,
          r.publicKey,
          tokenMint,
          TOKEN_PROGRAM_ID,
          ASSOCIATED_TOKEN_PROGRAM_ID
        )
      );
    }

    // 3. SPL Token transfer
    if (r.tokenAmount > 0) {
      const rawTokens = BigInt(Math.round(r.tokenAmount * Math.pow(10, tokenDecimals)));
      instructions.push(
        createTransferInstruction(
          payerAta,
          recipientAta,
          payerWallet.publicKey,
          rawTokens,
          [],
          TOKEN_PROGRAM_ID
        )
      );
    }
  }

  const latestBlockhash = await connection.getLatestBlockhash('confirmed');

  // Build single transaction
  const tx = new Transaction();
  instructions.forEach((ix) => tx.add(ix));
  tx.feePayer = payerWallet.publicKey;
  tx.recentBlockhash = latestBlockhash.blockhash;

  let serializedLength = 0;
  try {
    serializedLength = tx.serialize({ requireAllSignatures: false, verifySignatures: false }).length;
  } catch {
    serializedLength = tx.serializeMessage().length;
  }

  const signatures: string[] = [];

  if (serializedLength <= 1180) {
    onStatusChange?.('Simulating funding transaction (1 tx)...');
    const sim = await connection.simulateTransaction(tx);
    if (sim.value.err) {
      const simErr: any = new Error(`Simulation failed: ${JSON.stringify(sim.value.err)}`);
      simErr.simulationError = sim.value.err;
      simErr.logs = sim.value.logs;
      throw simErr;
    }

    onStatusChange?.('Please approve the funding transaction in your wallet...');
    let sig: string;
    if (typeof payerWallet.sendTransaction === 'function') {
      sig = await payerWallet.sendTransaction(tx, connection, {
        preflightCommitment: 'confirmed',
        skipPreflight: false,
      });
    } else if (typeof payerWallet.signTransaction === 'function') {
      sig = await fallbackSignAndSendTransaction(payerWallet as any, connection, tx);
    } else {
      throw new Error('Connected wallet does not support sending transactions.');
    }

    onStatusChange?.('Confirming funding transaction on Solana...');
    await confirmTransactionWithPolling(
      connection,
      sig,
      latestBlockhash.blockhash,
      latestBlockhash.lastValidBlockHeight
    );
    signatures.push(sig);
  } else {
    onStatusChange?.('Splitting funding into 2 transactions to fit Solana limit...');
    const half = Math.ceil(instructions.length / 2);
    const tx1Instructions = instructions.slice(0, half);
    const tx2Instructions = instructions.slice(half);

    for (const [idx, partIxs] of [tx1Instructions, tx2Instructions].entries()) {
      const partTx = new Transaction();
      partIxs.forEach((ix) => partTx.add(ix));
      partTx.feePayer = payerWallet.publicKey;
      const bHash = await connection.getLatestBlockhash('confirmed');
      partTx.recentBlockhash = bHash.blockhash;

      onStatusChange?.(`Please approve funding part ${idx + 1} of 2 in your wallet...`);
      let s: string;
      if (typeof payerWallet.sendTransaction === 'function') {
        s = await payerWallet.sendTransaction(partTx, connection, {
          preflightCommitment: 'confirmed',
        });
      } else if (typeof payerWallet.signTransaction === 'function') {
        s = await fallbackSignAndSendTransaction(payerWallet as any, connection, partTx);
      } else {
        throw new Error('Connected wallet does not support sending transactions.');
      }

      onStatusChange?.(`Confirming part ${idx + 1} of 2...`);
      await confirmTransactionWithPolling(connection, s, bHash.blockhash, bHash.lastValidBlockHeight);
      signatures.push(s);
    }
  }

  return signatures;
}

/**
 * Robust transaction confirmation: races WebSocket confirmation with HTTP polling
 * to guarantee transactions never hang indefinitely if Devnet WebSocket drops.
 */
export async function confirmTransactionWithPolling(
  connection: Connection,
  signature: string,
  blockhash: string,
  lastValidBlockHeight: number,
  timeoutMs: number = 45000
): Promise<void> {
  const start = Date.now();

  const wsConfirmPromise = connection
    .confirmTransaction(
      {
        signature,
        blockhash,
        lastValidBlockHeight,
      },
      'confirmed'
    )
    .then((res) => {
      if (res.value.err) {
        throw new Error(
          `Transaction confirmation failed on-chain: ${JSON.stringify(res.value.err)}`
        );
      }
    });

  const pollPromise = new Promise<void>(async (resolve, reject) => {
    while (Date.now() - start < timeoutMs) {
      await new Promise((r) => setTimeout(r, 1500));
      try {
        const { value: status } = await connection.getSignatureStatus(signature, {
          searchTransactionHistory: false,
        });
        if (status) {
          if (status.err) {
            reject(
              new Error(
                `Transaction confirmation failed on-chain: ${JSON.stringify(status.err)}`
              )
            );
            return;
          }
          if (
            status.confirmationStatus === 'confirmed' ||
            status.confirmationStatus === 'finalized'
          ) {
            resolve();
            return;
          }
        }
      } catch {
        // Ignore transient RPC polling errors
      }
    }

    try {
      const { value: status } = await connection.getSignatureStatus(signature);
      if (
        status &&
        (status.confirmationStatus === 'confirmed' ||
          status.confirmationStatus === 'finalized')
      ) {
        if (status.err) {
          reject(
            new Error(
              `Transaction confirmation failed on-chain: ${JSON.stringify(status.err)}`
            )
          );
        } else {
          resolve();
        }
        return;
      }
    } catch {}

    reject(
      new Error(
        `Confirmation timed out after ${Math.round(timeoutMs / 1000)}s on Devnet. Check explorer to verify.`
      )
    );
  });

  await Promise.race([wsConfirmPromise, pollPromise]);
}

/**
 * Fallback signing path: signs with signTransaction then sends raw transaction.
 * Used only if wallet.sendTransaction is unavailable.
 */
export async function fallbackSignAndSendTransaction(
  wallet: { signTransaction: (tx: Transaction) => Promise<Transaction> },
  connection: Connection,
  tx: Transaction
): Promise<string> {
  console.log('[Solthrift Fallback] Using signTransaction -> sendRawTransaction path');
  const signedTx = await wallet.signTransaction(tx);
  const rawTx = signedTx.serialize();
  return await connection.sendRawTransaction(rawTx, {
    skipPreflight: false,
    preflightCommitment: 'confirmed',
  });
}

/**
 * Unified helper to explicitly build, simulate, inspect, send, and confirm transactions
 * across all Solthrift operations (createCircle, join, contribute, payout, removeDefaulter, closing).
 */
export async function executeProgramMethod({
  connection,
  wallet,
  method,
  preInstructions,
  postInstructions,
  onStatusChange,
}: ExecuteProgramMethodOptions): Promise<{ signature: string; tx: Transaction }> {
  if (!wallet || !wallet.publicKey) {
    throw new Error('Wallet not connected. Connect your wallet to proceed.');
  }

  // 1. Attach preInstructions and postInstructions to the method builder if provided
  if (preInstructions && preInstructions.length > 0) {
    method.preInstructions(preInstructions);
  }
  if (postInstructions && postInstructions.length > 0) {
    method.postInstructions(postInstructions);
  }

  onStatusChange?.('Preparing and simulating transaction...');

  // 2. Build the transaction explicitly:
  const tx: Transaction = await method.transaction();
  tx.feePayer = wallet.publicKey;

  const latestBlockhash = await connection.getLatestBlockhash('confirmed');
  tx.recentBlockhash = latestBlockhash.blockhash;

  // Log serialized metrics
  let serializedBytes: Uint8Array;
  try {
    serializedBytes = tx.serialize({ requireAllSignatures: false, verifySignatures: false });
  } catch {
    serializedBytes = tx.serializeMessage();
  }
  const txSize = serializedBytes.length;
  const instructionCount = tx.instructions.length;
  const accountKeys = new Set<string>();
  if (tx.feePayer) accountKeys.add(tx.feePayer.toBase58());
  for (const ix of tx.instructions) {
    accountKeys.add(ix.programId.toBase58());
    for (const k of ix.keys) {
      accountKeys.add(k.pubkey.toBase58());
    }
  }
  const accountCount = accountKeys.size;

  console.log(
    `[Solthrift Tx Metrics] Size: ${txSize} bytes | Instructions: ${instructionCount} | Accounts: ${accountCount}`
  );
  if (txSize > 1200) {
    console.warn(
      `[Solthrift Tx Warning] Transaction size (${txSize} bytes) exceeds 1200 bytes (limit 1232 bytes)!`
    );
  }

  // 3. Simulate before asking wallet to sign
  const sim = await connection.simulateTransaction(tx);
  if (sim.value.err) {
    console.error('[Solthrift Simulation Error]:', sim.value.err, sim.value.logs);
    const simErr: any = new Error(
      `Simulation failed: ${JSON.stringify(sim.value.err)}`
    );
    simErr.simulationError = sim.value.err;
    simErr.logs = sim.value.logs;
    throw simErr;
  }
  console.log('simulation ok', sim.value.unitsConsumed);

  // 4. Prompt wallet to sign and send
  onStatusChange?.('Please approve the transaction in your wallet...');

  let signature: string;
  if (typeof wallet.sendTransaction === 'function') {
    signature = await wallet.sendTransaction(tx, connection, {
      preflightCommitment: 'confirmed',
      skipPreflight: false,
    });
  } else if (typeof wallet.signTransaction === 'function') {
    signature = await fallbackSignAndSendTransaction(wallet as any, connection, tx);
  } else {
    throw new Error('Connected wallet does not support sending transactions.');
  }

  console.log('[Solthrift Tx Sent] Signature:', signature);
  onStatusChange?.('Transaction submitted. Confirming on Solana...');

  // 5. Confirm with polling fallback so it never hangs indefinitely
  await confirmTransactionWithPolling(
    connection,
    signature,
    latestBlockhash.blockhash,
    latestBlockhash.lastValidBlockHeight
  );

  return { signature, tx };
}

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

  const errStr = String(err.message || err);

  // 1. Simulation failure: Parse underlying error from logs and simulationError if present
  const logsArr: string[] = Array.isArray(err.logs) ? err.logs : [];
  const logsText = logsArr.join('\n');
  const combinedText = `${errStr}\n${logsText}\n${JSON.stringify(err.simulationError ?? '')}`;

  // 1a. Check for Anchor / custom code in simulation error or logs:
  // e.g. err.simulationError.InstructionError[1].Custom or "Custom": 6026 or "custom program error: 0x178a"
  let parsedCustomCode: number | null = null;
  if (typeof err.simulationError === 'object' && err.simulationError !== null) {
    const rawCustom =
      err.simulationError?.InstructionError?.[1]?.Custom ??
      err.simulationError?.InstructionError?.[1] ??
      err.simulationError?.Custom;
    if (typeof rawCustom === 'number') {
      parsedCustomCode = rawCustom;
    }
  }
  if (parsedCustomCode === null) {
    const customMatch =
      combinedText.match(/"Custom":\s*(\d+)/i) ||
      combinedText.match(/Error Number:\s*(\d+)/i);
    if (customMatch && customMatch[1]) {
      parsedCustomCode = Number(customMatch[1]);
    }
  }
  if (parsedCustomCode === null) {
    const hexMatch = combinedText.match(/custom program error:\s*0x([0-9a-fA-F]+)/i);
    if (hexMatch && hexMatch[1]) {
      parsedCustomCode = parseInt(hexMatch[1], 16);
    }
  }

  if (parsedCustomCode !== null && PLAIN_ENGLISH_ERROR_MAP[parsedCustomCode]) {
    const match = ERROR_CODE_MAP.get(parsedCustomCode);
    return {
      code: parsedCustomCode,
      name: match?.name,
      message: PLAIN_ENGLISH_ERROR_MAP[parsedCustomCode],
      details: `0x${parsedCustomCode.toString(16)} (${match?.name || 'Code ' + parsedCustomCode}): ${match?.msg || errStr}\n\nLogs:\n${logsText}`,
    };
  }

  // 1b. Check for Error Code by name in logs
  for (const log of logsArr) {
    const logMatch = String(log).match(/Error Code:\s*([a-zA-Z0-9]+)/i);
    if (logMatch && logMatch[1]) {
      const found = ERROR_NAME_MAP.get(logMatch[1].toLowerCase());
      if (found) {
        const plain = PLAIN_ENGLISH_ERROR_MAP[found.code] || found.msg;
        return {
          code: found.code,
          name: found.name,
          message: plain,
          details: `${found.name} (${found.code}): ${found.msg}\n\nLogs:\n${logsText}`,
        };
      }
    }
  }

  // 1c. Check for SPL Token insufficient funds in simulation or logs
  const isInsufficientTokenFundsInSim =
    parsedCustomCode === 1 ||
    combinedText.toLowerCase().includes('custom program error: 0x1') ||
    combinedText.toLowerCase().includes('transfer: insufficient funds');

  if (isInsufficientTokenFundsInSim) {
    return {
      code: 1,
      name: 'InsufficientTokenFunds',
      message:
        'Insufficient token balance in your wallet. You need test tokens (e.g. devnet USDC) to cover your upfront deposit. You have SOL for gas fees, but circles require test tokens.',
      details: `SPL Token Error 0x1: Insufficient funds in token account\n\nLogs:\n${logsText}`,
    };
  }

  // 1d. Check for Insufficient SOL for fees or rent in simulation
  if (
    combinedText.includes('Attempt to debit an account but found no record of a prior credit') ||
    combinedText.toLowerCase().includes('insufficient funds for rent') ||
    combinedText.toLowerCase().includes('insufficient lamports')
  ) {
    return {
      message: 'Not enough SOL in wallet to pay network fee and account rent.',
      details: `${errStr}\n\nLogs:\n${logsText}`,
    };
  }

  // 1e. Fallback simulation failure when no specific program error was identified
  if (err.simulationError || (logsArr.length > 0 && errStr.includes('Simulation failed'))) {
    console.error('[Simulation Error]:', {
      error: err.simulationError,
      logs: err.logs,
      fullObject: err,
    });
    return {
      name: 'SimulationError',
      message: 'Transaction simulation failed on Solana before opening your wallet.',
      details: `Simulation Error: ${JSON.stringify(err.simulationError ?? err.message)}\n\nLogs:\n${logsText}`,
    };
  }

  // 2. Log the INNER error. For a WalletError print err.name, err.message, err.error (the original thrown by the wallet),
  // err.error?.code, err.cause, and the full object with console.error.
  // Show a plain-English message plus a collapsed Details line containing those fields. Never show only "Unexpected error".
  const isWalletError =
    err?.name?.includes('Wallet') ||
    err?.error !== undefined ||
    err?.cause !== undefined ||
    errStr.includes('WalletSignTransactionError') ||
    errStr.includes('WalletSendTransactionError') ||
    errStr.toLowerCase().includes('unexpected error');

  if (isWalletError) {
    const errName = err?.name || 'WalletError';
    const errMsg = err?.message || String(err);
    const innerError = err?.error ?? (err as any)?.cause ?? null;
    const innerCode = innerError?.code ?? err?.code ?? null;
    const innerMsg =
      innerError?.message ??
      (typeof innerError === 'string' ? innerError : null) ??
      (innerError?.toString ? innerError.toString() : null);

    console.error('WalletError err.name:', err?.name);
    console.error('WalletError err.message:', err?.message);
    console.error('WalletError err.error:', err?.error);
    console.error('WalletError err.error?.code:', err?.error?.code);
    console.error('WalletError err.cause:', err?.cause);
    console.error('WalletError full object:', err);

    let plainMessage: string;
    if (
      errMsg.includes('User rejected') ||
      errMsg.includes('Transaction was rejected') ||
      innerMsg?.includes('User rejected') ||
      innerCode === 4001
    ) {
      plainMessage = 'Transaction request was cancelled in your wallet. Approve the prompt to continue.';
    } else {
      plainMessage =
        'Wallet failed to sign or send the transaction. Check that your wallet extension is unlocked, connected to Solana Devnet, and has sufficient SOL.';
    }

    const detailLines: string[] = [
      `err.name: ${errName}`,
      `err.message: ${errMsg}`,
      `err.error: ${err?.error !== undefined ? (typeof err.error === 'object' ? JSON.stringify(err.error) : String(err.error)) : 'undefined'}`,
      `err.error?.code: ${err?.error?.code !== undefined ? String(err.error.code) : 'undefined'}`,
      `err.cause: ${err?.cause !== undefined ? (typeof err.cause === 'object' ? JSON.stringify(err.cause) : String(err.cause)) : 'undefined'}`,
    ];

    return {
      name: errName,
      code: typeof innerCode === 'number' ? innerCode : undefined,
      message: plainMessage,
      details: detailLines.join(' | '),
    };
  }

  // 3. User rejected transaction via standard browser rejection
  if (
    errStr.includes('User rejected the request') ||
    errStr.includes('Transaction was rejected') ||
    err.code === 4001
  ) {
    return { message: 'Transaction rejected in wallet. Approve the prompt to continue.' };
  }

  // 4. Direct Anchor error structure
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

  // 5. Look for hex or decimal error code in error message or logs
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

  // 6. Scan logs for error name
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

  // 7. SPL Token Program Errors (e.g. 0x1 = InsufficientFunds)
  const isInsufficientTokenFunds =
    hexMatch?.[1]?.toLowerCase() === '1' ||
    errStr.toLowerCase().includes('custom program error: 0x1') ||
    errStr.toLowerCase().includes('transfer: insufficient funds') ||
    (Array.isArray(err.logs) &&
      err.logs.some((l: string) => l.toLowerCase().includes('insufficient funds') || l.includes('0x1')));

  if (isInsufficientTokenFunds) {
    return {
      code: 1,
      name: 'InsufficientTokenFunds',
      message: 'Insufficient token balance in your wallet. You need test tokens (e.g. devnet USDC) to cover your upfront deposit. You have SOL for gas fees, but circles require test tokens.',
      details: 'SPL Token Error 0x1: Insufficient funds in token account',
    };
  }

  // 8. Insufficient SOL for fees or rent
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

  // 9. Fallback clean message
  const cleanMsg = errStr.replace(/^Error:\s*/, '');
  return { message: cleanMsg, details: errStr !== cleanMsg ? errStr : undefined };
}

/**
 * Detects if an error is a user-initiated rejection, popup close, or cancellation
 */
export function isUserCancellation(err: any): boolean {
  if (!err) return false;
  const name = String(err?.name || '');
  const msg = String(err?.message || err || '').toLowerCase();
  const innerMsg = String(err?.error?.message || (err as any)?.cause?.message || '').toLowerCase();
  const code = err?.code ?? err?.error?.code ?? (err as any)?.cause?.code;

  if (code === 4001) return true;
  if (
    name === 'WalletWindowClosedError' ||
    name === 'WalletWindowBlockedError' ||
    (name === 'WalletSignTransactionError' && (msg.includes('reject') || msg.includes('cancel') || msg.includes('closed'))) ||
    (name === 'WalletSendTransactionError' && (msg.includes('reject') || msg.includes('cancel') || msg.includes('closed')))
  ) {
    return true;
  }
  if (
    msg.includes('user rejected') ||
    msg.includes('transaction was rejected') ||
    msg.includes('rejected the request') ||
    msg.includes('request was rejected') ||
    msg.includes('cancelled') ||
    msg.includes('canceled') ||
    msg.includes('closed') ||
    innerMsg.includes('user rejected') ||
    innerMsg.includes('transaction was rejected') ||
    innerMsg.includes('rejected the request') ||
    innerMsg.includes('cancelled') ||
    innerMsg.includes('canceled')
  ) {
    return true;
  }
  return false;
}

/**
 * Extracts a valid base58 Solana public key from raw input, URLs, hashes, or explorer links
 */
export function extractSolanaAddress(raw: string): string {
  let cleaned = (raw || '').trim();
  if (!cleaned) return '';

  // Extract from circle URL: .../circle/<address> or ...#/circle/<address>
  if (cleaned.includes('/circle/')) {
    const parts = cleaned.split('/circle/');
    cleaned = parts[parts.length - 1];
  }
  // Extract from Solana Explorer URL: .../address/<address>
  if (cleaned.includes('/address/')) {
    const parts = cleaned.split('/address/');
    cleaned = parts[parts.length - 1];
  }
  // Strip query parameters and hash fragments
  cleaned = cleaned.split('?')[0].split('#')[0].trim();

  // Match 32 to 44 base58 characters
  const match = cleaned.match(/[1-9A-HJ-NP-za-km-z]{32,44}/);
  if (match) {
    return match[0];
  }
  return cleaned;
}



