import fs from "node:fs";
import path from "node:path";
import {
  Keypair,
  Networks,
  Operation,
  TransactionBuilder,
  Address,
  scValToNative,
  xdr,
} from "@stellar/stellar-sdk";
import { Server } from "@stellar/stellar-sdk/rpc";

const RPC_URL = "https://mainnet.sorobanrpc.com";
const NETWORK = Networks.PUBLIC;

const LEXORA =
  process.env.LEXORA_MAINNET_CONTRACT ||
  "CAJL2JO6EILWBTHDRMIQVJA6MTZIUWHOD6WNVJDN7FWTYD6H3NFXH542";
const SAC =
  "CC7L34EWYCTDCA3L7CRRULWX577UJWET32KNJFD2WTEQ4KD7IAUKHIS6";
const ISSUER =
  "GCGVZEE7RD2BFF2EIQUT37DYJUR7WDCQ2KWA5LUWYATRFLKEYHMJ3XRP";
const EXPECTED_OWNER =
  "GCGJIJ4YYQR7ROEVXW4QNPN3E2C7AJMTQA7KVA2BMX7JGWFJAYTSFDFU";

const DECIMALS = 10_000_000n;
const EXPECTED_MAX_SUPPLY = 900_000_000_000n * DECIMALS;
const EXPECTED_BURNED = 426_026_808n * DECIMALS;
const EXPECTED_CIRCULATING = 899_573_973_192n;
const DISTRIBUTION_FILE = path.join(
  process.cwd(),
  ".secrets",
  "xrp262-distribution.json",
);

if (!process.env.LEXORA_DEPLOYER_SECRET) {
  throw new Error("Missing LEXORA_DEPLOYER_SECRET.");
}

const distribution = JSON.parse(fs.readFileSync(DISTRIBUTION_FILE, "utf8"));
const distributionKey = Keypair.fromSecret(distribution.secretKey);
if (distributionKey.publicKey() !== distribution.publicKey) {
  throw new Error("Distribution secret does not match saved publicKey.");
}

const deployer = Keypair.fromSecret(process.env.LEXORA_DEPLOYER_SECRET);
const server = new Server(RPC_URL);

function assetId() {
  return xdr.ScVal.scvMap([
    new xdr.ScMapEntry({
      key: xdr.ScVal.scvSymbol("code"),
      val: xdr.ScVal.scvString("XRP262"),
    }),
    new xdr.ScMapEntry({
      key: xdr.ScVal.scvSymbol("issuer"),
      val: Address.fromString(ISSUER).toScVal(),
    }),
  ]);
}

function normalizeTokenStatus(value) {
  if (Array.isArray(value)) {
    return value[0];
  }
  return value;
}

async function simulate(contract, functionName, args = []) {
  const tx = new TransactionBuilder(
    await server.getAccount(deployer.publicKey()),
    { networkPassphrase: NETWORK, fee: "10000000" },
  )
    .addOperation(
      Operation.invokeContractFunction({
        contract,
        function: functionName,
        args,
      }),
    )
    .setTimeout(300)
    .build();

  const result = await server.simulateTransaction(tx);

  if (result.error) {
    throw new Error(
      `${contract}::${functionName}() simulation failed: ${result.error}`,
    );
  }

  if (!result.result?.retval) {
    throw new Error(`${contract}::${functionName}() returned no value`);
  }

  return scValToNative(result.result.retval);
}

