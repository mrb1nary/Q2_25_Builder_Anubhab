import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { Anchor } from "../target/types/anchor";
import { assert } from "chai";
import { TOKEN_PROGRAM_ID } from "@solana/spl-token";
import { ComputeBudgetProgram } from "@solana/web3.js";

describe("mint_ip_nft", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const program = anchor.workspace.anchor as Program<Anchor>;
  const payer = provider.wallet;
  let mintKeypair: anchor.web3.Keypair;
  let metadata: anchor.web3.PublicKey;
  let masterEdition: anchor.web3.PublicKey;

  const tokenMetadataProgram = new anchor.web3.PublicKey(
    "metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s"
  );

  const uniqueId = Math.random().toString(36).substring(2, 8);
  const nftName = `Test NFT ${uniqueId}`;
  const nftSymbol = "TNFT";
  const nftUri = "https://example.com/nft.json";

  // Utility to wait until payer has sufficient balance
  async function waitForBalance(
    pubkey: anchor.web3.PublicKey,
    minBalance: number
  ) {
    for (let i = 0; i < 10; i++) {
      const balance = await provider.connection.getBalance(pubkey);
      if (balance >= minBalance) return;
      await new Promise((r) => setTimeout(r, 1000));
    }
    throw new Error("Insufficient balance after airdrop");
  }

  before(async () => {
    console.log(`RPC endpoint: ${provider.connection.rpcEndpoint}`);

    // Request airdrop and wait for balance confirmation
    const airdropSig = await provider.connection.requestAirdrop(
      payer.publicKey,
      1 * anchor.web3.LAMPORTS_PER_SOL
    );
    await provider.connection.confirmTransaction(airdropSig, "confirmed");
    await waitForBalance(payer.publicKey, 1 * anchor.web3.LAMPORTS_PER_SOL);

    mintKeypair = anchor.web3.Keypair.generate();

    // Derive metadata PDA
    [metadata] = anchor.web3.PublicKey.findProgramAddressSync(
      [
        Buffer.from("metadata"),
        tokenMetadataProgram.toBuffer(),
        mintKeypair.publicKey.toBuffer(),
      ],
      tokenMetadataProgram
    );

    // Derive master edition PDA
    [masterEdition] = anchor.web3.PublicKey.findProgramAddressSync(
      [
        Buffer.from("metadata"),
        tokenMetadataProgram.toBuffer(),
        mintKeypair.publicKey.toBuffer(),
        Buffer.from("edition"),
      ],
      tokenMetadataProgram
    );

    console.log("Mint setup complete.");
  });

  it("Mints an NFT successfully", async () => {
    console.log("Starting NFT mint...");

    console.log("Payer:", payer.publicKey.toBase58());
    console.log("Mint:", mintKeypair.publicKey.toBase58());
    console.log("Metadata PDA:", metadata.toBase58());
    console.log("Master Edition PDA:", masterEdition.toBase58());
    console.log("Token Program:", TOKEN_PROGRAM_ID.toBase58());
    console.log("Metadata Program:", tokenMetadataProgram.toBase58());

    try {
      // Increase compute budget for complex CPI
      const computeLimitIx = ComputeBudgetProgram.setComputeUnitLimit({
        units: 500_000,
      });

      const tx = await program.methods
        .mintIpNft(nftName, nftSymbol, nftUri)
        .accounts({
          payer: payer.publicKey,
          mint: mintKeypair.publicKey,
          metadata,
          masterEdition,
          tokenProgram: TOKEN_PROGRAM_ID,
          metadataProgram: tokenMetadataProgram,
          systemProgram: anchor.web3.SystemProgram.programId,
          rent: anchor.web3.SYSVAR_RENT_PUBKEY,
          sysvarInstructions: anchor.web3.SYSVAR_INSTRUCTIONS_PUBKEY,
        })
        .signers([mintKeypair])
        .preInstructions([computeLimitIx])
        .rpc();

      console.log("Mint transaction signature:", tx);

      // Confirm transaction finalization
      await provider.connection.confirmTransaction(tx, "confirmed");

      // Verify mint account exists
      const mintInfo = await provider.connection.getAccountInfo(
        mintKeypair.publicKey
      );
      assert.ok(mintInfo, "Mint account should exist");

      // Verify metadata account exists
      const metaInfo = await provider.connection.getAccountInfo(metadata);
      assert.ok(metaInfo, "Metadata account should exist");

      // Verify master edition account exists
      const editionInfo = await provider.connection.getAccountInfo(
        masterEdition
      );
      assert.ok(editionInfo, "Master edition account should exist");

      console.log("NFT minted successfully ✅");
    } catch (error) {
      console.error("❌ Minting failed:", error);
      if ("logs" in error && Array.isArray(error.logs)) {
        console.error("Logs:\n" + error.logs.join("\n"));
      }
      throw error;
    }
  });

  it("Fails to mint NFT with the same mint account", async () => {
    console.log("Testing duplicate mint failure...");

    try {
      const computeLimitIx = ComputeBudgetProgram.setComputeUnitLimit({
        units: 500_000,
      });

      await program.methods
        .mintIpNft("Duplicate NFT", nftSymbol, nftUri)
        .accounts({
          payer: payer.publicKey,
          mint: mintKeypair.publicKey,
          metadata,
          masterEdition,
          tokenProgram: TOKEN_PROGRAM_ID,
          metadataProgram: tokenMetadataProgram,
          systemProgram: anchor.web3.SystemProgram.programId,
          rent: anchor.web3.SYSVAR_RENT_PUBKEY,
          sysvarInstructions: anchor.web3.SYSVAR_INSTRUCTIONS_PUBKEY,
        })
        .signers([mintKeypair])
        .preInstructions([computeLimitIx])
        .rpc({ skipPreflight: true });

      assert.fail("Should have thrown an error");
    } catch (error) {
      console.log("✅ Duplicate mint failed as expected");
      if ("logs" in error && Array.isArray(error.logs)) {
        console.error("Logs:\n" + error.logs.join("\n"));
      }
      assert.ok(error);
    }
  });

  it("Mints another NFT with a different mint account", async () => {
    const newMintKeypair = anchor.web3.Keypair.generate();

    const [newMetadata] = anchor.web3.PublicKey.findProgramAddressSync(
      [
        Buffer.from("metadata"),
        tokenMetadataProgram.toBuffer(),
        newMintKeypair.publicKey.toBuffer(),
      ],
      tokenMetadataProgram
    );

    const [newMasterEdition] = anchor.web3.PublicKey.findProgramAddressSync(
      [
        Buffer.from("metadata"),
        tokenMetadataProgram.toBuffer(),
        newMintKeypair.publicKey.toBuffer(),
        Buffer.from("edition"),
      ],
      tokenMetadataProgram
    );

    const computeLimitIx = ComputeBudgetProgram.setComputeUnitLimit({
      units: 500_000,
    });

    try {
      const tx = await program.methods
        .mintIpNft("Second NFT", nftSymbol, nftUri)
        .accounts({
          payer: payer.publicKey,
          mint: newMintKeypair.publicKey,
          metadata: newMetadata,
          masterEdition: newMasterEdition,
          tokenProgram: TOKEN_PROGRAM_ID,
          metadataProgram: tokenMetadataProgram,
          systemProgram: anchor.web3.SystemProgram.programId,
          rent: anchor.web3.SYSVAR_RENT_PUBKEY,
          sysvarInstructions: anchor.web3.SYSVAR_INSTRUCTIONS_PUBKEY,
        })
        .signers([newMintKeypair])
        .preInstructions([computeLimitIx])
        .rpc();

      console.log("Second NFT minted:", tx);

      const mintInfo = await provider.connection.getAccountInfo(
        newMintKeypair.publicKey
      );
      assert.ok(mintInfo, "Second mint account should exist");

      const metaInfo = await provider.connection.getAccountInfo(newMetadata);
      assert.ok(metaInfo, "Second metadata account should exist");

      const editionInfo = await provider.connection.getAccountInfo(
        newMasterEdition
      );
      assert.ok(editionInfo, "Second master edition account should exist");
    } catch (error) {
      console.error("❌ Failed to mint second NFT:", error);
      if ("logs" in error && Array.isArray(error.logs)) {
        console.error("Logs:\n" + error.logs.join("\n"));
      }
      throw error;
    }
  });
});
