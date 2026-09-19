const HORIZON_URL = "https://horizon.stellar.org";
const ASSET_CODE = "XRP262";
const ISSUER = "GCGVZEE7RD2BFF2EIQUT37DYJUR7WDCQ2KWA5LUWYATRFLKEYHMJ3XRP";

const assetId = encodeURIComponent(`${ASSET_CODE}:${ISSUER}`);
const url = `${HORIZON_URL}/assets?asset_code=${encodeURIComponent(ASSET_CODE)}&asset_issuer=${encodeURIComponent(ISSUER)}`;

console.log("XRP262 supply summary");
console.log("--------------------");
console.log("Asset:", `${ASSET_CODE}-${ISSUER}`);
console.log("Horizon:", HORIZON_URL);

const response = await fetch(url);
if (!response.ok) throw new Error(`Horizon request failed: ${response.status} ${response.statusText}`);

const data = await response.json();
const record = data._embedded?.records?.[0];

if (!record) {
  throw new Error("XRP262 asset was not returned by Horizon.");
}

console.log("\nAsset record:");
console.dir(record, { depth: null });

console.log("\nSupply breakdown:");
console.log("Total issued:", record.balances?.authorized ?? "unknown");
console.log("Authorized to maintain liabilities:", record.balances?.authorized_to_maintain_liabilities ?? "unknown");
console.log("Unauthorized:", record.balances?.unauthorized ?? "unknown");
console.log("Claimable balances:", record.claimable_balances_amount ?? "unknown");
console.log("Liquidity pools:", record.liquidity_pools_amount ?? "unknown");
console.log("Soroban contracts:", record.contracts_amount ?? "unknown");
console.log("SDEX offers:", record.offers_amount ?? "unknown");

console.log("\nCounts:");
console.log("Accounts/trustlines:", record.accounts?.authorized ?? "unknown");
console.log("Claimable balances:", record.num_claimable_balances ?? "unknown");
console.log("Liquidity pools:", record.num_liquidity_pools ?? "unknown");
console.log("Soroban contracts:", record.num_contracts ?? "unknown");

console.log("\nNOTE: Horizon's asset balances are the protocol's current issued-asset accounting view; SAC contract balances are represented separately from classic trustlines.");
