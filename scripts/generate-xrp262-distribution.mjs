import { Keypair } from "@stellar/stellar-sdk";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const secretsDir = join(process.cwd(), ".secrets");
const outputPath = join(secretsDir, "xrp262-distribution.json");

mkdirSync(secretsDir, { recursive: true });

try {
  readFileSync(outputPath, "utf8");
  throw new Error(
    `XRP262 distribution account already exists at ${outputPath}. Refusing to overwrite it.`,
  );
} catch (error) {
  if (error.code !== "ENOENT") throw error;
}

const keypair = Keypair.random();

const payload = {
  publicKey: keypair.publicKey(),
  secretKey: keypair.secret(),
};

writeFileSync(outputPath, JSON.stringify(payload, null, 2) + "\n", {
  mode: 0o600,
});

console.log("XRP262 distribution account generated.");
console.log("Public key:", payload.publicKey);
console.log("Secret key: saved only to", outputPath);
console.log("");
console.log("IMPORTANT: keep this file private and never commit it.");
