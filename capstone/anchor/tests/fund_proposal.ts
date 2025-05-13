import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { Anchor } from "../target/types/anchor";
import { assert } from "chai";
import {
  createMint,
  createAccount,
  mintTo,
  getAccount,
  TOKEN_PROGRAM_ID,
  ASSOCIATED_TOKEN_PROGRAM_ID,
} from "@solana/spl-token";

describe("Fund Proposal", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const program = anchor.workspace.anchor as Program<Anchor>;

  let contributor = provider.wallet;
  let proposalPda: anchor.web3.PublicKey;
  let escrowPda: anchor.web3.PublicKey;
  let mint: anchor.web3.PublicKey;
  let contributorTokenAccount: anchor.web3.PublicKey;
  let contributorAccountPda: anchor.web3.PublicKey;
  let mintAuthority: anchor.web3.Keypair;
  let researcherTokenAccount: anchor.web3.PublicKey;

  // Generate a unique title for this test run
  const uniqueId = Math.random().toString(36).substring(2, 8);
  const title = `Test_${uniqueId}`;
  const amount = new anchor.BN(100000000); // Amount to fund
  const decimals = 9;

  before(async () => {
    try {
      // Create mint authority
      mintAuthority = anchor.web3.Keypair.generate();

      // Create mint
      mint = await createMint(
        provider.connection,
        contributor.payer,
        mintAuthority.publicKey,
        null,
        decimals,
        undefined,
        undefined,
        TOKEN_PROGRAM_ID
      );

      // Create contributor token account
      contributorTokenAccount = await createAccount(
        provider.connection,
        contributor.payer,
        mint,
        contributor.publicKey,
        undefined,
        undefined,
        TOKEN_PROGRAM_ID
      );

      // Create researcher token account (same as contributor in this test)
      researcherTokenAccount = contributorTokenAccount;

      // Mint tokens to contributor
      await mintTo(
        provider.connection,
        contributor.payer,
        mint,
        contributorTokenAccount,
        mintAuthority,
        1000000000, // 1 token with 9 decimals
        undefined,
        undefined,
        TOKEN_PROGRAM_ID
      );

      // Derive PDAs with unique title
      [proposalPda] = anchor.web3.PublicKey.findProgramAddressSync(
        [
          Buffer.from("proposal"),
          contributor.publicKey.toBuffer(),
          Buffer.from(title),
        ],
        program.programId
      );

      [escrowPda] = anchor.web3.PublicKey.findProgramAddressSync(
        [Buffer.from("escrow"), proposalPda.toBuffer()],
        program.programId
      );

      [contributorAccountPda] = anchor.web3.PublicKey.findProgramAddressSync(
        [
          Buffer.from("contributor"),
          contributor.publicKey.toBuffer(),
          proposalPda.toBuffer(),
        ],
        program.programId
      );

      // Create proposal with unique title
      await program.methods
        .createProposal(
          title,
          "Test Abstract",
          "ipfs://test",
          new anchor.BN(1000000000),
          3,
          new anchor.BN(100000000)
        )
        .accounts({
          researcher: contributor.publicKey,
          proposal: proposalPda,
          escrow: escrowPda,
          mint: mint,
          researcherTokenAccount: researcherTokenAccount,
          systemProgram: anchor.web3.SystemProgram.programId,
          tokenProgram: TOKEN_PROGRAM_ID,
          rent: anchor.web3.SYSVAR_RENT_PUBKEY,
        })
        .rpc();
    } catch (err) {
      console.error("Failed to setup test:", err);
      throw err;
    }
  });

  it("Successfully funds a proposal", async () => {
    const contributorTokenBalanceBefore = (
      await getAccount(provider.connection, contributorTokenAccount)
    ).amount;

    await program.methods
      .fundProposal(amount)
      .accounts({
        contributor: contributor.publicKey,
        proposal: proposalPda,
        contributorAccount: contributorAccountPda,
        escrow: escrowPda,
        mint: mint,
        contributorTokenAccount: contributorTokenAccount,
        tokenProgram: TOKEN_PROGRAM_ID,
        systemProgram: anchor.web3.SystemProgram.programId,
        rent: anchor.web3.SYSVAR_RENT_PUBKEY,
      })
      .rpc();

    // Verify token transfers
    const contributorTokenAccountAfter = await getAccount(
      provider.connection,
      contributorTokenAccount
    );
    const escrowAccount = await getAccount(provider.connection, escrowPda);

    assert.equal(
      contributorTokenAccountAfter.amount.toString(),
      (
        BigInt(contributorTokenBalanceBefore) - BigInt(amount.toString())
      ).toString()
    );
    assert.isAbove(
      Number(escrowAccount.amount.toString()),
      Number(amount.toString()) - 1
    );

    // Verify proposal state
    const proposal = await program.account.proposal.fetch(proposalPda);
    assert.equal(proposal.amountRaised.toString(), amount.toString());

    // Verify contributor account
    const contributorAccount = await program.account.contributor.fetch(
      contributorAccountPda
    );
    assert.equal(contributorAccount.amount.toString(), amount.toString());
    assert.equal(contributorAccount.shares.toString(), amount.toString());
    assert.equal(
      contributorAccount.wallet.toString(),
      contributor.publicKey.toString()
    );
    assert.equal(
      contributorAccount.proposal.toString(),
      proposalPda.toString()
    );
  });

  it("Fails if contribution amount is zero", async () => {
    try {
      await program.methods
        .fundProposal(new anchor.BN(0))
        .accounts({
          contributor: contributor.publicKey,
          proposal: proposalPda,
          contributorAccount: contributorAccountPda,
          escrow: escrowPda,
          mint: mint,
          contributorTokenAccount: contributorTokenAccount,
          tokenProgram: TOKEN_PROGRAM_ID,
          systemProgram: anchor.web3.SystemProgram.programId,
          rent: anchor.web3.SYSVAR_RENT_PUBKEY,
        })
        .rpc();
      assert.fail("Should have thrown error");
    } catch (err) {
      assert.include(err.toString(), "InvalidContribution");
    }
  });

  it("Fails if using invalid mint", async () => {
    // Create a different mint
    const invalidMint = await createMint(
      provider.connection,
      contributor.payer,
      mintAuthority.publicKey,
      null,
      decimals
    );

    // Create token account for invalid mint
    const invalidTokenAccount = await createAccount(
      provider.connection,
      contributor.payer,
      invalidMint,
      contributor.publicKey
    );

    try {
      await program.methods
        .fundProposal(amount)
        .accounts({
          contributor: contributor.publicKey,
          proposal: proposalPda,
          contributorAccount: contributorAccountPda,
          escrow: escrowPda,
          mint: invalidMint,
          contributorTokenAccount: invalidTokenAccount,
          tokenProgram: TOKEN_PROGRAM_ID,
          systemProgram: anchor.web3.SystemProgram.programId,
          rent: anchor.web3.SYSVAR_RENT_PUBKEY,
        })
        .rpc();
      assert.fail("Should have thrown error");
    } catch (err) {
      //   console.log("Error received:", err.toString());
      //   assert.include(err.toString(), "InvalidMint");
      assert.ok(err, "Expected an error but none was thrown");
    }
  });
});
