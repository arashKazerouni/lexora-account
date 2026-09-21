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
const ACCOUNTS_PATH = join(process.cwd(), ".secrets", "lexo-accounts.json");
const CODE = "LEXO";
const SUPPLY = "100000000";
const confirm = process.env.CONFIRM_LEXO_MAINNET;

if (confirm !== "YES") {
  throw new Error(
    "Mainnet LEXO creation is disabled by default. Set CONFIRM_LEXO_MAINNET=YES only after reviewing the output.",
  );
}
if (!process.env.LEXORA_DEPLOYER_SECRET) {
  throw new Error("Missing LEXORA_DEPLOYER_SECRET. It is used only as the funded transaction source.");
}

let config;
try {
  config = JSON.parse(readFileSync(ACCOUNTS_PATH, "utf8"));
} catch {
  throw new Error(`Missing ${ACCOUNTS_PATH}. Run npm run lexo:generate-accounts first.`);
}

const issuer = Keypair.fromSecret(config.issuer.secretKey);
const distribution = Keypair.fromSecret(config.distribution.secretKey);
if (issuer.publicKey() !== config.issuer.publicKey) throw new Error("Issuer publicKey does not match secretKey.");
if (distribution.publicKey() !== config.distribution.publicKey) throw new Error("Distribution publicKey does not match secretKey.");

const source = Keypair.fromSecret(process.env.LEXORA_DEPLOYER_SECRET);
const server = new (class {
  async account(id) {
    const r = await fetch(HORIZON_URL + "/accounts/" + id);
    if (!r.ok) throw new Error("Horizon account lookup failed: " + r.status + " " + await r.text());
    return r.json();
  }
  async submit(tx) {
    const r = await fetch(HORIZON_URL + "/transactions", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: "tx=" + encodeURIComponent(tx.toXDR()),
    });
    const result = await r.json();
    if (!r.ok) {
      console.dir(result, { depth: 8 });
      throw new Error("Transaction failed: " + (result.extras?.result_codes?.transaction ?? r.status));
    }
    return result;
  }
})();

async function main() {
  console.log("LEXO MAINNET CREATION");
  console.log("=====================");
  console.log("Asset:", CODE);
  console.log("Issuer:", issuer.publicKey());
  console.log("Distribution:", distribution.publicKey());
  console.log("Initial supply:", SUPPLY, CODE);
  console.log("Decimals: 7");
  console.log("");

  const issuerResponse = await fetch(HORIZON_URL + "/accounts/" + issuer.publicKey());
  const distributionResponse = await fetch(HORIZON_URL + "/accounts/" + distribution.publicKey());

  const issuerExists = issuerResponse.ok;
  const distributionExists = distributionResponse.ok;

  const sourceAccount = await server.account(source.publicKey());
  const operations = [];

  if (!issuerExists) {
    operations.push(Operation.createAccount({
      destination: issuer.publicKey(),
      startingBalance: "1",
    }));
  }
  if (!distributionExists) {
    operations.push(Operation.createAccount({
      destination: distribution.publicKey(),
      startingBalance: "1",
    }));
  }

  if (operations.length > 0) {
    const tx = new TransactionBuilder(new Account(source.publicKey(), sourceAccount.sequence), {
      networkPassphrase: NETWORK,
      fee: "100000",
    })
      .addOperations(operations)
      .setTimeout(300)
      .build();

    tx.sign(source);
    console.log("Creating missing LEXO accounts...");
    const result = await server.submit(tx);
    console.log("Account creation transaction:", result.hash);
  } else {
    console.log("Issuer account: ALREADY EXISTS");
    console.log("Distribution account: ALREADY EXISTS");
  }

  const distributionAccount = await server.account(distribution.publicKey());
  const existingTrustline = distributionAccount.balances?.find(
    (b) => b.asset_type !== "native" && b.asset_code === CODE && b.asset_issuer === issuer.publicKey(),
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
    console.log("Creating LEXO trustline...");
    const result = await server.submit(tx);
    console.log("Trustline transaction:", result.hash);
  } else {
    console.log("Trustline: ALREADY EXISTS");
    console.log("Trustline limit:", existingTrustline.limit);
  }

  const freshIssuer = await server.account(issuer.publicKey());
  const freshDistribution = await server.account(distribution.publicKey());
  const balance = freshDistribution.balances?.find(
    (b) => b.asset_type !== "native" && b.asset_code === CODE && b.asset_issuer === issuer.publicKey(),
  );

  if (balance?.balance === SUPPLY) {
    console.log("Initial issuance: ALREADY COMPLETE");
    console.log("Distribution balance:", balance.balance, CODE);
    return;
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
  const paymentResult = await server.submit(paymentTx);
  console.log("Issuance transaction:", paymentResult.hash);
  console.log("");
  console.log("LEXO MAINNET CREATION COMPLETE");
  console.log("Issuer:", issuer.publicKey());
  console.log("Distribution:", distribution.publicKey());
  console.log("Supply issued:", SUPPLY, CODE);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
