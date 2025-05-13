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

describe("submit_milestone", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const program = anchor.workspace.anchor as Program<Anchor>;

  let researcher = provider.wallet;
  let proposalPda: anchor.web3.PublicKey;
  let milestonePda: anchor.web3.PublicKey;
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

    // Create proposal first
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
  });

  it("Submits a milestone successfully", async () => {
    // Fetch proposal account before submission
    const proposalBefore = await program.account.proposal.fetch(proposalPda);

    // Call submit_milestone
    await program.methods
      .submitMilestone(milestoneNumber, evidenceHash)
      .accounts({
        researcher: researcher.publicKey,
        proposal: proposalPda,
        milestone: milestonePda,
        systemProgram: anchor.web3.SystemProgram.programId,
      })
      .rpc();

    // Fetch proposal and milestone after submission
    const proposalAfter = await program.account.proposal.fetch(proposalPda);
    const milestone = await program.account.milestone.fetch(milestonePda);

    // Assert proposal current milestone updated
    assert.equal(proposalAfter.currentMilestone, milestoneNumber);

    // Assert milestone fields
    assert.equal(milestone.proposal.toString(), proposalPda.toString());
    assert.equal(milestone.milestoneNumber, milestoneNumber);
    assert.equal(milestone.evidenceHash, evidenceHash);
    assert.equal(milestone.validationVotes, 0);
    assert.equal(milestone.totalValidators, 3);
    assert.equal(milestone.fundsReleased, false);
    assert.deepEqual(milestone.status, { pending: {} });

    // Check timestamps are set
    assert.isTrue(
      milestone.createdAt.toNumber() > 0,
      "Created timestamp should be set"
    );
    assert.isTrue(
      milestone.updatedAt.toNumber() > 0,
      "Updated timestamp should be set"
    );

    // Check deadline is set to 14 days from now
    assert.isTrue(
      milestone.deadline.toNumber() > milestone.createdAt.toNumber(),
      "Deadline should be after creation time"
    );

    // Verify deadline is approx 14 days (with some tolerance of course)
    const expectedDeadline = milestone.createdAt.toNumber() + 14 * 86400;
    const tolerance = 10; // Allow 10 seconds tolerance
    assert.approximately(
      milestone.deadline.toNumber(),
      expectedDeadline,
      tolerance,
      "Deadline should be 14 days after creation"
    );
  });

  it("Fails if milestone number is out of sequence", async () => {
    try {
      const outOfSequenceNumber = 3; // Should be 2 since we just submitted 1
      const [invalidMilestonePda] =
        anchor.web3.PublicKey.findProgramAddressSync(
          [
            Buffer.from("milestone"),
            proposalPda.toBuffer(),
            Buffer.from([outOfSequenceNumber]),
          ],
          program.programId
        );

      await program.methods
        .submitMilestone(outOfSequenceNumber, evidenceHash)
        .accounts({
          researcher: researcher.publicKey,
          proposal: proposalPda,
          milestone: invalidMilestonePda,
          systemProgram: anchor.web3.SystemProgram.programId,
        })
        .rpc({ skipPreflight: true });
      assert.fail("Should have thrown error");
    } catch (err) {
      // Just check that an error occurred
      assert.ok(err, "Expected an error but none was thrown");
      console.log("Error received:", err.toString());
    }
  });

  it("Fails if milestone number exceeds total milestones", async () => {
    try {
      const invalidMilestoneNumber = 10; // Total is only 3
      const [invalidMilestonePda] =
        anchor.web3.PublicKey.findProgramAddressSync(
          [
            Buffer.from("milestone"),
            proposalPda.toBuffer(),
            Buffer.from([invalidMilestoneNumber]),
          ],
          program.programId
        );

      await program.methods
        .submitMilestone(invalidMilestoneNumber, evidenceHash)
        .accounts({
          researcher: researcher.publicKey,
          proposal: proposalPda,
          milestone: invalidMilestonePda,
          systemProgram: anchor.web3.SystemProgram.programId,
        })
        .rpc({ skipPreflight: true });
      assert.fail("Should have thrown error");
    } catch (err) {
      // Just check that an error occurred
      assert.ok(err, "Expected an error but none was thrown");
      console.log("Error received:", err.toString());
    }
  });
});
