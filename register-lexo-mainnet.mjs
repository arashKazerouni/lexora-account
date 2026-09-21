import {
  Address,
  Keypair,
  Networks,
  Operation,
  TransactionBuilder,
  nativeToScVal,
  scValToNative,
  StrKey,
  xdr,
  authorizeEntry,
  checkAuthEntryReadiness,
  inspectAuthEntry,
} from "@stellar/stellar-sdk";
import { Server, assembleTransaction } from "@stellar/stellar-sdk/rpc";

const RPC_URL = "https://mainnet.sorobanrpc.com";
const NETWORK = Networks.PUBLIC;
const LEXORA =
  process.env.LEXORA_MAINNET_CONTRACT ??
  "CAJL2JO6EILWBTHDRMIQVJA6MTZIUWHOD6WNVJDN7FWTYD6H3NFXH542";
const confirm = process.env.CONFIRM_LEXO_REGISTRATION;

if (confirm !== "YES") {
  throw new Error("Set CONFIRM_LEXO_REGISTRATION=YES only after LEXO issuance is verified.");
}
if (!process.env.LEXORA_DEPLOYER_SECRET || !process.env.LEXORA_OWNER_SECRET) {
  throw new Error("Missing LEXORA_DEPLOYER_SECRET or LEXORA_OWNER_SECRET.");
}
const issuer = process.env.LEXO_ISSUER_PUBLIC_KEY;
if (!issuer || !StrKey.isValidEd25519PublicKey(issuer)) {
  throw new Error("Set a valid LEXO_ISSUER_PUBLIC_KEY.");
}

const owner = Keypair.fromSecret(process.env.LEXORA_OWNER_SECRET);
const deployer = Keypair.fromSecret(process.env.LEXORA_DEPLOYER_SECRET);
const server = new Server(RPC_URL);

async function simulate(functionName, args = []) {
  const tx = new TransactionBuilder(
    await server.getAccount(deployer.publicKey()),
    { networkPassphrase: NETWORK, fee: process.env.SOROBAN_MAX_FEE_STROOPS ?? "9000000" },
  )
    .addOperation(Operation.invokeContractFunction({ contract: LEXORA, function: functionName, args }))
    .setTimeout(300)
    .build();
  const result = await server.simulateTransaction(tx);
  if (result.error) throw new Error(`LEXORA::${functionName} simulation failed: ${result.error}`);
  if (!result.result?.retval) throw new Error(`LEXORA::${functionName} returned no value`);
  return scValToNative(result.result.retval);
}

async function main() {
  console.log("LEXO → LEXORA REGISTRATION");
  console.log("==========================");
  console.log("LEXORA:", LEXORA);
  console.log("Asset: LEXO");
  console.log("Issuer:", issuer);

  const statusBefore = await simulate("token_status", [
    xdr.ScVal.scvMap([
      new xdr.ScMapEntry({
        key: xdr.ScVal.scvSymbol("code"),
        val: xdr.ScVal.scvString("LEXO"),
      }),
      new xdr.ScMapEntry({
        key: xdr.ScVal.scvSymbol("issuer"),
        val: Address.fromString(issuer).toScVal(),
      }),
    ]),
  ]).catch(() => null);

  if (statusBefore !== null) {
    console.log("LEXO registry entry already exists. No registration submitted.");
    return;
  }

  const tx = new TransactionBuilder(await server.getAccount(deployer.publicKey()), {
    networkPassphrase: NETWORK,
    fee: process.env.SOROBAN_MAX_FEE_STROOPS ?? "9000000",
  })
    .addOperation(
      Operation.invokeContractFunction({
        contract: LEXORA,
        function: "register_token",
        args: [
          xdr.ScVal.scvMap([
            new xdr.ScMapEntry({
              key: xdr.ScVal.scvSymbol("code"),
              val: xdr.ScVal.scvString("LEXO"),
            }),
            new xdr.ScMapEntry({
              key: xdr.ScVal.scvSymbol("issuer"),
              val: Address.fromString(issuer).toScVal(),
            }),
          ]),
        ],
      }),
    )
    .setTimeout(300)
    .build();

  // LEXORA registration uses require_auth and can exceed the RPC default instruction budget.
  // Give simulation 100k instruction leeway so assembleTransaction carries a sufficient CPU limit.
  const simulation = await server.simulateTransaction(tx, { instructionLeeway: 100000 });
  if (simulation.error) throw new Error(`Registration simulation failed: ${simulation.error}`);
  console.log("SIMULATION KEYS:", Object.keys(simulation));
  console.log("SIMULATION RESULT KEYS:", simulation.result ? Object.keys(simulation.result) : []);
  console.log("SIMULATION RAW:", JSON.stringify(simulation, null, 2));
  throw new Error("STOPPED AFTER SIMULATION — no mainnet transaction submitted.");

  if (!simulation.result?.auth) throw new Error("Registration returned no authorization entries.");

  const validUntil = simulation.latestLedger + 60;
  simulation.result.auth = await Promise.all(
    simulation.result.auth.map(async (entry) => {
      const info = inspectAuthEntry(entry);
      if (info.address !== LEXORA) throw new Error(`Unexpected auth address: ${info.address}`);
      return authorizeEntry(
        entry,
        async (_preimage, signingHash) => {
          const signature = owner.sign(signingHash);
          if (!owner.verify(signingHash, signature)) throw new Error("Local owner signature verification failed.");
          return { signatureScVal: xdr.ScVal.scvBytes(signature), address: LEXORA };
        },
        validUntil,
        NETWORK,
      );
    }),
  );

  for (const entry of simulation.result.auth) {
    const readiness = checkAuthEntryReadiness(entry, simulation.latestLedger);
    if (!readiness.ready) throw new Error(`Authorization entry not ready: ${JSON.stringify(readiness)}`);
  }

  const prepared = assembleTransaction(tx, simulation).build();
  prepared.sign(deployer);

  console.log("Submitting LEXO registration to MAINNET...");
  const response = await server.sendTransaction(prepared);
  console.log("Transaction hash:", response.hash);
  if (response.status === "ERROR") throw new Error(JSON.stringify(response));

  const result = await server.pollTransaction(response.hash);
  console.log("Final status:", result.status);
  if (result.status === "FAILED") throw new Error("LEXO registration transaction failed.");

  console.log("LEXO registration: SUCCESS");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
