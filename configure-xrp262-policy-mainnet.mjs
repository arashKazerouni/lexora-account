import {
  Keypair,
  Networks,
  Operation,
  TransactionBuilder,
  authorizeEntry,
  inspectAuthEntry,
  checkAuthEntryReadiness,
  nativeToScVal,
  xdr,
} from "@stellar/stellar-sdk";
import { Server, assembleTransaction } from "@stellar/stellar-sdk/rpc";

const RPC_URL = "https://mainnet.sorobanrpc.com";
const NETWORK = Networks.PUBLIC;
const LEXORA = "CCV2AE6KK5IA3EW3VM5FNQC3NZUMVGLQBEMDFEWTAEFTLNRPVWIYSQJA";
const MAX_SUPPLY = 900_000_000_000;
const deployer = Keypair.fromSecret(process.env.LEXORA_DEPLOYER_SECRET);
const EXPECTED_DEPLOYER = "GBJELP7DVYFQLY77ZM34SDMQOHDRBN7E7L44WHDAMPPMLCSKG6P3ESRT";
const owner = Keypair.fromSecret(process.env.LEXORA_OWNER_SECRET);
const EXPECTED_OWNER = "8d8b4a1ee1719716095f0eb8aa25943c6235c0dd0cde03348cb9a1f674308aec";
const server = new Server(RPC_URL);
const SOROBAN_FEE_LIMIT = "10000000";

async function main() {
  if (deployer.publicKey() !== EXPECTED_DEPLOYER) throw new Error(`Wrong deployer: ${deployer.publicKey()}`);
  if (owner.publicKey() !== EXPECTED_OWNER) throw new Error(`Wrong owner: ${owner.publicKey()}`);
  console.log("Network: MAINNET");
  console.log("Deployer:", deployer.publicKey());
  console.log("Owner:", owner.publicKey());
  console.log("LEXORA:", LEXORA);
  console.log("Max supply:", MAX_SUPPLY);

  const account = await server.getAccount(deployer.publicKey());
  const tx = new TransactionBuilder(account, {
    networkPassphrase: NETWORK,
    fee: SOROBAN_FEE_LIMIT,
  })
    .addOperation(Operation.invokeContractFunction({
      contract: LEXORA,
      function: "configure_xrp262_policy",
      args: [nativeToScVal(BigInt(MAX_SUPPLY), { type: "i128" })],
    }))
    .setTimeout(300)
    .build();

  console.log("Simulating...");
  const simulation = await server.simulateTransaction(tx, { cpuInstructions: 1_000_000 });
  if (simulation.error) throw new Error(simulation.error);
  if (!simulation.result?.auth) throw new Error("Simulation returned no authorization entries.");

  const validUntil = simulation.latestLedger + 60;
  simulation.result.auth = await Promise.all(simulation.result.auth.map(async (entry) => {
    const before = inspectAuthEntry(entry);
    console.log("Auth entry:", {
      credentialType: before.credentialType,
      address: before.address,
      nonce: before.nonce?.toString(),
      expiration: before.signatureExpirationLedger,
      signers: before.signers.map((signer) => ({ address: signer.address, signed: signer.signed })),
    });
    if (before.address !== LEXORA) throw new Error(`Unexpected authorization address: ${before.address}; expected ${LEXORA}`);
    return authorizeEntry(entry, async (_preimage, signingHash) => {
      const signature = owner.sign(signingHash);
      if (!owner.verify(signingHash, signature)) throw new Error("Local Ed25519 signature verification failed");
      return { signatureScVal: xdr.ScVal.scvBytes(signature), address: LEXORA };
    }, validUntil, NETWORK);
  }));

  for (const entry of simulation.result.auth) {
    const readiness = checkAuthEntryReadiness(entry, simulation.latestLedger);
    console.log("Auth readiness:", readiness);
    if (!readiness.ready) throw new Error(`Authorization entry is not ready: ${JSON.stringify(readiness)}`);
  }

  const prepared = assembleTransaction(tx, simulation).build();
  prepared.sign(deployer);
  console.log("Submitting to MAINNET...");
  const response = await server.sendTransaction(prepared);
  console.log("Transaction hash:", response.hash);
  console.log("Status:", response.status);
  if (response.status === "ERROR") throw new Error(JSON.stringify(response));

  const result = await server.pollTransaction(response.hash);
  console.log("Final status:", result.status);
  if (result.status === "FAILED") {
    const failedTx = await server.getTransaction(response.hash);
    console.dir(failedTx, { depth: 8 });
    throw new Error("Soroban transaction failed; see decoded transaction result above.");
  }
  console.log("XRP262 policy configuration succeeded.");
}

main().catch((err) => { console.error(err); process.exit(1); });
