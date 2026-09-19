import * as StellarSdk from "@stellar/stellar-sdk";

const RPC_URL = "https://mainnet.sorobanrpc.com";
const NETWORK = StellarSdk.Networks.PUBLIC;
const LEXORA = process.env.LEXORA_MAINNET_CONTRACT;
const OWNER_SECRET = process.env.LEXORA_OWNER_SECRET;
const EXPECTED_OWNER =
  "GCGJIJ4YYQR7ROEVXW4QNPN3E2C7AJMTQA7KVA2BMX7JGWFJAYTSFDFU";

if (!LEXORA) throw new Error("Missing LEXORA_MAINNET_CONTRACT.");
if (!StellarSdk.StrKey.isValidContract(LEXORA)) {
  throw new Error(`Invalid contract address: ${LEXORA}`);
}
if (!OWNER_SECRET) throw new Error("Missing LEXORA_OWNER_SECRET.");

const owner = StellarSdk.Keypair.fromSecret(OWNER_SECRET);
if (owner.publicKey() !== EXPECTED_OWNER) {
  throw new Error(`Wrong owner secret: ${owner.publicKey()}`);
}

const server = new StellarSdk.rpc.Server(RPC_URL);
const source = await server.getAccount(
  "GBJELP7DVYFQLY77ZM34SDMQOHDRBN7E7L44WHDAMPPMLCSKG6P3ESRT"
);

const tx = new StellarSdk.TransactionBuilder(source, {
  fee: StellarSdk.BASE_FEE,
  networkPassphrase: NETWORK,
})
  .addOperation(
    StellarSdk.Operation.invokeContractFunction({
      contract: LEXORA,
      function: "owner",
      args: [],
    })
  )
  .setTimeout(300)
  .build();

const simulation = await server.simulateTransaction(tx);
if (simulation.error) throw new Error(simulation.error);
if (!simulation.result?.retval) {
  throw new Error("owner() simulation returned no return value.");
}

const returned = StellarSdk.scValToNative(simulation.result.retval);
const returnedHex = Buffer.from(returned).toString("hex");
const expectedHex = owner.rawPublicKey().toString("hex");

console.log("LEXORA:", LEXORA);
console.log("On-chain owner:", StellarSdk.StrKey.encodeEd25519PublicKey(Buffer.from(returned)));
console.log("Expected owner:", EXPECTED_OWNER);

if (returnedHex !== expectedHex) {
  throw new Error(
    `OWNER MISMATCH: on-chain=${returnedHex}, expected=${expectedHex}`
  );
}

console.log("OWNER VERIFICATION: PASS");
