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

async function runCancelTest() {
  console.log("\n========================================================");
  console.log(" Starting Solthrift 5-Member Circle Cancel Test");
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

  // Create token accounts for members 1, 2, and 3
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
  // Step 2: create_circle with 5 members, deposit_pct 50, contribution 10, open duration 5s
  // --------------------------------------------------------------------------
  console.log("\n--- Step 2: create_circle (5 members, open duration 5s) ---");

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

  const membersTarget = 5;
  const contribution = new BN(10).mul(ONE_TOKEN); // 10 tokens
  const depositPct = 50;
  const periodDuration = new BN(120); // 120 seconds
  const graceDuration = new BN(0);
  const fillWindowDuration = new BN(0);
  const openWindowDuration = new BN(5); // 5 seconds open duration

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
    new BN(20).mul(ONE_TOKEN).toString(),
    "Slot 1 deposit equals 20 tokens: max(50% * (5 - 1) * 10, 10) = 20"
  );

  // --------------------------------------------------------------------------
  // Step 3: Only members 1, 2 and 3 join (3 of 5)
  // --------------------------------------------------------------------------
  console.log("\n--- Step 3: Members 2 and 3 Join (3 of 5 members) ---");

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
    new BN(15).mul(ONE_TOKEN).toString(),
    "Slot 2 deposit equals 15 tokens: max(50% * (5 - 2) * 10, 10) = 15"
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
    "Slot 3 deposit equals 10 tokens: max(50% * (5 - 3) * 10, 10) = 10"
  );

  // Circle is still Open (only 3 of 5 joined)
  const circleOpenCheck = await fetchWithRetry(
    () => pg.program.account.circle.fetch(circlePda, "confirmed"),
    "Circle account after 3 members joined"
  );
  assertEqual(
    circleOpenCheck.status.open !== undefined,
    true,
    "Circle remains Open with 3 of 5 members joined"
  );
  assertEqual(
    circleOpenCheck.currentMemberCount,
    3,
    "current_member_count is 3"
  );

  // --------------------------------------------------------------------------
  // Step 4: Wait 6 seconds. Call cancelOpenCircle by any caller. Expect status Closing.
  // --------------------------------------------------------------------------
  console.log("\n--- Step 4: Wait 6 seconds and cancelOpenCircle ---");

  console.log("Waiting for open deadline to pass...");
  const circleBeforeCancel = await fetchWithRetry(
    () => pg.program.account.circle.fetch(circlePda, "confirmed"),
    "Circle account before cancelOpenCircle"
  );
  const openDeadline = circleBeforeCancel.openDeadline.toNumber();
  console.log(`Open deadline: ${openDeadline}`);
  await waitUntilChainTime(openDeadline + 1);

  let cancelConfirmed = false;
  for (let attempt = 1; attempt <= 6; attempt++) {
    try {
      console.log(`Calling cancelOpenCircle (attempt ${attempt}/6)...`);
      const cancelSig = await pg.program.methods
        .cancelOpenCircle()
        .accounts({
          circle: circlePda,
          caller: pg.wallet.publicKey,
        })
        .rpc();
      await waitForConfirmation(cancelSig, `cancelOpenCircle (attempt ${attempt})`);
      cancelConfirmed = true;
      break;
    } catch (err: any) {
      const errStr = err?.toString() || "";
      if (errStr.includes("OpenWindowNotExpired") && attempt < 6) {
        console.log(`Open deadline not expired yet on cluster. Retrying in 2s (attempt ${attempt}/6)...`);
        await sleepMs(2000);
      } else {
        throw err;
      }
    }
  }

  if (!cancelConfirmed) {
    throw new Error("Failed to cancel open circle after 6 attempts");
  }

  const circleAfterCancel = await fetchWithRetry(
    () => pg.program.account.circle.fetch(circlePda, "confirmed"),
    "Circle account after cancelOpenCircle"
  );
  const isCircleClosing = circleAfterCancel.status.closing !== undefined || JSON.stringify(circleAfterCancel.status).toLowerCase().includes("closing");
  assertEqual(isCircleClosing, true, "Expect circle status Closing");

  // --------------------------------------------------------------------------
  // Step 5: Call exitMember for members 1, 2 and 3. Expect each gets its full
  // deposit back, and the vault is exactly 0.
  // --------------------------------------------------------------------------
  console.log("\n--- Step 5: exitMember for Members 1, 2, and 3 ---");

  // Member 1 exits
  const m1BalBeforeExit = (await fetchWithRetry(() => getAccount(pg.connection, member1TokenAccount, "confirmed"), "m1 token account before exit")).amount;
  const exit1Sig = await pg.program.methods
    .exitMember()
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
  await waitForConfirmation(exit1Sig, "exitMember (Member 1)");
  const m1BalAfterExit = (await fetchWithRetry(() => getAccount(pg.connection, member1TokenAccount, "confirmed"), "m1 token account after exit")).amount;
  assertEqual(
    m1BalAfterExit - m1BalBeforeExit,
    20_000_000n,
    "Member 1 gets full deposit back (20 tokens)"
  );

  // Member 2 exits
  const m2BalBeforeExit = (await fetchWithRetry(() => getAccount(pg.connection, member2TokenAccount, "confirmed"), "m2 token account before exit")).amount;
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
    "Member 2 gets full deposit back (15 tokens)"
  );

  // Member 3 exits
  const m3BalBeforeExit = (await fetchWithRetry(() => getAccount(pg.connection, member3TokenAccount, "confirmed"), "m3 token account before exit")).amount;
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
    10_000_000n,
    "Member 3 gets full deposit back (10 tokens)"
  );

  // Check vault balance is exactly 0
  const vaultFinal = await fetchWithRetry(
    () => getAccount(pg.connection, vaultPda, "confirmed"),
    "Vault token account after all exits"
  );
  assertEqual(
    vaultFinal.amount.toString(),
    "0",
    "the vault balance is exactly 0"
  );

  // --------------------------------------------------------------------------
  // Step 6: Call claimRefund for member 1. It MUST FAIL.
  // Print PASS if it fails and FAIL if it succeeds.
  // Then call it again for the same member and confirm it fails again.
  // --------------------------------------------------------------------------
  console.log("\n--- Step 6: Verify claimRefund fails for Member 1 ---");

  // First call to claimRefund
  let firstCallFailed = false;
  try {
    const claimSig = await pg.program.methods
      .claimRefund()
      .accounts({
        circle: circlePda,
        member: creatorMemberPda,
        tokenMint: mint,
        memberTokenAccount: member1TokenAccount,
        vault: vaultPda,
        memberWallet: pg.wallet.publicKey,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .rpc();
    await waitForConfirmation(claimSig, "unexpected claimRefund (first call)");
  } catch (err: any) {
    firstCallFailed = true;
    console.log(
      `[PASS] claimRefund for member 1 correctly failed on first call: ${
        err.message || err
      }`
    );
  }

  if (!firstCallFailed) {
    console.error(
      "[FAIL] claimRefund for member 1 succeeded on first call when it MUST FAIL"
    );
    throw new Error(
      "Assertion failed: claimRefund for member 1 succeeded when it was expected to fail"
    );
  }

  // Second call to claimRefund
  let secondCallFailed = false;
  try {
    const claimSig = await pg.program.methods
      .claimRefund()
      .accounts({
        circle: circlePda,
        member: creatorMemberPda,
        tokenMint: mint,
        memberTokenAccount: member1TokenAccount,
        vault: vaultPda,
        memberWallet: pg.wallet.publicKey,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .rpc();
    await waitForConfirmation(claimSig, "unexpected claimRefund (second call)");
  } catch (err: any) {
    secondCallFailed = true;
    console.log(
      `[PASS] claimRefund for member 1 correctly failed on second call: ${
        err.message || err
      }`
    );
  }

  if (!secondCallFailed) {
    console.error(
      "[FAIL] claimRefund for member 1 succeeded on second call when it MUST FAIL"
    );
    throw new Error(
      "Assertion failed: claimRefund for member 1 succeeded on second call when it was expected to fail"
    );
  }

  console.log("\n========================================================");
  console.log(" Solthrift 5-Member Cancel Test COMPLETED SUCCESSFULLY!");
  console.log("========================================================\n");
}

// Support both Solana Playground mocha test runner and direct script execution
if (typeof describe !== "undefined") {
  describe("Solthrift Cancel Test", function () {
    this.timeout(240000);

    it("cancels open circle, refunds deposits via exitMember, and prevents claimRefund drain", async function () {
      this.timeout(240000);
      await runCancelTest();
    });
  });
} else {
  runCancelTest().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
