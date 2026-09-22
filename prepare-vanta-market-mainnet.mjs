import * as StellarSdk from "@stellar/stellar-sdk";

const HORIZON_URL = "https://horizon.stellar.org";
const server = new StellarSdk.Horizon.Server(HORIZON_URL);

const VANTA = new StellarSdk.Asset("VANTA", "GABER3CCXQ44LCM5CBHKCPRNLMJFEKN2QKBQHQPJD6TFV3WXU63PKXRP");
const FARM = new StellarSdk.Asset("FARM", "GBF7ZMNV4L2PFQRHJEMQLH7FEYMIP4ZSUKQ42ZOCYL5MI5P234C2NMNB");
const SIKE = new StellarSdk.Asset("SIKE", "GBPBUOS7DG7IOK3CCX3TPVLG4PW44C7J5M4VEXREYSM7EOQAGEYPY7QV");

const PRICE_VANTA_PER_XLM = 100_000_000; // 1 XLM = 100M VANTA
const PLAN = {
  vantaXlm: { xlm: 10, vanta: 1_000_000_000 },
  vantaFarm: { xlmEquivalent: 4, vanta: 400_000_000, farm: 4_000_000 },
  vantaSike: { xlmEquivalent: 2, vanta: 200_000_000, sike: 2_000_000 },
};

function poolId(a, b) {
  const [x, y] = StellarSdk.Asset.compare(a, b) <= 0 ? [a, b] : [b, a];
  const params = new StellarSdk.LiquidityPoolAsset(x, y, StellarSdk.LiquidityPoolFeeV18)
    .getLiquidityPoolParameters();
  return StellarSdk.getLiquidityPoolId("constant_product", params).toString("hex");
}

async function checkPool(name, a, b) {
  const id = poolId(a, b);
  try {
    const p = await server.liquidityPools().liquidityPool(id).call();
    console.log(name, "EXISTS", p.id);
    console.log("  reserves:", p.reserves);
    return true;
  } catch (e) {
    if (e?.response?.status === 404) {
      console.log(name, "NO POOL", id);
      return false;
    }
    throw e;
  }
}

console.log("VANTA MARKET MAINNET PREFLIGHT");
console.log("Reference: 1,000,000 VANTA = 0.01 XLM");
console.log("No transactions are submitted.");

await checkPool("VANTA/XLM", VANTA, StellarSdk.Asset.native());
await checkPool("VANTA/FARM", VANTA, FARM);
await checkPool("VANTA/SIKE", VANTA, SIKE);

console.log("\nPLAN");
console.log(JSON.stringify(PLAN, null, 2));
console.log("Total VANTA:", 1_600_000_000);
console.log("Total XLM allocation:", 21.2);
