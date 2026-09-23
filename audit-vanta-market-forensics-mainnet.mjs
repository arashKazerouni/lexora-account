import * as StellarSdk from "@stellar/stellar-sdk";
import { Server as RpcServer } from "@stellar/stellar-sdk/rpc";
import fs from "node:fs/promises";

const HORIZON_URL = process.env.HORIZON_URL || "https://horizon.stellar.org";
const HORIZON_FALLBACK_URLS = [HORIZON_URL, "https://horizon.stellar.lobstr.co"].filter(
  (url, index, urls) => urls.indexOf(url) === index,
);
const RPC_URL = process.env.SOROBAN_RPC_URL || "https://mainnet.sorobanrpc.com";
const SECRETS_PATH =
  process.env.VANTA_MARKET_ACCOUNTS_PATH || ".secrets/vanta-market-accounts.json";

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

function classify(account, knownAccounts) {
  return knownAccounts.has(account) ? "KNOWN PROJECT ACCOUNT" : "UNRECOGNIZED ACCOUNT";
}

function printOperation(operation, knownAccounts, pair) {
  const source = operation.source_account;
  console.log(
    "  " +
      operation.created_at +
      " | ledger " +
      operation.ledger +
      " | " +
      operation.transaction_hash,
  );
  console.log("    source: " + source + " [" + classify(source, knownAccounts) + "]");
  console.log("    operation: " + operation.type);

  if (operation.type === "liquidity_pool_deposit") {
    for (const item of operation.reserves_deposited ?? []) {
      console.log("    deposited: " + item.amount + " " + item.asset);
    }
    console.log("    shares received: " + (operation.shares_received ?? "n/a"));
  } else if (operation.type === "liquidity_pool_withdraw") {
    for (const item of operation.reserves_received ?? []) {
      console.log("    withdrawn: " + item.amount + " " + item.asset);
    }
    console.log("    shares burned: " + (operation.shares ?? "n/a"));
  }

  console.log("    pair: " + pair.name);
}

function printTrade(trade, knownAccounts, pair) {
  const participants = [];
  if (trade.base_account) participants.push(["base", trade.base_account]);
  if (trade.counter_account) participants.push(["counter", trade.counter_account]);

  console.log("  " + trade.ledger_close_time + " | trade " + trade.id);
  console.log("    pair: " + pair.name);
  for (const [role, account] of participants) {
    console.log("    " + role + " account: " + account + " [" + classify(account, knownAccounts) + "]");
  }
  console.log(
    "    base: " +
      trade.base_amount +
      " " +
      (trade.base_asset_code || "XLM"),
  );
  console.log(
    "    counter: " +
      trade.counter_amount +
      " " +
      (trade.counter_asset_code || "XLM"),
  );
  console.log(
    "    pool side: " +
      (trade.base_liquidity_pool_id === trade.counter_liquidity_pool_id
        ? "both"
        : trade.base_liquidity_pool_id
          ? "base"
          : "counter"),
  );
}

async function getPoolOperations(id) {
  const result = await getJsonFromHorizon(
    "/liquidity_pools/" + id + "/operations?limit=200&order=asc",
  );
  return {
    records: result.data?._embedded?.records ?? [],
    source: result.baseUrl,
  };
}

async function getPoolTrades(id) {
  const result = await getJsonFromHorizon(
    "/liquidity_pools/" + id + "/trades?limit=200&order=asc",
  );
  return {
    records: result.data?._embedded?.records ?? [],
    source: result.baseUrl,
  };
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
  if (!knownAccounts.size) {
    console.log("  WARNING: no known account keys loaded; classification is limited.");
  }
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
    console.log(
      "  current: " +
        formatNumber(baseReserve) +
        " " +
        assetLabel(pair.base) +
        " / " +
        formatNumber(counterReserve) +
        " " +
        assetLabel(pair.counter),
    );
    console.log(
      "  initial: " +
        formatNumber(pair.initialBase) +
        " " +
        assetLabel(pair.base) +
        " / " +
        formatNumber(pair.initialCounter) +
        " " +
        assetLabel(pair.counter),
    );
    console.log(
      "  delta: " +
        formatNumber(deltaBase) +
        " " +
        assetLabel(pair.base) +
        " (" +
        pct(deltaBase, pair.initialBase).toFixed(4) +
        "%), " +
        formatNumber(deltaCounter) +
        " " +
        assetLabel(pair.counter) +
        " (" +
        pct(deltaCounter, pair.initialCounter).toFixed(4) +
        "%)",
    );
    console.log(
      "  spot now: 1 " +
        assetLabel(pair.base) +
        " = " +
        spot.toFixed(12) +
        " " +
        assetLabel(pair.counter),
    );
    console.log(
      "  spot initial: 1 " +
        assetLabel(pair.base) +
        " = " +
        initialSpot.toFixed(12) +
        " " +
        assetLabel(pair.counter),
    );
    console.log("  spot change: " + pct(spot - initialSpot, initialSpot).toFixed(4) + "%");
    console.log(
      "  K initial: " +
        initialK.toLocaleString("en-US", { maximumFractionDigits: 7 }),
    );
    console.log(
      "  K current: " +
        currentK.toLocaleString("en-US", { maximumFractionDigits: 7 }),
    );
    console.log("  K change: " + pct(currentK - initialK, initialK).toFixed(6) + "%");
    if (pool.last_modified_ledger !== null) {
      console.log("  pool last modified ledger: " + pool.last_modified_ledger);
    }

    try {
      const operationResult = await getPoolOperations(id);
      console.log("  operations source: " + operationResult.source);
      console.log("  pool operations returned: " + operationResult.records.length);
      for (const operation of operationResult.records) {
        if (
          operation.type === "liquidity_pool_deposit" ||
          operation.type === "liquidity_pool_withdraw"
        ) {
          printOperation(operation, knownAccounts, pair);
        }
      }
    } catch (error) {
      console.log("  operations: UNAVAILABLE (" + (error.message || error) + ")");
    }

    try {
      const tradeResult = await getPoolTrades(id);
      console.log("  trades source: " + tradeResult.source);
      console.log("  pool trades returned: " + tradeResult.records.length);
      for (const trade of tradeResult.records) {
        printTrade(trade, knownAccounts, pair);
      }
    } catch (error) {
      console.log("  trades: UNAVAILABLE (" + (error.message || error) + ")");
    }

    console.log("");
  }

  console.log("FORENSICS INTERPRETATION");
  console.log("  Current pool reserves are the primary on-chain state.");
  console.log("  K can increase because constant-product swaps include fees; K growth alone is not a failure signal.");
  console.log("  UNRECOGNIZED ACCOUNT only means the key was not found in the local known-account set.");
  console.log("  It does NOT establish that the account is independent, unrelated, or controlled by a third party.");
  console.log("  A KNOWN PROJECT ACCOUNT interaction is evidence of project-account activity.");
  console.log("  Horizon pool operations expose actual deposited/withdrawn reserves; pool trades expose successful trades referencing the pool.");
  console.log("  Historical endpoints are used only for forensic enrichment; RPC remains the source of truth for current pool state.");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
