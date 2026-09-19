import * as StellarSdk from "@stellar/stellar-sdk";

const RPC_URL = "https://mainnet.sorobanrpc.com";
const NETWORK = StellarSdk.Networks.PUBLIC;

const ASSET_CODE = "XRP262";
const ISSUER =
  "GCGVZEE7RD2BFF2EIQUT37DYJUR7WDCQ2KWA5LUWYATRFLKEYHMJ3XRP";

const EXPECTED_SAC =
  "CDJXGLSHYWF77E6IHNQBXJXQBA2K6WPNN7KKI4EO3USYTXUAZAHMGEDZ";

const SECRET = process.env.DEPLOYER_SECRET;

if (!SECRET) {
  throw new Error(
    "Missing DEPLOYER_SECRET. Set it in the shell; never put the secret in this file."
  );
}

const server = new StellarSdk.rpc.Server(RPC_URL);
const keypair = StellarSdk.Keypair.fromSecret(SECRET);
const source = keypair.publicKey();

const asset = new StellarSdk.Asset(ASSET_CODE, ISSUER);

// SAC contract IDs are network-aware. The SDK's contractId() helper builds
// HashIDPreimage(ENVELOPE_TYPE_CONTRACT_ID, networkID, ContractIDPreimage).
const derived = asset.contractId(NETWORK);

// Build the native SAC deployment operation.
// IMPORTANT: this script intentionally DOES NOT submit the transaction.
const account = await server.getAccount(source);

const operation = StellarSdk.Operation.createStellarAssetContract({
  asset,
  source,
});

const transaction = new StellarSdk.TransactionBuilder(account, {
  fee: StellarSdk.BASE_FEE,
  networkPassphrase: NETWORK,
})
  .addOperation(operation)
  .setTimeout(300)
  .build();

const prepared = await server.prepareTransaction(transaction);

console.log("XRP262 SAC deployment preparation");
console.log("---------------------------------");
console.log("Asset:          ", `${ASSET_CODE}-${ISSUER}`);
console.log("Issuer:         ", ISSUER);
console.log("Derived SAC:    ", derived);
console.log("Expected SAC:   ", EXPECTED_SAC);
console.log("Source:         ", source);
console.log("RPC:            ", RPC_URL);
console.log("");
console.log(
  derived === EXPECTED_SAC
    ? "Address check:  PASS"
    : "Address check:  FAIL"
);
console.log("");
console.log("Transaction prepared successfully.");
console.log("NO transaction was submitted.");
console.log("");
console.log("Prepared transaction XDR:");
console.log(prepared.toXDR());
