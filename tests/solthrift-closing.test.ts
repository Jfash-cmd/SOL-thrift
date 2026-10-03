import {
  Keypair,
  PublicKey,
  SystemProgram,
  LAMPORTS_PER_SOL,
  Transaction,
  sendAndConfirmTransaction,
  SYSVAR_RENT_PUBKEY,
} from "@solana/web3.js";
import {
  createMint,
  createAccount,
  mintTo,
  getAccount,
  TOKEN_PROGRAM_ID,
} from "@solana/spl-token";

// In Solana Playground (beta.solpg.io), `pg` and `BN` are injected globally.
// Do not import Anchor or write Anchor.toml.
declare const pg: any;
declare const BN: any;

// Helper to log clear [PASS] or [FAIL] for each test assertion
function assertEqual(actual: any, expected: any, description: string) {
  const actualStr = actual?.toString();
  const expectedStr = expected?.toString();
  if (actualStr === expectedStr) {
    console.log(`[PASS] ${description}`);
  } else {
    console.error(
      `[FAIL] ${description} -> Expected: ${expectedStr}, Got: ${actualStr}`
    );
    throw new Error(
      `Assertion failed: ${description}. Expected: ${expectedStr}, Got: ${actualStr}`
    );
  }
}

/**
 * Sleep helper that loops until Date.now() >= end, yielding CPU via a cheap
 * RPC call (pg.connection.getSlot()) so it does not spin the CPU.
 */
async function sleepMs(ms: number): Promise<void> {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    await pg.connection.getSlot();
  }
}

/**
 * Helper to wait until on-chain cluster time (block time) passes unixSeconds.
 * Loops, fetches slot with 'confirmed' commitment, then block time;
 * if t is not null and t > unixSeconds, returns; otherwise calls sleepMs(1000).
 */
async function waitUntilChainTime(unixSeconds: number): Promise<void> {
  while (true) {
    const slot = await pg.connection.getSlot("confirmed");
    const t = await pg.connection.getBlockTime(slot);
    if (t !== null && t !== undefined && t > unixSeconds) {
      return;
    }
    await sleepMs(1000);
  }
}

/**
 * Helper to fetch an account with up to 8 retries, 1 second apart.
 * Used for every account fetch to prevent timing and RPC indexing race conditions.
 */
async function fetchWithRetry<T>(
  fetchFn: () => Promise<T>,
  accountLabel: string = "account",
  maxRetries: number = 8,
  delayMs: number = 1000
): Promise<T> {
  let lastError: any;
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      return await fetchFn();
    } catch (err: any) {
      lastError = err;
      if (attempt < maxRetries) {
        await sleepMs(delayMs);
      }
    }
  }
  throw new Error(
    `Failed to fetch ${accountLabel} after ${maxRetries} retries (1s apart): ${
      lastError?.message || lastError
    }`
  );
}

/**
 * Helper to wait for a transaction signature to reach 'confirmed' status
 * before proceeding with any subsequent actions.
 */
async function waitForConfirmation(signature: string, label: string) {
  await pg.connection.confirmTransaction(signature, "confirmed");
  console.log(`${label} confirmed (tx: ${signature})`);
}

