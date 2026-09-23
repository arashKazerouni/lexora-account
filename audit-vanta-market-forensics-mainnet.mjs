import * as StellarSdk from "@stellar/stellar-sdk";
import { Server as RpcServer } from "@stellar/stellar-sdk/rpc";
import fs from "node:fs/promises";

const HORIZON_URL = process.env.HORIZON_URL || "https://horizon.stellar.org";
const HORIZON_FALLBACK_URLS = [
  HORIZON_URL,
  "https://horizon.stellar.lobstr.co",
].filter((url, index, urls) => urls.indexOf(url) === index);
const RPC_URL = process.env.SOROBAN_RPC_URL || "https://mainnet.sorobanrpc.com";
const SECRETS_PATH =
  process.env.VANTA_MARKET_ACCOUNTS_PATH ||
  ".secrets/vanta-market-accounts.json";

const VANTA_ISSUER = "GABER3CCXQ44LCM5CBHKCPRNLMJFEKN2QKBQHQPJD6TFV3WXU63PKXRP";
const FARM_ISSUER = "GBF7ZMNV4L2PFQRHJEMQLH7FEYMIP4ZSUKQ42ZOCYL5MI5P234C2NMNB";
const SIKE_ISSUER = "GBPBUOS7DG7IOK3CCX3TPVLG4PW44C7J5M4VEXREYSM7EOQAGEYPY7QV";

const VANTA = new StellarSdk.Asset("VANTA", VANTA_ISSUER);
const XLM = StellarSdk.Asset.native();
const FARM = new StellarSdk.Asset("FARM", FARM_ISSUER);
const SIKE = new StellarSdk.Asset("SIKE", SIKE_ISSUER);

const PAIRS = [
  { name: "VANTA/XLM", base: VANTA, counter: XLM, initialBase: 1_000_000_000, initialCounter: 10 },
  { name: "VANTA/FARM", base: VANTA, counter: FARM, initialBase: 400_000_000, initialCounter: 4_000_000 },
  { name: "VANTA/SIKE", base: VANTA, counter: SIKE, initialBase: 200_000_000, initialCounter: 2_000_000 },
];

const rpcServer = new RpcServer(RPC_URL);

function poolId(a, b) {
  const [x, y] = StellarSdk.Asset.compare(a, b) <= 0 ? [a, b] : [b, a];
  const poolAsset = new StellarSdk.LiquidityPoolAsset(x, y, StellarSdk.LiquidityPoolFeeV18);
  return Buffer.from(
    StellarSdk.getLiquidityPoolId("constant_product", poolAsset.getLiquidityPoolParameters()),
  ).toString("hex");
}

function assetLabel(asset) {
  return asset.isNative() ? "XLM" : asset.getCode();
}

function readXdrMember(object, ...names) {
  for (const name of names) {
    if (object == null) continue;
    const value = object[name];
    if (typeof value === "function") return value.call(object);
    if (value !== undefined && value !== null) return value;
  }
  throw new TypeError("Missing XDR member: " + names.join(" / "));
}

function poolLedgerKey(id) {
  return StellarSdk.xdr.LedgerKey.liquidityPool(
    new StellarSdk.xdr.LedgerKeyLiquidityPool({
      liquidityPoolId: new StellarSdk.xdr.PoolId(Buffer.from(id, "hex")),
    }),
  );
}

async function getPool(id) {
  const response = await rpcServer.getLedgerEntries(poolLedgerKey(id));
  if (!response.entries?.length) throw new Error("Liquidity pool not found in RPC: " + id);

  const entry = response.entries[0].val;
  const liquidityPool = readXdrMember(entry, "mustLiquidityPool", "liquidityPool");
  const body = readXdrMember(liquidityPool, "body");
  const cp = readXdrMember(body, "mustConstantProduct", "constantProduct");
  const params = readXdrMember(cp, "params");

  return {
    type: "constant_product",
    fee_bp: Number(readXdrMember(params, "fee")),
    reserveA: Number(readXdrMember(cp, "reserveA")) / 1e7,
    reserveB: Number(readXdrMember(cp, "reserveB")) / 1e7,
    total_shares: Number(readXdrMember(cp, "totalPoolShares")) / 1e7,
    last_modified_ledger: response.entries[0].last_modified_ledger ?? null,
  };
}

