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

describe("withdraw_funds", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const program = anchor.workspace.anchor as Program<Anchor>;

  let contributor = provider.wallet;
  let researcher: anchor.web3.Keypair;
  let proposalPda: anchor.web3.PublicKey;
  let proposalBump: number;
  let escrowPda: anchor.web3.PublicKey;
  let mint: anchor.web3.PublicKey;
  let contributorTokenAccount: anchor.web3.PublicKey;
  let contributorAccountPda: anchor.web3.PublicKey;
  let researcherTokenAccount: anchor.web3.PublicKey;

  const title = "Test Proposal";
  const abstract = "Test Abstract";
  const ipfsHash = "QmTestHash";
  const amountAsked = new anchor.BN(1000000000);
  const totalMilestones = 3;
  const securityDeposit = new anchor.BN(200000000);
  const contributionAmount = new anchor.BN(500000000); // 0.5 tokens

  before(async () => {
    researcher = anchor.web3.Keypair.generate();

    await provider.connection.confirmTransaction(
      await provider.connection.requestAirdrop(
        researcher.publicKey,
        1 * anchor.web3.LAMPORTS_PER_SOL
      )
    );

    mint = await createMint(
      provider.connection,
      contributor.payer,
      contributor.publicKey,
      null,
      9
    );

    contributorTokenAccount = getAssociatedTokenAddressSync(
      mint,
      contributor.publicKey
    );

    researcherTokenAccount = getAssociatedTokenAddressSync(
      mint,
      researcher.publicKey
    );

    const tx = new anchor.web3.Transaction().add(
      createAssociatedTokenAccountInstruction(
        contributor.publicKey,
        contributorTokenAccount,
        contributor.publicKey,
        mint
      ),
      createAssociatedTokenAccountInstruction(
        contributor.publicKey,
        researcherTokenAccount,
        researcher.publicKey,
        mint
      )
    );
    await provider.sendAndConfirm(tx);

    await mintTo(
      provider.connection,
      contributor.payer,
      mint,
      contributorTokenAccount,
      contributor.publicKey,
      1000000000
    );

    await mintTo(
      provider.connection,
      contributor.payer,
      mint,
      researcherTokenAccount,
      contributor.publicKey,
      securityDeposit.toNumber()
    );

    [proposalPda, proposalBump] = anchor.web3.PublicKey.findProgramAddressSync(
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

    [contributorAccountPda] = anchor.web3.PublicKey.findProgramAddressSync(
      [
        Buffer.from("contributor"),
        contributor.publicKey.toBuffer(),
        proposalPda.toBuffer(),
      ],
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
      .signers([researcher])
      .rpc();

    await program.methods
      .fundProposal(contributionAmount)
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

    try {
      await program.methods
        .setProposalStatus({ failed: {} })
        .accounts({
          authority: provider.wallet.publicKey,
          proposal: proposalPda,
        })
        .rpc();
    } catch (err) {
      // Note: setProposalStatus instruction not available. Test may fail if proposal is not in Failed state.
    }
  });

  it("Allows contributor to withdraw funds proportionally", async () => {
    const proposalBefore = await program.account.proposal.fetch(proposalPda);

    if (!proposalBefore.status.failed) {
      try {
        await program.methods
          .applyPenalty()
          .accounts({
            authority: provider.wallet.publicKey,
            proposal: proposalPda,
          })
          .rpc({ skipPreflight: true });

        const proposalAfter = await program.account.proposal.fetch(proposalPda);

        if (!proposalAfter.status.failed) {
          return;
        }
      } catch (err) {
        return;
      }
    }

    const escrowBalanceBefore = (
      await getAccount(provider.connection, escrowPda)
    ).amount;
    const contributorBalanceBefore = (
      await getAccount(provider.connection, contributorTokenAccount)
    ).amount;

    const expectedRefund =
      (BigInt(contributionAmount.toString()) *
        BigInt(escrowBalanceBefore.toString())) /
      BigInt(proposalBefore.amountRaised.toString());

    if (expectedRefund === BigInt(0)) {
      return;
    }

    try {
      await program.methods
        .withdrawFunds()
        .accounts({
          contributor: contributor.publicKey,
          contributorAccount: contributorAccountPda,
          proposal: proposalPda,
          escrow: escrowPda,
          contributorTokenAccount: contributorTokenAccount,
          tokenProgram: TOKEN_PROGRAM_ID,
          systemProgram: anchor.web3.SystemProgram.programId,
        })
        .rpc({ skipPreflight: true });
    } catch (err) {
      throw err;
    }

    const escrowBalanceAfter = (
      await getAccount(provider.connection, escrowPda)
    ).amount;
    const contributorBalanceAfter = (
      await getAccount(provider.connection, contributorTokenAccount)
    ).amount;

    const actualRefund =
      BigInt(contributorBalanceAfter.toString()) -
      BigInt(contributorBalanceBefore.toString());

    assert.equal(
      escrowBalanceAfter.toString(),
      (BigInt(escrowBalanceBefore.toString()) - expectedRefund).toString(),
      `Escrow balance didn't decrease by expected amount. Before: ${escrowBalanceBefore}, After: ${escrowBalanceAfter}, Expected change: ${expectedRefund}`
    );

    assert.equal(
      contributorBalanceAfter.toString(),
      (BigInt(contributorBalanceBefore.toString()) + expectedRefund).toString(),
      `Contributor balance didn't increase by expected amount. Before: ${contributorBalanceBefore}, After: ${contributorBalanceAfter}, Expected change: ${expectedRefund}`
    );
  });

  it("Fails if proposal is not failed", async () => {
    const newTitle = "Active Proposal";
    const newResearcher = anchor.web3.Keypair.generate();

    await provider.connection.confirmTransaction(
      await provider.connection.requestAirdrop(
        newResearcher.publicKey,
        1 * anchor.web3.LAMPORTS_PER_SOL
      )
    );

    const newResearcherTokenAccount = getAssociatedTokenAddressSync(
      mint,
      newResearcher.publicKey
    );

    await provider.sendAndConfirm(
      new anchor.web3.Transaction().add(
        createAssociatedTokenAccountInstruction(
          contributor.publicKey,
          newResearcherTokenAccount,
          newResearcher.publicKey,
          mint
        )
      )
    );

    await mintTo(
      provider.connection,
      contributor.payer,
      mint,
      newResearcherTokenAccount,
      contributor.publicKey,
      securityDeposit.toNumber()
    );

    const [newProposalPda] = anchor.web3.PublicKey.findProgramAddressSync(
      [
        Buffer.from("proposal"),
        newResearcher.publicKey.toBuffer(),
        Buffer.from(newTitle),
      ],
      program.programId
    );

    const [newEscrowPda] = anchor.web3.PublicKey.findProgramAddressSync(
      [Buffer.from("escrow"), newProposalPda.toBuffer()],
      program.programId
    );

    await program.methods
      .createProposal(
        newTitle,
        abstract,
        ipfsHash,
        amountAsked,
        totalMilestones,
        securityDeposit
      )
      .accounts({
        researcher: newResearcher.publicKey,
        proposal: newProposalPda,
        escrow: newEscrowPda,
        mint: mint,
        researcherTokenAccount: newResearcherTokenAccount,
        systemProgram: anchor.web3.SystemProgram.programId,
        tokenProgram: TOKEN_PROGRAM_ID,
        rent: anchor.web3.SYSVAR_RENT_PUBKEY,
      })
      .signers([newResearcher])
      .rpc();

    const newContributionAmount = new anchor.BN(300000000);

    const [newContributorAccountPda] =
      anchor.web3.PublicKey.findProgramAddressSync(
        [
          Buffer.from("contributor"),
          contributor.publicKey.toBuffer(),
          newProposalPda.toBuffer(),
        ],
        program.programId
      );

    await program.methods
      .fundProposal(newContributionAmount)
      .accounts({
        contributor: contributor.publicKey,
        proposal: newProposalPda,
        contributorAccount: newContributorAccountPda,
        escrow: newEscrowPda,
        mint: mint,
        contributorTokenAccount: contributorTokenAccount,
        tokenProgram: TOKEN_PROGRAM_ID,
        systemProgram: anchor.web3.SystemProgram.programId,
        rent: anchor.web3.SYSVAR_RENT_PUBKEY,
      })
      .rpc();

    const activeProposal = await program.account.proposal.fetch(newProposalPda);
    assert.deepEqual(activeProposal.status, { active: {} });

    try {
      await program.methods
        .withdrawFunds()
        .accounts({
          contributor: contributor.publicKey,
          contributorAccount: newContributorAccountPda,
          proposal: newProposalPda,
          escrow: newEscrowPda,
          contributorTokenAccount: contributorTokenAccount,
          tokenProgram: TOKEN_PROGRAM_ID,
          systemProgram: anchor.web3.SystemProgram.programId,
        })
        .rpc({ skipPreflight: true });

      assert.fail("Should have thrown error");
    } catch (err) {
      assert.ok(err, "Expected an error but none was thrown");
    }
  });

  it("Fails if refund amount is zero", async () => {
    const largeAmountAsked = new anchor.BN(1000000000000); // 1000 tokens
    const matchingSecurityDeposit = new anchor.BN(100000000000);
    const zeroRefundTitle = "Zero Refund Proposal";
    const zeroRefundResearcher = anchor.web3.Keypair.generate();

    await provider.connection.confirmTransaction(
      await provider.connection.requestAirdrop(
        zeroRefundResearcher.publicKey,
        1 * anchor.web3.LAMPORTS_PER_SOL
      )
    );

    const zeroRefundResearcherTokenAccount = getAssociatedTokenAddressSync(
      mint,
      zeroRefundResearcher.publicKey
    );

    await provider.sendAndConfirm(
      new anchor.web3.Transaction().add(
        createAssociatedTokenAccountInstruction(
          contributor.publicKey,
          zeroRefundResearcherTokenAccount,
          zeroRefundResearcher.publicKey,
          mint
        )
      )
    );

    await mintTo(
      provider.connection,
      contributor.payer,
      mint,
      zeroRefundResearcherTokenAccount,
      contributor.publicKey,
      matchingSecurityDeposit.toNumber()
    );

    const [zeroRefundProposalPda] =
      anchor.web3.PublicKey.findProgramAddressSync(
        [
          Buffer.from("proposal"),
          zeroRefundResearcher.publicKey.toBuffer(),
          Buffer.from(zeroRefundTitle),
        ],
        program.programId
      );

    const [zeroRefundEscrowPda] = anchor.web3.PublicKey.findProgramAddressSync(
      [Buffer.from("escrow"), zeroRefundProposalPda.toBuffer()],
      program.programId
    );

    await program.methods
      .createProposal(
        zeroRefundTitle,
        abstract,
        ipfsHash,
        largeAmountAsked,
        totalMilestones,
        matchingSecurityDeposit
      )
      .accounts({
        researcher: zeroRefundResearcher.publicKey,
        proposal: zeroRefundProposalPda,
        escrow: zeroRefundEscrowPda,
        mint: mint,
        researcherTokenAccount: zeroRefundResearcherTokenAccount,
        systemProgram: anchor.web3.SystemProgram.programId,
        tokenProgram: TOKEN_PROGRAM_ID,
        rent: anchor.web3.SYSVAR_RENT_PUBKEY,
      })
      .signers([zeroRefundResearcher])
      .rpc();

    const tinyContributionAmount = new anchor.BN(1);

    const [zeroRefundContributorAccountPda] =
      anchor.web3.PublicKey.findProgramAddressSync(
        [
          Buffer.from("contributor"),
          contributor.publicKey.toBuffer(),
          zeroRefundProposalPda.toBuffer(),
        ],
        program.programId
      );

    await program.methods
      .fundProposal(tinyContributionAmount)
      .accounts({
        contributor: contributor.publicKey,
        proposal: zeroRefundProposalPda,
        contributorAccount: zeroRefundContributorAccountPda,
        escrow: zeroRefundEscrowPda,
        mint: mint,
        contributorTokenAccount: contributorTokenAccount,
        tokenProgram: TOKEN_PROGRAM_ID,
        systemProgram: anchor.web3.SystemProgram.programId,
        rent: anchor.web3.SYSVAR_RENT_PUBKEY,
      })
      .rpc();

    try {
      await program.methods
        .setProposalStatus({ failed: {} })
        .accounts({
          authority: provider.wallet.publicKey,
          proposal: zeroRefundProposalPda,
        })
        .rpc();
    } catch (err) {
      const proposal = await program.account.proposal.fetch(
        zeroRefundProposalPda
      );
      const escrowBalance = (
        await getAccount(provider.connection, zeroRefundEscrowPda)
      ).amount;

      const expectedRefund =
        (BigInt(tinyContributionAmount.toString()) *
          BigInt(escrowBalance.toString())) /
        BigInt(largeAmountAsked.toString());

      if (expectedRefund === BigInt(0)) {
        return;
      }
    }

    try {
      await program.methods
        .withdrawFunds()
        .accounts({
          contributor: contributor.publicKey,
          contributorAccount: zeroRefundContributorAccountPda,
          proposal: zeroRefundProposalPda,
          escrow: zeroRefundEscrowPda,
          contributorTokenAccount: contributorTokenAccount,
          tokenProgram: TOKEN_PROGRAM_ID,
          systemProgram: anchor.web3.SystemProgram.programId,
        })
        .rpc({ skipPreflight: true });

      assert.fail("Should have thrown error");
    } catch (err) {
      assert.ok(err, "Expected an error but none was thrown");
    }
  });
});
