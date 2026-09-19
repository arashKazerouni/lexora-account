import * as StellarSdk from "@stellar/stellar-sdk";

const RPC_URL = "https://mainnet.sorobanrpc.com";
const NETWORK = StellarSdk.Networks.PUBLIC;

const ASSET_CODE = "XRP262";
const ISSUER =
  "GCGVZEE7RD2BFF2EIQUT37DYJUR7WDCQ2KWA5LUWYATRFLKEYHMJ3XRP";

const EXPECTED_SAC =
  "CC7L34EWYCTDCA3L7CRRULWX577UJWET32KNJFD2WTEQ4KD7IAUKHIS6";

const server = new StellarSdk.rpc.Server(RPC_URL);
const asset = new StellarSdk.Asset(ASSET_CODE, ISSUER);
const derived = asset.contractId(NETWORK);

console.log("XRP262 SAC mainnet verification");
console.log("--------------------------------");
console.log("Asset:          ", `${ASSET_CODE}-${ISSUER}`);
console.log("Derived SAC:    ", derived);
console.log("Expected SAC:   ", EXPECTED_SAC);
console.log("RPC:            ", RPC_URL);
console.log(
  "Address check:  ",
  derived === EXPECTED_SAC ? "PASS" : "FAIL"
);

if (derived !== EXPECTED_SAC) {
  throw new Error("Deterministic SAC address mismatch.");
}

const contract = new StellarSdk.Contract(derived);
const footprint = contract.getFootprint();
const ledgerKey = StellarSdk.xdr.LedgerKey.contractData(
  footprint.contractData
);

console.log("\nQuerying mainnet contract instance...");
const result = await server.getLedgerEntries(ledgerKey);

console.log("\nMainnet ledger result:");
console.dir(result, { depth: null });

if (!result.entries || result.entries.length === 0) {
  console.log("\nRESULT: XRP262 SAC is NOT deployed on mainnet yet.");
  console.log("The deterministic address is correct, but no contract instance exists.");
  process.exit(0);
}

const entry = result.entries[0];
const value = entry.val ?? entry.value;

console.log("\nRESULT: XRP262 SAC contract instance EXISTS on mainnet.");
console.log("Contract address:", derived);

if (value) {
  console.log("\nContract-data value:");
  console.dir(value, { depth: null });
}
