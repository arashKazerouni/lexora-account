const HORIZON_URL = "https://horizon.stellar.org";
const ASSET_CODE = "XRP262";
const ISSUER = "GCGVZEE7RD2BFF2EIQUT37DYJUR7WDCQ2KWA5LUWYATRFLKEYHMJ3XRP";

async function getJson(url) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Request failed: ${response.status} ${response.statusText}: ${url}`);
  return response.json();
}

async function collect(url, label) {
  const records = [];
  let next = url;

  while (next) {
    const page = await getJson(next);
    records.push(...(page._embedded?.records ?? []));
    next = page._links?.next?.href ?? null;
  }

  console.log(`${label}: ${records.length}`);
  return records;
}

const asset = encodeURIComponent(`${ASSET_CODE}:${ISSUER}`);
const accountsUrl = `${HORIZON_URL}/accounts?asset=${asset}&limit=200`;
const claimableUrl = `${HORIZON_URL}/claimable_balances?asset=${asset}&limit=200`;
const poolsUrl = `${HORIZON_URL}/liquidity_pools?reserves=${asset}&limit=200`;
const offersUrl = `${HORIZON_URL}/offers?selling=${asset}&limit=200`;

console.log("XRP262 distribution trace");
console.log("------------------------");
console.log("Asset:", `${ASSET_CODE}-${ISSUER}`);

const [accounts, claimable, pools, offers] = await Promise.all([
  collect(accountsUrl, "Classic accounts"),
  collect(claimableUrl, "Claimable balances"),
  collect(poolsUrl, "Liquidity pools"),
  collect(offersUrl, "Selling offers"),
]);

console.log("\nCLASSIC ACCOUNT TRUSTLINES");
for (const account of accounts) {
  const balance = account.balances?.find(
    (b) => b.asset_type === "credit_alphanum4" && b.asset_code === ASSET_CODE && b.asset_issuer === ISSUER
  );
  if (balance) {
    console.log(account.account, "balance=", balance.balance, "limit=", balance.limit, "buying_liabilities=", balance.buying_liabilities, "selling_liabilities=", balance.selling_liabilities, "authorized=", balance.is_authorized);
  }
}

console.log("\nCLAIMABLE BALANCES");
for (const item of claimable) {
  const amount = item.amount ?? item.asset_amount;
  console.log(item.id, "amount=", amount, "sponsor=", item.sponsor ?? "unknown");
}

console.log("\nLIQUIDITY POOLS");
for (const pool of pools) {
  console.log(pool.id, "reserves=", pool.reserves, "total_shares=", pool.total_shares);
}

console.log("\nSELLING OFFERS");
for (const offer of offers) {
  console.log("offer", offer.id, "seller=", offer.seller, "amount=", offer.amount, "price=", offer.price, "price_r=", offer.price_r);
}

console.log("\nRaw records are available above if a category needs deeper tracing.");
