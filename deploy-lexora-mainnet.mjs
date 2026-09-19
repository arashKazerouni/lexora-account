import * as StellarSdk from "@stellar/stellar-sdk";
import fs from "node:fs";

const RPC_URL = "https://mainnet.sorobanrpc.com";
const NETWORK = StellarSdk.Networks.PUBLIC;
const WASM_PATH =
  process.env.LEXORA_WASM_PATH ??
  "target/wasm32v1-none/release/lexora_account.wasm";

const DEPLOYER_SECRET = process.env.LEXORA_DEPLOYER_SECRET;
const OWNER_SECRET = process.env.LEXORA_OWNER_SECRET;
const EXPECTED_DEPLOYER =
  "GBJELP7DVYFQLY77ZM34SDMQOHDRBN7E7L44WHDAMPPMLCSKG6P3ESRT";
const EXPECTED_OWNER =
  "GCGJIJ4YYQR7ROEVXW4QNPN3E2C7AJMTQA7KVA2BMX7JGWFJAYTSFDFU";
const CONFIRM = process.env.CONFIRM_LEXORA_MAINNET_DEPLOY;

if (!DEPLOYER_SECRET || !OWNER_SECRET) {
  throw new Error(
    "Missing LEXORA_DEPLOYER_SECRET or LEXORA_OWNER_SECRET. Keep both secrets only in the shell."
  );
}
if (CONFIRM !== "YES") {
  throw new Error(
    "Mainnet deployment is disabled by default. Set CONFIRM_LEXORA_MAINNET_DEPLOY=YES after reviewing the printed checks."
  );
}
if (!fs.existsSync(WASM_PATH)) {
  throw new Error(`WASM not found: ${WASM_PATH}. Run 'stellar contract build' first.`);
}

const deployer = StellarSdk.Keypair.fromSecret(DEPLOYER_SECRET);
const owner = StellarSdk.Keypair.fromSecret(OWNER_SECRET);
if (deployer.publicKey() !== EXPECTED_DEPLOYER) {
  throw new Error(`Wrong deployer: ${deployer.publicKey()}`);
}
if (owner.publicKey() !== EXPECTED_OWNER) {
  throw new Error(`Wrong owner: ${owner.publicKey()}`);
}

const wasm = fs.readFileSync(WASM_PATH);
const wasmHash = StellarSdk.xdr.Hash(
  StellarSdk.hash(wasm)
);
const server = new StellarSdk.rpc.Server(RPC_URL);

console.log("LEXORA MAINNET FRESH DEPLOYMENT");
console.log("--------------------------------");
console.log("WASM:      ", WASM_PATH);
console.log("WASM hash: ", wasmHash.toString("hex"));
console.log("Deployer:  ", deployer.publicKey());
console.log("Owner:     ", owner.publicKey());
console.log("Network:   MAINNET");
console.log("");

const account = await server.getAccount(deployer.publicKey());

const uploadTx = new StellarSdk.TransactionBuilder(account, {
  fee: StellarSdk.BASE_FEE,
  networkPassphrase: NETWORK,
})
  .addOperation(StellarSdk.Operation.uploadContractWasm({ wasm }))
  .setTimeout(300)
  .build();

const preparedUpload = await server.prepareTransaction(uploadTx);
preparedUpload.sign(deployer);
const uploadResponse = await server.sendTransaction(preparedUpload);
if (uploadResponse.status === "ERROR") {
  throw new Error(JSON.stringify(uploadResponse));
}
const uploadResult = await server.pollTransaction(uploadResponse.hash);
if (uploadResult.status !== "SUCCESS") {
  console.dir(uploadResult, { depth: 10 });
  throw new Error("WASM upload failed.");
}

const uploadedHash = uploadResult.returnValue.bytes();
if (uploadedHash.toString("hex") !== wasmHash.toString("hex")) {
  throw new Error("Uploaded WASM hash does not match the local WASM hash.");
}

console.log("WASM upload: PASS");
console.log("Upload tx:   ", uploadResponse.hash);

const constructorArgs = [
  StellarSdk.nativeToScVal(owner.rawPublicKey(), { type: "bytes" }),
];

const deployAccount = await server.getAccount(deployer.publicKey());
const deployTx = new StellarSdk.TransactionBuilder(deployAccount, {
  fee: StellarSdk.BASE_FEE,
  networkPassphrase: NETWORK,
})
  .addOperation(
    StellarSdk.Operation.createCustomContract({
      address: StellarSdk.Address.fromString(deployer.publicKey()),
      wasmHash: uploadedHash,
      salt: StellarSdk.hash(Buffer.from("LEXORA-XRP262-MAINNET-V2")),
      constructorArgs,
    })
  )
  .setTimeout(300)
  .build();

const preparedDeploy = await server.prepareTransaction(deployTx);
preparedDeploy.sign(deployer);
const deployResponse = await server.sendTransaction(preparedDeploy);
if (deployResponse.status === "ERROR") {
  throw new Error(JSON.stringify(deployResponse));
}
const deployResult = await server.pollTransaction(deployResponse.hash);
if (deployResult.status !== "SUCCESS") {
  console.dir(deployResult, { depth: 10 });
  throw new Error("LEXORA deployment failed.");
}

const contractAddress = StellarSdk.StrKey.encodeContract(
  StellarSdk.Address.fromScAddress(
    deployResult.returnValue.address()
  ).toBuffer()
);

console.log("");
console.log("LEXORA DEPLOYMENT SUCCESSFUL");
console.log("----------------------------");
console.log("Contract:    ", contractAddress);
console.log("Deploy tx:   ", deployResponse.hash);
console.log("Ledger:      ", deployResult.ledger);
console.log("Owner:       ", EXPECTED_OWNER);
console.log("");
console.log("NEXT: verify owner() on mainnet before configuring any policy or SAC.");