async function runClosingTest() {
  console.log("\n========================================================");
  console.log(" Starting Solthrift 3-Member Circle Closing Test");
  console.log("========================================================\n");

  const DECIMALS = 6;
  const DECIMALS_FACTOR = new BN(10).pow(new BN(DECIMALS)); // 1,000,000
  const ONE_TOKEN = DECIMALS_FACTOR;

  // --------------------------------------------------------------------------
  // Step 1: Setup Mint, Members & Token Accounts
  // --------------------------------------------------------------------------
  console.log("--- Step 1: Setup Mint, Members & Token Accounts ---");

  const payerKeypair = pg.wallet.keypair;
  if (!payerKeypair) {
    throw new Error("pg.wallet.keypair is required to sign token and SOL transfers");
  }

  // Create test SPL token mint with 6 decimals
  const mint = await createMint(
    pg.connection,
    payerKeypair,
    pg.wallet.publicKey,
    null,
    DECIMALS
  );
  console.log(`Created test SPL token mint: ${mint.toBase58()}`);

  // Member 1 is pg.wallet; Members 2 and 3 are in-memory generated Keypairs
  const member1Wallet = pg.wallet.publicKey;
  const member2 = Keypair.generate();
  const member3 = Keypair.generate();

  console.log(`Member 1 (pg.wallet): ${member1Wallet.toBase58()}`);
  console.log(`Member 2: ${member2.publicKey.toBase58()}`);
  console.log(`Member 3: ${member3.publicKey.toBase58()}`);

  // Fund generated members with 0.02 SOL each from pg.wallet for transaction fees
  const fundTx = new Transaction().add(
    SystemProgram.transfer({
      fromPubkey: pg.wallet.publicKey,
      toPubkey: member2.publicKey,
      lamports: 0.02 * LAMPORTS_PER_SOL,
    }),
    SystemProgram.transfer({
      fromPubkey: pg.wallet.publicKey,
      toPubkey: member3.publicKey,
      lamports: 0.02 * LAMPORTS_PER_SOL,
    })
  );
  const fundTxSig = await sendAndConfirmTransaction(pg.connection, fundTx, [payerKeypair], {
    commitment: "confirmed",
  });
  console.log(`Funded members 2, 3 with 0.02 SOL each (tx: ${fundTxSig})`);

  // Create token accounts for each member
  const member1TokenAccount = await createAccount(
    pg.connection,
    payerKeypair,
    mint,
    member1Wallet
  );
  const member2TokenAccount = await createAccount(
    pg.connection,
    payerKeypair,
    mint,
    member2.publicKey
  );
  const member3TokenAccount = await createAccount(
    pg.connection,
    payerKeypair,
    mint,
    member3.publicKey
  );

  console.log(`Member 1 token account: ${member1TokenAccount.toBase58()}`);
  console.log(`Member 2 token account: ${member2TokenAccount.toBase58()}`);
  console.log(`Member 3 token account: ${member3TokenAccount.toBase58()}`);

  // Mint 200 tokens (200,000,000 base units) to each of the 3 members
  const mintAmount = 200_000_000n; // 200 * 10^6
  const mint1Tx = await mintTo(pg.connection, payerKeypair, mint, member1TokenAccount, payerKeypair, mintAmount);
  console.log(`Minted 200 tokens to Member 1 (tx: ${mint1Tx})`);
  const mint2Tx = await mintTo(pg.connection, payerKeypair, mint, member2TokenAccount, payerKeypair, mintAmount);
  console.log(`Minted 200 tokens to Member 2 (tx: ${mint2Tx})`);
  const mint3Tx = await mintTo(pg.connection, payerKeypair, mint, member3TokenAccount, payerKeypair, mintAmount);
  console.log(`Minted 200 tokens to Member 3 (tx: ${mint3Tx})`);

  // --------------------------------------------------------------------------
  // Step 2: create_circle with 3 members, deposit_pct 50, contribution 10, period 20s, grace 0
  // --------------------------------------------------------------------------
  console.log("\n--- Step 2: create_circle ---");

  const circleId = new BN(Math.floor(Date.now() / 1000));
  const circleIdBytes = circleId.toArrayLike(Buffer, "le", 8);

  const [circlePda] = PublicKey.findProgramAddressSync(
    [Buffer.from("circle"), pg.wallet.publicKey.toBuffer(), circleIdBytes],
    pg.program.programId
  );
  const [creatorMemberPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("member"), circlePda.toBuffer(), pg.wallet.publicKey.toBuffer()],
    pg.program.programId
  );
  const [vaultPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("vault"), circlePda.toBuffer()],
    pg.program.programId
  );

  console.log(`Circle PDA: ${circlePda.toBase58()}`);
  console.log(`Creator Member (Slot 1) PDA: ${creatorMemberPda.toBase58()}`);
  console.log(`Vault PDA: ${vaultPda.toBase58()}`);

  const membersTarget = 3;
  const contribution = new BN(10).mul(ONE_TOKEN); // 10 tokens
  const depositPct = 50;
  const periodDuration = new BN(20); // 20 seconds
  const graceDuration = new BN(0);
  const fillWindowDuration = new BN(0);
  const openWindowDuration = new BN(0);

  const createCircleSig = await pg.program.methods
    .createCircle(
      circleId,
      membersTarget,
      contribution,
      depositPct,
      periodDuration,
      graceDuration,
      fillWindowDuration,
      openWindowDuration
    )
    .accounts({
      circle: circlePda,
      creatorMember: creatorMemberPda,
      vault: vaultPda,
      creator: pg.wallet.publicKey,
      tokenMint: mint,
      creatorTokenAccount: member1TokenAccount,
      tokenProgram: TOKEN_PROGRAM_ID,
      systemProgram: SystemProgram.programId,
      rent: SYSVAR_RENT_PUBKEY,
    })
    .rpc();

  await waitForConfirmation(createCircleSig, "createCircle");

  const m1AccountAfterCreate = await fetchWithRetry(
    () => pg.program.account.member.fetch(creatorMemberPda, "confirmed"),
    "Member 1 (creator) account after createCircle"
  );
  assertEqual(
    m1AccountAfterCreate.depositRemaining.toString(),
    new BN(10).mul(ONE_TOKEN).toString(),
    "Slot 1 deposit equals 10 tokens: max(50% * (3 - 1) * 10, 10) = 10"
  );

  // --------------------------------------------------------------------------
  // Step 3: Members 2 and 3 Join (All Join - deposits 10, 10, 10)
  // --------------------------------------------------------------------------
  console.log("\n--- Step 3: Members 2 and 3 Join ---");

  // Member 2 Joins (Slot 2)
  const [member2Pda] = PublicKey.findProgramAddressSync(
    [Buffer.from("member"), circlePda.toBuffer(), member2.publicKey.toBuffer()],
    pg.program.programId
  );
  const join2Sig = await pg.program.methods
    .joinCircle()
    .accounts({
      circle: circlePda,
      member: member2Pda,
      memberWallet: member2.publicKey,
      tokenMint: mint,
      memberTokenAccount: member2TokenAccount,
      vault: vaultPda,
      tokenProgram: TOKEN_PROGRAM_ID,
      systemProgram: SystemProgram.programId,
    })
    .signers([member2])
    .rpc();
  await waitForConfirmation(join2Sig, "joinCircle (Member 2)");

  const m2Account = await fetchWithRetry(
    () => pg.program.account.member.fetch(member2Pda, "confirmed"),
    "Member 2 account after joinCircle"
  );
  assertEqual(
    m2Account.depositRemaining.toString(),
    new BN(10).mul(ONE_TOKEN).toString(),
    "Slot 2 deposit equals 10 tokens: max(50% * (3 - 2) * 10, 10) = 10"
  );

  // Member 3 Joins (Slot 3)
  const [member3Pda] = PublicKey.findProgramAddressSync(
    [Buffer.from("member"), circlePda.toBuffer(), member3.publicKey.toBuffer()],
    pg.program.programId
  );
  const join3Sig = await pg.program.methods
    .joinCircle()
    .accounts({
      circle: circlePda,
      member: member3Pda,
      memberWallet: member3.publicKey,
      tokenMint: mint,
      memberTokenAccount: member3TokenAccount,
      vault: vaultPda,
      tokenProgram: TOKEN_PROGRAM_ID,
      systemProgram: SystemProgram.programId,
    })
    .signers([member3])
    .rpc();
  await waitForConfirmation(join3Sig, "joinCircle (Member 3)");

  const m3Account = await fetchWithRetry(
    () => pg.program.account.member.fetch(member3Pda, "confirmed"),
    "Member 3 account after joinCircle"
  );
  assertEqual(
    m3Account.depositRemaining.toString(),
    new BN(10).mul(ONE_TOKEN).toString(),
    "Slot 3 deposit equals 10 tokens: max(50% * (3 - 3) * 10, 10) = 10"
  );

  const circleAfterJoin = await fetchWithRetry(
    () => pg.program.account.circle.fetch(circlePda, "confirmed"),
    "Circle account after all members joined"
  );
  assertEqual(
    circleAfterJoin.status.active !== undefined,
    true,
    "Circle status transitioned to Active upon all members joining"
  );

  // --------------------------------------------------------------------------
  // Step 4: Period 1 - All contribute, payout to slot 1 (expect 30)
  // --------------------------------------------------------------------------
  console.log("\n--- Step 4: Period 1 Contributions and Payout ---");

  // Member 1 contributes
  const cont1Sig = await pg.program.methods
    .contribute()
    .accounts({
      circle: circlePda,
      member: creatorMemberPda,
      memberWallet: member1Wallet,
      tokenMint: mint,
      memberTokenAccount: member1TokenAccount,
      vault: vaultPda,
      tokenProgram: TOKEN_PROGRAM_ID,
    })
    .rpc();
  await waitForConfirmation(cont1Sig, "contribute (Member 1)");

  // Member 2 contributes
  const cont2Sig = await pg.program.methods
    .contribute()
    .accounts({
      circle: circlePda,
      member: member2Pda,
      memberWallet: member2.publicKey,
      tokenMint: mint,
      memberTokenAccount: member2TokenAccount,
      vault: vaultPda,
      tokenProgram: TOKEN_PROGRAM_ID,
    })
    .signers([member2])
    .rpc();
  await waitForConfirmation(cont2Sig, "contribute (Member 2)");

  // Member 3 contributes
  const cont3Sig = await pg.program.methods
    .contribute()
    .accounts({
      circle: circlePda,
      member: member3Pda,
      memberWallet: member3.publicKey,
      tokenMint: mint,
      memberTokenAccount: member3TokenAccount,
      vault: vaultPda,
      tokenProgram: TOKEN_PROGRAM_ID,
    })
    .signers([member3])
    .rpc();
  await waitForConfirmation(cont3Sig, "contribute (Member 3)");

  // Slot 1 token balance before payout (200 - 10 deposit - 10 contribution = 180)
  const slot1Before = await fetchWithRetry(
    () => getAccount(pg.connection, member1TokenAccount, "confirmed"),
    "Member 1 token account before P1 payout"
  );

  // Call payout for Period 1 (recipient Slot 1)
  const payout1Sig = await pg.program.methods
    .payout()
    .accounts({
      circle: circlePda,
      recipientMember: creatorMemberPda,
      tokenMint: mint,
      recipientTokenAccount: member1TokenAccount,
      vault: vaultPda,
      caller: pg.wallet.publicKey,
      tokenProgram: TOKEN_PROGRAM_ID,
    })
    .rpc();
  await waitForConfirmation(payout1Sig, "payout (Period 1 to Slot 1)");

  const slot1After = await fetchWithRetry(
    () => getAccount(pg.connection, member1TokenAccount, "confirmed"),
    "Member 1 token account after P1 payout"
  );
  const slot1Received = slot1After.amount - slot1Before.amount;
  assertEqual(
    slot1Received.toString(),
    (30_000_000n).toString(),
    "Period 1 payout to slot 1: recipient receives exactly 30 tokens (30,000,000 base units)"
  );
  assertEqual(
    slot1After.amount.toString(),
    (210_000_000n).toString(),
    "Member 1 token balance after P1 payout is 210 tokens"
  );

  // --------------------------------------------------------------------------
  // Step 5: Period 2 - Members 2 and 3 contribute; Member 1 does not.
  // Wait for deadline, then removeDefaulter on Member 1.
  // --------------------------------------------------------------------------
  console.log("\n--- Step 5: Period 2 Contributions and removeDefaulter on Member 1 ---");

  // Member 2 contributes
  const cont2P2Sig = await pg.program.methods
    .contribute()
    .accounts({
      circle: circlePda,
      member: member2Pda,
      memberWallet: member2.publicKey,
      tokenMint: mint,
      memberTokenAccount: member2TokenAccount,
      vault: vaultPda,
      tokenProgram: TOKEN_PROGRAM_ID,
    })
    .signers([member2])
    .rpc();
  await waitForConfirmation(cont2P2Sig, "contribute Period 2 (Member 2)");

  // Member 3 contributes
  const cont3P2Sig = await pg.program.methods
    .contribute()
    .accounts({
      circle: circlePda,
      member: member3Pda,
      memberWallet: member3.publicKey,
      tokenMint: mint,
      memberTokenAccount: member3TokenAccount,
      vault: vaultPda,
      tokenProgram: TOKEN_PROGRAM_ID,
    })
    .signers([member3])
    .rpc();
  await waitForConfirmation(cont3P2Sig, "contribute Period 2 (Member 3)");

  console.log("Member 1 does not contribute. Waiting for Period 2 deadline to pass...");
  const circleBeforeRemove = await fetchWithRetry(
    () => pg.program.account.circle.fetch(circlePda, "confirmed"),
    "Circle account before removeDefaulter"
  );
  const deadline =
    circleBeforeRemove.periodStartTime.toNumber() +
    circleBeforeRemove.periodDuration.toNumber() +
    circleBeforeRemove.graceDuration.toNumber();
  console.log(`Period 2 deadline: ${deadline}`);
  await waitUntilChainTime(deadline + 1);

  // Call removeDefaulter on Member 1 (retry up to 6 times with 5s delay on GracePeriodNotExpired)
  let removeConfirmed = false;
  for (let attempt = 1; attempt <= 6; attempt++) {
    try {
      console.log(`Calling removeDefaulter on member 1 (attempt ${attempt}/6)...`);
      const removeSig = await pg.program.methods
        .removeDefaulter()
        .accounts({
          circle: circlePda,
          member: creatorMemberPda,
          tokenMint: mint,
          memberTokenAccount: member1TokenAccount,
          vault: vaultPda,
          caller: pg.wallet.publicKey,
          tokenProgram: TOKEN_PROGRAM_ID,
        })
        .rpc();
      await waitForConfirmation(removeSig, `removeDefaulter (Member 1, attempt ${attempt})`);
      removeConfirmed = true;
      break;
    } catch (err: any) {
      const errStr = err?.toString() || "";
      if (errStr.includes("GracePeriodNotExpired") && attempt < 6) {
        console.log(`Grace period not yet expired on cluster. Waiting 5s before retrying (attempt ${attempt}/6)...`);
        await sleepMs(5000);
      } else {
        throw err;
      }
    }
  }

  if (!removeConfirmed) {
    throw new Error("Failed to remove defaulter after 6 attempts");
  }

  // --------------------------------------------------------------------------
  // Step 6: Expect circle status Closing, forfeit_per_claimant 5,
  // forfeit_pool_remaining 10, member 1 deposit_remaining 0 and nothing refunded.
  // --------------------------------------------------------------------------
  console.log("\n--- Step 6: Verify Circle Closing State ---");

  const circleAfterRemove = await fetchWithRetry(
    () => pg.program.account.circle.fetch(circlePda, "confirmed"),
    "Circle account after member 1 removal"
  );
  const isCircleClosing = circleAfterRemove.status.closing !== undefined || JSON.stringify(circleAfterRemove.status).toLowerCase().includes("closing");
  assertEqual(isCircleClosing, true, "circle status Closing");
  assertEqual(
    circleAfterRemove.forfeitPerClaimant.toString(),
    (5_000_000n).toString(),
    "forfeit_per_claimant 5"
  );
  assertEqual(
    circleAfterRemove.forfeitPoolRemaining.toString(),
    (10_000_000n).toString(),
    "forfeit_pool_remaining 10"
  );

  const m1AccountAfterRemove = await fetchWithRetry(
    () => pg.program.account.member.fetch(creatorMemberPda, "confirmed"),
    "Member 1 account after removal"
  );
  assertEqual(
    m1AccountAfterRemove.depositRemaining.toString(),
    "0",
    "member 1 deposit_remaining 0"
  );

  const m1TokenAccountAfterRemove = await fetchWithRetry(
    () => getAccount(pg.connection, member1TokenAccount, "confirmed"),
    "Member 1 token account after removal"
  );
  assertEqual(
    m1TokenAccountAfterRemove.amount.toString(),
    (210_000_000n).toString(),
    "member 1 token balance is still 210 (nothing refunded)"
  );

  // --------------------------------------------------------------------------
  // Step 7: For members 2 and 3: call claimRefund (expect +10 each) and
  // exitMember (expect +15 each: 10 deposit + 5 forfeit share)
  // --------------------------------------------------------------------------
  console.log("\n--- Step 7: Claim Refunds and Exits for Members 2 and 3 ---");

  // Member 2 claimRefund
  const m2BalBeforeRefund = (await fetchWithRetry(() => getAccount(pg.connection, member2TokenAccount, "confirmed"), "m2 token account")).amount;
  const refund2Sig = await pg.program.methods
    .claimRefund()
    .accounts({
      circle: circlePda,
      member: member2Pda,
      tokenMint: mint,
      memberTokenAccount: member2TokenAccount,
      vault: vaultPda,
      memberWallet: member2.publicKey,
      tokenProgram: TOKEN_PROGRAM_ID,
    })
    .signers([member2])
    .rpc();
  await waitForConfirmation(refund2Sig, "claimRefund (Member 2)");
  const m2BalAfterRefund = (await fetchWithRetry(() => getAccount(pg.connection, member2TokenAccount, "confirmed"), "m2 token account after refund")).amount;
  assertEqual(
    m2BalAfterRefund - m2BalBeforeRefund,
    10_000_000n,
    "Member 2 claimRefund returns +10 tokens"
  );

  // Member 2 exitMember
  const m2BalBeforeExit = (await fetchWithRetry(() => getAccount(pg.connection, member2TokenAccount, "confirmed"), "m2 token account")).amount;
  const exit2Sig = await pg.program.methods
    .exitMember()
    .accounts({
      circle: circlePda,
      member: member2Pda,
      tokenMint: mint,
      memberTokenAccount: member2TokenAccount,
      vault: vaultPda,
      caller: pg.wallet.publicKey,
      tokenProgram: TOKEN_PROGRAM_ID,
    })
    .rpc();
  await waitForConfirmation(exit2Sig, "exitMember (Member 2)");
  const m2BalAfterExit = (await fetchWithRetry(() => getAccount(pg.connection, member2TokenAccount, "confirmed"), "m2 token account after exit")).amount;
  assertEqual(
    m2BalAfterExit - m2BalBeforeExit,
    15_000_000n,
    "Member 2 exitMember returns +15 tokens (10 deposit plus 5 forfeit share)"
  );

  // Member 3 claimRefund
  const m3BalBeforeRefund = (await fetchWithRetry(() => getAccount(pg.connection, member3TokenAccount, "confirmed"), "m3 token account")).amount;
  const refund3Sig = await pg.program.methods
    .claimRefund()
    .accounts({
      circle: circlePda,
      member: member3Pda,
      tokenMint: mint,
      memberTokenAccount: member3TokenAccount,
      vault: vaultPda,
      memberWallet: member3.publicKey,
      tokenProgram: TOKEN_PROGRAM_ID,
    })
    .signers([member3])
    .rpc();
  await waitForConfirmation(refund3Sig, "claimRefund (Member 3)");
  const m3BalAfterRefund = (await fetchWithRetry(() => getAccount(pg.connection, member3TokenAccount, "confirmed"), "m3 token account after refund")).amount;
  assertEqual(
    m3BalAfterRefund - m3BalBeforeRefund,
    10_000_000n,
    "Member 3 claimRefund returns +10 tokens"
  );

  // Member 3 exitMember
  const m3BalBeforeExit = (await fetchWithRetry(() => getAccount(pg.connection, member3TokenAccount, "confirmed"), "m3 token account")).amount;
  const exit3Sig = await pg.program.methods
    .exitMember()
    .accounts({
      circle: circlePda,
      member: member3Pda,
      tokenMint: mint,
      memberTokenAccount: member3TokenAccount,
      vault: vaultPda,
      caller: pg.wallet.publicKey,
      tokenProgram: TOKEN_PROGRAM_ID,
    })
    .rpc();
  await waitForConfirmation(exit3Sig, "exitMember (Member 3)");
  const m3BalAfterExit = (await fetchWithRetry(() => getAccount(pg.connection, member3TokenAccount, "confirmed"), "m3 token account after exit")).amount;
  assertEqual(
    m3BalAfterExit - m3BalBeforeExit,
    15_000_000n,
    "Member 3 exitMember returns +15 tokens (10 deposit plus 5 forfeit share)"
  );

  // --------------------------------------------------------------------------
  // Step 8: Expect vault balance to be exactly 0. Expect final token balances:
  // member 1 = 210, member 2 = 195, member 3 = 195.
  // --------------------------------------------------------------------------
  console.log("\n--- Step 8: Final Invariant Verifications ---");

  const vaultFinal = await fetchWithRetry(
    () => getAccount(pg.connection, vaultPda, "confirmed"),
    "Vault token account final"
  );
  assertEqual(
    vaultFinal.amount.toString(),
    "0",
    "Expect the vault balance to be exactly 0"
  );

  const m1FinalBal = (await fetchWithRetry(() => getAccount(pg.connection, member1TokenAccount, "confirmed"), "Member 1 final")).amount;
  assertEqual(
    m1FinalBal.toString(),
    (210_000_000n).toString(),
    "Final token balance: member 1 = 210"
  );

  const m2FinalBal = (await fetchWithRetry(() => getAccount(pg.connection, member2TokenAccount, "confirmed"), "Member 2 final")).amount;
  assertEqual(
    m2FinalBal.toString(),
    (195_000_000n).toString(),
    "Final token balance: member 2 = 195"
  );

  const m3FinalBal = (await fetchWithRetry(() => getAccount(pg.connection, member3TokenAccount, "confirmed"), "Member 3 final")).amount;
  assertEqual(
    m3FinalBal.toString(),
    (195_000_000n).toString(),
    "Final token balance: member 3 = 195"
  );

  console.log("\n========================================================");
  console.log(" Solthrift 3-Member Closing Test COMPLETED SUCCESSFULLY!");
  console.log("========================================================\n");
}

// Support both Solana Playground mocha test runner and direct script execution
if (typeof describe !== "undefined") {
  describe("Solthrift Closing Test", function () {
    this.timeout(240000);

    it("handles circle closing, defaulter forfeit, and refunds/exits", async function () {
      this.timeout(240000);
      await runClosingTest();
    });
  });
} else {
  runClosingTest().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
