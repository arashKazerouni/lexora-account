import * as StellarSdk from "@stellar/stellar-sdk";

const HORIZON_URL = process.env.HORIZON_URL || "https://horizon.stellar.lobstr.co";

const VANTA_ISSUER = "GABER3CCXQ44LCM5CBHKCPRNLMJFEKN2QKBQHQPJD6TFV3WXU63PKXRP";
const FARM_ISSUER = "GBF7ZMNV4L2PFQRHJEMQLH7FEYMIP4ZSUKQ42ZOCYL5MI5P234C2NMNB";
const SIKE_ISSUER = "GBPBUOS7DG7IOK3CCX3TPVLG4PW44C7J5M4VEXREYSM7EOQAGEYPY7QV";

const VANTA = new StellarSdk.Asset("VANTA", VANTA_ISSUER);
const XLM = StellarSdk.Asset.native();
const FARM = new StellarSdk.Asset("FARM", FARM_ISSUER);
const SIKE = new StellarSdk.Asset("SIKE", SIKE_ISSUER);

const PAIRS = [
  { name: "VANTA/XLM", base: VANTA, counter: XLM },
  { name: "VANTA/FARM", base: VANTA, counter: FARM },
  { name: "VANTA/SIKE", base: VANTA, counter: SIKE },
];

function poolId(a, b) {
  const [x, y] = StellarSdk.Asset.compare(a, b) <= 0 ? [a, b] : [b, a];
  const poolAsset = new StellarSdk.LiquidityPoolAsset(
    x,
    y,
    StellarSdk.LiquidityPoolFeeV18,
  );
  return Buffer.from(
    StellarSdk.getLiquidityPoolId(
      "constant_product",
      poolAsset.getLiquidityPoolParameters(),
    ),
  ).toString("hex");
}

function assetParams(asset, prefix) {
  if (asset.isNative()) {
    return { [prefix + "_asset_type"]: "native" };
  }
  return {
    [prefix + "_asset_type"]: "credit_alphanum4",
    [prefix + "_asset_code"]: asset.getCode(),
    [prefix + "_asset_issuer"]: asset.getIssuer(),
  };
}

async function getJson(url) {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${url}`);
  }
  return response.json();
}

function reserve(pool, asset) {
  return Number(
    (pool.reserves ?? []).find((r) =>
      asset.isNative()
        ? r.asset === "native"
        : r.asset === asset.getCode() + ":" + asset.getIssuer(),
    )?.amount ?? "0",
  );
}

function printOrderBook(book) {
  const asks = book.asks ?? [];
  const bids = book.bids ?? [];
  console.log("  order book asks: " + asks.length);
  console.log("  order book bids: " + bids.length);

  if (asks.length) {
    console.log("  best ask: price=" + asks[0].price + " amount=" + asks[0].amount);
  }
  if (bids.length) {
    console.log("  best bid: price=" + bids[0].price + " amount=" + bids[0].amount);
  }
}

async function main() {
  console.log("VANTA MAINNET MARKET + DISCOVERABILITY AUDIT");
  console.log("============================================");
  console.log("READ-ONLY: no transactions are submitted.");
  console.log("Horizon: " + HORIZON_URL);
  console.log("");

  for (const pair of PAIRS) {
    const id = poolId(pair.base, pair.counter);

    const params = new URLSearchParams({
      ...assetParams(pair.base, "base"),
      ...assetParams(pair.counter, "counter"),
      limit: "20",
    });

    const [pool, orderBook] = await Promise.all([
      getJson(HORIZON_URL + "/liquidity_pools/" + id),
      getJson(HORIZON_URL + "/order_book?" + params.toString()),
    ]);

    const baseReserve = reserve(pool, pair.base);
    const counterReserve = reserve(pool, pair.counter);
    const spot = baseReserve > 0 ? counterReserve / baseReserve : 0;
    const inverse = counterReserve > 0 ? baseReserve / counterReserve : 0;

    console.log(pair.name);
    console.log("  pool ID: " + id);
    console.log("  Horizon pool status: DISCOVERABLE");
    console.log("  type: " + pool.type);
    console.log("  fee: " + pool.fee_bp + " bp");
    console.log("  total shares: " + pool.total_shares);
    console.log("  reserves: " + pair.base.getCode?.() ?? "XLM" + "=" + baseReserve);
    console.log("  " + (pair.base.isNative() ? "XLM" : pair.base.getCode()) + ": " + baseReserve.toFixed(7));
    console.log("  " + (pair.counter.isNative() ? "XLM" : pair.counter.getCode()) + ": " + counterReserve.toFixed(7));
    console.log("  implied spot: 1 " + pair.base.getCode() + " = " + spot.toFixed(12) + " " + (pair.counter.isNative() ? "XLM" : pair.counter.getCode()));
    console.log("  inverse spot: 1 " + (pair.counter.isNative() ? "XLM" : pair.counter.getCode()) + " = " + inverse.toFixed(7) + " VANTA");
    const tradeParams = new URLSearchParams({ limit: "20" });
    const tradeUrl = HORIZON_URL + "/liquidity_pools/" + id + "/trades?" + tradeParams.toString();
    let tradeStatus = "UNKNOWN";
    let tradeCount = null;
    try {
      const trades = await getJson(tradeUrl);
      tradeStatus = "AVAILABLE";
      tradeCount = (trades.records ?? []).length;
    } catch (error) {
      tradeStatus = String(error.message || error);
    }
    console.log("  related LP trades: " + (tradeCount === null ? tradeStatus : tradeCount + " returned"));
    printOrderBook(orderBook);
    console.log("");
  }

  console.log("INTERPRETATION");
  console.log("  AMM ratios above are on-chain pool spot ratios, not guaranteed market prices.");
  console.log("  FARM/SIKE ratios are bootstrap exchange ratios; they do not establish independent fair value.");
  console.log("  Horizon exposes all three pools; trade history availability depends on the public provider.");
  console.log("  No transactions were submitted by this audit.");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