async function main() {
  console.log("XRP262 FINAL MAINNET CONTROL VERIFICATION");
  console.log("=========================================");
  console.log("LEXORA:", LEXORA);
  console.log("SAC:", SAC);
  console.log("Issuer:", ISSUER);
  console.log("Expected max supply: 900,000,000,000 XRP262");
  console.log("Expected burned: 426,026,808 XRP262");
  console.log("Expected circulating: 899,573,973,192 XRP262");
  console.log("");

  const configuredSac = await simulate(LEXORA, "xrp262_sac");
  const policy = await simulate(LEXORA, "xrp262_policy");
  const registryStatusRaw = await simulate(LEXORA, "token_status", [assetId()]);
  const registryStatus = normalizeTokenStatus(registryStatusRaw);
  const allowed = await simulate(LEXORA, "is_token_allowed", [assetId()]);
  const ownerBytes = await simulate(LEXORA, "owner");
  const onChainOwner = xdr.ScVal.scvBytes(Buffer.from(ownerBytes));
  const ownerAddress = Address.fromScAddress(
    xdr.ScAddress.sc_addressTypeContract()
      ? undefined
      : undefined,
  );
  const sacAdmin = await simulate(SAC, "admin");
  const lexoraBalance = BigInt(
    await simulate(SAC, "balance", [Address.fromString(LEXORA).toScVal()]),
  );

  const distributionBalance = BigInt(
    await simulate(SAC, "balance", [
      Address.fromString(distribution.publicKey).toScVal(),
    ]),
  );

  console.log("Configured SAC:", configuredSac);
  console.log("Policy:", policy);
  console.log("Registry status:", registryStatus);
  console.log("Token allowed:", allowed);
  console.log("SAC admin:", sacAdmin);
  console.log("LEXORA SAC balance (base units):", lexoraBalance);
  console.log(
    "Distribution SAC balance (base units):",
    distributionBalance,
  );
  console.log("");

  const maxSupply = BigInt(policy.max_supply ?? policy.maxSupply);
  const minted = BigInt(policy.minted);
  const burned = BigInt(policy.burned);
  const circulating = (minted - burned) / DECIMALS;

  if (configuredSac !== SAC) {
    throw new Error(`SAC binding mismatch: ${configuredSac}`);
  }

  if (maxSupply !== EXPECTED_MAX_SUPPLY) {
    throw new Error(
      `Max supply mismatch: ${maxSupply} != ${EXPECTED_MAX_SUPPLY}`,
    );
  }

  if (minted !== EXPECTED_MAX_SUPPLY) {
    throw new Error(
      `Minted mismatch: ${minted} != ${EXPECTED_MAX_SUPPLY}`,
    );
  }

  if (burned !== EXPECTED_BURNED) {
    throw new Error(
      `Burned mismatch: ${burned} != ${EXPECTED_BURNED}`,
    );
  }

  if (circulating !== EXPECTED_CIRCULATING) {
    throw new Error(
      `Circulating mismatch: ${circulating} != ${EXPECTED_CIRCULATING}`,
    );
  }

  if (registryStatus !== "Active" || !allowed) {
    throw new Error(
      `XRP262 registry is not Active/allowed: status=${registryStatus}, allowed=${allowed}`,
    );
  }

  if (sacAdmin !== LEXORA) {
    throw new Error(`SAC admin mismatch: ${sacAdmin}`);
  }

  if (lexoraBalance !== 0n) {
    throw new Error(`Unexpected LEXORA SAC balance: ${lexoraBalance}`);
  }

  const expectedDistributionBalance =
    EXPECTED_CIRCULATING * DECIMALS;

  if (distributionBalance !== expectedDistributionBalance) {
    throw new Error(
      `Distribution balance mismatch: ${distributionBalance} != ${expectedDistributionBalance}`,
    );
  }

  console.log("SAC binding: PASS");
  console.log("900B max supply: PASS");
  console.log("Minted: 900,000,000,000 XRP262: PASS");
  console.log("Burned: 426,026,808 XRP262: PASS");
  console.log("Circulating: 899,573,973,192 XRP262: PASS");
  console.log("Registry: ACTIVE: PASS");
  console.log("Token allowed: PASS");
  console.log("SAC admin = LEXORA: PASS");
  console.log("LEXORA XRP262 balance: 0: PASS");
  console.log(
    "Distribution balance = 899,573,973,192 XRP262: PASS",
  );
  console.log("");
  console.log("XRP262 FINAL MAINNET CONTROL CHECK: PASS");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
