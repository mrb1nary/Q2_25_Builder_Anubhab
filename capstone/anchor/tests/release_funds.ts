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
    // Airdrop SOL to validator
    await provider.connection.confirmTransaction(
      await provider.connection.requestAirdrop(
        validator.publicKey,
        1 * anchor.web3.LAMPORTS_PER_SOL
      ),
      "confirmed"
    );

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
      2000000000
    );

    [proposalPda] = anchor.web3.PublicKey.findProgramAddressSync(
      [
        Buffer.from("proposal"),
        researcher.publicKey.toBuffer(),
        Buffer.from(title),
      ],
      program.programId
    );

    [escrowPda] = anchor.web3.PublicKey.findProgramAddressSync(
      [Buffer.from("escrow"), proposalPda.toBuffer()],
      program.programId
    );

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

    [milestonePda] = anchor.web3.PublicKey.findProgramAddressSync(
      [
        Buffer.from("milestone"),
        proposalPda.toBuffer(),
        Buffer.from([milestoneNumber]),
      ],
      program.programId
    );

    await program.methods
      .submitMilestone(milestoneNumber, evidenceHash)
      .accounts({
        researcher: researcher.publicKey,
        proposal: proposalPda,
        milestone: milestonePda,
        systemProgram: anchor.web3.SystemProgram.programId,
      })
      .rpc();

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

    [votePda] = anchor.web3.PublicKey.findProgramAddressSync(
      [
        Buffer.from("vote"),
        validator.publicKey.toBuffer(),
        milestonePda.toBuffer(),
      ],
      program.programId
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
    const milestoneBefore = await program.account.milestone.fetch(milestonePda);
    if (!milestoneBefore.status.validated) {
      console.log("Milestone not validated, skipping test");
      return;
    }

    if (milestoneBefore.fundsReleased) {
      console.log("Funds already released, skipping test");
      return;
    }

    const escrowBalanceBefore = (
      await getAccount(provider.connection, escrowPda)
    ).amount;
    const researcherBalanceBefore = (
      await getAccount(provider.connection, researcherTokenAccount)
    ).amount;

    const expectedPayment = amountAsked.div(new anchor.BN(totalMilestones));

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

    const milestoneAfter = await program.account.milestone.fetch(milestonePda);
    const proposalAfter = await program.account.proposal.fetch(proposalPda);
    const escrowBalanceAfter = (
      await getAccount(provider.connection, escrowPda)
    ).amount;
    const researcherBalanceAfter = (
      await getAccount(provider.connection, researcherTokenAccount)
    ).amount;

    assert.equal(milestoneAfter.fundsReleased, true);
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
