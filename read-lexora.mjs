import {
  Contract,
  Networks,
  Address,
  xdr,
} from "@stellar/stellar-sdk";

import { Server } from "@stellar/stellar-sdk/rpc";

const RPC_URL = "https://mainnet.sorobanrpc.com";
const server = new Server(RPC_URL);

const LEXORA =
  "CD3ZU34KEWO57CMO7YVZCE7W3RJMXJ3T6CKPHYWKI7IVCDXSHBGTM6TT";

const contract = new Contract(LEXORA);

console.log("Contract:", LEXORA);

const entries = await server.getLedgerEntries();

console.dir(entries, { depth: null });
