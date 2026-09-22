import * as StellarSdk from "@stellar/stellar-sdk";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const HORIZON_URL = "https://horizon.stellar.org";
const NETWORK = StellarSdk.Networks.PUBLIC;
const SOURCE_PATH = join(process.cwd(), ".secrets", "lexo-accounts.json");

const SOURCE = "GABXUKWDB44SQGY6OVJWD3OXYEXE27UIGBWTF4FI2JMNLEXZKMA7TSQX";
const VANTA_ISSUER = "GABER3CCXQ44LCM5CBHKCPRNLMJFEKN2QKBQHQPJD6TFV3WXU63PKXRP";
const FARM_ISSUER = "GBF7ZMNV4L2PFQRHJEMQLH7FEYMIP4ZSUKQ42ZOCYL5MI5P234C2NMNB";
const SIKE_ISSUER = "GBPBUOS7DG7IOK3CCX3TPVLG4PW44C7J5M4VEXREYSM7EOQAGEYPY7QV";

const PLAN = [
  {
    name: "VANTA/XLM",
    a: StellarSdk.Asset.native(),
    b: new StellarSdk.Asset("VANTA", VANTA_ISSUER),
    amountA: "10.0000000",
    amountB: "1000000000.0000000",
    price: "0.00000001",
  },
  {
    name: "VANTA/FARM",
    a: new StellarSdk.Asset("FARM", FARM_ISSUER),
    b: new StellarSdk.Asset("VANTA", VANTA_ISSUER),
    amountA: "4000000.0000000",
    amountB: "400000000.0000000",
    price: "0.0100000",
  },
  {
    name: "VANTA/SIKE",
    a: new StellarSdk.Asset("SIKE", SIKE_ISSUER),
    b: new StellarSdk.Asset("VANTA", VANTA_ISSUER),
    amountA: "2000000.0000000",
    amountB: "200000000.0000000",
    price: "0.0100000",
  },
];

function readSourceKeypair() {
  const config = JSON.parse(readFileSync(SOURCE_PATH, "utf8"));
  const kp = StellarSdk.Keypair.fromSecret(config.distribution.secretKey);
  if (kp.publicKey() !== SOURCE) {
    throw new Error("LEXO distribution secret does not match the expected source account.");
  }
  return kp;
}

async function json(url) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`HTTP ${r.status}: ${url}`);
  return r.json();
}

function balance(account, asset) {
  if (asset.isNative()) {
    return Number(account.balances?.find((b) => b.asset_type === "native")?.balance ?? "0");
  }
  return Number(
    account.balances?.find(
      (b) =>
        b.asset_type !== "native" &&
        b.asset_code === asset.getCode() &&
        b.asset_issuer === asset.getIssuer(),
    )?.balance ?? "0",
  );
}

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

function orderedPair(a, b) {
  return StellarSdk.Asset.compare(a, b) <= 0 ? [a, b] : [b, a];
}

function poolShareAsset(plan) {
  return new StellarSdk.LiquidityPoolAsset(
    ...orderedPair(plan.a, plan.b),
    StellarSdk.LiquidityPoolFeeV18,
  );
}

function hasPoolShareTrustline(account, plan) {
  const id = poolId(plan.a, plan.b);
  return Boolean(
    account.balances?.find(
      (b) =>
        b.asset_type === "liquidity_pool_shares" &&
        b.liquidity_pool_id === id,
    ),
  );
}

async function submitChangeTrust(kp) {
  const account = await server.loadAccount(SOURCE);
  const tx = new StellarSdk.TransactionBuilder(account, {
    fee: "100",
    networkPassphrase: NETWORK,
  })
    .addOperation(
      StellarSdk.Operation.changeTrust({
        asset: new StellarSdk.LiquidityPoolAsset(
          ...orderedPair(PLAN[0].a, PLAN[0].b),
          StellarSdk.LiquidityPoolFeeV18,
        ),
        limit: "1000000000",
      }),
    )
    .addOperation(
      StellarSdk.Operation.changeTrust({
        asset: new StellarSdk.LiquidityPoolAsset(
          ...orderedPair(PLAN[1].a, PLAN[1].b),
          StellarSdk.LiquidityPoolFeeV18,
        ),
        limit: "1000000000",
      }),
    )
    .addOperation(
      StellarSdk.Operation.changeTrust({
        asset: new StellarSdk.LiquidityPoolAsset(
          ...orderedPair(PLAN[2].a, PLAN[2].b),
          StellarSdk.LiquidityPoolFeeV18,
        ),
        limit: "1000000000",
      }),
    )
    .setTimeout(60)
    .build();

  tx.sign(kp);
  return server.submitTransaction(tx);
}

