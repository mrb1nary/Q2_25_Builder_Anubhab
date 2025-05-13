import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { Anchor } from "../target/types/anchor";
import { assert } from "chai";
import {
  createInitializeMintInstruction,
  getMintLen,
  getAccount,
  TOKEN_PROGRAM_ID,
  ASSOCIATED_TOKEN_PROGRAM_ID,
  createMintToInstruction,
  createAssociatedTokenAccountInstruction,
  getAssociatedTokenAddressSync,
} from "@solana/spl-token";

describe("Create Proposal Test", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const program = anchor.workspace.anchor as Program<Anchor>;

  let researcher = provider.wallet;
  let proposalPda: anchor.web3.PublicKey;
  let escrowPda: anchor.web3.PublicKey;
  let mint: anchor.web3.PublicKey;
  let mintKeypair: anchor.web3.Keypair;
  let researcherTokenAccount: anchor.web3.PublicKey;

  // Generate a unique ID for this test run
  const uniqueId = Math.random().toString(36).substring(2, 8);
  const title = `Research_${uniqueId}`;
  const abstractText = "This is a test proposal";
  const ipfsHash = "QmTestHash";
  const amountAsked = new anchor.BN(1000000000); // 1 SOL
  const totalMilestones = 3;
  const securityDeposit = new anchor.BN(100000000); // 0.1 SOL
  const decimals = 9;

  before(async () => {
    try {
      // Create mint keypair
      mintKeypair = anchor.web3.Keypair.generate();
      mint = mintKeypair.publicKey;

      // Get mint account size and rent
      const mintLen = getMintLen([]);
      const mintLamports =
        await provider.connection.getMinimumBalanceForRentExemption(mintLen);

      // Create mint account
      const createAccountInstruction = anchor.web3.SystemProgram.createAccount({
        fromPubkey: researcher.publicKey,
        newAccountPubkey: mint,
        space: mintLen,
        lamports: mintLamports,
        programId: TOKEN_PROGRAM_ID,
      });

      // Initialize mint
      const initializeMintInstruction = createInitializeMintInstruction(
        mint,
        decimals,
        researcher.publicKey,
        null,
        TOKEN_PROGRAM_ID
      );

      // Create researcher's token account
      researcherTokenAccount = getAssociatedTokenAddressSync(
        mint,
        researcher.publicKey,
        false,
        TOKEN_PROGRAM_ID,
        ASSOCIATED_TOKEN_PROGRAM_ID
      );

      const createAta = createAssociatedTokenAccountInstruction(
        researcher.publicKey,
        researcherTokenAccount,
        researcher.publicKey,
        mint,
        TOKEN_PROGRAM_ID,
        ASSOCIATED_TOKEN_PROGRAM_ID
      );

      // Mint tokens to researcher
      const mintToInstruction = createMintToInstruction(
        mint,
        researcherTokenAccount,
        researcher.publicKey,
        securityDeposit.muln(10).toNumber(), // Mint 10x the security deposit
        [],
        TOKEN_PROGRAM_ID
      );

      const transaction = new anchor.web3.Transaction().add(
        createAccountInstruction,
        initializeMintInstruction,
        createAta,
        mintToInstruction
      );
      await provider.sendAndConfirm(transaction, [mintKeypair]);

      // Derive the proposal PDA with unique title
      [proposalPda] = anchor.web3.PublicKey.findProgramAddressSync(
        [
          Buffer.from("proposal"),
          researcher.publicKey.toBuffer(),
          Buffer.from(title),
        ],
        program.programId
      );

      // Derive the escrow PDA
      [escrowPda] = anchor.web3.PublicKey.findProgramAddressSync(
        [Buffer.from("escrow"), proposalPda.toBuffer()],
        program.programId
      );
    } catch (err) {
      console.error("Failed to setup test:", err);
      throw err;
    }
  });

  it("Creates a proposal and transfers the security deposit", async () => {
    // Get token balance before
    const tokenAccountBefore = await getAccount(
      provider.connection,
      researcherTokenAccount
    );

    await program.methods
      .createProposal(
        title,
        abstractText,
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

    // Fetch the proposal account
    const proposal = await program.account.proposal.fetch(proposalPda);

    // Assert proposal data
    assert.equal(proposal.title, title);
    assert.equal(proposal.abstractText, abstractText);
    assert.equal(
      proposal.researcher.toString(),
      researcher.publicKey.toString()
    );
    assert.equal(proposal.amountAsked.toString(), amountAsked.toString());
    assert.equal(
      proposal.initialSecurityDeposit.toString(),
      securityDeposit.toString()
    );
    assert.equal(
      proposal.currentSecurityDeposit.toString(),
      securityDeposit.toString()
    );
    assert.equal(proposal.totalMilestones, totalMilestones);
    assert.equal(proposal.currentMilestone, 0);
    assert.equal(proposal.ipfsHash, ipfsHash);
    assert.equal(proposal.fundsEscrow.toString(), escrowPda.toString());
    assert.equal(proposal.penaltyCounter, 0);
    assert.deepEqual(proposal.status, { active: {} });

    // Check token account was created and verify balance
    const escrowAccount = await getAccount(provider.connection, escrowPda);
    assert.isNotNull(escrowAccount);
    assert.equal(escrowAccount.mint.toString(), mint.toString());
    assert.equal(escrowAccount.owner.toString(), proposalPda.toString());
    assert.equal(escrowAccount.amount.toString(), securityDeposit.toString());

    // Verify researcher's token balance decreased
    const tokenAccountAfter = await getAccount(
      provider.connection,
      researcherTokenAccount
    );
    assert.equal(
      tokenAccountAfter.amount.toString(),
      (
        BigInt(tokenAccountBefore.amount.toString()) -
        BigInt(securityDeposit.toString())
      ).toString()
    );
  });

  it("Fails if security deposit is too low", async () => {
    // Generate unique title for this test case
    const uniqueId2 = Math.random().toString(36).substring(2, 8);
    const newTitle = `Research2_${uniqueId2}`;

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

    try {
      await program.methods
        .createProposal(
          newTitle,
          abstractText,
          ipfsHash,
          amountAsked,
          totalMilestones,
          new anchor.BN(1) // Too low
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
      assert.fail("Should have thrown error");
    } catch (err) {
      assert.include(err.toString(), "MoreSecurityDeposit");
    }
  });

  it("Fails if amount asked is zero", async () => {
    // Generate unique title for this test case
    const uniqueId3 = Math.random().toString(36).substring(2, 8);
    const newTitle = `Research3_${uniqueId3}`;

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

    try {
      await program.methods
        .createProposal(
          newTitle,
          abstractText,
          ipfsHash,
          new anchor.BN(0), // Zero amount
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
      assert.fail("Should have thrown error");
    } catch (err) {
      assert.include(err.toString(), "InvalidAmount");
    }
  });
});
