import {
  Keypair, Networks, Operation, TransactionBuilder, Address, authorizeEntry,
  inspectAuthEntry, checkAuthEntryReadiness, xdr, nativeToScVal, scValToNative, StrKey,
} from "@stellar/stellar-sdk";
import { Server, assembleTransaction } from "@stellar/stellar-sdk/rpc";
import { validateAssembledSorobanResources } from "./lib/soroban-safety.mjs";
import { requireMainnetConfirmation } from "./lib/mainnet-guards.mjs";

const RPC_URL = "https://mainnet.sorobanrpc.com";
const NETWORK = Networks.PUBLIC;
const SAC = "CC7L34EWYCTDCA3L7CRRULWX577UJWET32KNJFD2WTEQ4KD7IAUKHIS6";
const LEXORA = process.env.LEXORA_MAINNET_CONTRACT ||
  "CAJL2JO6EILWBTHDRMIQVJA6MTZIUWHOD6WNVJDN7FWTYD6H3NFXH542";
const ISSUER = "GCGVZEE7RD2BFF2EIQUT37DYJUR7WDCQ2KWA5LUWYATRFLKEYHMJ3XRP";

if (!process.env.XRP262_ISSUER_SECRET) throw new Error("Missing XRP262_ISSUER_SECRET.");
const issuer = Keypair.fromSecret(process.env.XRP262_ISSUER_SECRET);
if (issuer.publicKey() !== ISSUER) throw new Error(`Wrong XRP262 issuer secret: ${issuer.publicKey()}`);

const server = new Server(RPC_URL);

async function invoke(functionName, args) {
  const tx = new TransactionBuilder(await server.getAccount(issuer.publicKey()), {
    networkPassphrase: NETWORK, fee: "10000000",
  }).addOperation(Operation.invokeContractFunction({
    contract: SAC, function: functionName, args,
  })).setTimeout(300).build();

  const simulation = await server.simulateTransaction(tx, { cpuInstructions: 1_000_000 });
  if (simulation.error) throw new Error(`${functionName} simulation failed: ${simulation.error}`);
  return { tx, simulation };
}

async function main() {
  requireMainnetConfirmation("CONFIRM_XRP262_SAC_ADMIN_TRANSFER", process.env.CONFIRM_XRP262_SAC_ADMIN_TRANSFER);
  const read = await invoke("admin", []);
  const currentAdmin = Address.fromScVal(read.simulation.result?.retval).toString();
  console.log("XRP262 SAC ADMIN TRANSFER");
  console.log("SAC:", SAC);
  console.log("Current admin:", currentAdmin);
  console.log("Expected issuer:", ISSUER);
  console.log("New admin:", LEXORA);

  if (currentAdmin !== ISSUER) {
    throw new Error(`Refusing transfer: current SAC admin is ${currentAdmin}, not issuer ${ISSUER}`);
  }

  const tx = new TransactionBuilder(await server.getAccount(issuer.publicKey()), {
    networkPassphrase: NETWORK, fee: "10000000",
  }).addOperation(Operation.invokeContractFunction({
    contract: SAC,
    function: "set_admin",
    args: [Address.fromString(LEXORA).toScVal()],
  })).setTimeout(300).build();

  console.log("Simulating set_admin...");
  const simulation = await server.simulateTransaction(tx, { cpuInstructions: 1_000_000 });
  if (simulation.error) throw new Error(simulation.error);
  if (!simulation.result?.auth) throw new Error("Simulation returned no authorization entries.");

  const validUntil = simulation.latestLedger + 60;
  simulation.result.auth = await Promise.all(simulation.result.auth.map(async (entry) => {
    const info = inspectAuthEntry(entry);
    console.log("Auth entry:", {
      address: info.address, credentialType: info.credentialType,
      signers: info.signers.map((s) => ({ address: s.address, signed: s.signed })),
    });

    // SAC set_admin() is authorized by the current admin, which is the
    // transaction source account here. For sourceAccount credentials,
    // the SDK correctly reports address=null because the source account
    // signature is carried by the transaction itself. Do not attempt to
    // authorize this entry as a contract/custom credential.
    if (info.credentialType === "sourceAccount") return entry;

    if (info.address !== ISSUER) throw new Error(`Unexpected auth address: ${info.address}`);
    return authorizeEntry(entry, async (_preimage, signingHash) => {
      const signature = issuer.sign(signingHash);
      if (!issuer.verify(signingHash, signature))
        throw new Error("Local XRP262 issuer signature verification failed.");
      return {
        signatureScVal: xdr.ScVal.scvBytes(signature), address: ISSUER,
      };
    }, validUntil, NETWORK);
  }));

  for (const entry of simulation.result.auth) {
    const readiness = checkAuthEntryReadiness(entry, simulation.latestLedger);
    if (!readiness.ready) throw new Error(`Authorization not ready: ${JSON.stringify(readiness)}`);
  }

  const prepared = assembleTransaction(tx, simulation).build();
  validateAssembledSorobanResources(prepared, simulation, "XRP262 SAC admin transfer");
  prepared.sign(issuer);
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
    throw new Error("SAC admin transfer failed.");
  }
  console.log("SAC admin transfer succeeded.");
}
main().catch((err) => { console.error(err); process.exit(1); });
