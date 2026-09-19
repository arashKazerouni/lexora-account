import * as StellarSdk from "@stellar/stellar-sdk";

const RPC_URL = "https://mainnet.sorobanrpc.com";
const HORIZON_URL = "https://horizon.stellar.org";
const NETWORK = StellarSdk.Networks.PUBLIC;

const ASSET_CODE = "XRP262";
const ISSUER = "GCGVZEE7RD2BFF2EIQUT37DYJUR7WDCQ2KWA5LUWYATRFLKEYHMJ3XRP";
const EXPECTED_SAC = "CC7L34EWYCTDCA3L7CRRULWX577UJWET32KNJFD2WTEQ4KD7IAUKHIS6";

const server = new StellarSdk.rpc.Server(RPC_URL);
const asset = new StellarSdk.Asset(ASSET_CODE, ISSUER);
const derived = asset.contractId(NETWORK);

console.log("XRP262 FINAL MAINNET CHECKPOINT");
console.log("===============================");
console.log("Asset:", `${ASSET_CODE}-${ISSUER}`);
console.log("Expected SAC:", EXPECTED_SAC);
console.log("Derived SAC:", derived);

if (derived !== EXPECTED_SAC) throw new Error("Deterministic SAC mismatch.");

const contract = new StellarSdk.Contract(derived);
const footprint = contract.getFootprint();
const ledgerKey = StellarSdk.xdr.LedgerKey.contractData(footprint.contractData);
const result = await server.getLedgerEntries(ledgerKey);

if (!result.entries?.length) throw new Error("XRP262 SAC contract instance not found.");

const value = result.entries[0].val ?? result.entries[0].value;
const instance = value?.contractData?.val?.instance ?? value?.contractData?.instance ?? value;

console.log("\nSAC ledger entry:");
console.dir(result.entries[0], { depth: null });

console.log("\nSAC instance:");
console.dir(instance, { depth: null });

const horizonUrl = `${HORIZON_URL}/assets?asset_code=${encodeURIComponent(ASSET_CODE)}&asset_issuer=${encodeURIComponent(ISSUER)}`;
const response = await fetch(horizonUrl);
if (!response.ok) throw new Error(`Horizon request failed: ${response.status} ${response.statusText}`);

const data = await response.json();
const assetRecord = data._embedded?.records?.[0];
if (!assetRecord) throw new Error("XRP262 asset not found in Horizon.");

console.log("\nHorizon asset record:");
console.dir(assetRecord, { depth: null });

console.log("\nFINAL CHECKPOINT DATA");
console.log("---------------------");
console.log("Asset:", `${ASSET_CODE}-${ISSUER}`);
console.log("Issuer:", ISSUER);
console.log("SAC:", derived);
console.log("SAC deployed:", "YES");
console.log("SAC executable/instance:", "SEE LEDGER ENTRY ABOVE");
console.log("Decimals:", "SEE SAC METADATA ABOVE");
console.log("Admin:", "SEE SAC INSTANCE ABOVE");
console.log("Issued/authorized balance:", assetRecord.balances?.authorized ?? "unknown");
console.log("Unauthorized balance:", assetRecord.balances?.unauthorized ?? "unknown");
console.log("Liquidity-pool amount:", assetRecord.liquidity_pools_amount ?? "unknown");
console.log("Contract amount:", assetRecord.contracts_amount ?? "unknown");
console.log("Claimable amount:", assetRecord.claimable_balances_amount ?? "unknown");
const offersUrl = `${HORIZON_URL}/offers?selling=${encodeURIComponent(`${ASSET_CODE}:${ISSUER}`)}&limit=200`;
const offersResponse = await fetch(offersUrl);
if (!offersResponse.ok) throw new Error(`Horizon offers request failed: ${offersResponse.status} ${offersResponse.statusText}`);
const offersPage = await offersResponse.json();
const offers = offersPage._embedded?.records ?? [];
const offerAmount = offers.reduce((sum, offer) => sum + Number(offer.amount ?? 0), 0);

console.log("Open selling offers:", offers.length);
console.log("Offer amount:", offerAmount.toFixed(7));
console.log("\nRESULT: XRP262 SAC + live asset supply/distribution state queried from mainnet.");
