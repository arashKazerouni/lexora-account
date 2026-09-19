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
} from "@stellar/stellar-sdk";

import { Server, assembleTransaction } from "@stellar/stellar-sdk/rpc";

const RPC_URL = "https://soroban-testnet.stellar.org";
const NETWORK = Networks.TESTNET;

const LEXORA =
  "CBXESEYLHVKMOEI5OGPIRY6VQVZ7NYKTKMFBQ2IBAFIBYV3LNKKXNEWY";

const XRP262_SAC =
  "CBQZU2IXARXJVH5HCJ3PBZ7KZUXK3Z3HYJSOEFQWWHS2VJ66CDHOLKQB";

// The fee-payer signs the transaction envelope.
// The owner signs the LEXORA contract-account authorization entry.
const deployer = Keypair.fromSecret(process.env.LEXORA_DEPLOYER_SECRET);
const owner = Keypair.fromSecret(process.env.LEXORA_OWNER_SECRET);

const server = new Server(RPC_URL);
const SOROBAN_FEE_LIMIT = "10000000";

async function main() {
  console.log("Network: TESTNET");
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
        args: [Address.fromString(XRP262_SAC).toScVal()],
      }),
    )
    .setTimeout(300)
    .build();

  console.log("Simulating...");
  const simulation = await server.simulateTransaction(tx, {
    cpuInstructions: 1_000_000,
  });

  if (simulation.error) {
    throw new Error(simulation.error);
  }

  if (!simulation.result?.auth) {
    throw new Error("Simulation returned no authorization entries.");
  }

  console.log("Simulation OK");
  console.log("Latest ledger:", simulation.latestLedger);
  console.log("Auth entries:", simulation.result.auth.length);

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
          `Unexpected authorization address: ${before.address}; expected ${LEXORA}`,
        );
      }

      return authorizeEntry(
        entry,
        async (_preimage, signingHash) => {
          const signature = owner.sign(signingHash);

          if (!owner.verify(signingHash, signature)) {
            throw new Error("Local Ed25519 signature verification failed");
          }

          console.log(
            "Authorization signing hash:",
            Buffer.from(signingHash).toString("hex"),
          );
          console.log("Owner signature verified locally.");

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

  console.log("Authorization entry signed.");

  for (const entry of simulation.result.auth) {
    const readiness = checkAuthEntryReadiness(entry, simulation.latestLedger);

    console.log("Auth readiness:", readiness);

    if (!readiness.ready) {
      throw new Error(
        `Authorization entry is not ready: ${JSON.stringify(readiness)}`,
      );
    }
  }

  console.log("Assembling transaction...");
  const prepared = assembleTransaction(tx, simulation).build();

  prepared.sign(deployer);

  console.log("Submitting to TESTNET...");
  const response = await server.sendTransaction(prepared);

  console.log("Transaction hash:", response.hash);
  console.log("Status:", response.status);

  if (response.status === "ERROR") {
    throw new Error(JSON.stringify(response));
  }

  const result = await server.pollTransaction(response.hash);

  console.log("Final status:", result.status);
  console.log("Transaction:", response.hash);

  if (result.status === "FAILED") {
    const failedTx = await server.getTransaction(response.hash);
    console.dir(failedTx, { depth: 8 });
    throw new Error(
      "Soroban transaction failed; see decoded transaction result above.",
    );
  }

  console.log("XRP262 SAC binding succeeded.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
