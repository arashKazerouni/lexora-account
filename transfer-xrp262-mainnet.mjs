import {
  Keypair,
  Networks,
  Operation,
  TransactionBuilder,
  Address,
  scValToNative,
  StrKey,
  nativeToScVal,
} from "@stellar/stellar-sdk";
import { Server, assembleTransaction } from "@stellar/stellar-sdk/rpc";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const RPC_URL = "https://mainnet.sorobanrpc.com";
const NETWORK = Networks.PUBLIC;

const LEXORA =
  process.env.LEXORA_MAINNET_CONTRACT ??
  "CAJL2JO6EILWBTHDRMIQVJA6MTZIUWHOD6WNVJDN7FWTYD6H3NFXH542";

const SAC =
  "CC7L34EWYCTDCA3L7CRRULWX577UJWET32KNJFD2WTEQ4KD7IAUKHIS6";

const TRANSFER_AMOUNT = 426_026_808n * 10_000_000n;
const confirm = process.env.CONFIRM_XRP262_MAINNET_TRANSFER;

if (confirm !== "YES") {
  throw new Error(
    "Mainnet transfer is disabled by default. Set CONFIRM_XRP262_MAINNET_TRANSFER=YES only after reviewing the output.",
  );
}

const secretsPath = join(
  process.cwd(),
  ".secrets",
  "xrp262-distribution.json",
);

let secrets;
try {
  secrets = JSON.parse(readFileSync(secretsPath, "utf8"));
} catch {
  throw new Error(
    `Missing ${secretsPath}. Run npm run xrp262:generate-distribution first.`,
  );
}

if (!secrets.secretKey || !secrets.publicKey) {
  throw new Error("Distribution secret file is missing publicKey or secretKey.");
}

const distribution = Keypair.fromSecret(secrets.secretKey);
const deployer = process.env.LEXORA_DEPLOYER_SECRET
  ? Keypair.fromSecret(process.env.LEXORA_DEPLOYER_SECRET)
  : null;

if (!deployer) {
  throw new Error("Missing LEXORA_DEPLOYER_SECRET for fee sponsorship.");
}

if (distribution.publicKey() !== secrets.publicKey) {
  throw new Error("Distribution publicKey does not match the saved secretKey.");
}

if (!StrKey.isValidEd25519PublicKey(distribution.publicKey())) {
  throw new Error("Distribution public key is invalid.");
}

const server = new Server(RPC_URL);

async function simulate(contract, functionName, args = []) {
  const tx = new TransactionBuilder(
    await server.getAccount(distribution.publicKey()),
    { networkPassphrase: NETWORK, fee: process.env.SOROBAN_MAX_FEE_STROOPS ?? "100000000" },
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
  console.log("XRP262 MAINNET DISTRIBUTION → LEXORA TRANSFER");
  console.log("==============================================");
  console.log("Distribution:", distribution.publicKey());
  console.log("LEXORA:", LEXORA);
  console.log("SAC:", SAC);
  console.log("Amount:", TRANSFER_AMOUNT.toString(), "base units");
  console.log("Amount: 426,026,808 XRP262");
  console.log("");

  const distributionBalance = BigInt(
    await simulate(SAC, "balance", [
      Address.fromString(distribution.publicKey()).toScVal(),
    ]),
  );
  const lexoraBalanceBefore = BigInt(
    await simulate(SAC, "balance", [
      Address.fromString(LEXORA).toScVal(),
    ]),
  );
  const sacAdmin = await simulate(SAC, "admin");

  console.log("Distribution balance:", distributionBalance.toString());
  console.log("LEXORA balance before:", lexoraBalanceBefore.toString());
  console.log("SAC admin:", sacAdmin);

  if (sacAdmin !== LEXORA) {
    throw new Error(`SAC admin mismatch: ${sacAdmin}`);
  }

  if (distributionBalance < TRANSFER_AMOUNT) {
    throw new Error(
      `Distribution balance too low: ${distributionBalance}; need ${TRANSFER_AMOUNT}.`,
    );
  }

  const account = await server.getAccount(distribution.publicKey());
  const tx = new TransactionBuilder(account, {
    networkPassphrase: NETWORK,
    fee: process.env.SOROBAN_MAX_FEE_STROOPS ?? "100000000",
  })
    .addOperation(
      Operation.invokeContractFunction({
        contract: SAC,
        function: "transfer",
        args: [
          Address.fromString(distribution.publicKey()).toScVal(),
          Address.fromString(LEXORA).toScVal(),
          nativeToScVal(TRANSFER_AMOUNT.toString(), { type: "i128" }),
        ],
      }),
    )
    .setTimeout(300)
    .build();

  const simulation = await server.simulateTransaction(tx);

  if (simulation.error) {
    throw new Error(`Transfer simulation failed: ${simulation.error}`);
  }

  console.log("Simulation: PASS");

  // Rebuild the transaction from simulation resources before signing/submitting.
  const prepared = assembleTransaction(tx, simulation).build();
  prepared.sign(distribution);

  // The distribution account holds XRP262 and its XLM balance may be reserved
  // by the trustline. Sponsor the network/Soroban fee from the funded deployer
  // account so the asset treasury does not need excess XLM.
  const feeBump = TransactionBuilder.buildFeeBumpTransaction(
    deployer,
    prepared.fee,
    prepared,
    NETWORK,
  );
  feeBump.sign(deployer);

  console.log("Fee source:", deployer.publicKey());
  console.log("Submitting fee-bumped transaction to MAINNET...");
  const response = await server.sendTransaction(feeBump);
  console.log("Transaction hash:", response.hash);
  console.log("Status:", response.status);

  if (response.status === "ERROR") {
    throw new Error(JSON.stringify(response));
  }

  const result = await server.pollTransaction(response.hash);
  console.log("Final status:", result.status);

  if (result.status === "FAILED") {
    const failed = await server.getTransaction(response.hash);
    console.dir(failed, { depth: 10 });
    throw new Error("XRP262 distribution transfer failed.");
  }

  const distributionBalanceAfter = BigInt(
    await simulate(SAC, "balance", [
      Address.fromString(distribution.publicKey()).toScVal(),
    ]),
  );
  const lexoraBalanceAfter = BigInt(
    await simulate(SAC, "balance", [
      Address.fromString(LEXORA).toScVal(),
    ]),
  );

  if (distributionBalanceAfter !== distributionBalance - TRANSFER_AMOUNT) {
    throw new Error("Distribution balance post-transfer mismatch.");
  }

  if (lexoraBalanceAfter !== lexoraBalanceBefore + TRANSFER_AMOUNT) {
    throw new Error("LEXORA balance post-transfer mismatch.");
  }

  console.log("");
  console.log("XRP262 TRANSFER SUCCESS");
  console.log("=======================");
  console.log("Transaction:", response.hash);
  console.log("Distribution balance after:", distributionBalanceAfter.toString());
  console.log("LEXORA balance after:", lexoraBalanceAfter.toString());
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
