import {
  Keypair, Networks, Operation, TransactionBuilder, Address, authorizeEntry,
  inspectAuthEntry, checkAuthEntryReadiness, xdr, scValToNative, StrKey,
} from "@stellar/stellar-sdk";
import { Server, assembleTransaction } from "@stellar/stellar-sdk/rpc";
import { validateAssembledSorobanResources } from "./lib/soroban-safety.mjs";

const RPC_URL = "https://mainnet.sorobanrpc.com";
const NETWORK = Networks.PUBLIC;
const LEXORA = process.env.LEXORA_MAINNET_CONTRACT ||
  "CAJL2JO6EILWBTHDRMIQVJA6MTZIUWHOD6WNVJDN7FWTYD6H3NFXH542";
const XRP262_ISSUER = "GCGVZEE7RD2BFF2EIQUT37DYJUR7WDCQ2KWA5LUWYATRFLKEYHMJ3XRP";

if (process.env.CONFIRM_XRP262_MAINNET_ENABLE !== "YES")
  throw new Error("Set CONFIRM_XRP262_MAINNET_ENABLE=YES to enable XRP262.");
if (!process.env.LEXORA_DEPLOYER_SECRET || !process.env.LEXORA_OWNER_SECRET)
  throw new Error("Missing LEXORA_DEPLOYER_SECRET or LEXORA_OWNER_SECRET.");

const deployer = Keypair.fromSecret(process.env.LEXORA_DEPLOYER_SECRET);
const owner = Keypair.fromSecret(process.env.LEXORA_OWNER_SECRET);
const server = new Server(RPC_URL);

function assetId() {
  return xdr.ScVal.scvMap([
    new xdr.ScMapEntry({ key: xdr.ScVal.scvSymbol("code"), val: xdr.ScVal.scvString("XRP262") }),
    new xdr.ScMapEntry({ key: xdr.ScVal.scvSymbol("issuer"), val: Address.fromString(XRP262_ISSUER).toScVal() }),
  ]);
}

function normalizeTokenStatus(value) {
  return Array.isArray(value) ? value[0] : value;
}

async function simulate(contract, functionName, args = []) {
  const tx = new TransactionBuilder(await server.getAccount(deployer.publicKey()), {
    networkPassphrase: NETWORK, fee: process.env.SOROBAN_MAX_FEE_STROOPS ?? "9000000",
  }).addOperation(Operation.invokeContractFunction({ contract, function: functionName, args }))
    .setTimeout(300).build();
  const result = await server.simulateTransaction(tx);
  if (result.error) throw new Error(`${functionName}() simulation failed: ${result.error}`);
  if (!result.result?.retval) throw new Error(`${functionName}() returned no value`);
  return scValToNative(result.result.retval);
}

async function main() {
  console.log("XRP262 MAINNET REGISTRY ENABLE");
  console.log("==============================");
  console.log("LEXORA:", LEXORA);
  console.log("Issuer:", XRP262_ISSUER);

  const onChainOwner = StrKey.encodeEd25519PublicKey(
    Buffer.from(await simulate(LEXORA, "owner")),
  );
  if (onChainOwner !== owner.publicKey())
    throw new Error(`LEXORA owner mismatch: ${onChainOwner}`);

  const statusBeforeRaw = await simulate(LEXORA, "token_status", [assetId()]);
  const statusBefore = normalizeTokenStatus(statusBeforeRaw);
  const allowedBefore = await simulate(LEXORA, "is_token_allowed", [assetId()]);
  console.log("Registry before:", statusBefore);
  console.log("Allowed before:", allowedBefore);

  if (statusBefore !== "Disabled" || allowedBefore !== false)
    throw new Error("XRP262 must be Disabled before this controlled re-enable.");

  const tx = new TransactionBuilder(await server.getAccount(deployer.publicKey()), {
    networkPassphrase: NETWORK, fee: process.env.SOROBAN_MAX_FEE_STROOPS ?? "9000000",
  }).addOperation(Operation.invokeContractFunction({
    contract: LEXORA, function: "register_token", args: [assetId()],
  })).setTimeout(300).build();

  console.log("Owner verification: PASS");
  console.log("Simulating...");
  const simulation = await server.simulateTransaction(tx, { cpuInstructions: 1_000_000 });
  if (simulation.error) throw new Error(`register_token() simulation failed: ${simulation.error}`);
  if (!simulation.result?.auth) throw new Error("Simulation returned no authorization entries.");

  const validUntil = simulation.latestLedger + 60;
  simulation.result.auth = await Promise.all(simulation.result.auth.map(async (entry) => {
    const info = inspectAuthEntry(entry);
    if (info.address !== LEXORA)
      throw new Error(`Unexpected authorization address: ${info.address}`);
    return authorizeEntry(entry, async (_preimage, signingHash) => ({
      signatureScVal: xdr.ScVal.scvBytes(owner.sign(signingHash)), address: LEXORA,
    }), validUntil, NETWORK);
  }));

  for (const entry of simulation.result.auth) {
    const readiness = checkAuthEntryReadiness(entry, simulation.latestLedger);
    if (!readiness.ready) throw new Error(`Authorization not ready: ${JSON.stringify(readiness)}`);
  }

  const prepared = assembleTransaction(tx, simulation).build();
  validateAssembledSorobanResources(prepared, simulation, "XRP262 mainnet mutation");
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
    throw new Error("XRP262 registry enable failed.");
  }

  const statusAfterRaw = await simulate(LEXORA, "token_status", [assetId()]);
  const statusAfter = normalizeTokenStatus(statusAfterRaw);
  const allowedAfter = await simulate(LEXORA, "is_token_allowed", [assetId()]);
  if (statusAfter !== "Active" || allowedAfter !== true)
    throw new Error(`Post-enable verification failed: status=${statusAfter}, allowed=${allowedAfter}`);

  console.log("Registry after: Active");
  console.log("Allowed after: true");
  console.log("");
  console.log("XRP262 REGISTRY ENABLE: SUCCESS");
  console.log("Transaction:", response.hash);
}

main().catch((err) => { console.error(err); process.exit(1); });
