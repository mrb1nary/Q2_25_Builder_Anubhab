import { Keypair, PublicKey, Connection, Commitment } from "@solana/web3.js";
import { getOrCreateAssociatedTokenAccount, mintTo } from "@solana/spl-token";
import wallet from "../../Turbin3-wallet.json";
import { bs58 } from "@coral-xyz/anchor/dist/cjs/utils/bytes";

// Import our keypair from the wallet file
const secret = bs58.decode(wallet);
const keypair = Keypair.fromSecretKey(new Uint8Array(secret));

//Create a Solana devnet connection
const commitment: Commitment = "confirmed";
const connection = new Connection("https://api.devnet.solana.com", commitment);

const token_decimals = 1_000_000n;

// Mint address
const mint = new PublicKey("G9ZqURs7UyCAmB4KmMErQ1Fzb1aAzFkkM6As6HmsoREC");

(async () => {
  try {
    // Create an ATA
    const ata = await getOrCreateAssociatedTokenAccount(connection, keypair, mint, keypair.publicKey) 
    // const ata = ???
    console.log(`Your ata is: ${ata.address.toBase58()}`);
    // Mint to ATA

    const mintTx = await mintTo(connection, keypair,mint,ata.address,keypair.publicKey,10000000)
    // const mintTx = ???
    console.log(`Your mint txid: ${mintTx}`);
  } catch (error) {
    console.log(`Oops, something went wrong: ${error}`);
  }
})();
