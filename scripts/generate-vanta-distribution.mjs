import { Keypair } from "@stellar/stellar-sdk";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const ISSUER_PUBLIC_KEY =
  "GABER3CCXQ44LCM5CBHKCPRNLMJFEKN2QKBQHQPJD6TFV3WXU63PKXRP";
const OUTPUT_PATH = join(process.cwd(), ".secrets", "vanta-accounts.json");

mkdirSync(join(process.cwd(), ".secrets"), { recursive: true });

const distribution = Keypair.random();

const config = {
  asset: "VANTA",
  issuer: { publicKey: ISSUER_PUBLIC_KEY },
  distribution: {
    publicKey: distribution.publicKey(),
    secretKey: distribution.secret(),
  },
};

writeFileSync(OUTPUT_PATH, JSON.stringify(config, null, 2) + "\n", {
  mode: 0o600,
});

console.log("VANTA DISTRIBUTION ACCOUNT GENERATED");
console.log("====================================");
console.log("Issuer:", ISSUER_PUBLIC_KEY);
console.log("Distribution:", distribution.publicKey());
console.log("Saved:", OUTPUT_PATH);
console.log("");
console.log("The issuer secret is intentionally NOT stored by this script.");
console.log("Add the issuer secret locally at:");
console.log(".secrets/vanta-issuer.secret");
