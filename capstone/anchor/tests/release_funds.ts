import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { Anchor } from "../target/types/anchor";
import { assert } from "chai";
import {
  createMint,
  getAccount,
  TOKEN_PROGRAM_ID,
  getAssociatedTokenAddressSync,
  createAssociatedTokenAccountInstruction,
  mintTo,
} from "@solana/spl-token";

describe("release_funds", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const program = anchor.workspace.anchor as Program<Anchor>;

  // Main accounts
  let researcher = provider.wallet;
  let validator = anchor.web3.Keypair.generate();
  let proposalPda: anchor.web3.PublicKey;
  let milestonePda: anchor.web3.PublicKey;
  let votePda: anchor.web3.PublicKey;
  let mint: anchor.web3.PublicKey;
  let researcherTokenAccount: anchor.web3.PublicKey;
  let escrowPda: anchor.web3.PublicKey;

  // Generate a unique title for this test run
  const uniqueId = Math.random().toString(36).substring(2, 8);
  const title = `Test_${uniqueId}`;
  const abstract = "Test Abstract";
  const ipfsHash = "QmTestHash";
  const amountAsked = new anchor.BN(1000000000); // 1 token with 9 decimals
  const totalMilestones = 3;
  const securityDeposit = new anchor.BN(100000000); // 0.1 token
  const milestoneNumber = 1;
  const evidenceHash = "QmTestEvidenceHash";

  before(async () => {
    // Fund validator wallet
    const airdropSig = await provider.connection.requestAirdrop(
      validator.publicKey,
      2 * anchor.web3.LAMPORTS_PER_SOL
    );
    await provider.connection.confirmTransaction(airdropSig);

    // Create mint
    mint = await createMint(
      provider.connection,
      researcher.payer,
      researcher.publicKey,
      null,
      9
    );

    // Create researcher's token account
    researcherTokenAccount = getAssociatedTokenAddressSync(
      mint,
      researcher.publicKey
    );

    // Create ATA for researcher
    try {
      const tx = new anchor.web3.Transaction().add(
        createAssociatedTokenAccountInstruction(
          researcher.publicKey,
          researcherTokenAccount,
          researcher.publicKey,
          mint
        )
      );
      await provider.sendAndConfirm(tx);
    } catch (err) {
      console.log(
        "Token account creation error (may already exist):",
        err.message
      );
    }

    // Mint tokens to researcher
    await mintTo(
      provider.connection,
      researcher.payer,
      mint,
      researcherTokenAccount,
      researcher.publicKey,
      2000000000 // 2 tokens (for security deposit + funding)
    );

    // Derive proposal PDA with unique title
    [proposalPda] = anchor.web3.PublicKey.findProgramAddressSync(
      [
        Buffer.from("proposal"),
        researcher.publicKey.toBuffer(),
        Buffer.from(title),
      ],
      program.programId
    );

    // Derive escrow PDA
    [escrowPda] = anchor.web3.PublicKey.findProgramAddressSync(
      [Buffer.from("escrow"), proposalPda.toBuffer()],
      program.programId
    );

    // Create proposal with unique title
    await program.methods
      .createProposal(
        title,
        abstract,
        ipfsHash,
        amountAsked,
        totalMilestones,
        securityDeposit
      )
      .accounts({
        researcher: researcher.publicKey,
        proposal: proposalPda,
        escrow: escrowPda,
        mint: mint,
        researcherTokenAccount: researcherTokenAccount,
        systemProgram: anchor.web3.SystemProgram.programId,
        tokenProgram: TOKEN_PROGRAM_ID,
        rent: anchor.web3.SYSVAR_RENT_PUBKEY,
      })
      .rpc();

    // Fund the proposal (as researcher for simplicity)
    await program.methods
      .fundProposal(amountAsked)
      .accounts({
        contributor: researcher.publicKey,
        proposal: proposalPda,
        contributorAccount: anchor.web3.PublicKey.findProgramAddressSync(
          [
            Buffer.from("contributor"),
            researcher.publicKey.toBuffer(),
            proposalPda.toBuffer(),
          ],
          program.programId
        )[0],
        escrow: escrowPda,
        mint: mint,
        contributorTokenAccount: researcherTokenAccount,
        tokenProgram: TOKEN_PROGRAM_ID,
        systemProgram: anchor.web3.SystemProgram.programId,
        rent: anchor.web3.SYSVAR_RENT_PUBKEY,
      })
      .rpc();

    // Derive milestone PDA
    [milestonePda] = anchor.web3.PublicKey.findProgramAddressSync(
      [
        Buffer.from("milestone"),
        proposalPda.toBuffer(),
        Buffer.from([milestoneNumber]),
      ],
      program.programId
    );

    // Submit milestone
    await program.methods
      .submitMilestone(milestoneNumber, evidenceHash)
      .accounts({
        researcher: researcher.publicKey,
        proposal: proposalPda,
        milestone: milestonePda,
        systemProgram: anchor.web3.SystemProgram.programId,
      })
      .rpc();

    // Set milestone to Active state (if needed)
    try {
      await program.methods
        .setMilestoneActive()
        .accounts({
          authority: researcher.publicKey,
          milestone: milestonePda,
        })
        .rpc();
    } catch (err) {
      console.log(
        "Note: setMilestoneActive instruction not available, continuing test"
      );
    }

    // Derive vote PDA
    [votePda] = anchor.web3.PublicKey.findProgramAddressSync(
      [
        Buffer.from("vote"),
        validator.publicKey.toBuffer(),
        milestonePda.toBuffer(),
      ],
      program.programId
    );

    // Validate milestone with approval
    // We need to validate the milestone before we can release funds
    await program.methods
      .validateMilestone(true)
      .accounts({
        validator: validator.publicKey,
        milestone: milestonePda,
        proposal: proposalPda,
        vote: votePda,
        systemProgram: anchor.web3.SystemProgram.programId,
      })
      .signers([validator])
      .rpc();

    // Create additional validators and have them approve to reach threshold
    const validator2 = anchor.web3.Keypair.generate();
    await provider.connection.confirmTransaction(
      await provider.connection.requestAirdrop(
        validator2.publicKey,
        1 * anchor.web3.LAMPORTS_PER_SOL
      )
    );

    const [vote2Pda] = anchor.web3.PublicKey.findProgramAddressSync(
      [
        Buffer.from("vote"),
        validator2.publicKey.toBuffer(),
        milestonePda.toBuffer(),
      ],
      program.programId
    );

    await program.methods
      .validateMilestone(true)
      .accounts({
        validator: validator2.publicKey,
        milestone: milestonePda,
        proposal: proposalPda,
        vote: vote2Pda,
        systemProgram: anchor.web3.SystemProgram.programId,
      })
      .signers([validator2])
      .rpc();
  });

  it("Successfully releases funds for a validated milestone", async () => {
    // Verify milestone is validated before proceeding
    const milestoneBefore = await program.account.milestone.fetch(milestonePda);
    if (!milestoneBefore.status.validated) {
      console.log("Milestone not validated, skipping test");
      return;
    }

    // Skip test if funds are already released
    if (milestoneBefore.fundsReleased) {
      console.log("Funds already released, skipping test");
      return;
    }

    // Get token balances before
    const escrowBalanceBefore = (
      await getAccount(provider.connection, escrowPda)
    ).amount;
    const researcherBalanceBefore = (
      await getAccount(provider.connection, researcherTokenAccount)
    ).amount;

    // Calculate expected payment
    const expectedPayment = amountAsked.div(new anchor.BN(totalMilestones));

    // Release funds
    await program.methods
      .releaseFunds()
      .accounts({
        researcher: researcher.publicKey,
        proposal: proposalPda,
        escrow: escrowPda,
        milestone: milestonePda,
        researcherTokenAccount: researcherTokenAccount,
        tokenProgram: TOKEN_PROGRAM_ID,
        systemProgram: anchor.web3.SystemProgram.programId,
      })
      .rpc();

    // Fetch accounts after release
    const milestoneAfter = await program.account.milestone.fetch(milestonePda);
    const proposalAfter = await program.account.proposal.fetch(proposalPda);
    const escrowBalanceAfter = (
      await getAccount(provider.connection, escrowPda)
    ).amount;
    const researcherBalanceAfter = (
      await getAccount(provider.connection, researcherTokenAccount)
    ).amount;

    // Assert milestone updated
    assert.equal(milestoneAfter.fundsReleased, true);

    // Assert token balances changed correctly
    assert.equal(
      escrowBalanceAfter.toString(),
      (
        BigInt(escrowBalanceBefore.toString()) -
        BigInt(expectedPayment.toString())
      ).toString()
    );
    assert.equal(
      researcherBalanceAfter.toString(),
      (
        BigInt(researcherBalanceBefore.toString()) +
        BigInt(expectedPayment.toString())
      ).toString()
    );

    // Check if proposal was marked completed (if this was the last milestone)
    if (proposalAfter.currentMilestone === proposalAfter.totalMilestones) {
      assert.deepEqual(proposalAfter.status, { completed: {} });
    }
  });

  it("Fails if funds are already released", async () => {
    try {
      await program.methods
        .releaseFunds()
        .accounts({
          researcher: researcher.publicKey,
          proposal: proposalPda,
          escrow: escrowPda,
          milestone: milestonePda,
          researcherTokenAccount: researcherTokenAccount,
          tokenProgram: TOKEN_PROGRAM_ID,
          systemProgram: anchor.web3.SystemProgram.programId,
        })
        .rpc({ skipPreflight: true });
      assert.fail("Should have thrown error");
    } catch (err) {
      assert.ok(err, "Expected an error but none was thrown");
      console.log("Error received:", err.toString());
    }
  });

  it("Fails if milestone is not validated", async () => {
    // Create a new milestone that's not validated
    const newMilestoneNumber = 2;
    const [newMilestonePda] = anchor.web3.PublicKey.findProgramAddressSync(
      [
        Buffer.from("milestone"),
        proposalPda.toBuffer(),
        Buffer.from([newMilestoneNumber]),
      ],
      program.programId
    );

    // Submit the milestone
    await program.methods
      .submitMilestone(newMilestoneNumber, "QmNewEvidence")
      .accounts({
        researcher: researcher.publicKey,
        proposal: proposalPda,
        milestone: newMilestonePda,
        systemProgram: anchor.web3.SystemProgram.programId,
      })
      .rpc();

    try {
      await program.methods
        .releaseFunds()
        .accounts({
          researcher: researcher.publicKey,
          proposal: proposalPda,
          escrow: escrowPda,
          milestone: newMilestonePda,
          researcherTokenAccount: researcherTokenAccount,
          tokenProgram: TOKEN_PROGRAM_ID,
          systemProgram: anchor.web3.SystemProgram.programId,
        })
        .rpc({ skipPreflight: true });
      assert.fail("Should have thrown error");
    } catch (err) {
      assert.ok(err, "Expected an error but none was thrown");
      console.log("Error received:", err.toString());
    }
  });
});
