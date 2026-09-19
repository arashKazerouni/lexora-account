import * as StellarSdk from "@stellar/stellar-sdk";

const RPC_URL = "https://mainnet.sorobanrpc.com";
const CONTRACT_ID = "CAJL2JO6EILWBTHDRMIQVJA6MTZIUWHOD6WNVJDN7FWTYD6H3NFXH542";

const DEPLOYER = "GBJELP7DVYFQLY77ZM34SDMQOHDRBN7E7L44WHDAMPPMLCSKG6P3ESRT";

const server = new StellarSdk.rpc.Server(RPC_URL);

async function main() {
  const account = await server.getAccount(DEPLOYER);

  const contract = new StellarSdk.Contract(CONTRACT_ID);

  const tx = new StellarSdk.TransactionBuilder(account, {
    fee: StellarSdk.BASE_FEE,
    networkPassphrase: StellarSdk.Networks.PUBLIC,
  })
    .addOperation(contract.call("owner"))
    .setTimeout(30)
    .build();

  const simulation = await server.simulateTransaction(tx);

  if (StellarSdk.rpc.Api.isSimulationError(simulation)) {
    console.dir(simulation, { depth: 10 });
    throw new Error("Simulation failed");
  }

  const owner = StellarSdk.scValToNative(simulation.result.retval);

  console.log("Contract:", CONTRACT_ID);
  console.log("owner(): ", owner);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
