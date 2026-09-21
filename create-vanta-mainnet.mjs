import {
  Account,
  Asset,
  Keypair,
  Networks,
  Operation,
  TransactionBuilder,
} from "@stellar/stellar-sdk";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const HORIZON_URL = "https://horizon.stellar.org";
const NETWORK = Networks.PUBLIC;
const CODE = "VANTA";
const SUPPLY = "922000000000";
const ISSUER_PUBLIC_KEY =
  "GABER3CCXQ44LCM5CBHKCPRNLMJFEKN2QKBQHQPJD6TFV3WXU63PKXRP";
const ISSUER_SECRET_PATH = join(process.cwd(), ".secrets", "vanta-issuer.secret");
const ACCOUNTS_PATH = join(process.cwd(), ".secrets", "vanta-accounts.json");
const confirm = process.env.CONFIRM_VANTA_MAINNET;

if (confirm !== "YES") {
  throw new Error(
    "Mainnet VANTA creation is disabled by default. Set CONFIRM_VANTA_MAINNET=YES only after reviewing the output.",
  );
}
if (!process.env.LEXORA_DEPLOYER_SECRET) {
  throw new Error(
    "Missing LEXORA_DEPLOYER_SECRET. It is used only as the funded transaction source.",
  );
}

let distributionConfig;
try {
  distributionConfig = JSON.parse(readFileSync(ACCOUNTS_PATH, "utf8"));
} catch {
  throw new Error(
    `Missing ${ACCOUNTS_PATH}. Run npm run vanta:generate-distribution first.`,
  );
}

let issuerSecret;
try {
  issuerSecret = readFileSync(ISSUER_SECRET_PATH, "utf8").trim();
} catch {
  throw new Error(
    `Missing ${ISSUER_SECRET_PATH}. Add the VANTA issuer secret locally before mainnet creation.`,
  );
}

const issuer = Keypair.fromSecret(issuerSecret);
if (issuer.publicKey() !== ISSUER_PUBLIC_KEY) {
  throw new Error("VANTA issuer secret does not derive the expected issuer public key.");
}

const distribution = Keypair.fromSecret(distributionConfig.distribution.secretKey);
if (distribution.publicKey() !== distributionConfig.distribution.publicKey) {
  throw new Error("VANTA distribution publicKey does not match its local secretKey.");
}

const source = Keypair.fromSecret(process.env.LEXORA_DEPLOYER_SECRET);

async function account(publicKey) {
  const response = await fetch(HORIZON_URL + "/accounts/" + publicKey);
  if (!response.ok) {
    const body = await response.text();
    const error = new Error(`Horizon account lookup failed: ${response.status}`);
    error.body = body;
    throw error;
  }
  return response.json();
}

async function submit(tx) {
  const response = await fetch(HORIZON_URL + "/transactions", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: "tx=" + encodeURIComponent(tx.toXDR()),
  });
  const result = await response.json();
  if (!response.ok) {
    console.dir(result, { depth: 8 });
    throw new Error(
      "Transaction failed: " +
        (result.extras?.result_codes?.transaction ?? response.status),
    );
  }
  return result;
}

async function waitForAccounts() {
  for (let attempt = 1; attempt <= 15; attempt += 1) {
    const [issuerResponse, distributionResponse] = await Promise.all([
      fetch(HORIZON_URL + "/accounts/" + issuer.publicKey()),
      fetch(HORIZON_URL + "/accounts/" + distribution.publicKey()),
    ]);
    if (issuerResponse.ok && distributionResponse.ok) return;
    if (attempt === 15) {
      throw new Error(
        "Accounts were created on-chain but Horizon did not expose both accounts within the retry window.",
      );
    }
    await new Promise((resolve) => setTimeout(resolve, 2000));
  }
}

