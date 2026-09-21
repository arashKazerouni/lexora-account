import {
  Address,
  Keypair,
  Networks,
  Operation,
  TransactionBuilder,
  scValToNative,
  StrKey,
  xdr,
  authorizeEntry,
  checkAuthEntryReadiness,
  inspectAuthEntry,
} from "@stellar/stellar-sdk";
import { Server, assembleTransaction } from "@stellar/stellar-sdk/rpc";
import { validateAssembledSorobanResources } from "./lib/soroban-safety.mjs";

const RPC_URL = "https://mainnet.sorobanrpc.com";
const NETWORK = Networks.PUBLIC;
const LEXORA =
  process.env.LEXORA_MAINNET_CONTRACT ??
  "CAJL2JO6EILWBTHDRMIQVJA6MTZIUWHOD6WNVJDN7FWTYD6H3NFXH542";
const confirm = process.env.CONFIRM_VANTA_REGISTRATION;
const issuer = process.env.VANTA_ISSUER_PUBLIC_KEY;

if (confirm !== "YES") {
  throw new Error(
    "Set CONFIRM_VANTA_REGISTRATION=YES only after VANTA issuance is verified.",
  );
}
if (!process.env.LEXORA_DEPLOYER_SECRET || !process.env.LEXORA_OWNER_SECRET) {
  throw new Error("Missing LEXORA_DEPLOYER_SECRET or LEXORA_OWNER_SECRET.");
}
if (!issuer || !StrKey.isValidEd25519PublicKey(issuer)) {
  throw new Error("Set a valid VANTA_ISSUER_PUBLIC_KEY.");
}

const owner = Keypair.fromSecret(process.env.LEXORA_OWNER_SECRET);
const deployer = Keypair.fromSecret(process.env.LEXORA_DEPLOYER_SECRET);
const server = new Server(RPC_URL);

const assetMap = () =>
  xdr.ScVal.scvMap([
    new xdr.ScMapEntry({
      key: xdr.ScVal.scvSymbol("code"),
      val: xdr.ScVal.scvString("VANTA"),
    }),
    new xdr.ScMapEntry({
      key: xdr.ScVal.scvSymbol("issuer"),
      val: Address.fromString(issuer).toScVal(),
    }),
  ]);

async function simulate(functionName, args = []) {
  const tx = new TransactionBuilder(
    await server.getAccount(deployer.publicKey()),
    { networkPassphrase: NETWORK, fee: "9000000" },
  )
    .addOperation(
      Operation.invokeContractFunction({
        contract: LEXORA,
        function: functionName,
        args,
      }),
    )
    .setTimeout(300)
    .build();

  const result = await server.simulateTransaction(tx);
  if (result.error) {
    throw new Error(`LEXORA::${functionName} simulation failed: ${result.error}`);
  }
  if (!result.result?.retval) {
    throw new Error(`LEXORA::${functionName} returned no value`);
  }
  return scValToNative(result.result.retval);
}

