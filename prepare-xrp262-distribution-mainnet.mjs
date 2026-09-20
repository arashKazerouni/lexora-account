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
const DISTRIBUTION_PATH = join(process.cwd(), ".secrets", "xrp262-distribution.json");
const ISSUER = "GCGVZEE7RD2BFF2EIQUT37DYJUR7WDCQ2KWA5LUWYATRFLKEYHMJ3XRP";
const CODE = "XRP262";
const TRUSTLINE_LIMIT = "900000000000";
const confirm = process.env.CONFIRM_XRP262_MAINNET_TRUSTLINE;

if (confirm !== "YES") {
  throw new Error("Set CONFIRM_XRP262_MAINNET_TRUSTLINE=YES to create the XRP262 trustline on mainnet.");
}

let secrets;
try {
  secrets = JSON.parse(readFileSync(DISTRIBUTION_PATH, "utf8"));
} catch {
  throw new Error("Missing " + DISTRIBUTION_PATH + ". Restore the existing funded distribution key file first.");
}

if (!secrets.publicKey || !secrets.secretKey) {
  throw new Error("Distribution secret file is missing publicKey or secretKey.");
}

const keypair = Keypair.fromSecret(secrets.secretKey);
if (keypair.publicKey() !== secrets.publicKey) {
  throw new Error("Distribution publicKey does not match the saved secretKey.");
}

async function main() {
  const accountId = keypair.publicKey();
  console.log("XRP262 DISTRIBUTION TRUSTLINE");
  console.log("=============================");
  console.log("Distribution:", accountId);
  console.log("Asset:", CODE);
  console.log("Issuer:", ISSUER);
  console.log("Limit:", TRUSTLINE_LIMIT);

  const response = await fetch(
    HORIZON_URL + "/accounts/" + accountId +
      "?signers=false&transactions=false&operations=false&payments=false&effects=false&offers=false&trade_effects=false&trades=false&claimable_balances=false&liquidity_pools=false",
  );

  if (!response.ok) {
    throw new Error("Horizon account lookup failed: " + response.status + " " + await response.text());
  }

  const account = await response.json();
  const existing = account.balances?.find(
    (balance) =>
      balance.asset_type !== "native" &&
      balance.asset_code === CODE &&
      balance.asset_issuer === ISSUER,
  );

  if (existing) {
    console.log("Trustline: ALREADY EXISTS");
    console.log("Current limit:", existing.limit);
    console.log("Current balance:", existing.balance);
    console.log("No transaction submitted.");
    return;
  }

  const transaction = new TransactionBuilder(
    new Account(accountId, account.sequence),
    {
      networkPassphrase: Networks.PUBLIC,
      fee: "100000",
    },
  )
    .addOperation(
      Operation.changeTrust({
        asset: new Asset(CODE, ISSUER),
        limit: TRUSTLINE_LIMIT,
      }),
    )
    .setTimeout(300)
    .build();

  transaction.sign(keypair);

  console.log("Submitting trustline transaction to MAINNET...");
  const submitResponse = await fetch(HORIZON_URL + "/transactions", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: "tx=" + encodeURIComponent(transaction.toXDR()),
  });

  const result = await submitResponse.json();

  if (!submitResponse.ok) {
    console.dir(result, { depth: 8 });
    throw new Error(
      "Trustline transaction failed: " +
        (result.extras?.result_codes?.transaction ?? submitResponse.status),
    );
  }

  console.log("Trustline transaction: PASS");
  console.log("Transaction hash:", result.hash);
  console.log("Trustline limit:", TRUSTLINE_LIMIT);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