async function main() {
  console.log("VANTA MAINNET CREATION");
  console.log("======================");
  console.log("Asset:", CODE);
  console.log("Issuer:", issuer.publicKey());
  console.log("Distribution:", distribution.publicKey());
  console.log("Initial supply:", SUPPLY, CODE);
  console.log("Decimals: 7");
  console.log("Network: Stellar Mainnet");
  console.log("");

  const issuerResponse = await fetch(HORIZON_URL + "/accounts/" + issuer.publicKey());
  const distributionResponse = await fetch(HORIZON_URL + "/accounts/" + distribution.publicKey());

  const sourceAccount = await account(source.publicKey());
  const operations = [];

  if (!issuerResponse.ok) {
    operations.push(
      Operation.createAccount({
        destination: issuer.publicKey(),
        startingBalance: "1",
      }),
    );
  }

  if (!distributionResponse.ok) {
    operations.push(
      Operation.createAccount({
        destination: distribution.publicKey(),
        startingBalance: "1",
      }),
    );
  }

  if (operations.length > 0) {
    const builder = new TransactionBuilder(
      new Account(source.publicKey(), sourceAccount.sequence),
      { networkPassphrase: NETWORK, fee: "100000" },
    );

    for (const operation of operations) builder.addOperation(operation);

    const tx = builder.setTimeout(300).build();
    tx.sign(source);

    console.log("Creating missing VANTA accounts...");
    const result = await submit(tx);
    console.log("Account creation transaction:", result.hash);
    await waitForAccounts();
  } else {
    console.log("Issuer account: ALREADY EXISTS");
    console.log("Distribution account: ALREADY EXISTS");
  }

  const distributionAccount = await account(distribution.publicKey());
  const existingTrustline = distributionAccount.balances?.find(
    (balance) =>
      balance.asset_type !== "native" &&
      balance.asset_code === CODE &&
      balance.asset_issuer === issuer.publicKey(),
  );

  if (!existingTrustline) {
    const tx = new TransactionBuilder(
      new Account(distribution.publicKey(), distributionAccount.sequence),
      { networkPassphrase: NETWORK, fee: "100000" },
    )
      .addOperation(
        Operation.changeTrust({
          asset: new Asset(CODE, issuer.publicKey()),
          limit: SUPPLY,
        }),
      )
      .setTimeout(300)
      .build();

    tx.sign(distribution);
    console.log("Creating VANTA trustline...");
    const result = await submit(tx);
    console.log("Trustline transaction:", result.hash);
  } else {
    console.log("Trustline: ALREADY EXISTS");
    console.log("Trustline limit:", existingTrustline.limit);
  }

  const freshIssuer = await account(issuer.publicKey());
  const freshDistribution = await account(distribution.publicKey());
  const balance = freshDistribution.balances?.find(
    (entry) =>
      entry.asset_type !== "native" &&
      entry.asset_code === CODE &&
      entry.asset_issuer === issuer.publicKey(),
  );

  if (balance?.balance === SUPPLY) {
    console.log("Initial issuance: ALREADY COMPLETE");
    console.log("Distribution balance:", balance.balance, CODE);
    return;
  }

  if (balance && Number(balance.balance) > 0) {
    throw new Error(
      `Distribution already holds ${balance.balance} ${CODE}; refusing to issue the full supply again.`,
    );
  }

  const paymentTx = new TransactionBuilder(
    new Account(issuer.publicKey(), freshIssuer.sequence),
    { networkPassphrase: NETWORK, fee: "100000" },
  )
    .addOperation(
      Operation.payment({
        destination: distribution.publicKey(),
        asset: new Asset(CODE, issuer.publicKey()),
        amount: SUPPLY,
      }),
    )
    .setTimeout(300)
    .build();

  paymentTx.sign(issuer);

  console.log("Issuing initial supply...");
  const paymentResult = await submit(paymentTx);
  console.log("Issuance transaction:", paymentResult.hash);
  console.log("");
  console.log("VANTA MAINNET CREATION COMPLETE");
  console.log("Issuer:", issuer.publicKey());
  console.log("Distribution:", distribution.publicKey());
  console.log("Supply issued:", SUPPLY, CODE);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
