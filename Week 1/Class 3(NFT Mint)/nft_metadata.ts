import wallet from "../../convertedWallet.json";
import { createUmi } from "@metaplex-foundation/umi-bundle-defaults";
import {
  createGenericFile,
  createSignerFromKeypair,
  signerIdentity,
} from "@metaplex-foundation/umi";
import { irysUploader } from "@metaplex-foundation/umi-uploader-irys";
import { readFile } from "fs";

// Create a devnet connection
const umi = createUmi("https://api.devnet.solana.com");

let keypair = umi.eddsa.createKeypairFromSecretKey(new Uint8Array(wallet));
const signer = createSignerFromKeypair(umi, keypair);

umi.use(irysUploader());
umi.use(signerIdentity(signer));

(async () => {
  try {
    // Follow this JSON structure
    // https://docs.metaplex.com/programs/token-metadata/changelog/v1.0#json-structure

    // const imageFile = await readFile(
    //   "/home/mrb1nary/turbin3/solana-starter/ts/cluster1/jeff.png"
    // );

    const image =
      "https://gateway.irys.xyz/5RYbUnwCcVsKPURcGBmp8cw9iudF5Dqv8siTfP4pZsAo";
    const metadata = {
      name: "Jeff4k",
      symbol: "JP",
      description: "Old Man Jeff",
      image: image,
      attributes: [{ trait_type: "nature", value: "funny" }],
      properties: {
        files: [
          {
            type: "image/png",
            uri: "https://gateway.irys.xyz/5RYbUnwCcVsKPURcGBmp8cw9iudF5Dqv8siTfP4pZsAo",
          },
        ],
      },
      creators: [],
    };
    const myUri = await umi.uploader.uploadJson(metadata);
    console.log("Your metadata URI: ", myUri);
  } catch (error) {
    console.log("Oops.. Something went wrong", error);
  }
})();

//https://arweave.net/5Uuw19wqvu46FnRK4cC2uR78jQ9BfnqypsTq8JG341jy

// https://gateway.irys.xyz/5Uuw19wqvu46FnRK4cC2uR78jQ9BfnqypsTq8JG341jy


// https://gateway.irys.xyz/FnLM7xbeDpWuVYUP46QPVJAiiVaUAnvLtDAUx3Cb1ug5