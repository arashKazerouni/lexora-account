import * as StellarSdk from "@stellar/stellar-sdk";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const HORIZON_URL = "https://horizon.stellar.org";
const NETWORK = StellarSdk.Networks.PUBLIC;
const SOURCE_PATH = join(process.cwd(), ".secrets", "lexo-accounts.json");
const VANTA_PATH = join(process.cwd(), ".secrets", "vanta-accounts.json");

const LEXO_DISTRIBUTION =
  "GABXUKWDB44SQGY6OVJWD3OXYEXE27UIGBWTF4FI2JMNLEXZKMA7TSQX";
const VANTA_ISSUER =
  "GABER3CCXQ44LCM5CBHKCPRNLMJFEKN2QKBQHQPJD6TFV3WXU63PKXRP";
const VANTA_DISTRIBUTION =
  "GCIBP63HOCB6WRL6EF6WBXYMH3PZ4EAWDXH7KUU5AUOZAX3Q4OOFI5NI";
const FARM_ISSUER =
  "GBF7ZMNV4L2PFQRHJEMQLH7FEYMIP4ZSUKQ42ZOCYL5MI5P234C2NMNB";
const FARM_DISTRIBUTION =
  "GBJELP7DVYFQLY77ZM34SDMQOHDRBN7E7L44WHDAMPPMLCSKG6P3ESRT";
const SIKE_ISSUER =
  "GBPBUOS7DG7IOK3CCX3TPVLG4PW44C7J5M4VEXREYSM7EOQAGEYPY7QV";
const SIKE_DISTRIBUTION =
  "GCEN47OQUGNGIY3VE3KS7AHRCP5AFU4GVBFVMLWZ5DW25PNKUY36BOZB";

const PLAN = {
  xlm: 10,
  vantaXlm: 1_000_000_000,
  vantaFarm: 400_000_000,
  farm: 4_000_000,
  vantaSike: 200_000_000,
  sike: 2_000_000,
  reserve: 2.2,
};

function assetBalance(account, code, issuer) {
  return Number(
    account.balances?.find(
      (b) =>
        b.asset_type !== "native" &&
        b.asset_code === code &&
        b.asset_issuer === issuer,
    )?.balance ?? "0",
  );
}

function xlmBalance(account) {
  return Number(
    account.balances?.find((b) => b.asset_type === "native")?.balance ?? "0",
  );
}

async function account(publicKey) {
  const r = await fetch(HORIZON_URL + "/accounts/" + publicKey);
  if (!r.ok) throw new Error(`Account lookup failed for ${publicKey}: ${r.status}`);
  return r.json();
}

async function poolId(a, b) {
  const [x, y] = StellarSdk.Asset.compare(a, b) <= 0 ? [a, b] : [b, a];
  const poolAsset = new StellarSdk.LiquidityPoolAsset(
    x,
    y,
    StellarSdk.LiquidityPoolFeeV18,
  );
  return StellarSdk.getLiquidityPoolId(
    "constant_product",
    poolAsset.getLiquidityPoolParameters(),
  ).toString("hex");
}

function trustline(accountData, code, issuer) {
  return accountData.balances?.find(
    (b) =>
      b.asset_type !== "native" &&
      b.asset_code === code &&
      b.asset_issuer === issuer,
  );
}

