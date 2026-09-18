import { Address, StrKey, xdr } from "@stellar/stellar-sdk";
import { Server } from "@stellar/stellar-sdk/rpc";

const RPC_URL = "https://mainnet.sorobanrpc.com";
const CONTRACT = "CD3ZU34KEWO57CMO7YVZCE7W3RJMXJ3T6CKPHYWKI7IVCDXSHBGTM6TT";

const issuerBytes = Uint8Array.from([
  128, 48, 103, 90, 199, 137, 65, 119,
  253, 111, 37, 22, 27, 21, 188, 220,
  51, 245, 142, 59, 54, 74, 158, 13,
  23, 193, 159, 62, 121, 106, 81, 249,
]);

const issuer = StrKey.encodeEd25519PublicKey(issuerBytes);
console.log("Issuer:", issuer);
console.log("Contract:", CONTRACT);

const key = xdr.ScVal.scvVec([
  xdr.ScVal.scvSymbol("Token"),
  xdr.ScVal.scvMap([
    new xdr.ScMapEntry({
      key: xdr.ScVal.scvSymbol("code"),
      val: xdr.ScVal.scvString("XEVA"),
    }),
    new xdr.ScMapEntry({
      key: xdr.ScVal.scvSymbol("issuer"),
      val: Address.fromString(issuer).toScVal(),
    }),
  ]),
]);

const ledgerKey = xdr.LedgerKey.contractData(
  new xdr.LedgerKeyContractData({
    contract: Address.fromString(CONTRACT).toScAddress(),
    key,
    durability: xdr.ContractDataDurability.persistent,
  }),
);

const server = new Server(RPC_URL);
const result = await server.getLedgerEntries([ledgerKey]);

console.log("\nMainnet ledger result:");
console.dir(result, { depth: null });
