import { readFileSync } from "node:fs";
import { join } from "node:path";

const HORIZON_URL =
  process.env.HORIZON_URL || "https://horizon.stellar.org";
const VANTA_CODE = "VANTA";
const VANTA_ISSUER =
  "GABER3CCXQ44LCM5CBHKCPRNLMJFEKN2QKBQHQPJD6TFV3WXU63PKXRP";
const BASE_RESERVE_XLM = 0.5;
const DEFAULT_CONFIG_PATH = join(
  process.cwd(),
  ".secrets",
  "vanta-market-accounts.json",
);

function loadAccounts() {
  const configPath =
    process.env.VANTA_MARKET_ACCOUNTS_PATH || DEFAULT_CONFIG_PATH;

  let raw;
  try {
    raw = readFileSync(configPath, "utf8");
  } catch {
    throw new Error(
      [
        `Missing VANTA market account map: ${configPath}`,
        "",
        "Create this local-only file (never commit it) with:",
        JSON.stringify(
          {
            accounts: [
              { role: "VANTA Treasury", publicKey: "G..." },
              { role: "Liquidity", publicKey: "G..." },
              { role: "Developer rewards", publicKey: "G..." },
              { role: "Community rewards", publicKey: "G..." },
              { role: "Application payments", publicKey: "G..." },
              { role: "Marketing", publicKey: "G..." },
              { role: "Partner/demo", publicKey: "G..." },
              { role: "User distribution 01", publicKey: "G..." },
              { role: "User distribution 02", publicKey: "G..." },
              { role: "User distribution 03", publicKey: "G..." },
              { role: "User distribution 04", publicKey: "G..." },
              { role: "Reserve", publicKey: "G..." },
            ],
          },
          null,
          2,
        ),
        "",
        "The audit is read-only and requires public keys only; no secret keys are needed.",
      ].join("\n"),
    );
  }

  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error(`Invalid JSON in ${configPath}`);
  }

  const accounts = Array.isArray(parsed) ? parsed : parsed?.accounts;
  if (!Array.isArray(accounts)) {
    throw new Error(
      `Expected ${configPath} to contain an "accounts" array.`,
    );
  }

  if (accounts.length !== 12) {
    throw new Error(
      `Expected exactly 12 VANTA market accounts; found ${accounts.length}.`,
    );
  }

  const normalized = accounts.map((account, index) => {
    const role = String(account?.role ?? `Account ${String(index + 1).padStart(2, "0")}`).trim();
    const publicKey = String(account?.publicKey ?? "").trim();

    if (!/^G[A-Z2-7]{55}$/.test(publicKey)) {
      throw new Error(
        `Invalid Stellar public key for ${role}: ${publicKey || "(missing)"}`,
      );
    }

    return { role, publicKey };
  });

  const seen = new Set();
  for (const account of normalized) {
    if (seen.has(account.publicKey)) {
      throw new Error(`Duplicate public key in account map: ${account.publicKey}`);
    }
    seen.add(account.publicKey);
  }

  return { configPath, accounts: normalized };
}

async function getAccount(publicKey) {
  const response = await fetch(
    `${HORIZON_URL}/accounts/${encodeURIComponent(publicKey)}`,
  );
  const bodyText = await response.text();

  let body;
  try {
    body = JSON.parse(bodyText);
  } catch {
    body = null;
  }

  if (!response.ok) {
    const detail =
      body?.title ||
      body?.detail ||
      body?.extras?.result_codes?.transaction ||
      bodyText.trim();

    throw new Error(
      `Horizon account lookup failed for ${publicKey}: HTTP ${response.status}${detail ? ` — ${detail}` : ""}`,
    );
  }

  return body;
}

function xlmBalance(account) {
  return Number(
    account.balances?.find((balance) => balance.asset_type === "native")?.balance ??
      "0",
  );
}

function vantaTrustline(account) {
  return account.balances?.find(
    (balance) =>
      balance.asset_type !== "native" &&
      balance.asset_code === VANTA_CODE &&
      balance.asset_issuer === VANTA_ISSUER,
  );
}

function minimumBalance(account) {
  const subentries = Number(account.subentry_count ?? 0);
  return (2 + subentries) * BASE_RESERVE_XLM;
}

function format(value) {
  return Number(value).toFixed(7);
}