async function main() {
  console.log("VANTA → LEXORA REGISTRATION");
  console.log("===========================");
  console.log("LEXORA:", LEXORA);
  console.log("Asset: VANTA");
  console.log("Issuer:", issuer);
  console.log("RPC:", RPC_URL);
  console.log("Deployer:", deployer.publicKey());
  console.log("Owner:", owner.publicKey());

  let statusBefore;
  try {
    console.log("[DEBUG] Checking existing VANTA registry entry...");
    statusBefore = await simulate("token_status", [assetMap()]);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("[DEBUG] token_status check failed:", message);
    if (!/not found|does not exist|missing/i.test(message)) {
      throw new Error(`Could not verify existing VANTA registry entry: ${message}`);
    }
    console.log("[DEBUG] No existing registry entry detected; proceeding with registration.");
    statusBefore = null;
  }

  if (statusBefore !== null && statusBefore !== undefined) {
    console.log("VANTA registry entry already exists. No registration submitted.");
    return;
  }

  const tx = new TransactionBuilder(
    await server.getAccount(deployer.publicKey()),
    { networkPassphrase: NETWORK, fee: "9000000" },
  )
    .addOperation(
      Operation.invokeContractFunction({
        contract: LEXORA,
        function: "register_token",
        args: [assetMap()],
      }),
    )
    .setTimeout(300)
    .build();

  console.log("[DEBUG] Phase 1: baseline simulation...");
  const baselineSimulation = await server.simulateTransaction(tx);
  if (baselineSimulation.error) {
    throw new Error(
      `Registration baseline simulation failed: ${baselineSimulation.error}`,
    );
  }

  const baselineInstructions = Number(
    baselineSimulation.transactionData?._data?.resources?.instructions ?? 0,
  );
  if (!Number.isSafeInteger(baselineInstructions) || baselineInstructions <= 0) {
    throw new Error(
      `Baseline simulation returned invalid instruction budget: ${baselineInstructions}`,
    );
  }

  const cpuLeeway = 140000;
  console.log("BASELINE SIMULATED INSTRUCTIONS:", baselineInstructions);
  console.log("CPU LEEWAY SELECTED:", cpuLeeway);

  console.log("[DEBUG] Phase 2: submission simulation with adaptive CPU leeway...");
  const simulation = await server.simulateTransaction(tx, {
    cpuInstructions: cpuLeeway,
  });
  if (simulation.error) {
    throw new Error(`Registration simulation failed: ${simulation.error}`);
  }

  if (!simulation.result?.auth) {
    throw new Error("Registration returned no authorization entries.");
  }

  const validUntil = simulation.latestLedger + 60;
  simulation.result.auth = await Promise.all(
    simulation.result.auth.map(async (entry) => {
      const info = inspectAuthEntry(entry);
      if (info.address !== LEXORA) {
        throw new Error(`Unexpected auth address: ${info.address}`);
      }
      return authorizeEntry(
        entry,
        async (_preimage, signingHash) => {
          const signature = owner.sign(signingHash);
          if (!owner.verify(signingHash, signature)) {
            throw new Error("Local owner signature verification failed.");
          }
          return {
            signatureScVal: xdr.ScVal.scvBytes(signature),
            address: LEXORA,
          };
        },
        validUntil,
        NETWORK,
      );
    }),
  );

  for (const entry of simulation.result.auth) {
    const readiness = checkAuthEntryReadiness(entry, simulation.latestLedger);
    if (!readiness.ready) {
      throw new Error(
        `Authorization entry not ready: ${JSON.stringify(readiness)}`,
      );
    }
  }

  const authorizedTx = new TransactionBuilder(
    await server.getAccount(deployer.publicKey()),
    { networkPassphrase: NETWORK, fee: "9000000" },
  )
    .addOperation(
      Operation.invokeContractFunction({
        contract: LEXORA,
        function: "register_token",
        args: [assetMap()],
        auth: simulation.result.auth,
      }),
    )
    .setTimeout(300)
    .build();

  console.log("[DEBUG] Phase 3: enforced simulation with signed authorization...");
  const finalSimulation = await server.simulateTransaction(authorizedTx);
  if (finalSimulation.error) {
    throw new Error(
      "Registration enforced simulation failed: " + finalSimulation.error,
    );
  }

  const finalSimulatedInstructions = Number(
    finalSimulation.transactionData?._data?.resources?.instructions ?? 0,
  );
  if (!Number.isSafeInteger(finalSimulatedInstructions) || finalSimulatedInstructions <= 0) {
    throw new Error(
      "Enforced simulation returned invalid instruction budget: " +
        finalSimulatedInstructions,
    );
  }

  console.log("FINAL SIMULATED INSTRUCTIONS:", finalSimulatedInstructions);
  console.log(
    "FINAL SIMULATED RESOURCE FEE (stroops):",
    Number(finalSimulation.minResourceFee ?? 0),
  );

  const prepared = assembleTransaction(authorizedTx, finalSimulation).build();
  validateAssembledSorobanResources(
    prepared,
    finalSimulation,
    "VANTA mainnet registration",
  );

  prepared.sign(deployer);
  console.log("Submitting VANTA registration to MAINNET...");
  const response = await server.sendTransaction(prepared);
  console.log("Transaction hash:", response.hash);

  if (response.status === "ERROR") {
    throw new Error(JSON.stringify(response));
  }

  const result = await server.pollTransaction(response.hash);
  console.log("Final status:", result.status);

  if (result.status === "FAILED") {
    throw new Error("VANTA registration transaction failed.");
  }

  console.log("VANTA registration: SUCCESS");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
