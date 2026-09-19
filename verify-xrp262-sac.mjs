import { Contract, xdr } from "@stellar/stellar-sdk";
import { Server } from "@stellar/stellar-sdk/rpc";

const RPC_URL = "https://mainnet.sorobanrpc.com";
const XRP262_SAC =
  "CDJXGLSHYWF77E6IHNQBXJXQBA2K6WPNN7KKI4EO3USYTXUAZAHMGEDZ";

const server = new Server(RPC_URL);
const contract = new Contract(XRP262_SAC);

// Contract.getFootprint() returns an SDK wrapper. Convert its underlying
// contractData XDR into a real LedgerKey before passing it to RPC.
const footprint = contract.getFootprint();
const ledgerKey = xdr.LedgerKey.contractData(footprint.contractData);

console.log("XRP262 SAC:", XRP262_SAC);
console.log("RPC:", RPC_URL);
console.log("\nQuerying mainnet contract instance...");

const result = await server.getLedgerEntries(ledgerKey);

console.log("\nMainnet ledger result:");
console.dir(result, { depth: null });

if (!result.entries || result.entries.length === 0) {
  console.log("\nRESULT: XRP262 SAC contract instance was not found on mainnet.");
  process.exit(0);
}

const entry = result.entries[0];
const value = entry.val ?? entry.value;

console.log("\nRESULT: XRP262 SAC contract instance exists on mainnet.");
if (value) {
  console.log("\nContract-data value:");
  console.dir(value, { depth: null });
}
