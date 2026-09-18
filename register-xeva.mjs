import {
  Keypair,
  Networks,
  Operation,
  TransactionBuilder,
  authorizeEntry,
  nativeToScVal,
  Address,
  xdr,
  hash,
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
    fee: BASE_FEE,
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

  const simulation = await server.simulateTransaction(tx);

  if (simulation.error) {
    throw new Error(simulation.error);
  }

  console.log("Simulation OK");

  const latestLedger = simulation.latestLedger;
  const validUntil = latestLedger + 100;

  console.log("Latest ledger:", latestLedger);
  console.log("Auth entries:", simulation.result.auth.length);

  /*
   * LEXORA is a custom account.
   *
   * Its Signature type is BytesN<64>, so we must return
   * the raw Ed25519 signature as an SCVal bytes value.
   */
  simulation.result.auth = await Promise.all(
    simulation.result.auth.map(async (entry) => {
      const validUntil = simulation.latestLedger + 100;

      simulation.result.auth = await Promise.all(
        simulation.result.auth.map((entry) =>
          authorizeEntry(entry, owner, validUntil, NETWORK),
        ),
      );

      console.log("Authorization entry signed.");
    }),
  );

  console.log("Assembling transaction...");

  const prepared = assembleTransaction(tx, simulation);

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
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