async function getJson(url) {
  const response = await fetch(url);
  if (!response.ok) {
    let detail = "";
    try { detail = (await response.text()).trim(); } catch {}
    throw new Error("HTTP " + response.status + (detail ? " " + detail : "") + ": " + url);
  }
  return response.json();
}

async function getJsonFromHorizon(path) {
  const errors = [];
  for (const baseUrl of HORIZON_FALLBACK_URLS) {
    try {
      return { data: await getJson(baseUrl + path), baseUrl };
    } catch (error) {
      errors.push(String(error.message || error));
    }
  }
  throw new Error(errors.join(" | "));
}

function reserve(pool, pair, asset) {
  const baseIsA = StellarSdk.Asset.compare(pair.base, pair.counter) <= 0;
  const isBase = asset.equals(pair.base);
  return isBase === baseIsA ? pool.reserveA : pool.reserveB;
}

function collectPublicKeys(value, out = new Set()) {
  if (typeof value === "string") {
    if (/^G[A-Z2-7]{55}$/.test(value)) out.add(value);
  } else if (Array.isArray(value)) {
    for (const item of value) collectPublicKeys(item, out);
  } else if (value && typeof value === "object") {
    for (const item of Object.values(value)) collectPublicKeys(item, out);
  }
  return out;
}

async function loadKnownAccounts() {
  try {
    return collectPublicKeys(JSON.parse(await fs.readFile(SECRETS_PATH, "utf8")));
  } catch {
    return new Set();
  }
}

function pct(delta, initial) {
  return initial === 0 ? 0 : (delta / initial) * 100;
}

function formatNumber(value, digits = 7) {
  return Number(value).toLocaleString("en-US", {
    minimumFractionDigits: 0,
    maximumFractionDigits: digits,
  });
}

async function getPoolTransactions(id) {
  const result = await getJsonFromHorizon(
    "/liquidity_pools/" + id + "/transactions?limit=200&order=asc",
  );
  return { records: result.data?._embedded?.records ?? [], source: result.baseUrl };
}

async function getTransactionOperations(hash) {
  const result = await getJsonFromHorizon(
    "/transactions/" + hash + "/operations?limit=200",
  );
  return { records: result.data?._embedded?.records ?? [], source: result.baseUrl };
}

function operationSummary(operation, poolIdHex) {
  if (operation.type === "liquidity_pool_deposit" || operation.type === "liquidity_pool_withdraw") {
    return {
      type: operation.type,
      source: operation.source_account,
      assets: [
        [operation.asset_a, operation.amount_a],
        [operation.asset_b, operation.amount_b],
      ],
    };
  }

  if (
    operation.type === "liquidity_pool_trade" &&
    (!operation.liquidity_pool_id || operation.liquidity_pool_id === poolIdHex)
  ) {
    return {
      type: operation.type,
      source: operation.source_account,
      sold: [operation.sold_asset, operation.sold_amount],
      bought: [operation.bought_asset, operation.bought_amount],
    };
  }

  return null;
}

function printEvent(event, knownAccounts, pair) {
  const classification = knownAccounts.has(event.source)
    ? "KNOWN PROJECT ACCOUNT"
    : "UNRECOGNIZED ACCOUNT";

  console.log("  " + event.created_at + " | ledger " + event.ledger + " | " + event.hash);
  console.log("    source: " + event.source + " [" + classification + "]");
  console.log("    operation: " + event.type);
  if (event.sold) {
    console.log("    sold: " + event.sold[1] + " " + event.sold[0]);
    console.log("    bought: " + event.bought[1] + " " + event.bought[0]);
  } else if (event.assets) {
    for (const [asset, amount] of event.assets) console.log("    amount: " + amount + " " + asset);
  }
  console.log("    pair: " + pair.name);
}

