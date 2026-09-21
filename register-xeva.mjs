import {
  Keypair,
  Networks,
  Operation,
  TransactionBuilder,
  authorizeEntry,
  inspectAuthEntry,
  checkAuthEntryReadiness,
  Address,
  xdr,
  BASE_FEE,
} from "@stellar/stellar-sdk";

import { Server, assembleTransaction } from "@stellar/stellar-sdk/rpc";

const RPC_URL = "https://mainnet.sorobanrpc.com";
const NETWORK = Networks.PUBLIC;

const LEXORA = "CD3ZU34KEWO57CMO7YVZCE7W3RJMXJ3T6CKPHYWKI7IVCDXSHBGTM6TT";

const XEVA_ISSUER = "GCADAZ22Y6EUC575N4SRMGYVXTODH5MOHM3EVHQNC7AZ6PTZNJI7SXRP";

const deployer = Keypair.fromSecret(process.env.LEXORA_DEPLOYER_SECRET);
const owner = Keypair.fromSecret(process.env.LEXORA_OWNER_SECRET);

const server = new Server(RPC_URL);

// Start with a fee ceiling high enough for Soroban resource fees.
// assembleTransaction() will replace the fee with the simulation-derived
// Soroban resource fee plus the required inclusion fee.
const SOROBAN_FEE_LIMIT = "10000000"; // 1 XLM in stroops

function assetIdScVal() {
  return xdr.ScVal.scvMap([
    new xdr.ScMapEntry({
      key: xdr.ScVal.scvSymbol("code"),
      val: xdr.ScVal.scvString("XEVA"),
    }),
    new xdr.ScMapEntry({
      key: xdr.ScVal.scvSymbol("issuer"),
      val: new Address(XEVA_ISSUER).toScVal(),
    }),
  ]);
}

async function main() {
  console.log("Deployer:", deployer.publicKey());
  console.log("Owner:", owner.publicKey());
  console.log("LEXORA:", LEXORA);

  const account = await server.getAccount(deployer.publicKey());

  const tx = new TransactionBuilder(account, {
    networkPassphrase: NETWORK,
    fee: SOROBAN_FEE_LIMIT,
  })
    .addOperation(
      Operation.invokeContractFunction({
        contract: LEXORA,
        function: "register_token",
        args: [assetIdScVal()],
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

  console.log("Simulation OK");

  const validUntil = simulation.latestLedger + 100;

  console.log("Latest ledger:", simulation.latestLedger);
  console.log("Auth entries:", simulation.result.auth.length);

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
            "Signing hash:",
            Buffer.from(signingHash).toString("hex"),
          );
          console.log("Signature verified locally.");

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

  console.log("Submitting...");

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
    const tx = await server.getTransaction(response.hash);
    console.dir(tx, { depth: 8 });
    throw new Error(
      "Soroban transaction failed; see decoded transaction result above.",
    );
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
