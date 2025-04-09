import {
  Commitment,
  Connection,
  Keypair,
  LAMPORTS_PER_SOL,
  PublicKey,
} from "@solana/web3.js";
import wallet from "../../wallet.json";
import { getOrCreateAssociatedTokenAccount, transfer } from "@solana/spl-token";
import { bs58 } from "@coral-xyz/anchor/dist/cjs/utils/bytes";

// We're going to import our keypair from the wallet file
const secret = bs58.decode(wallet);
const keypair = Keypair.fromSecretKey(new Uint8Array(secret));

//Create a Solana devnet connection
const commitment: Commitment = "confirmed";
const connection = new Connection("https://api.devnet.solana.com", commitment);

// Mint address
const mint = new PublicKey("G9ZqURs7UyCAmB4KmMErQ1Fzb1aAzFkkM6As6HmsoREC");

// Recipient address
const to = new PublicKey("tSg5Ugo5CVuL374natxs6DL8zxXbaBvowqs9Htd2eqd");

// This should be the token owner's address, not the mint address
const from = keypair.publicKey;

(async () => {
  try {
    // Get the token account of the fromWallet address, and if it does not exist, create it
    const fromAta = await getOrCreateAssociatedTokenAccount(
      connection,
      keypair,
      mint,
      from
    );

    // Get the token account of the toWallet address, and if it does not exist, create it
    const toAta = await getOrCreateAssociatedTokenAccount(
      connection,
      keypair,
      mint,
      to
    );

    // Transfer the new token to the "toTokenAccount" we just created
    const signature = await transfer(
      connection,
      keypair,
      fromAta.address,
      toAta.address,
      keypair.publicKey,
      100000
    );

    console.log("Transfer transaction signature:", signature);
  } catch (e) {
    console.error(`Oops, something went wrong: ${e}`);
  }
})();
