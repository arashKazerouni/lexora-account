import * as StellarSdk from "@stellar/stellar-sdk";

const RPC_URL = "https://mainnet.sorobanrpc.com";
const NETWORK = StellarSdk.Networks.PUBLIC;
const ASSET_CODE = "XRP262";
const ISSUER =
  "GCGVZEE7RD2BFF2EIQUT37DYJUR7WDCQ2KWA5LUWYATRFLKEYHMJ3XRP";
const EXPECTED_SAC =
  "CC7L34EWYCTDCA3L7CRRULWX577UJWET32KNJFD2WTEQ4KD7IAUKHIS6";

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

const derived = asset.contractId(NETWORK);
if (derived !== EXPECTED_SAC) {
  throw new Error(`Deterministic SAC mismatch: ${derived}`);
}

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

console.log("XRP262 SAC deployment transaction verification");
console.log("------------------------------------------------");
console.log("Asset:              ", `${ASSET_CODE}-${ISSUER}`);
console.log("Expected SAC:       ", EXPECTED_SAC);
console.log("Derived SAC:        ", derived);
console.log("Source:             ", source);
console.log("Network:            ", NETWORK);
console.log("Operations:         ", prepared.operations.length);
console.log("Fee (stroops):      ", prepared.fee);
console.log("Fee (XLM):          ", Number(prepared.fee) / 10_000_000);
console.log("Sequence:            ", prepared.sequence);
console.log("Timeout ledger/time: ", prepared.timeBounds ?? "(none)");

const ops = prepared.operations;
if (ops.length !== 1) {
  throw new Error(`Expected exactly 1 operation, found ${ops.length}`);
}

const reparsed = StellarSdk.TransactionBuilder.fromXDR(
  prepared.toXDR(),
  NETWORK
);
const parsedOp = reparsed.operations[0];

console.log("\nDecoded operation:");
console.dir(parsedOp, { depth: 8 });

const createContract = parsedOp.func?.createContract;

const isExpectedOperation =
  parsedOp.type === "invokeHostFunction" &&
  parsedOp.func?.type === "hostFunctionTypeCreateContract" &&
  createContract?.contractIdPreimage?.type ===
    "contractIdPreimageFromAsset" &&
  createContract?.executable?.type ===
    "contractExecutableStellarAsset";

if (!isExpectedOperation) {
  throw new Error(
    "Prepared transaction operation does not match the expected native SAC deployment."
  );
}

console.log("\nDecoded operation checks:");
console.log("1. Host function:             PASS");
console.log("2. Asset-based contract ID:   PASS");
console.log("3. Stellar Asset executable:  PASS");
console.log(
  "4. Operation source:          ",
  parsedOp.source === source ? "PASS" : "CHECK"
);

console.log("\nPrepared transaction XDR (base64):");
console.log(prepared.toXDR());

console.log("\nSAFETY RESULT:");
console.log("1. Deterministic SAC address: PASS");
console.log("2. Exactly one operation:      PASS");
console.log("3. Asset-based contract ID:    PASS");
console.log("4. Stellar Asset executable:   PASS");
console.log("5. Transaction prepared:       PASS");
console.log("6. Transaction submitted:      NO");

console.log(
  "\nIMPORTANT: This script only prepares and inspects the transaction. " +
    "It does not sign or submit it."
);