async function submitDeposit(kp, plan) {
  const [a, b] = orderedPair(plan.a, plan.b);
  const amountA = a.equals(plan.a) ? plan.amountA : plan.amountB;
  const amountB = a.equals(plan.a) ? plan.amountB : plan.amountA;
  const id = poolId(a, b);

  const account = await server.loadAccount(SOURCE);
  const tx = new StellarSdk.TransactionBuilder(account, {
    fee: "100",
    networkPassphrase: NETWORK,
  })
    .addOperation(
      StellarSdk.Operation.liquidityPoolDeposit({
        liquidityPoolId: id,
        maxAmountA: amountA,
        maxAmountB: amountB,
        minPrice: plan.price,
        maxPrice: plan.price,
      }),
    )
    .setTimeout(60)
    .build();

  tx.sign(kp);
  return server.submitTransaction(tx);
}

const server = new StellarSdk.Horizon.Server(HORIZON_URL);

async function main() {
  console.log("VANTA MAINNET LIQUIDITY EXECUTION");
  console.log("=================================");
  console.log("Three classic Stellar constant-product pools.");
  console.log("No internal asset transfers are performed.");
  console.log("");

  if (process.env.CONFIRM_VANTA_LIQUIDITY !== "YES") {
    throw new Error(
      "BLOCKED: set CONFIRM_VANTA_LIQUIDITY=YES to authorize the mainnet pool transactions.",
    );
  }

  const kp = readSourceKeypair();
  const account = await json(`${HORIZON_URL}/accounts/${SOURCE}`);

  console.log("SOURCE:", SOURCE);
  console.log("XLM:", balance(account, StellarSdk.Asset.native()).toFixed(7));
  console.log("VANTA:", balance(account, PLAN[0].b).toFixed(7));
  console.log("FARM:", balance(account, PLAN[1].a).toFixed(7));
  console.log("SIKE:", balance(account, PLAN[2].a).toFixed(7));
  console.log("");

  const required = {
    xlm: 10,
    vanta: 1_600_000_000,
    farm: 4_000_000,
    sike: 2_000_000,
  };

  const current = {
    xlm: balance(account, StellarSdk.Asset.native()),
    vanta: balance(account, PLAN[0].b),
    farm: balance(account, PLAN[1].a),
    sike: balance(account, PLAN[2].a),
  };

  for (const [key, need] of Object.entries(required)) {
    if (current[key] < need) {
      throw new Error(`BLOCKED: insufficient ${key}; have=${current[key]} need=${need}`);
    }
  }

  for (const plan of PLAN) {
    const id = poolId(plan.a, plan.b);
    const r = await fetch(HORIZON_URL + "/liquidity_pools/" + id);
    if (r.status === 404) {
      console.log(plan.name + ": NEW POOL " + id);
    } else if (r.ok) {
      const pool = await r.json();
      const reserves = pool.reserves ?? [];
      const reserveA = Number(reserves[0]?.amount ?? "0");
      const reserveB = Number(reserves[1]?.amount ?? "0");
      if (reserveA !== 0 || reserveB !== 0) {
        throw new Error("BLOCKED: " + plan.name + " pool already has liquidity: " + id);
      }
      console.log(plan.name + ": EMPTY POOL " + id + " (safe to initialize)");
    } else {
      throw new Error("Unexpected pool lookup status for " + plan.name + ": " + r.status);
    }
    console.log("  ratio A/B = " + plan.price);
    console.log("  deposit = " + plan.amountA + " A + " + plan.amountB + " B");
  }

  const missingTrustlines = PLAN.filter((plan) => !hasPoolShareTrustline(account, plan));
  if (missingTrustlines.length > 0) {
    console.log("");
    console.log("STEP 1/4: creating " + missingTrustlines.length + " required pool-share trustline(s)...");
    const trustTx = await submitChangeTrust(kp);
    console.log("TRUSTLINE TX:", trustTx.hash);
  } else {
    console.log("");
    console.log("STEP 1/4: pool-share trustlines already exist; skipping trustline transaction.");
  }

  for (let i = 0; i < PLAN.length; i++) {
    const plan = PLAN[i];
    console.log("");
    console.log(`STEP ${i + 2}/4: creating and funding ${plan.name}...`);
    const tx = await submitDeposit(kp, plan);
    console.log(`${plan.name} TX:`, tx.hash);
  }

  console.log("");
  console.log("LIQUIDITY EXECUTION COMPLETE");
  console.log("All three pools were created and funded at the approved ratios.");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
