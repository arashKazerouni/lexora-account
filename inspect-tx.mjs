import { Server } from "@stellar/stellar-sdk/rpc";

const RPC_URL = "https://mainnet.sorobanrpc.com";

const HASH =
  "1bfc7c6339b652b3e6d7d9223874a14befccc9b5c4f1b9dd28c35f1434ebca50";

const server = new Server(RPC_URL);

const tx = await server.getTransaction(HASH);

console.dir(tx, { depth: null });

