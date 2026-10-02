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

async function runHappyPathTest() {
  console.log("\n========================================================");
  console.log(" Starting Solthrift 4-Member Circle Happy Path Test");
  console.log("========================================================\n");

  const DECIMALS = 6;
  const DECIMALS_FACTOR = new BN(10).pow(new BN(DECIMALS)); // 1,000,000
  const ONE_TOKEN = DECIMALS_FACTOR;

  // --------------------------------------------------------------------------
  // Step 1: Create test mint with 6 decimals, token accounts, and mint 200 tokens
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
  console.log(`Test Mint created: ${mint.toBase58()}`);

  // Member 1 is pg.wallet.
  // Members 2, 3, and 4 are generated in memory ONLY (never written to disk or logged).
  const member1Wallet = pg.wallet.publicKey;
  const member2 = Keypair.generate();
  const member3 = Keypair.generate();
  const member4 = Keypair.generate();

  // Fund generated members 2, 3, and 4 with 0.02 SOL each for transaction fees
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
  await sendAndConfirmTransaction(pg.connection, fundTx, [payerKeypair]);
  console.log("Funded members 2, 3, 4 with 0.02 SOL each for transaction fees");

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

  // Mint 200 tokens (200,000,000 base units) to each of the 4 members
  const mintAmount = 200_000_000n; // 200 * 10^6
  await mintTo(pg.connection, payerKeypair, mint, member1TokenAccount, payerKeypair, mintAmount);
  await mintTo(pg.connection, payerKeypair, mint, member2TokenAccount, payerKeypair, mintAmount);
  await mintTo(pg.connection, payerKeypair, mint, member3TokenAccount, payerKeypair, mintAmount);
  await mintTo(pg.connection, payerKeypair, mint, member4TokenAccount, payerKeypair, mintAmount);
  console.log("Minted 200 tokens (200,000,000 base units) to all 4 members");

  // --------------------------------------------------------------------------
  // Step 2: create_circle with specified parameters and derive PDAs
  // --------------------------------------------------------------------------
  console.log("\n--- Step 2: create_circle ---");

  // Unique circle ID per test run
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

  const membersTarget = 4;
  const contribution = new BN(10).mul(ONE_TOKEN); // 10 tokens = 10,000,000 base units
  const depositPct = 50;
  const periodDuration = new BN(120); // 120 seconds
  const graceDuration = new BN(0);
  const fillWindowDuration = new BN(0);
  const openWindowDuration = new BN(0);

  await pg.program.methods
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

  // Assert Slot 1 deposit: max(50% * (4 - 1) * 10, 10) = 15 tokens
  const m1AccountAfterCreate = await pg.program.account.member.fetch(creatorMemberPda);
  assertEqual(
    m1AccountAfterCreate.depositRemaining.toString(),
    new BN(15).mul(ONE_TOKEN).toString(),
    "Slot 1 deposit equals 15 tokens (15,000,000 base units)"
  );

  // --------------------------------------------------------------------------
  // Step 3: Members 2, 3 and 4 join; verify deposits & circle becomes Active
  // --------------------------------------------------------------------------
  console.log("\n--- Step 3: Members 2, 3, and 4 Join ---");

  // Member 2 Joins (Slot 2)
  const [member2Pda] = PublicKey.findProgramAddressSync(
    [Buffer.from("member"), circlePda.toBuffer(), member2.publicKey.toBuffer()],
    pg.program.programId
  );
  await pg.program.methods
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

  const m2Account = await pg.program.account.member.fetch(member2Pda);
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
  await pg.program.methods
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

  const m3Account = await pg.program.account.member.fetch(member3Pda);
  assertEqual(
    m3Account.depositRemaining.toString(),
    new BN(10).mul(ONE_TOKEN).toString(),
    "Slot 3 deposit equals 10 tokens: max(50% * (4 - 3) * 10, 10) = 10 (floor of 10 applied)"
  );

  // Member 4 Joins (Slot 4)
  const [member4Pda] = PublicKey.findProgramAddressSync(
    [Buffer.from("member"), circlePda.toBuffer(), member4.publicKey.toBuffer()],
    pg.program.programId
  );
  await pg.program.methods
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

  const m4Account = await pg.program.account.member.fetch(member4Pda);
  assertEqual(
    m4Account.depositRemaining.toString(),
    new BN(10).mul(ONE_TOKEN).toString(),
    "Slot 4 deposit equals 10 tokens: max(50% * (4 - 4) * 10, 10) = 10 (floor of 10 applied)"
  );

  // Assert circle transitions to Active upon 4th member joining
  const circleAfterJoin = await pg.program.account.circle.fetch(circlePda);
  const isCircleActive = circleAfterJoin.status.active !== undefined;
  assertEqual(
    isCircleActive,
    true,
    "Circle status transitioned to Active automatically upon fourth member joining"
  );
  assertEqual(
    circleAfterJoin.currentMemberCount,
    4,
    "Circle current_member_count is 4"
  );
  assertEqual(
    circleAfterJoin.activeMemberCount,
    4,
    "Circle active_member_count is 4"
  );
  assertEqual(
    circleAfterJoin.currentPeriod,
    1,
    "Circle current_period is 1"
  );

  // --------------------------------------------------------------------------
  // Step 4: All 4 contribute for period 1, then payout to slot 1
  // --------------------------------------------------------------------------
  console.log("\n--- Step 4: Period 1 Contributions and Payout ---");

  // Member 1 contributes
  await pg.program.methods
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

  // Member 2 contributes
  await pg.program.methods
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

  // Member 3 contributes
  await pg.program.methods
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

  // Member 4 contributes
  await pg.program.methods
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

  const circleAfterContribute = await pg.program.account.circle.fetch(circlePda);
  assertEqual(
    circleAfterContribute.contributionsThisPeriod,
    4,
    "All 4 contributions recorded for Period 1 (contributions_this_period == 4)"
  );

  // Balance of Member 1 before payout (should be 175 tokens: 200 minted - 15 deposit - 10 contribution)
  const slot1BalBefore = (await getAccount(pg.connection, member1TokenAccount)).amount;

  // Call payout for period 1 (recipient is Slot 1)
  await pg.program.methods
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

  // Assert Slot 1 receives exactly 40 tokens (40,000,000 base units)
  const slot1BalAfter = (await getAccount(pg.connection, member1TokenAccount)).amount;
  const slot1TokensReceived = slot1BalAfter - slot1BalBefore;
  assertEqual(
    slot1TokensReceived.toString(),
    (40_000_000n).toString(),
    "Slot 1 receives exactly 40 tokens (40,000,000 base units) in payout"
  );

  // Assert Vault holds exactly 45 tokens (45,000,000 base units) after payout (15 + 10 + 10 + 10 deposits)
  const vaultAfterPayout = await getAccount(pg.connection, vaultPda);
  assertEqual(
    vaultAfterPayout.amount.toString(),
    (45_000_000n).toString(),
    "Vault holds exactly 45 tokens (45,000,000 base units) of total locked deposits after payout"
  );

  // Assert Slot 1 member is marked as paid
  const m1AccountAfterPayout = await pg.program.account.member.fetch(creatorMemberPda);
  assertEqual(
    m1AccountAfterPayout.hasBeenPaid,
    true,
    "Slot 1 member has_been_paid is marked true"
  );

  console.log("\n========================================================");
  console.log(" Solthrift 4-Member Happy Path Test COMPLETED SUCCESSFULLY!");
  console.log("========================================================\n");
}

// Support both Solana Playground mocha test runner and direct script execution
if (typeof describe !== "undefined") {
  describe("Solthrift Happy Path Test", () => {
    it("runs a 4-member circle through Period 1 payout", async () => {
      await runHappyPathTest();
    });
  });
} else {
  runHappyPathTest().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
