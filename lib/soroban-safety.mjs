import { xdr } from "@stellar/stellar-sdk";

export function validateAssembledSorobanResources(prepared, simulation, label) {
  let simulatedInstructions = simulation?.transactionData?.resources;

  if (typeof simulatedInstructions === "function") {
    simulatedInstructions = simulatedInstructions.call(simulation.transactionData);
  }

  if (typeof simulatedInstructions?.instructions === "function") {
    simulatedInstructions = simulatedInstructions.instructions();
  } else {
    simulatedInstructions = simulatedInstructions?.instructions;
  }

  if (
    simulatedInstructions === undefined ||
    simulatedInstructions === null
  ) {
    simulatedInstructions =
      simulation?.transactionData?._data?.resources?.instructions;
  }

  const simulated = Number(simulatedInstructions);
  if (!Number.isFinite(simulated) || simulated <= 0) {
    throw new Error(`${label}: invalid simulated instruction requirement: ${simulatedInstructions}`);
  }

  let resources;
  try {
    // @stellar/stellar-sdk 17.x uses class-based XDR objects.
    // Transaction.toEnvelope() returns a TransactionEnvelope object whose
    // discriminant is exposed as a property, not a legacy v1() method.
    // The assembled Transaction already exposes its underlying XDR transaction
    // through the public .tx getter, so inspect Soroban resources directly.
    const tx = prepared?.innerTransaction?.tx ?? prepared?.tx;
    const sorobanExt = tx?.ext;

    if (!tx || !sorobanExt) {
      throw new Error("assembled transaction has no transaction extension");
    }

    if (sorobanExt.type !== "sorobanData") {
      throw new Error(
        `assembled transaction has no Soroban data (extension type: ${sorobanExt.type ?? "unknown"})`,
      );
    }

    resources = sorobanExt.sorobanData?.resources;
  } catch (error) {
    throw new Error(
      `${label}: could not inspect assembled Soroban resources: ${error.message}`,
    );
  }

  const assembled = resources?.instructions;
  if (typeof assembled !== "number" && typeof assembled !== "bigint") {
    throw new Error(`${label}: assembled instruction limit is unavailable; refusing mainnet submission.`);
  }

  const assembledNumber = Number(assembled);
  if (!Number.isFinite(assembledNumber) || assembledNumber < simulated) {
    throw new Error(
      `${label}: assembled instruction limit ${assembledNumber} is below simulated requirement ${simulated}; refusing mainnet submission.`,
    );
  }

  console.log(`${label}: simulated instructions = ${simulated}`);
  console.log(`${label}: assembled instruction limit = ${assembledNumber}`);
  console.log(`${label}: resource safety gate PASSED`);
  return resources;
}
