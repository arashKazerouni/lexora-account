const HORIZON_URL = "https://horizon.stellar.org";

const LEXO_DISTRIBUTION =
  "GABXUKWDB44SQGY6OVJWD3OXYEXE27UIGBWTF4FI2JMNLEXZKMA7TSQX";

const VANTA_ISSUER =
  "GABER3CCXQ44LCM5CBHKCPRNLMJFEKN2QKBQHQPJD6TFV3WXU63PKXRP";
const FARM_ISSUER =
  "GBF7ZMNV4L2PFQRHJEMQLH7FEYMIP4ZSUKQ42ZOCYL5MI5P234C2NMNB";
const FARM_DISTRIBUTION =
  "GBJELP7DVYFQLY77ZM34SDMQOHDRBN7E7L44WHDAMPPMLCSKG6P3ESRT";
const SIKE_ISSUER =
  "GBPBUOS7DG7IOK3CCX3TPVLG4PW44C7J5M4VEXREYSM7EOQAGEYPY7QV";
const SIKE_DISTRIBUTION =
  "GCEN47OQUGNGIY3VE3KS7AHRCP5AFU4GVBFVMLWZ5DW25PNKUY36BOZB";

function balance(account, code, issuer) {
  return Number(
    account.balances?.find(
      (b) =>
        b.asset_type !== "native" &&
        b.asset_code === code &&
        b.asset_issuer === issuer,
    )?.balance ?? "0",
  );
}

async function getJson(url) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`HTTP ${response.status}: ${url}`);
  return response.json();
}

async function orderBook(sellingCode, sellingIssuer) {
  const params = new URLSearchParams({
    selling_asset_type: "credit_alphanum4",
    selling_asset_code: sellingCode,
    selling_asset_issuer: sellingIssuer,
    buying_asset_type: "native",
    limit: "20",
  });
  return getJson(`${HORIZON_URL}/order_book?${params}`);
}

function printBook(name, book) {
  console.log(`\n${name}`);
  console.log("ASKS");
  for (const row of book.asks ?? []) {
    console.log(`  price=${row.price} amount=${row.amount}`);
  }
  console.log("BIDS");
  for (const row of book.bids ?? []) {
    console.log(`  price=${row.price} amount=${row.amount}`);
  }
}

async function main() {
  console.log("VANTA PAIR PRICING AUDIT");
  console.log("========================");
  console.log("READ-ONLY. NO TRANSACTIONS.");
  console.log("");

  const [source, farmDist, sikeDist, farmBook, sikeBook] =
    await Promise.all([
      getJson(`${HORIZON_URL}/accounts/${LEXO_DISTRIBUTION}`),
      getJson(`${HORIZON_URL}/accounts/${FARM_DISTRIBUTION}`),
      getJson(`${HORIZON_URL}/accounts/${SIKE_DISTRIBUTION}`),
      orderBook("FARM", FARM_ISSUER),
      orderBook("SIKE", SIKE_ISSUER),
    ]);

  const xlm = Number(
    source.balances?.find((b) => b.asset_type === "native")?.balance ?? "0",
  );

  console.log("LEXO INVENTORY");
  console.log(JSON.stringify({
    xlm,
    vanta: balance(source, "VANTA", VANTA_ISSUER),
    farm: balance(source, "FARM", FARM_ISSUER),
    sike: balance(source, "SIKE", SIKE_ISSUER),
  }, null, 2));

  console.log("\nDISTRIBUTION INVENTORY");
  console.log(JSON.stringify({
    farm: balance(farmDist, "FARM", FARM_ISSUER),
    sike: balance(sikeDist, "SIKE", SIKE_ISSUER),
  }, null, 2));

  console.log("\nVANTA/XLM REFERENCE");
  console.log("1,000,000 VANTA = 0.01 XLM");
  console.log("1 VANTA = 0.00000001 XLM");

  printBook("FARM/XLM ORDER BOOK", farmBook);
  printBook("SIKE/XLM ORDER BOOK", sikeBook);

  console.log("\nDECISION GATE");
  console.log("Current 4M FARM and 2M SIKE in LEXO are inventory, not commitments.");
  console.log("No VANTA/FARM or VANTA/SIKE pool should be created until its initial ratio is selected.");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
