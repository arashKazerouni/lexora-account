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

const EXPECTED_OWNER =
  "GCGJIJ4YYQR7ROEVXW4QNPN3E2C7AJMTQA7KVA2BMX7JGWFJAYTSFDFU";

const DECIMALS = 10_000_000n;
const REQUESTED_BURN = 426_026_808n;
const TARGET_CIRCULATING = 899_573_973_192n;
const EXPECTED_CIRCULATING_BEFORE = 900_000_000_000n;
const BURN_BASE_UNITS = REQUESTED_BURN * DECIMALS;

const confirm = process.env.CONFIRM_XRP262_MAINNET_BURN;

if (confirm !== "YES") {
  throw new Error(
    "Mainnet burn is disabled by default. Set CONFIRM_XRP262_MAINNET_BURN=YES only after reviewing the preflight output.",
  );
}

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
    throw new Error(
      `${contract}::${functionName}() returned no value`,
    );
  }

  return scValToNative(result.result.retval);
}

async function main() {
  console.log("XRP262 MAINNET BURN PREFLIGHT");
  console.log("============================");
  console.log("LEXORA:", LEXORA);
  console.log("SAC:", SAC);
  console.log("Burn:", REQUESTED_BURN.toString(), "XRP262");
  console.log("Burn base units:", BURN_BASE_UNITS.toString());
  console.log("Target circulating:", TARGET_CIRCULATING.toString(), "XRP262");
  console.log("");

  const ownerBytes = await simulate(LEXORA, "owner");
  const onChainOwner = StrKey.encodeEd25519PublicKey(Buffer.from(ownerBytes));

  if (onChainOwner !== EXPECTED_OWNER) {
    throw new Error(`LEXORA owner mismatch: ${onChainOwner}`);
  }

  if (owner.publicKey() !== EXPECTED_OWNER) {
    throw new Error(`Wrong LEXORA_OWNER_SECRET: ${owner.publicKey()}`);
  }

  const policyBefore = await simulate(LEXORA, "xrp262_policy");
  const sacBefore = await simulate(LEXORA, "xrp262_sac");
  const adminBefore = await simulate(SAC, "admin");
  const lexoraBalance = BigInt(
    await simulate(SAC, "balance", [Address.fromString(LEXORA).toScVal()]),
  );

  if (sacBefore !== SAC) {
    throw new Error("Configured SAC mismatch.");
  }

  if (adminBefore !== LEXORA) {
    throw new Error(`SAC admin mismatch: ${adminBefore}`);
  }

  const mintedBefore = BigInt(policyBefore.minted);
  const burnedBefore = BigInt(policyBefore.burned);
  const maxSupply = BigInt(
    policyBefore.max_supply ?? policyBefore.maxSupply,
  );
  const circulatingBeforeBase = mintedBefore - burnedBefore;
  const circulatingBefore = circulatingBeforeBase / DECIMALS;

  console.log("Policy minted:", mintedBefore.toString(), "base units");
  console.log("Policy burned:", burnedBefore.toString(), "base units");
  console.log("Policy max supply:", maxSupply.toString(), "base units");
  console.log("Lexora XRP262 balance:", lexoraBalance.toString(), "base units");
  console.log("Current circulating:", circulatingBefore.toString(), "XRP262");
  console.log("");

  if (circulatingBefore !== EXPECTED_CIRCULATING_BEFORE) {
    throw new Error(
      `Unexpected current circulating supply: ${circulatingBefore}. Expected ${EXPECTED_CIRCULATING_BEFORE}.`,
    );
  }

  if (lexoraBalance < BURN_BASE_UNITS) {
    throw new Error(
      `Lexora balance is too low: ${lexoraBalance} base units; need ${BURN_BASE_UNITS}.`,
    );
  }

  if (circulatingBeforeBase - BURN_BASE_UNITS !== TARGET_CIRCULATING * DECIMALS) {
    throw new Error("Burn amount does not produce the requested target.");
  }

  console.log("Preconditions: PASS");
  console.log("Simulating burn_xrp262...");

  const account = await server.getAccount(deployer.publicKey());
  const tx = new TransactionBuilder(account, {
    networkPassphrase: NETWORK,
    fee: "10000000",
  })
    .addOperation(
      Operation.invokeContractFunction({
        contract: LEXORA,
        function: "burn_xrp262",
        args: [nativeToScVal(BURN_BASE_UNITS.toString(), { type: "i128" })],
      }),
    )
    .setTimeout(300)
    .build();

  const simulation = await server.simulateTransaction(tx, {
    cpuInstructions: 2_000_000,
  });

  if (simulation.error) {
    throw new Error(`Burn simulation failed: ${simulation.error}`);
  }

  if (!simulation.result?.auth) {
    throw new Error("Burn simulation returned no authorization entries.");
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

  console.log("");
  console.log("READY TO SUBMIT");
  console.log("================");
  console.log("The transaction has NOT been submitted yet.");
  console.log("Run this script with CONFIRM_XRP262_MAINNET_BURN=YES");
  console.log("after reviewing the preflight output.");
  console.log("");

  const response = await server.sendTransaction(prepared);
  console.log("Submitted to MAINNET.");
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
    throw new Error("XRP262 burn transaction failed.");
  }

  const policyAfter = await simulate(LEXORA, "xrp262_policy");
  const lexoraBalanceAfter = BigInt(
    await simulate(SAC, "balance", [Address.fromString(LEXORA).toScVal()]),
  );

  const mintedAfter = BigInt(policyAfter.minted);
  const burnedAfter = BigInt(policyAfter.burned);
  const circulatingAfter = (mintedAfter - burnedAfter) / DECIMALS;

  if (burnedAfter !== burnedBefore + BURN_BASE_UNITS) {
    throw new Error(
      `Post-burn accounting mismatch: expected ${burnedBefore + BURN_BASE_UNITS}, got ${burnedAfter}`,
    );
  }

  if (circulatingAfter !== TARGET_CIRCULATING) {
    throw new Error(
      `Post-burn supply mismatch: expected ${TARGET_CIRCULATING}, got ${circulatingAfter}`,
    );
  }

  console.log("");
  console.log("XRP262 BURN SUCCESS");
  console.log("==================");
  console.log("Transaction:", response.hash);
  console.log("Burned:", REQUESTED_BURN.toString(), "XRP262");
  console.log("Burned base units:", BURN_BASE_UNITS.toString());
  console.log("Circulating after:", circulatingAfter.toString(), "XRP262");
  console.log("Lexora balance after:", lexoraBalanceAfter.toString(), "base units");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
