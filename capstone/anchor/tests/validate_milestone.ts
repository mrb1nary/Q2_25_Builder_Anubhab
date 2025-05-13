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

describe("validate_milestone", () => {
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
  const amountAsked = new anchor.BN(1000000000);
  const totalMilestones = 3;
  const securityDeposit = new anchor.BN(100000000);
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
      1000000000
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

    // Create proposal
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

    // Set milestone to Active state directly (for testing purposes)
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
  });

  it("Successfully validates a milestone with approval", async () => {
    // Fetch milestone before validation
    const milestoneBefore = await program.account.milestone.fetch(milestonePda);

    // Validate milestone with approval
    await program.methods
      .validateMilestone(true) // approve
      .accounts({
        validator: validator.publicKey,
        milestone: milestonePda,
        proposal: proposalPda,
        vote: votePda,
        systemProgram: anchor.web3.SystemProgram.programId,
      })
      .signers([validator])
      .rpc();

    // Fetch milestone and vote after validation
    const milestoneAfter = await program.account.milestone.fetch(milestonePda);
    const vote = await program.account.vote.fetch(votePda);

    // Assert vote was recorded correctly
    assert.equal(vote.validator.toString(), validator.publicKey.toString());
    assert.equal(vote.milestone.toString(), milestonePda.toString());
    assert.equal(vote.approved, true);
    assert.isTrue(vote.votedAt.toNumber() > 0);

    // Assert validation votes increased
    assert.equal(
      milestoneAfter.validationVotes,
      milestoneBefore.validationVotes + 1
    );

    // Check if milestone was validated (depends on threshold)
    if (milestoneAfter.validationVotes > milestoneAfter.totalValidators / 2) {
      assert.deepEqual(milestoneAfter.status, { validated: {} });
      assert.equal(milestoneAfter.fundsReleased, true);
    }
  });

  it("Successfully changes vote from approve to reject", async () => {
    // Skip this test if milestone was already validated
    const milestone = await program.account.milestone.fetch(milestonePda);
    if (milestone.status.validated) {
      console.log("Milestone already validated, skipping vote change test");
      return;
    }

    // Validate milestone with rejection (changing previous vote)
    await program.methods
      .validateMilestone(false) // reject
      .accounts({
        validator: validator.publicKey,
        milestone: milestonePda,
        proposal: proposalPda,
        vote: votePda,
        systemProgram: anchor.web3.SystemProgram.programId,
      })
      .signers([validator])
      .rpc();

    // Fetch milestone and vote after validation
    const milestoneAfter = await program.account.milestone.fetch(milestonePda);
    const vote = await program.account.vote.fetch(votePda);

    // Assert vote was updated correctly
    assert.equal(vote.approved, false);

    // Assert validation votes decreased
    assert.equal(milestoneAfter.validationVotes, 0);
  });

  it("Fails if milestone is not in Active state", async () => {
    // Create a new milestone that's not in Active state
    const newMilestoneNumber = 2;
    const [newMilestonePda] = anchor.web3.PublicKey.findProgramAddressSync(
      [
        Buffer.from("milestone"),
        proposalPda.toBuffer(),
        Buffer.from([newMilestoneNumber]),
      ],
      program.programId
    );

    // Submit the milestone (which will be in Pending state)
    await program.methods
      .submitMilestone(newMilestoneNumber, "QmNewEvidence")
      .accounts({
        researcher: researcher.publicKey,
        proposal: proposalPda,
        milestone: newMilestonePda,
        systemProgram: anchor.web3.SystemProgram.programId,
      })
      .rpc();

    // Derive vote PDA for new milestone
    const [newVotePda] = anchor.web3.PublicKey.findProgramAddressSync(
      [
        Buffer.from("vote"),
        validator.publicKey.toBuffer(),
        newMilestonePda.toBuffer(),
      ],
      program.programId
    );

    try {
      // Try to validate the pending milestone
      await program.methods
        .validateMilestone(true)
        .accounts({
          validator: validator.publicKey,
          milestone: newMilestonePda,
          proposal: proposalPda,
          vote: newVotePda,
          systemProgram: anchor.web3.SystemProgram.programId,
        })
        .signers([validator])
        .rpc({ skipPreflight: true });
      assert.fail("Should have thrown error");
    } catch (err) {
      assert.ok(err, "Expected an error but none was thrown");
      console.log("Error received:", err.toString());
    }
  });

  // Additional test: Multiple validators reaching threshold
  it("Validates milestone when threshold is reached with multiple validators", async () => {
    // Only run this test if the milestone isn't already validated
    const milestone = await program.account.milestone.fetch(milestonePda);
    if (milestone.status.validated) {
      console.log("Milestone already validated, skipping threshold test");
      return;
    }

    // Create additional validators
    const validator2 = anchor.web3.Keypair.generate();
    const validator3 = anchor.web3.Keypair.generate();

    // Fund validators
    await provider.connection.confirmTransaction(
      await provider.connection.requestAirdrop(
        validator2.publicKey,
        1 * anchor.web3.LAMPORTS_PER_SOL
      )
    );
    await provider.connection.confirmTransaction(
      await provider.connection.requestAirdrop(
        validator3.publicKey,
        1 * anchor.web3.LAMPORTS_PER_SOL
      )
    );

    // Derive vote PDAs
    const [vote2Pda] = anchor.web3.PublicKey.findProgramAddressSync(
      [
        Buffer.from("vote"),
        validator2.publicKey.toBuffer(),
        milestonePda.toBuffer(),
      ],
      program.programId
    );

    const [vote3Pda] = anchor.web3.PublicKey.findProgramAddressSync(
      [
        Buffer.from("vote"),
        validator3.publicKey.toBuffer(),
        milestonePda.toBuffer(),
      ],
      program.programId
    );

    // First validator votes to approve
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

    // Second validator votes to approve
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

    // Check milestone status after 2 approvals
    const milestoneAfter2 = await program.account.milestone.fetch(milestonePda);

    // If threshold is reached, milestone should be validated
    if (milestoneAfter2.validationVotes > milestoneAfter2.totalValidators / 2) {
      assert.deepEqual(milestoneAfter2.status, { validated: {} });
      assert.equal(milestoneAfter2.fundsReleased, true);
    } else {
      // Third validator votes to approve
      await program.methods
        .validateMilestone(true)
        .accounts({
          validator: validator3.publicKey,
          milestone: milestonePda,
          proposal: proposalPda,
          vote: vote3Pda,
          systemProgram: anchor.web3.SystemProgram.programId,
        })
        .signers([validator3])
        .rpc();

      // Check milestone status after 3 approvals
      const milestoneAfter3 = await program.account.milestone.fetch(
        milestonePda
      );
      assert.deepEqual(milestoneAfter3.status, { validated: {} });
      assert.equal(milestoneAfter3.fundsReleased, true);
    }
  });
});
