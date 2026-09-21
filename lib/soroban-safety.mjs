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
    // The installed SDK's Transaction.toEnvelope() returns the XDR envelope
    // as a JS object with union accessors (v1/tx), not the raw xdr union.
    // Stellar's current SDK examples inspect Soroban data this way.
    const envelope = prepared.toEnvelope();
    const tx = envelope.v1?.()?.tx?.();
    const feeBumpTx = envelope.txFeeBump?.()?.tx?.()?.innerTx?.()?.v1?.()?.tx?.();
    const txBody = tx ?? feeBumpTx;

    if (!txBody) {
      throw new Error("unsupported transaction envelope shape");
    }

    resources = txBody.ext?.()?.sorobanData?.()?.resources?.();
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
