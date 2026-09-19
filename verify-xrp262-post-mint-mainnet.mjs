import {
  Keypair,
  Networks,
  Operation,
  TransactionBuilder,
  Address,
  scValToNative,
  StrKey,
  xdr,
} from "@stellar/stellar-sdk";
import { Server } from "@stellar/stellar-sdk/rpc";

const RPC_URL = "https://mainnet.sorobanrpc.com";
const NETWORK = Networks.PUBLIC;

const LEXORA =
  process.env.LEXORA_MAINNET_CONTRACT ??
  "CAJL2JO6EILWBTHDRMIQVJA6MTZIUWHOD6WNVJDN7FWTYD6H3NFXH542";

const SAC =
  "CC7L34EWYCTDCA3L7CRRULWX577UJWET32KNFD2WTEQ4KD7IAUKHIS6";

const ISSUER =
  "GCGVZEE7RD2BFF2EIQUT37DYJUR7WDCQ2KWA5LUWYATRFLKEYHMJ3XRP";

const EXPECTED_MAX_SUPPLY = 900_000_000_000n * 10_000_000n;

const recipient = process.env.XRP262_MINT_RECIPIENT;
const amountText = process.env.XRP262_MINT_AMOUNT;
const txHash = process.env.XRP262_MINT_TX_HASH;

if (!recipient || !StrKey.isValidEd25519PublicKey(recipient)) {
  throw new Error("Set XRP262_MINT_RECIPIENT to the exact G... recipient.");
}

if (!amountText || !/^\d+$/.test(amountText) || BigInt(amountText) <= 0n) {
  throw new Error(
    "Set XRP262_MINT_AMOUNT to the exact positive base-unit amount that was minted.",
  );
}

const amount = BigInt(amountText);
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

async function simulate(contract, functionName, args = []) {
  const tx = new TransactionBuilder(
    await server.getAccount(
      process.env.LEXORA_DEPLOYER_PUBLIC_KEY ??
        "GCGJIJ4YYQR7ROEVXW4QNPN3E2C7AJMTQA7KVA2BMX7JGWFJAYTSFDFU",
    ),
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
  console.log("XRP262 POST-MINT MAINNET VERIFICATION");
  console.log("=====================================");
  console.log("Recipient:", recipient);
  console.log("Amount:", amount.toString(), "base units");
  if (txHash) console.log("Transaction:", txHash);
  console.log("");

  if (txHash) {
    const transaction = await server.getTransaction(txHash);
    if (transaction.status !== "SUCCESS") {
      throw new Error(
        `Mint transaction is not successful: ${transaction.status}`,
      );
    }
    console.log("Transaction status: SUCCESS");
  }

  const configuredSac = await simulate(LEXORA, "xrp262_sac");
  const policy = await simulate(LEXORA, "xrp262_policy");
  const registryStatus = await simulate(LEXORA, "token_status", [assetId()]);
  const allowed = await simulate(LEXORA, "is_token_allowed", [assetId()]);
  const sacAdmin = await simulate(SAC, "admin");
  const lexoraBalance = await simulate(SAC, "balance", [
    Address.fromString(LEXORA).toScVal(),
  ]);
  const recipientBalance = await simulate(SAC, "balance", [
    Address.fromString(recipient).toScVal(),
  ]);

  const maxSupply = BigInt(policy.max_supply ?? policy.maxSupply);
  const minted = BigInt(policy.minted);
  const burned = BigInt(policy.burned);

  console.log("Configured SAC:", configuredSac);
  console.log("Policy:", policy);
  console.log("Registry status:", registryStatus);
  console.log("Token allowed:", allowed);
  console.log("SAC admin:", sacAdmin);
  console.log("LEXORA balance:", lexoraBalance);
  console.log("Recipient balance:", recipientBalance);
  console.log("");

  if (configuredSac !== SAC) throw new Error("SAC binding mismatch.");
  if (maxSupply !== EXPECTED_MAX_SUPPLY) {
    throw new Error("Max supply mismatch.");
  }
  if (minted !== amount) {
    throw new Error(
      `Minted accounting mismatch: expected ${amount}, got ${minted}`,
    );
  }
  if (burned !== 0n) throw new Error(`Unexpected burned amount: ${burned}`);
  if (policy.minting_enabled !== true) {
    throw new Error("Minting unexpectedly disabled.");
  }
  if (policy.paused !== false) throw new Error("XRP262 is unexpectedly paused.");
  if (policy.clawback_enabled !== false) {
    throw new Error("Clawback unexpectedly enabled.");
  }
  if (registryStatus !== "Active") {
    throw new Error(`Registry status is ${registryStatus}`);
  }
  if (allowed !== true) throw new Error("XRP262 is not allowed.");
  if (sacAdmin !== LEXORA) throw new Error("SAC admin is not LEXORA.");
  if (BigInt(lexoraBalance) !== 0n) {
    throw new Error(`LEXORA unexpectedly holds XRP262: ${lexoraBalance}`);
  }
  if (BigInt(recipientBalance) < amount) {
    throw new Error(
      `Recipient balance mismatch: expected at least ${amount}, got ${recipientBalance}`,
    );
  }

  console.log("SAC binding: PASS");
  console.log("Policy accounting: PASS");
  console.log("Registry: ACTIVE");
  console.log("SAC admin = LEXORA: PASS");
  console.log("LEXORA XRP262 balance: 0");
  console.log("Recipient XRP262 balance: PASS");
  console.log("");
  console.log("XRP262 POST-MINT MAINNET VERIFICATION: PASS");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
