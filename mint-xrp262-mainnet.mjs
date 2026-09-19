import {
  Keypair,
  Networks,
  Operation,
  TransactionBuilder,
  Address,
  authorizeEntry,
  checkAuthEntryReadiness,
  inspectAuthEntry,
  nativeToScVal,
  scValToNative,
  StrKey,
  xdr,
} from "@stellar/stellar-sdk";
import { Server, assembleTransaction } from "@stellar/stellar-sdk/rpc";

const RPC_URL = "https://mainnet.sorobanrpc.com";
const NETWORK = Networks.PUBLIC;

const LEXORA =
  process.env.LEXORA_MAINNET_CONTRACT ??
  "CAJL2JO6EILWBTHDRMIQVJA6MTZIUWHOD6WNVJDN7FWTYD6H3NFXH542";

const SAC =
  "CC7L34EWYCTDCA3L7CRRULWX577UJWET32KNJFD2WTEQ4KD7IAUKHIS6";

const recipient = process.env.XRP262_MINT_RECIPIENT;
const amountText = process.env.XRP262_MINT_AMOUNT;
const confirm = process.env.CONFIRM_XRP262_MAINNET_MINT;

if (!recipient || !StrKey.isValidEd25519PublicKey(recipient)) {
  throw new Error("Set XRP262_MINT_RECIPIENT to a valid G... public key.");
}
if (!amountText || !/^\d+$/.test(amountText) || BigInt(amountText) <= 0n) {
  throw new Error("Set XRP262_MINT_AMOUNT to a positive integer in base units.");
}
if (confirm !== "YES") {
  throw new Error(
    "Mainnet minting is disabled by default. Set CONFIRM_XRP262_MAINNET_MINT=YES only after reviewing the preflight output.",
  );
}

const amount = BigInt(amountText);

if (!process.env.LEXORA_DEPLOYER_SECRET || !process.env.LEXORA_OWNER_SECRET) {
  throw new Error(
    "Missing LEXORA_DEPLOYER_SECRET or LEXORA_OWNER_SECRET.",
  );
}

const deployer = Keypair.fromSecret(process.env.LEXORA_DEPLOYER_SECRET);
const owner = Keypair.fromSecret(process.env.LEXORA_OWNER_SECRET);
const server = new Server(RPC_URL);

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
  console.log("XRP262 MAINNET MINT");
  console.log("==================");
  console.log("LEXORA:", LEXORA);
  console.log("SAC:", SAC);
  console.log("Recipient:", recipient);
  console.log("Amount:", amount.toString(), "base units");
  console.log("Amount:", Number(amount) / 10_000_000, "XRP262");
  console.log("");

  const policyBefore = await simulate(LEXORA, "xrp262_policy");
  const sacBefore = await simulate(LEXORA, "xrp262_sac");
  const adminBefore = await simulate(SAC, "admin");

  if (sacBefore !== SAC) throw new Error("Configured SAC mismatch.");
  if (adminBefore !== LEXORA) {
    throw new Error(`SAC admin mismatch: ${adminBefore}`);
  }
  if (policyBefore.minting_enabled !== true || policyBefore.paused !== false) {
    throw new Error("XRP262 minting is not enabled and unpaused.");
  }

  const mintedBefore = BigInt(policyBefore.minted);
  const burnedBefore = BigInt(policyBefore.burned);
  const maxSupply = BigInt(policyBefore.max_supply ?? policyBefore.maxSupply);

  if (mintedBefore !== 0n || burnedBefore !== 0n) {
    throw new Error(
      `This genesis mint script requires minted=0 and burned=0. Got minted=${mintedBefore}, burned=${burnedBefore}.`,
    );
  }
  if (amount > maxSupply) throw new Error("Mint exceeds max supply.");

  const account = await server.getAccount(deployer.publicKey());
  const tx = new TransactionBuilder(account, {
    networkPassphrase: NETWORK,
    fee: "10000000",
  })
    .addOperation(
      Operation.invokeContractFunction({
        contract: LEXORA,
        function: "mint_xrp262",
        args: [
          Address.fromString(recipient).toScVal(),
          nativeToScVal(amount.toString(), { type: "i128" }),
        ],
      }),
    )
    .setTimeout(300)
    .build();

  console.log("Simulating mint...");
  const simulation = await server.simulateTransaction(tx, {
    cpuInstructions: 2_000_000,
  });

  if (simulation.error) {
    throw new Error(`Mint simulation failed: ${simulation.error}`);
  }
  if (!simulation.result?.auth) {
    throw new Error("Mint simulation returned no authorization entries.");
  }

  console.log("Simulation: PASS");
  console.log("Auth entries:", simulation.result.auth.length);

  const validUntil = simulation.latestLedger + 60;

  simulation.result.auth = await Promise.all(
    simulation.result.auth.map(async (entry) => {
      const info = inspectAuthEntry(entry);
      console.log("Auth entry:", {
        address: info.address,
        credentialType: info.credentialType,
        nonce: info.nonce?.toString(),
        signers: info.signers.map((signer) => ({
          address: signer.address,
          signed: signer.signed,
        })),
      });

      if (info.address !== LEXORA) {
        throw new Error(
          `Unexpected auth address: ${info.address}; expected ${LEXORA}`,
        );
      }

      return authorizeEntry(
        entry,
        async (_preimage, signingHash) => {
          const signature = owner.sign(signingHash);
          if (!owner.verify(signingHash, signature)) {
            throw new Error("Local Ed25519 signature verification failed.");
          }

          return {
            signatureScVal: xdr.ScVal.scvBytes(signature),
            address: LEXORA,
          };
        },
        validUntil,
        NETWORK,
      );
    }),
  );

  for (const entry of simulation.result.auth) {
    const readiness = checkAuthEntryReadiness(
      entry,
      simulation.latestLedger,
    );
    if (!readiness.ready) {
      throw new Error(
        `Authorization entry is not ready: ${JSON.stringify(readiness)}`,
      );
    }
  }

  const prepared = assembleTransaction(tx, simulation).build();
  prepared.sign(deployer);

  console.log("Submitting to MAINNET...");
  const response = await server.sendTransaction(prepared);
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
    throw new Error("XRP262 mint transaction failed.");
  }

  const policyAfter = await simulate(LEXORA, "xrp262_policy");
  const mintedAfter = BigInt(policyAfter.minted);

  if (mintedAfter !== mintedBefore + amount) {
    throw new Error(
      `Post-mint accounting mismatch: expected ${mintedBefore + amount}, got ${mintedAfter}`,
    );
  }

  console.log("");
  console.log("XRP262 MINT SUCCESS");
  console.log("-------------------");
  console.log("Transaction:", response.hash);
  console.log("Minted before:", mintedBefore.toString());
  console.log("Minted after:", mintedAfter.toString());
  console.log("Recipient:", recipient);
  console.log("Amount:", amount.toString(), "base units");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
