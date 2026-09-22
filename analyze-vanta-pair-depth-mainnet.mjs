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

const VANTA_XLM = 0.00000001;

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

function fmt(n, digits = 7) {
  return Number(n).toLocaleString("en-US", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
}

function pct(n) {
  return `${(n * 100).toFixed(6)}%`;
}

function depthCost(asks, target) {
  let remaining = target;
  let cost = 0;
  let filled = 0;

  for (const row of asks ?? []) {
    if (remaining <= 0) break;
    const price = Number(row.price);
    const amount = Number(row.amount);
    const take = Math.min(remaining, amount);
    cost += take * price;
    filled += take;
    remaining -= take;
  }

  return {
    filled,
    cost,
    vwap: filled > 0 ? cost / filled : 0,
    complete: remaining <= 1e-12,
  };
}

function printDepthAnalysis(name, asks, targets, supply) {
  console.log(`\n${name} DEPTH ANALYSIS`);
  console.log("target token | filled | XLM cost | VWAP XLM/token | implied VANTA/token | complete");

  for (const target of targets) {
    const d = depthCost(asks, target);
    const impliedVanta = d.vwap > 0 ? d.vwap / VANTA_XLM : 0;
    console.log(
      `${fmt(target, 4).padStart(13)} | ${fmt(d.filled, 4).padStart(13)} | ${fmt(d.cost, 7).padStart(13)} | ${d.vwap.toFixed(10).padStart(17)} | ${impliedVanta.toFixed(8).padStart(19)} | ${d.complete ? "YES" : "NO"}`,
    );
  }

  console.log(`Supply reference: ${fmt(supply, 4)}`);
}

function printCandidateRatios(name, asks, budgets) {
  console.log(`\n${name} CANDIDATE RATIOS`);
  console.log("XLM-equivalent budget | token amount at observed VWAP | VANTA amount | VANTA/token ratio");

  for (const budget of budgets) {
    const d = depthCost(asks, Number.MAX_SAFE_INTEGER);
    if (!d.complete || d.cost <= 0) {
      const first = asks?.[0];
      const price = Number(first?.price ?? 0);
      const amount = price > 0 ? budget / price : 0;
      const vanta = budget / VANTA_XLM;
      console.log(
        `${budget.toFixed(4).padStart(20)} | ${fmt(amount, 4).padStart(28)} | ${fmt(vanta, 4).padStart(16)} | ${amount > 0 ? (vanta / amount).toFixed(8) : "n/a"}`,
      );
    }
  }
}

async function main() {
  console.log("VANTA PAIR DEPTH ANALYSIS");
  console.log("========================");
  console.log("READ-ONLY. NO TRANSACTIONS.");
  console.log("Uses current Horizon ask depth and the fixed VANTA/XLM reference.");
  console.log("This does NOT select or create any pool ratio.");

  const [source, farmDist, sikeDist, farmBook, sikeBook] =
    await Promise.all([
      getJson(`${HORIZON_URL}/accounts/${LEXO_DISTRIBUTION}`),
      getJson(`${HORIZON_URL}/accounts/${FARM_DISTRIBUTION}`),
      getJson(`${HORIZON_URL}/accounts/${SIKE_DISTRIBUTION}`),
      orderBook("FARM", FARM_ISSUER),
      orderBook("SIKE", SIKE_ISSUER),
    ]);

  const vanta = balance(source, "VANTA", VANTA_ISSUER);
  const farm = balance(source, "FARM", FARM_ISSUER);
  const sike = balance(source, "SIKE", SIKE_ISSUER);
  const farmSupply = balance(farmDist, "FARM", FARM_ISSUER);
  const sikeSupply = balance(sikeDist, "SIKE", SIKE_ISSUER);

  console.log("\nINVENTORY");
  console.log(JSON.stringify({ vanta, farm, sike }, null, 2));

  console.log("\nSUPPLY PERCENTAGES");
  console.log(`4M FARM / distribution balance = ${pct(4_000_000 / farmSupply)}`);
  console.log(`2M SIKE / distribution balance = ${pct(2_000_000 / sikeSupply)}`);
  console.log(`400M VANTA / 922B max supply = ${pct(400_000_000 / 922_000_000_000)}`);
  console.log(`200M VANTA / 922B max supply = ${pct(200_000_000 / 922_000_000_000)}`);

  console.log("\nREFERENCE");
  console.log("1,000,000 VANTA = 0.01 XLM");
  console.log("1 VANTA = 0.00000001 XLM");

  printDepthAnalysis(
    "FARM/XLM",
    farmBook.asks,
    [100_000, 1_000_000, 2_000_000, 4_000_000, 10_000_000],
    farmSupply,
  );

  printDepthAnalysis(
    "SIKE/XLM",
    sikeBook.asks,
    [100_000, 1_000_000, 2_000_000, 5_000_000, 8_000_000],
    sikeSupply,
  );

  printCandidateRatios("FARM/XLM", farmBook.asks, [0.25, 0.5, 1, 2, 4]);
  printCandidateRatios("SIKE/XLM", sikeBook.asks, [0.25, 0.5, 1, 2, 4]);

  console.log("\nINTERPRETATION");
  console.log("The important output is VWAP at the actual inventory size, not the first ask alone.");
  console.log("If the target amount fits inside one ask level, the VWAP will equal that level.");
  console.log("For a VANTA/FARM or VANTA/SIKE pool, convert the observed XLM/token price into a VANTA/token ratio.");
  console.log("Do not create a pool until the ratio and liquidity depth are explicitly chosen.");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
