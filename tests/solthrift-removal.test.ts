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
        await new Promise((resolve) => setTimeout(resolve, delayMs));
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

async function runRemovalTest() {
  console.log("\n========================================================");
  console.log(" Starting Solthrift 4-Member Circle Removal Test");
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

  // Member 1 is pg.wallet; Members 2, 3, 4 are in-memory generated Keypairs
  const member1Wallet = pg.wallet.publicKey;
  const member2 = Keypair.generate();
  const member3 = Keypair.generate();
  const member4 = Keypair.generate();

  console.log(`Member 1 (pg.wallet): ${member1Wallet.toBase58()}`);
  console.log(`Member 2: ${member2.publicKey.toBase58()}`);
  console.log(`Member 3: ${member3.publicKey.toBase58()}`);
  console.log(`Member 4: ${member4.publicKey.toBase58()}`);

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
    }),
    SystemProgram.transfer({
      fromPubkey: pg.wallet.publicKey,
      toPubkey: member4.publicKey,
      lamports: 0.02 * LAMPORTS_PER_SOL,
    })
  );
  const fundTxSig = await sendAndConfirmTransaction(pg.connection, fundTx, [payerKeypair], {
    commitment: "confirmed",
  });
  console.log(`Funded members 2, 3, 4 with 0.02 SOL each (tx: ${fundTxSig})`);

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
  const member4TokenAccount = await createAccount(
    pg.connection,
    payerKeypair,
    mint,
    member4.publicKey
  );

  console.log(`Member 1 token account: ${member1TokenAccount.toBase58()}`);
  console.log(`Member 2 token account: ${member2TokenAccount.toBase58()}`);
  console.log(`Member 3 token account: ${member3TokenAccount.toBase58()}`);
  console.log(`Member 4 token account: ${member4TokenAccount.toBase58()}`);

  // Mint 200 tokens (200,000,000 base units) to each of the 4 members
  const mintAmount = 200_000_000n; // 200 * 10^6
  const mint1Tx = await mintTo(pg.connection, payerKeypair, mint, member1TokenAccount, payerKeypair, mintAmount);
  console.log(`Minted 200 tokens to Member 1 (tx: ${mint1Tx})`);
  const mint2Tx = await mintTo(pg.connection, payerKeypair, mint, member2TokenAccount, payerKeypair, mintAmount);
  console.log(`Minted 200 tokens to Member 2 (tx: ${mint2Tx})`);
  const mint3Tx = await mintTo(pg.connection, payerKeypair, mint, member3TokenAccount, payerKeypair, mintAmount);
  console.log(`Minted 200 tokens to Member 3 (tx: ${mint3Tx})`);
  const mint4Tx = await mintTo(pg.connection, payerKeypair, mint, member4TokenAccount, payerKeypair, mintAmount);
  console.log(`Minted 200 tokens to Member 4 (tx: ${mint4Tx})`);

  // --------------------------------------------------------------------------
  // Step 2: create_circle with 4 members, deposit_pct 50, contribution 10, period 20s, grace 0
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

  const membersTarget = 4;
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
    new BN(15).mul(ONE_TOKEN).toString(),
    "Slot 1 deposit equals 15 tokens: max(50% * (4 - 1) * 10, 10) = 15"
  );

  // --------------------------------------------------------------------------
  // Step 3: Members 2, 3 and 4 Join (All Join)
  // --------------------------------------------------------------------------
  console.log("\n--- Step 3: Members 2, 3, and 4 Join ---");

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
    "Slot 2 deposit equals 10 tokens: max(50% * (4 - 2) * 10, 10) = 10"
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
    "Slot 3 deposit equals 10 tokens: max(50% * (4 - 3) * 10, 10) = 10"
  );

  // Member 4 Joins (Slot 4)
  const [member4Pda] = PublicKey.findProgramAddressSync(
    [Buffer.from("member"), circlePda.toBuffer(), member4.publicKey.toBuffer()],
    pg.program.programId
  );
  const join4Sig = await pg.program.methods
    .joinCircle()
    .accounts({
      circle: circlePda,
      member: member4Pda,
      memberWallet: member4.publicKey,
      tokenMint: mint,
      memberTokenAccount: member4TokenAccount,
      vault: vaultPda,
      tokenProgram: TOKEN_PROGRAM_ID,
      systemProgram: SystemProgram.programId,
    })
    .signers([member4])
    .rpc();
  await waitForConfirmation(join4Sig, "joinCircle (Member 4)");

  const m4Account = await fetchWithRetry(
    () => pg.program.account.member.fetch(member4Pda, "confirmed"),
    "Member 4 account after joinCircle"
  );
  assertEqual(
    m4Account.depositRemaining.toString(),
    new BN(10).mul(ONE_TOKEN).toString(),
    "Slot 4 deposit equals 10 tokens: max(50% * (4 - 4) * 10, 10) = 10"
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
  assertEqual(
    circleAfterJoin.activeMemberCount,
    4,
    "Circle active_member_count is 4"
  );

  // --------------------------------------------------------------------------
  // Step 4: Period 1 - All contribute, payout to slot 1 (expect 40)
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

  // Member 4 contributes
  const cont4Sig = await pg.program.methods
    .contribute()
    .accounts({
      circle: circlePda,
      member: member4Pda,
      memberWallet: member4.publicKey,
      tokenMint: mint,
      memberTokenAccount: member4TokenAccount,
      vault: vaultPda,
      tokenProgram: TOKEN_PROGRAM_ID,
    })
    .signers([member4])
    .rpc();
  await waitForConfirmation(cont4Sig, "contribute (Member 4)");

  // Balance of Member 1 before payout (200 - 15 deposit - 10 contribution = 175)
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
    (40_000_000n).toString(),
    "Period 1 payout to slot 1: recipient receives exactly 40 tokens (40,000,000 base units)"
  );

  // --------------------------------------------------------------------------
  // Step 5: Period 2 - Members 1, 2, 3 contribute; Member 4 does not.
  // Wait until deadline has passed, then call removeDefaulter on Member 4.
  // --------------------------------------------------------------------------
  console.log("\n--- Step 5: Period 2 Contributions and removeDefaulter ---");

  // Member 1 contributes for Period 2
  const cont1P2Sig = await pg.program.methods
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
  await waitForConfirmation(cont1P2Sig, "contribute Period 2 (Member 1)");

  // Member 2 contributes for Period 2
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

  // Member 3 contributes for Period 2
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

  console.log("Member 4 does not contribute. Waiting 22 seconds for Period 2 deadline to pass...");
  await new Promise((resolve) => setTimeout(resolve, 22000));

  // Call removeDefaulter on Member 4, signed by member 1 as caller.
  // If it fails with GracePeriodNotExpired, wait 5 s and retry, up to 6 times.
  let removeConfirmed = false;
  for (let attempt = 1; attempt <= 6; attempt++) {
    try {
      console.log(`Calling removeDefaulter on member 4 (attempt ${attempt}/6)...`);
      const removeSig = await pg.program.methods
        .removeDefaulter()
        .accounts({
          circle: circlePda,
          member: member4Pda,
          tokenMint: mint,
          memberTokenAccount: member4TokenAccount,
          vault: vaultPda,
          caller: pg.wallet.publicKey,
          tokenProgram: TOKEN_PROGRAM_ID,
        })
        .rpc();
      await waitForConfirmation(removeSig, `removeDefaulter (Member 4, attempt ${attempt})`);
      removeConfirmed = true;
      break;
    } catch (err: any) {
      const errStr = err?.toString() || "";
      if (errStr.includes("GracePeriodNotExpired") && attempt < 6) {
        console.log(`Grace period not yet expired on cluster. Waiting 5s before retrying (attempt ${attempt}/6)...`);
        await new Promise((resolve) => setTimeout(resolve, 5000));
      } else {
        throw err;
      }
    }
  }

  if (!removeConfirmed) {
    throw new Error("Failed to remove defaulter after 6 attempts");
  }

  // --------------------------------------------------------------------------
  // Step 6: Assert Member 4 status Removed, active_member_count 3,
  // contributions_this_period 4, member 4 deposit_remaining 0, order_len 3,
  // member 4 token balance is still 190.
  // --------------------------------------------------------------------------
  console.log("\n--- Step 6: Verify State After Removal ---");

  const m4AccountAfterRemove = await fetchWithRetry(
    () => pg.program.account.member.fetch(member4Pda, "confirmed"),
    "Member 4 account after removal"
  );
  const isM4Removed = m4AccountAfterRemove.status.removed !== undefined || JSON.stringify(m4AccountAfterRemove.status).toLowerCase().includes("removed");
  assertEqual(isM4Removed, true, "member 4 status Removed");
  assertEqual(
    m4AccountAfterRemove.depositRemaining.toString(),
    "0",
    "member 4 deposit_remaining 0"
  );

  const circleAfterRemove = await fetchWithRetry(
    () => pg.program.account.circle.fetch(circlePda, "confirmed"),
    "Circle account after removal"
  );
  assertEqual(
    circleAfterRemove.activeMemberCount,
    3,
    "active_member_count 3"
  );
  assertEqual(
    circleAfterRemove.contributionsThisPeriod,
    4,
    "contributions_this_period 4"
  );
  assertEqual(
    circleAfterRemove.orderLen,
    3,
    "order_len 3"
  );

  const m4TokenAccountAfterRemove = await fetchWithRetry(
    () => getAccount(pg.connection, member4TokenAccount, "confirmed"),
    "Member 4 token account after removal"
  );
  assertEqual(
    m4TokenAccountAfterRemove.amount.toString(),
    (180_000_000n).toString(),
    "member 4's token balance is 180 (200 minus the 10 deposit and the 10 period-1 contribution; nothing refunded)"
  );

  // --------------------------------------------------------------------------
  // Step 7: Call payout (recipient slot 2). Expect slot 2 receives 40.
  // Expect the vault balance to be exactly 35 (remaining deposits 15 + 10 + 10).
  // --------------------------------------------------------------------------
  console.log("\n--- Step 7: Period 2 Payout to Slot 2 ---");

  const slot2Before = await fetchWithRetry(
    () => getAccount(pg.connection, member2TokenAccount, "confirmed"),
    "Member 2 token account before P2 payout"
  );

  const payout2Sig = await pg.program.methods
    .payout()
    .accounts({
      circle: circlePda,
      recipientMember: member2Pda,
      tokenMint: mint,
      recipientTokenAccount: member2TokenAccount,
      vault: vaultPda,
      caller: pg.wallet.publicKey,
      tokenProgram: TOKEN_PROGRAM_ID,
    })
    .rpc();
  await waitForConfirmation(payout2Sig, "payout (Period 2 to Slot 2)");

  const slot2After = await fetchWithRetry(
    () => getAccount(pg.connection, member2TokenAccount, "confirmed"),
    "Member 2 token account after P2 payout"
  );
  const slot2Received = slot2After.amount - slot2Before.amount;
  assertEqual(
    slot2Received.toString(),
    (40_000_000n).toString(),
    "slot 2 receives 40 tokens (40,000,000 base units)"
  );

  const vaultAfterPayout2 = await fetchWithRetry(
    () => getAccount(pg.connection, vaultPda, "confirmed"),
    "Vault token account after P2 payout"
  );
  assertEqual(
    vaultAfterPayout2.amount.toString(),
    (35_000_000n).toString(),
    "the vault balance to be exactly 35 (the remaining deposits 15 + 10 + 10)"
  );

  console.log("\n========================================================");
  console.log(" Solthrift 4-Member Removal Test COMPLETED SUCCESSFULLY!");
  console.log("========================================================\n");
}

// Support both Solana Playground mocha test runner and direct script execution
if (typeof describe !== "undefined") {
  describe("Solthrift Removal Test", function () {
    this.timeout(240000);

    it("handles defaulter removal and subsequent payout", async function () {
      this.timeout(240000);
      await runRemovalTest();
    });
  });
} else {
  runRemovalTest().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
