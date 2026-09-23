import { mkdirSync, writeFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";

const outputPath = join(process.cwd(), ".secrets", "vanta-market-accounts.json");

const accounts = [
  { role: "VANTA issuer / Treasury", publicKey: "GABER3CCXQ44LCM5CBHKCPRNLMJFEKN2QKBQHQPJD6TFV3WXU63PKXRP" },
  { role: "Liquidity / VANTA funding", publicKey: "GABXUKWDB44SQGY6OVJWD3OXYEXE27UIGBWTF4FI2JMNLEXZKMA7TSQX" },
  { role: "XRP262 distribution", publicKey: "GBCPYP3TS6OAV37SXGKKY3YBY3QXMNWN2WZSDJ3RG2KZQAN5JWZDCY6Q" },
  { role: "FARM issuer", publicKey: "GBF7ZMNV4L2PFQRHJEMQLH7FEYMIP4ZSUKQ42ZOCYL5MI5P234C2NMNB" },
  { role: "FARM distribution", publicKey: "GBJELP7DVYFQLY77ZM34SDMQOHDRBN7E7L44WHDAMPPMLCSKG6P3ESRT" },
  { role: "SIKE issuer", publicKey: "GBPBUOS7DG7IOK3CCX3TPVLG4PW44C7J5M4VEXREYSM7EOQAGEYPY7QV" },
  { role: "VANTA market account 07", publicKey: "GCADAZ22Y6EUC575N4SRMGYVXTODH5MOHM3EVHQNC7AZ6PTZNJI7SXRP" },
  { role: "SIKE distribution", publicKey: "GCEN47OQUGNGIY3VE3KS7AHRCP5AFU4GVBFVMLWZ5DW25PNKUY36BOZB" },
  { role: "LEXORA owner / controller", publicKey: "GCGJIJ4YYQR7ROEVXW4QNPN3E2C7AJMTQA7KVA2BMX7JGWFJAYTSFDFU" },
  { role: "XRP262 issuer", publicKey: "GCGVZEE7RD2BFF2EIQUT37DYJUR7WDCQ2KWA5LUWYATRFLKEYHMJ3XRP" },
  { role: "VANTA distribution", publicKey: "GCIBP63HOCB6WRL6EF6WBXYMH3PZ4EAWDXH7KUU5AUOZAX3Q4OOFI5NI" },
  { role: "Project reserve / market account 12", publicKey: "GDSCUECSJ2UHOZJHSPXJEEXXQRRS5XQD62Y6XIGMFKQY5PBXNIJGXXRP" },
];

if (accounts.length !== 12) throw new Error("Expected exactly 12 accounts.");
if (existsSync(outputPath)) {
  throw new Error(`Refusing to overwrite existing file: ${outputPath}`);
}

mkdirSync(dirname(outputPath), { recursive: true });
writeFileSync(outputPath, JSON.stringify({ accounts }, null, 2) + "\n", { mode: 0o600 });

console.log(`Created ${outputPath}`);
for (const account of accounts) console.log(`${account.role}: ${account.publicKey}`);
console.log("Public keys only; no secret keys were written.");