async function main() {
  console.log("VANTA MAINNET MARKET FORENSICS");
  console.log("================================");
  console.log("READ-ONLY: no transactions are submitted.");
  console.log("RPC pool state: " + RPC_URL);
  console.log("Horizon history: " + HORIZON_FALLBACK_URLS.join(", "));
  console.log("Known-account source: " + SECRETS_PATH);
  console.log("");

  const knownAccounts = await loadKnownAccounts();
  console.log("Known project account keys loaded: " + knownAccounts.size);
  if (!knownAccounts.size) console.log("  WARNING: no known account keys loaded; classification is limited.");
  console.log("");

  for (const pair of PAIRS) {
    const id = poolId(pair.base, pair.counter);
    const pool = await getPool(id);
    const baseReserve = reserve(pool, pair, pair.base);
    const counterReserve = reserve(pool, pair, pair.counter);
    const currentK = baseReserve * counterReserve;
    const initialK = pair.initialBase * pair.initialCounter;
    const deltaBase = baseReserve - pair.initialBase;
    const deltaCounter = counterReserve - pair.initialCounter;
    const spot = baseReserve > 0 ? counterReserve / baseReserve : 0;
    const initialSpot = pair.initialBase > 0 ? pair.initialCounter / pair.initialBase : 0;

    console.log("POOL: " + pair.name);
    console.log("  pool ID: " + id);
    console.log("  type: " + pool.type);
    console.log("  fee: " + pool.fee_bp + " bp");
    console.log("  total shares: " + formatNumber(pool.total_shares));
    console.log("  current: " + formatNumber(baseReserve) + " " + assetLabel(pair.base) + " / " + formatNumber(counterReserve) + " " + assetLabel(pair.counter));
    console.log("  initial: " + formatNumber(pair.initialBase) + " " + assetLabel(pair.base) + " / " + formatNumber(pair.initialCounter) + " " + assetLabel(pair.counter));
    console.log("  delta: " + formatNumber(deltaBase) + " " + assetLabel(pair.base) + " (" + pct(deltaBase, pair.initialBase).toFixed(4) + "%), " + formatNumber(deltaCounter) + " " + assetLabel(pair.counter) + " (" + pct(deltaCounter, pair.initialCounter).toFixed(4) + "%)");
    console.log("  spot now: 1 " + assetLabel(pair.base) + " = " + spot.toFixed(12) + " " + assetLabel(pair.counter));
    console.log("  spot initial: 1 " + assetLabel(pair.base) + " = " + initialSpot.toFixed(12) + " " + assetLabel(pair.counter));
    console.log("  spot change: " + pct(spot - initialSpot, initialSpot).toFixed(4) + "%");
    console.log("  K initial: " + initialK.toLocaleString("en-US", { maximumFractionDigits: 7 }));
    console.log("  K current: " + currentK.toLocaleString("en-US", { maximumFractionDigits: 7 }));
    console.log("  K change: " + pct(currentK - initialK, initialK).toFixed(6) + "%");
    if (pool.last_modified_ledger !== null) console.log("  pool last modified ledger: " + pool.last_modified_ledger);

    let events = [];
    try {
      const txResult = await getPoolTransactions(id);
      console.log("  history source: " + txResult.source);
      console.log("  pool transactions returned: " + txResult.records.length);

      for (const tx of txResult.records) {
        try {
          const opResult = await getTransactionOperations(tx.hash);
          for (const operation of opResult.records) {
            const summary = operationSummary(operation, id);
            if (summary) {
              events.push({ ...summary, hash: tx.hash, ledger: tx.ledger, created_at: tx.created_at });
            }
          }
        } catch (error) {
          console.log("  transaction operations unavailable for " + tx.hash + ": " + (error.message || error));
        }
      }
    } catch (error) {
      console.log("  history: UNAVAILABLE (" + (error.message || error) + ")");
    }

    console.log("  relevant operations reconstructed: " + events.length);
    for (const event of events) printEvent(event, knownAccounts, pair);
    if (!events.length) console.log("  no reconstructable LP operations found in returned history.");
    console.log("");
  }

  console.log("FORENSICS INTERPRETATION");
  console.log("  Current pool reserves are the primary on-chain state.");
  console.log("  K can increase because constant-product swaps include fees; K growth alone is not a failure signal.");
  console.log("  UNRECOGNIZED ACCOUNT only means the key was not found in the local known-account set.");
  console.log("  It does NOT establish that the account is independent, unrelated, or controlled by a third party.");
  console.log("  A KNOWN PROJECT ACCOUNT interaction is evidence of project-account activity.");
  console.log("  Historical reserve deltas are reconstructed from returned Horizon history; unavailable history is reported explicitly.");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
