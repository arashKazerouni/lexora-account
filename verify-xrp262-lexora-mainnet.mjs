import {
  Keypair, Networks, Operation, TransactionBuilder, Address,
  scValToNative, StrKey, xdr,
} from "@stellar/stellar-sdk";
import { Server } from "@stellar/stellar-sdk/rpc";

const RPC_URL = "https://mainnet.sorobanrpc.com";
const NETWORK = Networks.PUBLIC;
const LEXORA = process.env.LEXORA_MAINNET_CONTRACT ||
  "CAJL2JO6EILWBTHDRMIQVJA6MTZIUWHOD6WNVJDN7FWTYD6H3NFXH542";
const SAC = "CC7L34EWYCTDCA3L7CRRULWX577UJWET32KNJFD2WTEQ4KD7IAUKHIS6";
const ISSUER = "GCGVZEE7RD2BFF2EIQUT37DYJUR7WDCQ2KWA5LUWYATRFLKEYHMJ3XRP";
const EXPECTED_MAX_SUPPLY = 900_000_000_000n * 10_000_000n;

if (!process.env.LEXORA_DEPLOYER_SECRET) throw new Error("Missing LEXORA_DEPLOYER_SECRET.");
const deployer = Keypair.fromSecret(process.env.LEXORA_DEPLOYER_SECRET);
const server = new Server(RPC_URL);

async function simulate(functionName, args = []) {
  const tx = new TransactionBuilder(await server.getAccount(deployer.publicKey()), {
    networkPassphrase: NETWORK, fee: "10000000",
  }).addOperation(Operation.invokeContractFunction({
    contract: functionName === "xrp262_sac" || functionName === "xrp262_policy" ||
      functionName === "token_status" || functionName === "is_token_allowed"
      ? LEXORA : SAC,
    function: functionName, args,
  })).setTimeout(300).build();
  const result = await server.simulateTransaction(tx);
  if (result.error) throw new Error(`${functionName}() simulation failed: ${result.error}`);
  if (!result.result?.retval) throw new Error(`${functionName}() returned no value`);
  return scValToNative(result.result.retval);
}

const assetId = xdr.ScVal.scvMap([
  new xdr.ScMapEntry({ key: xdr.ScVal.scvSymbol("code"), val: xdr.ScVal.scvString("XRP262") }),
  new xdr.ScMapEntry({ key: xdr.ScVal.scvSymbol("issuer"), val: Address.fromString(ISSUER).toScVal() }),
]);

async function main() {
  console.log("XRP262 / LEXORA FINAL MAINNET CONTROL CHECK");
  console.log("============================================");
  console.log("LEXORA:", LEXORA);
  console.log("SAC:", SAC);
  console.log("Issuer:", ISSUER);
  console.log("Expected total supply:", "900,000,000,000 XRP262");
  console.log("Expected max supply base units:", EXPECTED_MAX_SUPPLY.toString());
  console.log("");

  const sac = await simulate("xrp262_sac");
  const policy = await simulate("xrp262_policy");
  const status = await simulate("token_status", [assetId]);
  const allowed = await simulate("is_token_allowed", [assetId]);
  const admin = await simulate("admin");
  const balance = await simulate("balance", [Address.fromString(LEXORA).toScVal()]);

  console.log("Configured SAC:", sac);
  console.log("Policy:", policy);
  console.log("Registry status:", status);
  console.log("Token allowed:", allowed);
  console.log("SAC admin:", admin);
  console.log("LEXORA SAC balance (base units):", balance);
  console.log("");

  const maxSupply = BigInt(policy.max_supply ?? policy.maxSupply);
  const minted = BigInt(policy.minted);
  const burned = BigInt(policy.burned);

  if (sac !== SAC) throw new Error(`SAC mismatch: ${sac}`);
  if (maxSupply !== EXPECTED_MAX_SUPPLY) throw new Error(`Max supply mismatch: ${maxSupply}`);
  if (minted !== 0n || burned !== 0n) throw new Error(`Unexpected accounting: minted=${minted}, burned=${burned}`);
  if (!allowed) throw new Error("XRP262 is not active in the LEXORA registry.");
  if (admin !== LEXORA) throw new Error(`SAC admin mismatch: ${admin}`);
  if (BigInt(balance) !== 0n) throw new Error(`Unexpected LEXORA SAC balance: ${balance}`);

  console.log("SAC binding: PASS");
  console.log("900B max supply: PASS");
  console.log("Minted: 0");
  console.log("Burned: 0");
  console.log("Registry: ACTIVE");
  console.log("SAC admin = LEXORA: PASS");
  console.log("LEXORA XRP262 balance: 0");
  console.log("MAINNET CONTROL CHECK: PASS");
}
main().catch((err) => { console.error(err); process.exit(1); });
