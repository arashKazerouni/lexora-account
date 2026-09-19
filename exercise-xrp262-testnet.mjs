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
} from "@stellar/stellar-sdk";

import { Server, assembleTransaction } from "@stellar/stellar-sdk/rpc";

const RPC_URL = "https://soroban-testnet.stellar.org";
const NETWORK = Networks.TESTNET;

const LEXORA =
  process.env.LEXORA_TESTNET ||
  "CCKK2FG7LZEDCEQZPRGVDEBIYYVIDFYSOZMO24BY54X6HSQUVOKO6UWR";

const XRP262_SAC =
  "CBQZU2IXARXJVH5HCJ3PBZ7KZUXK3Z3HYJSOEFQWWHS2VJ66CDHOLKQB";

const MODE = process.env.XRP262_MODE || "mint";
const AMOUNT = BigInt(process.env.XRP262_AMOUNT || "1000000");
const RECIPIENT =
  process.env.XRP262_RECIPIENT ||
  process.env.LEXORA_TESTNET ||
  LEXORA;

const deployer = Keypair.fromSecret(process.env.LEXORA_DEPLOYER_SECRET);
const owner = Keypair.fromSecret(process.env.LEXORA_OWNER_SECRET);
const server = new Server(RPC_URL);
const SOROBAN_FEE_LIMIT = "10000000";

function buildArgs() {
  if (MODE === "mint") {
    return [
      Address.fromString(RECIPIENT).toScVal(),
      nativeToScVal(AMOUNT, { type: "i128" }),
    ];
  }

  if (MODE === "burn") {
    return [nativeToScVal(AMOUNT, { type: "i128" })];
  }

  throw new Error(`Unsupported XRP262_MODE: ${MODE}; use mint or burn`);
}

async function main() {
  console.log("Network: TESTNET");
  console.log("Mode:", MODE);
  console.log("LEXORA:", LEXORA);
  console.log("XRP262 SAC:", XRP262_SAC);
  console.log("Amount:", AMOUNT.toString());

  if (MODE === "mint") {
    console.log("Recipient:", RECIPIENT);
  }

  const account = await server.getAccount(deployer.publicKey());

  const tx = new TransactionBuilder(account, {
    networkPassphrase: NETWORK,
    fee: SOROBAN_FEE_LIMIT,
  })
    .addOperation(
      Operation.invokeContractFunction({
        contract: LEXORA,
        function: MODE === "mint" ? "mint_xrp262" : "burn_xrp262",
        args: buildArgs(),
      }),
    )
    .setTimeout(300)
    .build();

  console.log("Simulating...");
  const simulation = await server.simulateTransaction(tx, {
    cpuInstructions: 2_000_000,
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

    console.log("Auth readiness:", readiness);

    if (!readiness.ready) {
      throw new Error(
        `Authorization entry is not ready: ${JSON.stringify(readiness)}`,
      );
    }
  }

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
    throw new Error("Soroban transaction failed.");
  }

  console.log(
    MODE === "mint"
      ? "XRP262T mint succeeded."
      : "XRP262T burn succeeded.",
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
