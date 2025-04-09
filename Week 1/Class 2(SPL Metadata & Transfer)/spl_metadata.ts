import wallet from "../../wallet.json"
import { createUmi } from "@metaplex-foundation/umi-bundle-defaults"
import { 
    createMetadataAccountV3, 
    CreateMetadataAccountV3InstructionAccounts, 
    CreateMetadataAccountV3InstructionArgs,
    DataV2Args
} from "@metaplex-foundation/mpl-token-metadata";
import { createSignerFromKeypair, signerIdentity, publicKey } from "@metaplex-foundation/umi";
import { bs58 } from "@coral-xyz/anchor/dist/cjs/utils/bytes";
import { Keypair, PublicKey } from "@solana/web3.js";
import { TOKEN_PROGRAM_ID } from "@solana/spl-token";

// Define our Mint address

const secret = bs58.decode(wallet);
// const keypair = Keypair.fromSecretKey(new Uint8Array(secret));


// Create a UMI connection
const umi = createUmi('https://api.devnet.solana.com');
const keypair = umi.eddsa.createKeypairFromSecretKey(new Uint8Array(secret));
const signer = createSignerFromKeypair(umi, keypair);
umi.use(signerIdentity(createSignerFromKeypair(umi, keypair)));

const mint = new PublicKey("G9ZqURs7UyCAmB4KmMErQ1Fzb1aAzFkkM6As6HmsoREC");
const mint_umi = publicKey("G9ZqURs7UyCAmB4KmMErQ1Fzb1aAzFkkM6As6HmsoREC");
const [pda, bump] = PublicKey.findProgramAddressSync([Buffer.from("metadata"), mint.toBuffer()], TOKEN_PROGRAM_ID);

(async () => {
    try {
        // Start here
        // let accounts: CreateMetadataAccountV3InstructionAccounts = {
        //     ???
        // }

        let accounts: CreateMetadataAccountV3InstructionAccounts={
            mint: mint_umi,
            mintAuthority: signer,
        }

        // let data: DataV2Args = {
        //     ???
        // }

        let data: DataV2Args={
            name: "Anubhab",
            symbol: "BD",
            uri: "mrb1nary.in",
            sellerFeeBasisPoints: 1000,
            creators:null,
            collection:null,
            uses:null,
        }

        // let args: CreateMetadataAccountV3InstructionArgs = {
        //     ???
        // }

        let args: CreateMetadataAccountV3InstructionArgs={
            data,
            isMutable:false,
            collectionDetails:null

        }

        // let tx = createMetadataAccountV3(
        //     umi,
        //     {
        //         ...accounts,
        //         ...args
        //     }
        // )

        let tx = createMetadataAccountV3(
            umi,
            {
                ...accounts,
                ...args
            }
        )

        let result = await tx.sendAndConfirm(umi);
        console.log(bs58.encode(result.signature));
    } catch(e) {
        console.error(`Oops, something went wrong: ${e}`)
    }
})();