async function main() {
  console.log("VANTA NATIVE AMM LIQUIDITY PREFLIGHT");
  console.log("====================================");
  console.log("No transactions are submitted.");
  console.log("Source:", LEXO_DISTRIBUTION);
  console.log("");

  let lexoConfig;
  let vantaConfig;
  try {
    lexoConfig = JSON.parse(readFileSync(SOURCE_PATH, "utf8"));
    vantaConfig = JSON.parse(readFileSync(VANTA_PATH, "utf8"));
  } catch (error) {
    throw new Error("Required local .secrets account files are missing or invalid.");
  }

  const lexoDistribution = StellarSdk.Keypair.fromSecret(lexoConfig.distribution.secretKey);
  const vantaDistribution = StellarSdk.Keypair.fromSecret(vantaConfig.distribution.secretKey);

  if (lexoDistribution.publicKey() !== LEXO_DISTRIBUTION) {
    throw new Error("LEXO distribution secret does not match the expected public key.");
  }
  if (vantaDistribution.publicKey() !== VANTA_DISTRIBUTION) {
    throw new Error("VANTA distribution secret does not match the expected public key.");
  }

  const [source, vantaDist, farmDist, sikeDist] = await Promise.all([
    account(LEXO_DISTRIBUTION),
    account(VANTA_DISTRIBUTION),
    account(FARM_DISTRIBUTION),
    account(SIKE_DISTRIBUTION),
  ]);

  const values = {
    sourceXlm: xlmBalance(source),
    sourceVanta: assetBalance(source, "VANTA", VANTA_ISSUER),
    sourceFarm: assetBalance(source, "FARM", FARM_ISSUER),
    sourceSike: assetBalance(source, "SIKE", SIKE_ISSUER),
    vantaDistVanta: assetBalance(vantaDist, "VANTA", VANTA_ISSUER),
    farmDistFarm: assetBalance(farmDist, "FARM", FARM_ISSUER),
    sikeDistSike: assetBalance(sikeDist, "SIKE", SIKE_ISSUER),
  };

  console.log("CURRENT BALANCES");
  console.log(JSON.stringify(values, null, 2));
  console.log("");

  const checks = [
    ["XLM available", values.sourceXlm >= PLAN.xlm + PLAN.reserve, values.sourceXlm, PLAN.xlm + PLAN.reserve],
    ["VANTA in source", values.sourceVanta >= PLAN.vantaXlm + PLAN.vantaFarm + PLAN.vantaSike, values.sourceVanta, PLAN.vantaXlm + PLAN.vantaFarm + PLAN.vantaSike],
    ["FARM in source", values.sourceFarm >= PLAN.farm, values.sourceFarm, PLAN.farm],
    ["SIKE in source", values.sourceSike >= PLAN.sike, values.sourceSike, PLAN.sike],
  ];

  console.log("EXECUTION REQUIREMENTS");
  for (const [label, ok, have, need] of checks) {
    console.log(`${ok ? "PASS" : "BLOCKED"} ${label}: have=${have} need=${need}`);
  }

  console.log("");
  console.log("REQUIRED INTERNAL ASSET MOVES");
  if (values.sourceVanta < PLAN.vantaXlm + PLAN.vantaFarm + PLAN.vantaSike) {
    console.log(`VANTA: transfer at least ${(PLAN.vantaXlm + PLAN.vantaFarm + PLAN.vantaSike - values.sourceVanta).toFixed(7)} from VANTA distribution to source.`);
  } else {
    console.log("VANTA: already funded in source.");
  }
  if (values.sourceFarm < PLAN.farm) {
    console.log(`FARM: transfer at least ${(PLAN.farm - values.sourceFarm).toFixed(7)} from FARM distribution to source.`);
  } else {
    console.log("FARM: already funded in source.");
  }
  if (values.sourceSike < PLAN.sike) {
    console.log(`SIKE: transfer at least ${(PLAN.sike - values.sourceSike).toFixed(7)} from SIKE distribution to source.`);
  } else {
    console.log("SIKE: already funded in source.");
  }

  const assets = {
    vanta: new StellarSdk.Asset("VANTA", VANTA_ISSUER),
    farm: new StellarSdk.Asset("FARM", FARM_ISSUER),
    sike: new StellarSdk.Asset("SIKE", SIKE_ISSUER),
    xlm: StellarSdk.Asset.native(),
  };

  const pools = [
    ["VANTA/XLM", assets.vanta, assets.xlm],
    ["VANTA/FARM", assets.vanta, assets.farm],
    ["VANTA/SIKE", assets.vanta, assets.sike],
  ];

  console.log("");
  console.log("POOL/TRUSTLINE REQUIREMENTS");
  for (const [name, a, b] of pools) {
    const id = await poolId(a, b);
    const response = await fetch(HORIZON_URL + "/liquidity_pools/" + id);
    console.log(`${name}: ${response.status === 404 ? "NEW POOL" : "POOL EXISTS"} ${id}`);

    const aTrust = a.isNative()
      ? true
      : Boolean(trustline(source, a.getCode(), a.getIssuer()));
    const bTrust = b.isNative()
      ? true
      : Boolean(trustline(source, b.getCode(), b.getIssuer()));

    console.log(`  reserve trustlines: A=${aTrust ? "PASS" : "MISSING"} B=${bTrust ? "PASS" : "MISSING"}`);
    console.log("  pool-share trustline: REQUIRED before deposit");
  }

  const estimatedSubentries = 3;
  const requiredBaseReserve = 0.5 * estimatedSubentries;
  const postLiquidityXlm = values.sourceXlm - PLAN.xlm;
  console.log("");
  console.log("RESERVE CHECK");
  console.log("Planned untouched XLM:", PLAN.reserve);
  console.log("Estimated post-deposit XLM:", postLiquidityXlm.toFixed(7));
  console.log("Additional 3 pool-share subentries would require approximately:", requiredBaseReserve.toFixed(7), "XLM");
  console.log("Note: exact reserve headroom depends on existing source-account subentries.");

  console.log("");
  console.log("STATUS");
  const allFundingReady = checks.every(([, ok]) => ok);
  console.log(allFundingReady
    ? "Funding balances are sufficient for the approved deposits."
    : "BLOCKED: asset funding must be consolidated into the source account first.");
  console.log("Classic Stellar AMM operations do not have Soroban-style simulation; this script intentionally stops before signing/submitting.");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
