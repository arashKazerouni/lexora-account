import {
  Keypair,
  Networks,
  Operation,
  TransactionBuilder,
  Address,
  nativeToScVal,
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
  "CC7L34EWYCTDCA3L7CRRULWX577UJWET32KNJFD2WTEQ4KD7IAUKHIS6";

const ISSUER =
  "GCGVZEE7RD2BFF2EIQUT37DYJUR7WDCQ2KWA5LUWYATRFLKEYHMJ3XRP";

const EXPECTED_OWNER =
  "GCGJIJ4YYQR7ROEVXW4QNPN3E2C7AJMTQA7KVA2BMX7JGWFJAYTSFDFU";

const EXPECTED_MAX_SUPPLY = 900_000_000_000n * 10_000_000n;

const amountText = process.env.XRP262_MINT_AMOUNT;
if (!amountText || !/^\d+$/.test(amountText) || BigInt(amountText) <= 0n) {
  throw new Error(
    "Set XRP262_MINT_AMOUNT to a positive integer in base units before running preflight.",
  );
}
const MINT_AMOUNT = BigInt(amountText);

if (!process.env.LEXORA_DEPLOYER_SECRET) {
  throw new Error("Missing LEXORA_DEPLOYER_SECRET.");
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

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function main() {
  console.log("XRP262 MAINNET PRE-MINT PREFLIGHT");
  console.log("================================");
  console.log("LEXORA:", LEXORA);
  console.log("SAC:", SAC);
  console.log("Issuer:", ISSUER);
  console.log("Planned mint:", MINT_AMOUNT.toString(), "base units");
  const whole = MINT_AMOUNT / 10_000_000n;
  const fraction = (MINT_AMOUNT % 10_000_000n)
    .toString()
    .padStart(7, "0")
    .replace(/0+$/, "");
  const humanAmount = fraction ? `${whole}.${fraction}` : whole.toString();
  console.log("Planned mint:", humanAmount, "XRP262");
  console.log("");

  const ownerBytes = await simulate(LEXORA, "owner");
  const owner = StrKey.encodeEd25519PublicKey(Buffer.from(ownerBytes));
  const configuredSac = await simulate(LEXORA, "xrp262_sac");
  const policy = await simulate(LEXORA, "xrp262_policy");
  const registryStatus = await simulate(LEXORA, "token_status", [assetId()]);
  const allowed = await simulate(LEXORA, "is_token_allowed", [assetId()]);
  const canMint = await simulate(LEXORA, "can_mint_xrp262", [
    nativeToScVal(MINT_AMOUNT.toString(), { type: "i128" }),
  ]);
  const sacAdmin = await simulate(SAC, "admin");
  const lexoraBalance = await simulate(SAC, "balance", [
    Address.fromString(LEXORA).toScVal(),
  ]);

  const maxSupply = BigInt(policy.max_supply ?? policy.maxSupply);
  const minted = BigInt(policy.minted);
  const burned = BigInt(policy.burned);

  console.log("Owner:", owner);
  console.log("Configured SAC:", configuredSac);
  console.log("Policy:", policy);
  console.log("Registry:", registryStatus);
  console.log("Allowed:", allowed);
  console.log("can_mint_xrp262(amount):", canMint);
  console.log("SAC admin:", sacAdmin);
  console.log("LEXORA SAC balance:", lexoraBalance);
  console.log("");

  assert(owner === EXPECTED_OWNER, `Owner mismatch: ${owner}`);
  assert(configuredSac === SAC, `SAC mismatch: ${configuredSac}`);
  assert(maxSupply === EXPECTED_MAX_SUPPLY, "Max supply mismatch");
  assert(minted === 0n, `Expected minted=0, got ${minted}`);
  assert(burned === 0n, `Expected burned=0, got ${burned}`);
  assert(policy.minting_enabled === true, "Minting is disabled");
  assert(policy.paused === false, "Minting is paused");
  assert(policy.clawback_enabled === false, "Clawback must remain disabled");
  assert(registryStatus === "Active", `Registry status is ${registryStatus}`);
  assert(allowed === true, "XRP262 is not allowed by registry");
  assert(sacAdmin === LEXORA, `SAC admin mismatch: ${sacAdmin}`);
  assert(BigInt(lexoraBalance) === 0n, "LEXORA already holds XRP262");
  assert(MINT_AMOUNT <= EXPECTED_MAX_SUPPLY, "Planned mint exceeds max supply");
  assert(canMint === true, "Lexora policy rejects the planned mint");

  console.log("Owner: PASS");
  console.log("SAC binding: PASS");
  console.log("SAC admin = LEXORA: PASS");
  console.log("Policy: PASS");
  console.log("Registry: PASS");
  console.log("Mint amount: PASS");
  console.log("");
  console.log("XRP262 PRE-MINT PREFLIGHT: PASS");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
