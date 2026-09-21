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
    { networkPassphrase: NETWORK, fee: "9000000" },
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
  console.log("RPC:", RPC_URL);
  console.log("Deployer:", deployer.publicKey());
  console.log("Owner:", owner.publicKey());

  let statusBefore;
  try {
    console.log("[DEBUG] Checking existing LEXO registry entry...");
    statusBefore = await simulate("token_status", [
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
    ]);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("[DEBUG] token_status check failed:", message);
    if (!/not found|does not exist|missing/i.test(message)) {
      throw new Error(`Could not verify existing LEXO registry entry: ${message}`);
    }
    console.log("[DEBUG] No existing registry entry detected; proceeding with registration.");
    statusBefore = null;
  }

  if (statusBefore !== null && statusBefore !== undefined) {
    console.log("LEXO registry entry already exists. No registration submitted.");
    return;
  }

  const tx = new TransactionBuilder(await server.getAccount(deployer.publicKey()), {
    networkPassphrase: NETWORK,
    fee: "9000000",
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

  console.log("[DEBUG] Phase 1: baseline simulation (no extra CPU leeway)...");
  const baselineSimulation = await server.simulateTransaction(tx);
  if (baselineSimulation.error) {
    console.error("[DEBUG] Baseline simulation error:", baselineSimulation.error);
    console.error("[DEBUG] Baseline simulation object:", JSON.stringify(baselineSimulation, null, 2));
    throw new Error(`Registration baseline simulation failed: ${baselineSimulation.error}`);
  }

  const baselineInstructions = Number(
    baselineSimulation.transactionData?._data?.resources?.instructions ?? 0,
  );
  if (!Number.isSafeInteger(baselineInstructions) || baselineInstructions <= 0) {
    throw new Error(`Baseline simulation returned invalid instruction budget: ${baselineInstructions}`);
  }

  // Keep the additional CPU budget bounded so the existing registration fee
  // strategy is unchanged. The second simulation's returned resources are
  // authoritative and are passed directly to assembleTransaction().
  const cpuLeeway = 140000;
  console.log("BASELINE SIMULATED INSTRUCTIONS:", baselineInstructions);
  console.log("CPU LEEWAY SELECTED:", cpuLeeway);
  console.log("TARGET INSTRUCTION BUDGET:", baselineInstructions + cpuLeeway);

  console.log("[DEBUG] Phase 2: submission simulation with adaptive CPU leeway...");
  const simulation = await server.simulateTransaction(tx, { cpuInstructions: cpuLeeway });
  if (simulation.error) {
    console.error("[DEBUG] Submission simulation error:", simulation.error);
    console.error("[DEBUG] Submission simulation object:", JSON.stringify(simulation, null, 2));
    throw new Error(`Registration simulation failed: ${simulation.error}`);
  }

  const simulatedInstructions = Number(
    simulation.transactionData?._data?.resources?.instructions ?? 0,
  );
  const simulatedResourceFee = Number(simulation.minResourceFee ?? 0);
  console.log("SIMULATED INSTRUCTION BUDGET:", simulatedInstructions);
  console.log("SIMULATED RESOURCE FEE (stroops):", simulatedResourceFee);
  console.log("SIMULATION LATEST LEDGER:", simulation.latestLedger);
  console.log("SIMULATION AUTH ENTRIES:", simulation.result?.auth?.length ?? 0);
  console.log(
    "SIMULATION RESOURCE DATA:",
    JSON.stringify(simulation.transactionData?._data?.resources ?? null, null, 2),
  );
  console.log(
    "SIMULATION TRANSACTION DATA:",
    JSON.stringify(simulation.transactionData?._data ?? null, null, 2),
  );

  if (!simulation.result?.auth) throw new Error("Registration returned no authorization entries.");
  console.log("[DEBUG] Authorization entries received:", simulation.result.auth.length);

  const validUntil = simulation.latestLedger + 60;
  simulation.result.auth = await Promise.all(
    simulation.result.auth.map(async (entry) => {
      const info = inspectAuthEntry(entry);
      console.log("[DEBUG] Auth entry:", info);
      if (info.address !== LEXORA) throw new Error(`Unexpected auth address: ${info.address}`);
      return authorizeEntry(
        entry,
        async (_preimage, signingHash) => {
          const signature = owner.sign(signingHash);
          if (!owner.verify(signingHash, signature)) {
            throw new Error("Local owner signature verification failed.");
          }
          return { signatureScVal: xdr.ScVal.scvBytes(signature), address: LEXORA };
        },
        validUntil,
        NETWORK,
      );
    }),
  );

  for (const entry of simulation.result.auth) {
    const readiness = checkAuthEntryReadiness(entry, simulation.latestLedger);
    console.log("[DEBUG] Auth readiness:", JSON.stringify(readiness, null, 2));
    if (!readiness.ready) {
      throw new Error(`Authorization entry not ready: ${JSON.stringify(readiness)}`);
    }
  }

  // Rebuild the exact contract invocation with the signed authorization entries.
  // Operation.invokeContractFunction accepts auth directly; this makes the
  // simulation run in enforcement mode without depending on internal XDR
  // envelope accessors.
  const authorizedTx = new TransactionBuilder(
    await server.getAccount(deployer.publicKey()),
    { networkPassphrase: NETWORK, fee: "9000000" },
  )
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
        auth: simulation.result.auth,
      }),
    )
    .setTimeout(300)
    .build();

  console.log("[DEBUG] Phase 3: enforced simulation with signed authorization...");
  const finalSimulation = await server.simulateTransaction(authorizedTx);
  if (finalSimulation.error) {
    console.error("[DEBUG] Enforced simulation error:", finalSimulation.error);
    throw new Error("Registration enforced simulation failed: " + finalSimulation.error);
  }

  const finalSimulatedInstructions = Number(
    finalSimulation.transactionData?._data?.resources?.instructions ?? 0,
  );
  if (!Number.isSafeInteger(finalSimulatedInstructions) || finalSimulatedInstructions <= 0) {
    throw new Error(
      "Enforced simulation returned invalid instruction budget: " + finalSimulatedInstructions,
    );
  }
  console.log("FINAL SIMULATED INSTRUCTIONS:", finalSimulatedInstructions);
  console.log("FINAL SIMULATED RESOURCE FEE (stroops):", Number(finalSimulation.minResourceFee ?? 0));
  console.log("FINAL SIMULATION LATEST LEDGER:", finalSimulation.latestLedger);

  const prepared = assembleTransaction(authorizedTx, finalSimulation).build();
  validateAssembledSorobanResources(
    prepared,
    finalSimulation,
    "LEXO mainnet registration",
  );
  const preparedTx = prepared.innerTransaction?.tx ?? prepared.tx;
  console.log("[DEBUG] Prepared transaction fee:", preparedTx?.fee?.toString?.() ?? preparedTx?.fee);
  console.log("[DEBUG] Prepared Soroban resources:", JSON.stringify(preparedTx?.ext?.sorobanData?.resources ?? null, null, 2));
  console.log("[DEBUG] Prepared transaction ext type:", preparedTx?.ext?.type ?? null);

  prepared.sign(deployer);
  console.log("[DEBUG] Deployer signature attached.");

  console.log("Submitting LEXO registration to MAINNET...");
  const response = await server.sendTransaction(prepared);
  console.log("[DEBUG] sendTransaction response:", JSON.stringify(response, null, 2));
  console.log("Transaction hash:", response.hash);
  if (response.status === "ERROR") throw new Error(JSON.stringify(response));

  console.log("[DEBUG] Polling transaction result...");
  const result = await server.pollTransaction(response.hash);
  console.log("Final status:", result.status);
  console.log("[DEBUG] Final transaction result:", JSON.stringify(result, null, 2));
  if (result.status === "FAILED") throw new Error("LEXO registration transaction failed.");

  console.log("LEXO registration: SUCCESS");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
