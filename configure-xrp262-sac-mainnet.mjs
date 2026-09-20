import {
  Keypair,
  Networks,
  Operation,
  TransactionBuilder,
  Address,
  authorizeEntry,
  inspectAuthEntry,
  checkAuthEntryReadiness,
  xdr,
  nativeToScVal,
  scValToNative,
  StrKey,
} from "@stellar/stellar-sdk";
import { Server, assembleTransaction } from "@stellar/stellar-sdk/rpc";

const RPC_URL = "https://mainnet.sorobanrpc.com";
const NETWORK = Networks.PUBLIC;
const LEXORA =
  process.env.LEXORA_MAINNET_CONTRACT ||
  "CAJL2JO6EILWBTHDRMIQVJA6MTZIUWHOD6WNVJDN7FWTYD6H3NFXH542";
const XRP262_SAC =
  "CC7L34EWYCTDCA3L7CRRULWX577UJWET32KNJFD2WTEQ4KD7IAUKHIS6";
const EXPECTED_ASSET_CODE = "XRP262";

if (!process.env.LEXORA_DEPLOYER_SECRET) {
  throw new Error("Missing LEXORA_DEPLOYER_SECRET.");
}
if (!process.env.LEXORA_OWNER_SECRET) {
  throw new Error("Missing LEXORA_OWNER_SECRET.");
}

const deployer = Keypair.fromSecret(process.env.LEXORA_DEPLOYER_SECRET);
const owner = Keypair.fromSecret(process.env.LEXORA_OWNER_SECRET);
const server = new Server(RPC_URL);
const SOROBAN_FEE_LIMIT = process.env.SOROBAN_MAX_FEE_STROOPS ?? "100000000";

async function main() {
  const ownerReadTx = new TransactionBuilder(
    await server.getAccount(deployer.publicKey()),
    { networkPassphrase: NETWORK, fee: SOROBAN_FEE_LIMIT }
  )
    .addOperation(
      Operation.invokeContractFunction({
        contract: LEXORA,
        function: "owner",
        args: [],
      })
    )
    .setTimeout(300)
    .build();

  const ownerSimulation = await server.simulateTransaction(ownerReadTx);
  if (ownerSimulation.error) {
    throw new Error(
      `LEXORA owner() simulation failed: ${ownerSimulation.error}`
    );
  }

  const ownerValue = ownerSimulation.result?.retval;
  if (!ownerValue) throw new Error("LEXORA owner() returned no value.");

  const ownerBytes = Buffer.from(scValToNative(ownerValue));
  const onChainOwner = StrKey.encodeEd25519PublicKey(ownerBytes);
  const expectedOwner = owner.publicKey();

  if (onChainOwner !== expectedOwner) {
    throw new Error(
      `LEXORA owner mismatch: on-chain=${onChainOwner}, expected=${expectedOwner}`
    );
  }

  console.log("LEXORA owner verification: PASS");
  console.log("Network: MAINNET");
  console.log("Deployer:", deployer.publicKey());
  console.log("Owner:", owner.publicKey());
  console.log("LEXORA:", LEXORA);
  console.log("XRP262 SAC:", XRP262_SAC);

  const account = await server.getAccount(deployer.publicKey());
  const tx = new TransactionBuilder(account, {
    networkPassphrase: NETWORK,
    fee: SOROBAN_FEE_LIMIT,
  })
    .addOperation(
      Operation.invokeContractFunction({
        contract: LEXORA,
        function: "configure_xrp262_sac",
        args: [
          Address.fromString(XRP262_SAC).toScVal(),
          nativeToScVal(EXPECTED_ASSET_CODE, { type: "string" }),
        ],
      })
    )
    .setTimeout(300)
    .build();

  console.log("Simulating...");
  const simulation = await server.simulateTransaction(tx, {
    cpuInstructions: 1_000_000,
  });
  if (simulation.error) throw new Error(simulation.error);
  if (!simulation.result?.auth) {
    throw new Error("Simulation returned no authorization entries.");
  }

  const validUntil = simulation.latestLedger + 60;
  simulation.result.auth = await Promise.all(
    simulation.result.auth.map(async (entry) => {
      const before = inspectAuthEntry(entry);
      console.log("Auth entry:", {
        credentialType: before.credentialType,
        address: before.address,
        nonce: before.nonce?.toString(),
        expiration: before.signatureExpirationLedger,
        signers: before.signers.map((signer) => ({
          address: signer.address,
          signed: signer.signed,
        })),
      });

      if (before.address !== LEXORA) {
        throw new Error(
          `Unexpected authorization address: ${before.address}; expected ${LEXORA}`
        );
      }

      return authorizeEntry(
        entry,
        async (_preimage, signingHash) => {
          const signature = owner.sign(signingHash);
          if (!owner.verify(signingHash, signature)) {
            throw new Error("Local Ed25519 signature verification failed");
          }
          return {
            signatureScVal: xdr.ScVal.scvBytes(signature),
            address: LEXORA,
          };
        },
        validUntil,
        NETWORK
      );
    })
  );

  for (const entry of simulation.result.auth) {
    const readiness = checkAuthEntryReadiness(
      entry,
      simulation.latestLedger
    );
    console.log("Auth readiness:", readiness);
    if (!readiness.ready) {
      throw new Error(
        `Authorization entry is not ready: ${JSON.stringify(readiness)}`
      );
    }
  }

  const prepared = assembleTransaction(tx, simulation).build();
  prepared.sign(deployer);

  console.log("Submitting to MAINNET...");
  const response = await server.sendTransaction(prepared);
  console.log("Transaction hash:", response.hash);
  console.log("Status:", response.status);
  if (response.status === "ERROR") {
    throw new Error(JSON.stringify(response));
  }

  const result = await server.pollTransaction(response.hash);
  console.log("Final status:", result.status);
  if (result.status === "FAILED") {
    const failedTx = await server.getTransaction(response.hash);
    console.dir(failedTx, { depth: 8 });
    throw new Error(
      "Soroban transaction failed; see decoded transaction result above."
    );
  }

  console.log("XRP262 SAC binding succeeded.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
