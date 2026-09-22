import * as StellarSdk from "@stellar/stellar-sdk";

const HORIZON_URL = "https://horizon.stellar.org";

const SOURCE = "GABXUKWDB44SQGY6OVJWD3OXYEXE27UIGBWTF4FI2JMNLEXZKMA7TSQX";
const VANTA_ISSUER = "GABER3CCXQ44LCM5CBHKCPRNLMJFEKN2QKBQHQPJD6TFV3WXU63PKXRP";
const FARM_ISSUER = "GBF7ZMNV4L2PFQRHJEMQLH7FEYMIP4ZSUKQ42ZOCYL5MI5P234C2NMNB";
const SIKE_ISSUER = "GBPBUOS7DG7IOK3CCX3TPVLG4PW44C7J5M4VEXREYSM7EOQAGEYPY7QV";

const PLAN = [
  {
    name: "VANTA/XLM",
    a: StellarSdk.Asset.native(),
    b: new StellarSdk.Asset("VANTA", VANTA_ISSUER),
    expected: { native: 10, VANTA: 1_000_000_000 },
  },
  {
    name: "VANTA/FARM",
    a: new StellarSdk.Asset("FARM", FARM_ISSUER),
    b: new StellarSdk.Asset("VANTA", VANTA_ISSUER),
    expected: { FARM: 4_000_000, VANTA: 400_000_000 },
  },
  {
    name: "VANTA/SIKE",
    a: new StellarSdk.Asset("SIKE", SIKE_ISSUER),
    b: new StellarSdk.Asset("VANTA", VANTA_ISSUER),
    expected: { SIKE: 2_000_000, VANTA: 200_000_000 },
  },
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

function assetLabel(asset) {
  return asset.isNative() ? "native" : asset.getCode();
}

function sameAsset(record, asset) {
  if (asset.isNative()) return record.asset === "native";
  return (
    record.asset === asset.getCode() + ":" + asset.getIssuer()
  );
}

function formatAmount(value) {
  return Number(value).toFixed(7);
}

function assertClose(actual, expected, label) {
  const tolerance = 0.0000001;
  if (Math.abs(actual - expected) > tolerance) {
    throw new Error(
      label + " mismatch: actual=" + actual + " expected=" + expected,
    );
  }
}

async function main() {
  console.log("VANTA MAINNET LIQUIDITY AUDIT");
  console.log("=============================");
  console.log("READ-ONLY: no transactions are submitted.");
  console.log("");

  const accountResponse = await fetch(HORIZON_URL + "/accounts/" + SOURCE);
  if (!accountResponse.ok) throw new Error("Horizon account lookup failed: " + accountResponse.status);
  const account = await accountResponse.json();

  let failures = 0;

  for (const plan of PLAN) {
    const id = poolId(plan.a, plan.b);
    const response = await fetch(HORIZON_URL + "/liquidity_pools/" + id);
    if (!response.ok) {
      failures++;
      console.log(plan.name + ": FAIL - pool lookup HTTP " + response.status);
      continue;
    }

    const pool = await response.json();
    const reserves = pool.reserves ?? [];

    console.log(plan.name);
    console.log("  pool ID: " + id);
    console.log("  type: " + pool.type);
    console.log("  fee: " + pool.fee_bp + " bp");
    console.log("  total shares: " + pool.total_shares);
    console.log("  total trustlines: " + pool.total_trustlines);

    for (const [label, expected] of Object.entries(plan.expected)) {
      const asset =
        label === "native"
          ? StellarSdk.Asset.native()
          : label === "VANTA"
            ? new StellarSdk.Asset("VANTA", VANTA_ISSUER)
            : label === "FARM"
              ? new StellarSdk.Asset("FARM", FARM_ISSUER)
              : new StellarSdk.Asset("SIKE", SIKE_ISSUER);

      const reserve = reserves.find((r) => sameAsset(r, asset));
      const actual = Number(reserve?.amount ?? "0");
      try {
        assertClose(actual, expected, plan.name + " " + label);
        console.log("  PASS " + label + ": " + formatAmount(actual));
      } catch (error) {
        failures++;
        console.log("  FAIL " + error.message);
      }
    }

    const shareBalance = account.balances?.find(
      (b) =>
        b.asset_type === "liquidity_pool_shares" &&
        b.liquidity_pool_id === id,
    );

    if (!shareBalance) {
      failures++;
      console.log("  FAIL LP share trustline/balance not found on source account");
    } else {
      console.log("  PASS source LP shares: " + shareBalance.balance);
    }

    console.log("");
  }

  const expectedRemaining = {
    VANTA: 1_600_000_000 - 1_600_000_000,
    FARM: 4_000_000 - 4_000_000,
    SIKE: 2_000_000 - 2_000_000,
  };

  for (const [label, expected] of Object.entries(expectedRemaining)) {
    const asset =
      label === "VANTA"
        ? new StellarSdk.Asset("VANTA", VANTA_ISSUER)
        : label === "FARM"
          ? new StellarSdk.Asset("FARM", FARM_ISSUER)
          : new StellarSdk.Asset("SIKE", SIKE_ISSUER);
    const actual = account.balances?.find(
      (b) =>
        b.asset_type !== "native" &&
        b.asset_code === asset.getCode() &&
        b.asset_issuer === asset.getIssuer(),
    );
    const amount = Number(actual?.balance ?? "0");
    try {
      assertClose(amount, expected, "source " + label);
      console.log("PASS source " + label + " after deposits: " + formatAmount(amount));
    } catch (error) {
      failures++;
      console.log("FAIL " + error.message);
    }
  }

  console.log("");
  if (failures > 0) {
    throw new Error("AUDIT FAILED with " + failures + " check(s).");
  }

  console.log("LIQUIDITY AUDIT PASS");
  console.log("All three pools match the approved reserve targets.");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
