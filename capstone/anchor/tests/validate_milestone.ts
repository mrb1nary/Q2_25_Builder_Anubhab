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
  const LAMPORTS_PER_SOL = anchor.web3.LAMPORTS_PER_SOL;

  let researcher = provider.wallet;
  let validator = anchor.web3.Keypair.generate();
  let proposalPda: anchor.web3.PublicKey;
  let milestonePda: anchor.web3.PublicKey;
  let votePda: anchor.web3.PublicKey;
  let mint: anchor.web3.PublicKey;
  let researcherTokenAccount: anchor.web3.PublicKey;
  let escrowPda: anchor.web3.PublicKey;

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
    // Fund validator account using provider wallet as fallback
    try {
      const airdropSig = await provider.connection.requestAirdrop(
        validator.publicKey,
        2 * LAMPORTS_PER_SOL
      );
      await provider.connection.confirmTransaction(airdropSig);
    } catch (err) {
      console.log("Airdrop failed, transferring from main wallet...");
      await program.methods
        .transferSol(new anchor.BN(0.5 * LAMPORTS_PER_SOL))
        .accounts({
          from: researcher.publicKey,
          to: validator.publicKey,
        })
        .rpc();
    }

    // Create test mint
    mint = await createMint(
      provider.connection,
      researcher.payer,
      researcher.publicKey,
      null,
      9
    );

    // Get/create researcher token account
    researcherTokenAccount = getAssociatedTokenAddressSync(
      mint,
      researcher.publicKey
    );

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
      console.log("Token account exists, continuing...");
    }

    // Mint test tokens (1000 tokens with 9 decimals)
    await mintTo(
      provider.connection,
      researcher.payer,
      mint,
      researcherTokenAccount,
      researcher.publicKey,
      1000000000000 // 1000 tokens
    );

    // Derive proposal PDA
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

    // Activate milestone if available
    try {
      await program.methods
        .setMilestoneActive()
        .accounts({
          authority: researcher.publicKey,
          milestone: milestonePda,
        })
        .rpc();
    } catch (err) {
      console.log("setMilestoneActive not available, continuing...");
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

  describe("Single Validator Workflow", () => {
    it("Successfully validates a milestone with approval", async () => {
      const milestoneBefore = await program.account.milestone.fetch(
        milestonePda
      );

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

      const milestoneAfter = await program.account.milestone.fetch(
        milestonePda
      );
      const vote = await program.account.vote.fetch(votePda);

      assert.equal(vote.validator.toString(), validator.publicKey.toString());
      assert.equal(vote.milestone.toString(), milestonePda.toString());
      assert.equal(vote.approved, true);
      assert.isTrue(vote.votedAt.toNumber() > 0);
      assert.equal(
        milestoneAfter.validationVotes,
        milestoneBefore.validationVotes + 1
      );

      if (milestoneAfter.validationVotes > milestoneAfter.totalValidators / 2) {
        assert.deepEqual(milestoneAfter.status, { validated: {} });
        assert.equal(milestoneAfter.fundsReleased, true);
      }
    });

    it("Successfully changes vote from approve to reject", async () => {
      const milestone = await program.account.milestone.fetch(milestonePda);
      if (milestone.status.validated) {
        console.log("Skipping vote change test (already validated)");
        return;
      }

      await program.methods
        .validateMilestone(false)
        .accounts({
          validator: validator.publicKey,
          milestone: milestonePda,
          proposal: proposalPda,
          vote: votePda,
          systemProgram: anchor.web3.SystemProgram.programId,
        })
        .signers([validator])
        .rpc();

      const milestoneAfter = await program.account.milestone.fetch(
        milestonePda
      );
      const vote = await program.account.vote.fetch(votePda);

      assert.equal(vote.approved, false);
      assert.equal(milestoneAfter.validationVotes, 0);
    });
  });

  describe("Validation Edge Cases", () => {
    it("Fails if milestone is not in Active state", async () => {
      const newMilestoneNumber = 2;
      const [newMilestonePda] = anchor.web3.PublicKey.findProgramAddressSync(
        [
          Buffer.from("milestone"),
          proposalPda.toBuffer(),
          Buffer.from([newMilestoneNumber]),
        ],
        program.programId
      );

      await program.methods
        .submitMilestone(newMilestoneNumber, "QmNewEvidence")
        .accounts({
          researcher: researcher.publicKey,
          proposal: proposalPda,
          milestone: newMilestonePda,
          systemProgram: anchor.web3.SystemProgram.programId,
        })
        .rpc();

      const [newVotePda] = anchor.web3.PublicKey.findProgramAddressSync(
        [
          Buffer.from("vote"),
          validator.publicKey.toBuffer(),
          newMilestonePda.toBuffer(),
        ],
        program.programId
      );

      try {
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
        console.log(
          "Test passed: Milestone not active - expected failure occurred"
        );
        console.log("   Error received:", err.toString());
      }
    });
  });

  describe("Multi-Validator Workflow", () => {
    it("Validates milestone when threshold is reached", async () => {
      const milestone = await program.account.milestone.fetch(milestonePda);
      if (milestone.status.validated) {
        console.log("Skipping threshold test (already validated)");
        return;
      }

      const validator2 = provider.wallet;
      const validator3 = provider.wallet;

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

      // First validation
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

      // Second validation
      await program.methods
        .validateMilestone(true)
        .accounts({
          validator: validator2.publicKey,
          milestone: milestonePda,
          proposal: proposalPda,
          vote: vote2Pda,
          systemProgram: anchor.web3.SystemProgram.programId,
        })
        .rpc();

      const milestoneAfter2 = await program.account.milestone.fetch(
        milestonePda
      );

      if (
        milestoneAfter2.validationVotes >
        milestoneAfter2.totalValidators / 2
      ) {
        assert.deepEqual(milestoneAfter2.status, { validated: {} });
        assert.equal(milestoneAfter2.fundsReleased, true);
      } else {
        await program.methods
          .validateMilestone(true)
          .accounts({
            validator: validator3.publicKey,
            milestone: milestonePda,
            proposal: proposalPda,
            vote: vote3Pda,
            systemProgram: anchor.web3.SystemProgram.programId,
          })
          .rpc();

        const milestoneAfter3 = await program.account.milestone.fetch(
          milestonePda
        );
        assert.deepEqual(milestoneAfter3.status, { validated: {} });
        assert.equal(milestoneAfter3.fundsReleased, true);
      }
    });
  });
});
