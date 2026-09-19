import * as StellarSdk from "@stellar/stellar-sdk";

const RPC_URL = "https://mainnet.sorobanrpc.com";
const NETWORK = StellarSdk.Networks.PUBLIC;

const ASSET_CODE = "XRP262";
const ISSUER =
  "GCGVZEE7RD2BFF2EIQUT37DYJUR7WDCQ2KWA5LUWYATRFLKEYHMJ3XRP";

const EXPECTED_SAC =
  "CC7L34EWYCTDCA3L7CRRULWX577UJWET32KNJFD2WTEQ4KD7IAUKHIS6";

const SECRET = process.env.DEPLOYER_SECRET;
const CONFIRM = process.env.CONFIRM_XRP262_DEPLOY;

if (!SECRET) {
  throw new Error(
    "Missing DEPLOYER_SECRET. Set it in the shell; never put the secret in this file."
  );
}

if (CONFIRM !== "YES") {
  throw new Error(
    "Deployment is disabled by default. Set CONFIRM_XRP262_DEPLOY=YES to sign and submit the transaction."
  );
}

const server = new StellarSdk.rpc.Server(RPC_URL);
const keypair = StellarSdk.Keypair.fromSecret(SECRET);
const source = keypair.publicKey();

const asset = new StellarSdk.Asset(ASSET_CODE, ISSUER);
const derived = asset.contractId(NETWORK);

if (derived !== EXPECTED_SAC) {
  throw new Error(
    `Deterministic SAC mismatch: derived ${derived}, expected ${EXPECTED_SAC}`
  );
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

console.log("XRP262 SAC deployment");
console.log("---------------------");
console.log("Asset:          ", `${ASSET_CODE}-${ISSUER}`);
console.log("Derived SAC:    ", derived);
console.log("Expected SAC:   ", EXPECTED_SAC);
console.log("Source:         ", source);
console.log("RPC:            ", RPC_URL);
console.log("Preparing fresh mainnet transaction...");

const prepared = await server.prepareTransaction(transaction);

console.log("Prepared fee:   ", prepared.fee, "stroops");
console.log(
  "Prepared fee:   ",
  Number(prepared.fee) / 10_000_000,
  "XLM"
);

if (prepared.operations.length !== 1) {
  throw new Error(
    `Expected exactly 1 operation, found ${prepared.operations.length}`
  );
}

const parsed = StellarSdk.TransactionBuilder.fromXDR(
  prepared.toXDR(),
  NETWORK
);
const parsedOp = parsed.operations[0];
const createContract = parsedOp.func?.createContract;

const valid =
  parsedOp.type === "invokeHostFunction" &&
  parsedOp.func?.type === "hostFunctionTypeCreateContract" &&
  createContract?.contractIdPreimage?.type ===
    "contractIdPreimageFromAsset" &&
  createContract?.executable?.type ===
    "contractExecutableStellarAsset";

if (!valid) {
  throw new Error(
    "Freshly prepared transaction failed the native SAC structure check."
  );
}

console.log("Transaction structure: PASS");
console.log("Signing with local DEPLOYER_SECRET...");

prepared.sign(keypair);

console.log("Signature:       PASS");
console.log("Submitting to mainnet...");

const send = await server.sendTransaction(prepared);

console.log("Submission status:", send.status);
console.log("Transaction hash: ", send.hash ?? "(none)");

if (send.status === "ERROR") {
  console.error("Transaction submission failed:");
  console.dir(send, { depth: 8 });
  process.exit(1);
}

const hash = send.hash;
if (!hash) {
  throw new Error("Submission returned no transaction hash.");
}

console.log("Waiting for mainnet confirmation...");

for (let attempt = 1; attempt <= 30; attempt++) {
  await new Promise((resolve) => setTimeout(resolve, 2000));

  const result = await server.getTransaction(hash);

  console.log(
    `Poll ${attempt}: status=${result.status}` +
      (result.ledger ? `, ledger=${result.ledger}` : "")
  );

  if (result.status === "SUCCESS") {
    console.log("");
    console.log("========================================");
    console.log("XRP262 SAC DEPLOYMENT SUCCESSFUL");
    console.log("========================================");
    console.log("SAC:             ", EXPECTED_SAC);
    console.log("Transaction hash:", hash);
    console.log("Ledger:          ", result.ledger);
    console.log("Fee:             ", prepared.fee, "stroops");
    console.log(
      "Fee:             ",
      Number(prepared.fee) / 10_000_000,
      "XLM"
    );
    process.exit(0);
  }

  if (result.status === "FAILED") {
    console.error("");
    console.error("XRP262 SAC transaction FAILED.");
    console.dir(result, { depth: 10 });
    process.exit(1);
  }
}

console.error(
  "Transaction was submitted but was not confirmed within the polling window."
);
console.error("Hash:", hash);
process.exit(2);
