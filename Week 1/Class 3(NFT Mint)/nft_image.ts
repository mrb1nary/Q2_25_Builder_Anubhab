import wallet from "../../convertedWallet.json";
import { createUmi } from "@metaplex-foundation/umi-bundle-defaults";
import {
  createGenericFile,
  createSignerFromKeypair,
  signerIdentity,
} from "@metaplex-foundation/umi";
import { irysUploader } from "@metaplex-foundation/umi-uploader-irys";
import { readFile } from "fs/promises";

// Create a devnet connection
const umi = createUmi("https://api.devnet.solana.com");

let keypair = umi.eddsa.createKeypairFromSecretKey(new Uint8Array(wallet));
const signer = createSignerFromKeypair(umi, keypair);

// umi.use(irysUploader());
umi.use(irysUploader({ address: "https://devnet.irys.xyz/" }));
umi.use(signerIdentity(signer));

(async () => {
  try {
    //1. Load image
    //2. Convert image to generic file.
    //3. Upload image

    const image = await readFile(
      "/home/mrb1nary/turbin3/solana-starter/ts/cluster1/Jeff4k.png"
    );

    // const image = ???

    const file = createGenericFile(image, "jeff.png", {
      contentType: "image/jpg",
    });

    const [myUri] = await umi.uploader.upload([file]);
    console.log("Your image URI: ", myUri);
  } catch (error) {
    console.log("Oops.. Something went wrong", error);
  }
})();

//https://gateway.irys.xyz/88e7YKifAXn5LnzTZHZbY9vhbMGjDTkKaLkSTzt5y9AV

//https://arweave.net/C8NNAa9puepqYmEuY9wLWXr5tJtGiigUPvdxG9oGz9Ws


// https://arweave.net/5RYbUnwCcVsKPURcGBmp8cw9iudF5Dqv8siTfP4pZsAo

// https://gateway.irys.xyz/5RYbUnwCcVsKPURcGBmp8cw9iudF5Dqv8siTfP4pZsAo
