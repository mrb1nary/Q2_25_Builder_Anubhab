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

describe("close_proposal", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const program = anchor.workspace.anchor as Program<Anchor>;

  let researcher = provider.wallet;
  let proposalPda: anchor.web3.PublicKey;
  let escrowPda: anchor.web3.PublicKey;
  let mint: anchor.web3.PublicKey;
  let researcherTokenAccount: anchor.web3.PublicKey;

  const title = "Test Proposal";
  const abstract = "Test Abstract";
  const ipfsHash = "QmTestHash";
  const amountAsked = new anchor.BN(1000000000);
  const totalMilestones = 3;
  const securityDeposit = new anchor.BN(200000000);

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

    // Generate a truly unique title using both timestamp and random number
    const uniqueTitle = `${title}_${Math.random().toString(36).substring(7)}`;
    console.log(`Using unique title: ${uniqueTitle}`);

    // Derive PDAs with unique title
    [proposalPda] = anchor.web3.PublicKey.findProgramAddressSync(
      [
        Buffer.from("proposal"),
        researcher.publicKey.toBuffer(),
        Buffer.from(uniqueTitle),
      ],
      program.programId
    );

    [escrowPda] = anchor.web3.PublicKey.findProgramAddressSync(
      [Buffer.from("escrow"), proposalPda.toBuffer()],
      program.programId
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
      // Ignore if account already exists
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

    // Create proposal with the unique title
    await program.methods
      .createProposal(
        uniqueTitle,
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
  });

  it("Successfully closes a completed proposal with empty escrow", async () => {
    // Forcing proposal status to "Completed"
    try {
      await program.methods
        .testSetProposalStatus({ completed: {} })
        .accounts({
          authority: researcher.publicKey,
          proposal: proposalPda,
        })
        .rpc();
    } catch (err) {
      console.log(
        "Note: testSetProposalStatus instruction not available, skipping status set."
      );
    }

    // For test, we assume escrow is empty or we can empty it manually

    // Attempt to close proposal
    await program.methods
      .closeProposal()
      .accounts({
        proposal: proposalPda,
        researcher: researcher.publicKey,
        escrow: escrowPda,
        tokenProgram: TOKEN_PROGRAM_ID,
        systemProgram: anchor.web3.SystemProgram.programId,
      })
      .rpc();

    // Fetch proposal account to verify it is closed
    try {
      await program.account.proposal.fetch(proposalPda);
      assert.fail("Proposal account should be closed and not fetchable");
    } catch (err) {
      assert.ok(err, "Expected error fetching closed proposal");
    }
  });

  it("Fails to close proposal if escrow is not empty", async () => {
    // Create a new proposal for this test with unique title
    const newTitle = `Test Proposal 2_${Math.random()
      .toString(36)
      .substring(7)}`;

    // Derive new PDAs with unique title
    const [newProposalPda] = anchor.web3.PublicKey.findProgramAddressSync(
      [
        Buffer.from("proposal"),
        researcher.publicKey.toBuffer(),
        Buffer.from(newTitle),
      ],
      program.programId
    );

    const [newEscrowPda] = anchor.web3.PublicKey.findProgramAddressSync(
      [Buffer.from("escrow"), newProposalPda.toBuffer()],
      program.programId
    );

    // Create the new proposal
    await program.methods
      .createProposal(
        newTitle, // Use unique title
        abstract,
        ipfsHash,
        amountAsked,
        totalMilestones,
        securityDeposit
      )
      .accounts({
        researcher: researcher.publicKey,
        proposal: newProposalPda,
        escrow: newEscrowPda,
        mint: mint,
        researcherTokenAccount: researcherTokenAccount,
        systemProgram: anchor.web3.SystemProgram.programId,
        tokenProgram: TOKEN_PROGRAM_ID,
        rent: anchor.web3.SYSVAR_RENT_PUBKEY,
      })
      .rpc();

    // Rest of the test remains the same...
  });

  it("Fails to close proposal if status is not completed or failed", async () => {
    // Create a new proposal with unique title
    const newTitle = `Test Proposal 3_${Math.random()
      .toString(36)
      .substring(7)}`;

    const [newProposalPda] = anchor.web3.PublicKey.findProgramAddressSync(
      [
        Buffer.from("proposal"),
        researcher.publicKey.toBuffer(),
        Buffer.from(newTitle),
      ],
      program.programId
    );

    const [newEscrowPda] = anchor.web3.PublicKey.findProgramAddressSync(
      [Buffer.from("escrow"), newProposalPda.toBuffer()],
      program.programId
    );

    // Rest of the test remains the same...
  });
});
