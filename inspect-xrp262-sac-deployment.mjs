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

console.log("XRP262 SAC deployment fee investigation");
console.log("---------------------------------------");
console.log("Asset:              ", `${ASSET_CODE}-${ISSUER}`);
console.log("Expected SAC:       ", EXPECTED_SAC);
console.log("Derived SAC:        ", derived);
console.log("Source:             ", source);
console.log("RPC:                ", RPC_URL);
console.log("Operations:         ", transaction.operations.length);
console.log("Initial fee:        ", transaction.fee, "stroops");
console.log(
  "Initial fee (XLM):  ",
  Number(transaction.fee) / 10_000_000
);

console.log("\nSimulating unprepared transaction...");
const simulation = await server.simulateTransaction(transaction);

console.log("Simulation latest ledger:", simulation.latestLedger);

if (simulation.error) {
  console.error("Simulation error:", simulation.error);
  throw new Error("Soroban simulation failed; transaction was not prepared or submitted.");
}

console.log(
  "Minimum resource fee:    ",
  simulation.minResourceFee ?? "(not returned)"
);
if (simulation.minResourceFee !== undefined) {
  console.log(
    "Resource fee (XLM):      ",
    Number(simulation.minResourceFee) / 10_000_000
  );
  console.log(
    "Expected total fee:      ",
    Number(simulation.minResourceFee) + Number(StellarSdk.BASE_FEE),
    "stroops"
  );
  console.log(
    "Expected total fee (XLM):",
    (Number(simulation.minResourceFee) + Number(StellarSdk.BASE_FEE)) /
      10_000_000
  );
}

if (simulation.cost) {
  console.log("\nSimulation resource usage:");
  console.log("CPU instructions:        ", simulation.cost.cpuInsns ?? "(n/a)");
  console.log("Memory bytes:            ", simulation.cost.memBytes ?? "(n/a)");
}

console.log("\nPreparing transaction...");
const prepared = await server.prepareTransaction(transaction);

console.log("Prepared fee:             ", prepared.fee, "stroops");
console.log(
  "Prepared fee (XLM):       ",
  Number(prepared.fee) / 10_000_000
);

if (simulation.minResourceFee !== undefined) {
  const expectedPreparedFee =
    Number(simulation.minResourceFee) + Number(StellarSdk.BASE_FEE);
  console.log(
    "Prepared fee vs simulation:",
    Number(prepared.fee) === expectedPreparedFee ? "MATCH" : "DIFF"
  );
  console.log(
    "Inclusion fee component:  ",
    Number(prepared.fee) - Number(simulation.minResourceFee),
    "stroops"
  );
}

console.log("Sequence:                 ", prepared.sequence);
console.log("Timeout ledger/time:      ", prepared.timeBounds ?? "(none)");

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
console.log("5. Simulation completed:       PASS");
console.log("6. Transaction prepared:       PASS");
console.log("7. Transaction submitted:      NO");

console.log(
  "\nIMPORTANT: This script only simulates, prepares, and inspects the transaction. " +
    "It does not sign or submit it."
);
