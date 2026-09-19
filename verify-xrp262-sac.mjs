import * as StellarSdk from "@stellar/stellar-sdk";

const RPC_URL = "https://mainnet.sorobanrpc.com";
const NETWORK = StellarSdk.Networks.PUBLIC;

const ASSET_CODE = "XRP262";
const ISSUER =
  "GCGVZEE7RD2BFF2EIQUT37DYJUR7WDCQ2KWA5LUWYATRFLKEYHMJ3XRP";

const EXPECTED_SAC =
  "CC7L34EWYCTDCA3L7CRRULWX577UJWET32KNJFD2WTEQ4KD7IAUKHIS6";

const DEPLOYMENT_TX =
  "6d2d1ea64761349f79d82bb5010e05ff0f58d3537711a4bc7792f481a718f36f";
const DEPLOYMENT_LEDGER = 64504796;

const server = new StellarSdk.rpc.Server(RPC_URL);
const asset = new StellarSdk.Asset(ASSET_CODE, ISSUER);
const derived = asset.contractId(NETWORK);

console.log("XRP262 SAC mainnet verification");
console.log("--------------------------------");
console.log("Asset:          ", `${ASSET_CODE}-${ISSUER}`);
console.log("Derived SAC:    ", derived);
console.log("Expected SAC:   ", EXPECTED_SAC);
console.log("RPC:            ", RPC_URL);
console.log("Deployment tx:  ", DEPLOYMENT_TX);
console.log("Expected ledger:", DEPLOYMENT_LEDGER);
console.log(
  "Address check:  ",
  derived === EXPECTED_SAC ? "PASS" : "FAIL"
);

if (derived !== EXPECTED_SAC) {
  throw new Error("Deterministic SAC address mismatch.");
}

console.log("\nChecking deployment transaction...");
const tx = await server.getTransaction(DEPLOYMENT_TX);
console.log("Transaction status:", tx.status);
console.log("Transaction ledger:", tx.ledger);

if (tx.status !== "SUCCESS") {
  throw new Error(`Deployment transaction is not SUCCESS: ${tx.status}`);
}
if (tx.ledger !== DEPLOYMENT_LEDGER) {
  throw new Error(`Unexpected deployment ledger: ${tx.ledger}`);
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
console.log("Deployment ledger:", tx.ledger);
console.log("Deployment tx:", DEPLOYMENT_TX);
console.log("\nRESULT: deterministic address, deployment transaction, and contract instance all agree.");

if (value) {
  console.log("\nContract-data value:");
  console.dir(value, { depth: null });
}
