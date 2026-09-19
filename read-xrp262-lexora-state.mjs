import * as StellarSdk from "@stellar/stellar-sdk";

const RPC_URL = "https://mainnet.sorobanrpc.com";
const NETWORK = StellarSdk.Networks.PUBLIC;

const LEXORA =
  process.env.LEXORA_MAINNET_CONTRACT ??
  "CAJL2JO6EILWBTHDRMIQVJA6MTZIUWHOD6WNVJDN7FWTYD6H3NFXH542";

const XRP262_ISSUER =
  "GCGVZEE7RD2BFF2EIQUT37DYJUR7WDCQ2KWA5LUWYATRFLKEYHMJ3XRP";

const SOURCE =
  "GBJELP7DVYFQLY77ZM34SDMQOHDRBN7E7L44WHDAMPPMLCSKG6P3ESRT";

const server = new StellarSdk.rpc.Server(RPC_URL);

function assetIdScVal() {
  return StellarSdk.xdr.ScVal.scvMap([
    new StellarSdk.xdr.ScMapEntry({
      key: StellarSdk.xdr.ScVal.scvSymbol("code"),
      val: StellarSdk.xdr.ScVal.scvString("XRP262"),
    }),
    new StellarSdk.xdr.ScMapEntry({
      key: StellarSdk.xdr.ScVal.scvSymbol("issuer"),
      val: StellarSdk.Address.fromString(XRP262_ISSUER).toScVal(),
    }),
  ]);
}

async function simulate(functionName, args = []) {
  const account = await server.getAccount(SOURCE);

  const tx = new StellarSdk.TransactionBuilder(account, {
    networkPassphrase: NETWORK,
    fee: StellarSdk.BASE_FEE,
  })
    .addOperation(
      StellarSdk.Operation.invokeContractFunction({
        contract: LEXORA,
        function: functionName,
        args,
      }),
    )
    .setTimeout(300)
    .build();

  const simulation = await server.simulateTransaction(tx);

  if (simulation.error) {
    throw new Error(`${functionName}() simulation failed: ${simulation.error}`);
  }

  if (!simulation.result?.retval) {
    throw new Error(`${functionName}() returned no value`);
  }

  return StellarSdk.scValToNative(simulation.result.retval);
}

console.log("XRP262 / LEXORA MAINNET CONTROL CHECK");
console.log("======================================");
console.log("LEXORA:", LEXORA);
console.log("XRP262 issuer:", XRP262_ISSUER);
console.log("Expected SAC:", "CC7L34EWYCTDCA3L7CRRULWX577UJWET32KNJFD2WTEQ4KD7IAUKHIS6");
console.log("");

const ownerBytes = await simulate("owner");
const owner = StellarSdk.StrKey.encodeEd25519PublicKey(Buffer.from(ownerBytes));

console.log("LEXORA owner:", owner);
console.log("");

const sac = await simulate("xrp262_sac");
console.log("Configured XRP262 SAC:", sac ?? "NONE");

const policy = await simulate("xrp262_policy");
console.log("Configured XRP262 policy:", policy ?? "NONE");

const tokenStatus = await simulate("token_status", [assetIdScVal()]);
console.log("XRP262 registry status:", tokenStatus ?? "NONE");

const tokenAllowed = await simulate("is_token_allowed", [assetIdScVal()]);
console.log("XRP262 allowed by generic registry:", tokenAllowed);

console.log("");
console.log("READ-ONLY CHECKS");

if (owner !== "GCGJIJ4YYQR7ROEVXW4QNPN3E2C7AJMTQA7KVA2BMX7JGWFJAYTSFDFU") {
  throw new Error(`LEXORA OWNER MISMATCH: ${owner}`);
}

if (sac && sac !== "CC7L34EWYCTDCA3L7CRRULWX577UJWET32KNJFD2WTEQ4KD7IAUKHIS6") {
  throw new Error(`XRP262 SAC MISMATCH: ${sac}`);
}

console.log("Owner: PASS");
console.log("SAC identity: PASS");
console.log("No state was changed.");
