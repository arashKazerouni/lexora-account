import {
  Keypair, Networks, Operation, TransactionBuilder, authorizeEntry,
  inspectAuthEntry, checkAuthEntryReadiness, nativeToScVal, xdr, scValToNative, StrKey,
} from "@stellar/stellar-sdk";
import { Server, assembleTransaction } from "@stellar/stellar-sdk/rpc";
import { validateAssembledSorobanResources } from "./lib/soroban-safety.mjs";
import { requireMainnetConfirmation, getSorobanFee } from "./lib/mainnet-guards.mjs";

const RPC_URL = "https://mainnet.sorobanrpc.com";
const NETWORK = Networks.PUBLIC;
const LEXORA = process.env.LEXORA_MAINNET_CONTRACT ||
  "CAJL2JO6EILWBTHDRMIQVJA6MTZIUWHOD6WNVJDN7FWTYD6H3NFXH542";
const MAX_SUPPLY = 900_000_000_000n * 10_000_000n;
const FEE = getSorobanFee();

if (!process.env.LEXORA_DEPLOYER_SECRET || !process.env.LEXORA_OWNER_SECRET)
  throw new Error("Missing LEXORA_DEPLOYER_SECRET or LEXORA_OWNER_SECRET.");

const deployer = Keypair.fromSecret(process.env.LEXORA_DEPLOYER_SECRET);
const owner = Keypair.fromSecret(process.env.LEXORA_OWNER_SECRET);
const server = new Server(RPC_URL);

async function main() {
  requireMainnetConfirmation("CONFIRM_XRP262_MAINNET_POLICY", process.env.CONFIRM_XRP262_MAINNET_POLICY);
  const readTx = new TransactionBuilder(await server.getAccount(deployer.publicKey()), {
    networkPassphrase: NETWORK, fee: FEE,
  }).addOperation(Operation.invokeContractFunction({
    contract: LEXORA, function: "owner", args: [],
  })).setTimeout(300).build();

  const read = await server.simulateTransaction(readTx);
  if (read.error) throw new Error(`owner() simulation failed: ${read.error}`);
  const value = read.result?.retval;
  if (!value) throw new Error("owner() returned no value.");
  const onChainOwner = StrKey.encodeEd25519PublicKey(Buffer.from(scValToNative(value)));
  if (onChainOwner !== owner.publicKey())
    throw new Error(`LEXORA owner mismatch: on-chain=${onChainOwner}, expected=${owner.publicKey()}`);

  const tx = new TransactionBuilder(await server.getAccount(deployer.publicKey()), {
    networkPassphrase: NETWORK, fee: FEE,
  }).addOperation(Operation.invokeContractFunction({
    contract: LEXORA,
    function: "configure_xrp262_policy",
    args: [nativeToScVal(MAX_SUPPLY.toString(), { type: "i128" })],
  })).setTimeout(300).build();

  console.log("XRP262 MAINNET POLICY CONFIGURATION");
  console.log("LEXORA:", LEXORA);
  console.log("Total supply:", "900,000,000,000 XRP262");
  console.log("Decimals:", "7");
  console.log("Max supply base units:", MAX_SUPPLY.toString());
  console.log("Owner verification: PASS");
  console.log("Simulating...");

  const simulation = await server.simulateTransaction(tx, { cpuInstructions: 1_000_000 });
  if (simulation.error) throw new Error(simulation.error);
  if (!simulation.result?.auth) throw new Error("Simulation returned no authorization entries.");

  const validUntil = simulation.latestLedger + 60;
  simulation.result.auth = await Promise.all(simulation.result.auth.map(async (entry) => {
    const info = inspectAuthEntry(entry);
    if (info.address !== LEXORA) throw new Error(`Unexpected authorization address: ${info.address}`);
    return authorizeEntry(entry, async (_preimage, signingHash) => {
      const signature = owner.sign(signingHash);
      if (!owner.verify(signingHash, signature))
        throw new Error("Local LEXORA owner signature verification failed.");
      return {
        signatureScVal: xdr.ScVal.scvBytes(signature),
        address: LEXORA,
      };
    }, validUntil, NETWORK);
  }));

  for (const entry of simulation.result.auth) {
    const readiness = checkAuthEntryReadiness(entry, simulation.latestLedger);
    if (!readiness.ready) throw new Error(`Authorization not ready: ${JSON.stringify(readiness)}`);
  }

  const prepared = assembleTransaction(tx, simulation).build();
  validateAssembledSorobanResources(prepared, simulation, "XRP262 policy mutation");
  prepared.sign(deployer);
  console.log("Submitting to MAINNET...");
  const response = await server.sendTransaction(prepared);
  console.log("Transaction hash:", response.hash);
  console.log("Status:", response.status);
  if (response.status === "ERROR") throw new Error(JSON.stringify(response));

  const result = await server.pollTransaction(response.hash);
  console.log("Final status:", result.status);
  if (result.status === "FAILED") {
    const failed = await server.getTransaction(response.hash);
    console.dir(failed, { depth: 8 });
    throw new Error("XRP262 policy configuration failed.");
  }
  console.log("XRP262 policy configuration succeeded.");
}

main().catch((err) => { console.error(err); process.exit(1); });