async function main() {
  const { configPath, accounts } = loadAccounts();

  console.log("VANTA PHASE 2 — 12-ACCOUNT MAINNET AUDIT");
  console.log("========================================");
  console.log("READ-ONLY: no transactions are submitted.");
  console.log("Horizon:", HORIZON_URL);
  console.log("VANTA issuer:", VANTA_ISSUER);
  console.log("Account map:", configPath);
  console.log("");

  const results = await Promise.all(
    accounts.map(async (account) => {
      try {
        const data = await getAccount(account.publicKey);
        const xlm = xlmBalance(data);
        const minimum = minimumBalance(data);
        const vanta = vantaTrustline(data);

        return {
          ...account,
          status: "PASS",
          accountExists: true,
          xlm,
          minimum,
          headroom: xlm - minimum,
          subentries: Number(data.subentry_count ?? 0),
          vantaTrustline: Boolean(vanta),
          vantaBalance: Number(vanta?.balance ?? "0"),
          vantaLimit: vanta?.limit ?? null,
          homeDomain: data.home_domain ?? null,
          sequence: data.sequence ?? null,
          error: null,
        };
      } catch (error) {
        return {
          ...account,
          status: "FAIL",
          accountExists: false,
          xlm: 0,
          minimum: 0,
          headroom: 0,
          subentries: null,
          vantaTrustline: false,
          vantaBalance: 0,
          vantaLimit: null,
          homeDomain: null,
          sequence: null,
          error: error instanceof Error ? error.message : String(error),
        };
      }
    }),
  );

  console.log("ACCOUNT STATUS");
  console.log("==============");

  for (const result of results) {
    console.log("");
    console.log(result.role);
    console.log("  public key: " + result.publicKey);

    if (result.status === "FAIL") {
      console.log("  account: FAIL");
      console.log("  error: " + result.error);
      continue;
    }

    console.log("  account: PASS");
    console.log("  XLM balance: " + format(result.xlm));
    console.log("  subentries: " + result.subentries);
    console.log("  estimated minimum balance: " + format(result.minimum));
    console.log("  reserve headroom: " + format(result.headroom));
    console.log(
      "  VANTA trustline: " + (result.vantaTrustline ? "PASS" : "MISSING"),
    );
    console.log("  VANTA balance: " + format(result.vantaBalance));
    console.log("  VANTA limit: " + (result.vantaLimit ?? "missing"));
    console.log("  home domain: " + (result.homeDomain ?? "none"));
  }

  const existing = results.filter((result) => result.accountExists);
  const failed = results.filter((result) => !result.accountExists);
  const trustlines = existing.filter((result) => result.vantaTrustline);
  const missingTrustlines = existing.filter((result) => !result.vantaTrustline);

  const totalXlm = existing.reduce((sum, result) => sum + result.xlm, 0);
  const totalMinimum = existing.reduce(
    (sum, result) => sum + result.minimum,
    0,
  );
  const totalHeadroom = existing.reduce(
    (sum, result) => sum + result.headroom,
    0,
  );

  console.log("");
  console.log("PHASE 2 FUNDING SUMMARY");
  console.log("=======================");
  console.log("Accounts expected: 12");
  console.log("Accounts found: " + existing.length);
  console.log("Accounts missing: " + failed.length);
  console.log("VANTA trustlines: " + trustlines.length + "/12");
  console.log("VANTA trustlines missing: " + missingTrustlines.length);
  console.log("Combined XLM balance: " + format(totalXlm));
  console.log("Combined estimated minimum balance: " + format(totalMinimum));
  console.log("Combined reserve headroom: " + format(totalHeadroom));
  console.log("Target phase budget: 20.9000000 XLM");
  console.log(
    "XLM above estimated account reserves: " +
      format(totalHeadroom),
  );

  console.log("");
  console.log("DEPLOYMENT READINESS");
  console.log("====================");

  const accountsReady = failed.length === 0;
  const trustlinesReady = missingTrustlines.length === 0;

  console.log(
    accountsReady
      ? "PASS — all 12 public accounts exist."
      : "BLOCKED — one or more accounts do not exist on mainnet.",
  );
  console.log(
    trustlinesReady
      ? "PASS — all 12 accounts already have the VANTA trustline."
      : "INFO — VANTA trustlines are missing on " +
          missingTrustlines.length +
          " account(s); no trustline transactions were submitted.",
  );

  console.log("");
  console.log("NEXT SAFE INPUTS");
  console.log("================");
  console.log(
    "This audit intentionally does not allocate, fund, trustline, offer, or trade.",
  );
  console.log(
    "Use its balances and reserve headroom as the input for the Phase 2 allocation plan.",
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
