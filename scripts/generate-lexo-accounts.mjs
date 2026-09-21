import { Keypair } from "@stellar/stellar-sdk";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const secretsDir = join(process.cwd(), ".secrets");
const outputPath = join(secretsDir, "lexo-accounts.json");

mkdirSync(secretsDir, { recursive: true });

try {
  readFileSync(outputPath, "utf8");
  throw new Error(`LEXO account file already exists at ${outputPath}. Refusing to overwrite it.`);
} catch (error) {
  if (error.code !== "ENOENT") throw error;
}

const issuer = Keypair.random();
const distribution = Keypair.random();

const payload = {
  assetCode: "LEXO",
  decimals: 7,
  initialSupply: "100000000",
  issuer: {
    publicKey: issuer.publicKey(),
    secretKey: issuer.secret(),
  },
  distribution: {
    publicKey: distribution.publicKey(),
    secretKey: distribution.secret(),
  },
};

writeFileSync(outputPath, JSON.stringify(payload, null, 2) + "\n", { mode: 0o600 });

console.log("LEXO mainnet accounts generated.");
console.log("Issuer:", payload.issuer.publicKey);
console.log("Distribution:", payload.distribution.publicKey);
console.log("Supply:", payload.initialSupply, "LEXO");
console.log("Secret keys saved only to", outputPath);
console.log("");
console.log("IMPORTANT: fund the issuer and distribution accounts before running the guarded mainnet creation script.");
console.log("Never commit this file.");
