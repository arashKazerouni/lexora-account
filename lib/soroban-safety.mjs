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
    // Transaction.toEnvelope() returns a plain JS object in the installed SDK
    // rather than an XDR union with switch(). Rehydrate the canonical XDR
    // envelope so the resource extension can be inspected reliably.
    const envelope = xdr.TransactionEnvelope.fromXDR(prepared.toXDR(), "base64");
    const envelopeType = envelope.switch().name;
    let txBody = null;

    if (envelopeType === "tx") {
      txBody = envelope.tx();
    } else if (envelopeType === "txFeeBump") {
      txBody = envelope.tx().innerTx().v1().tx();
    }

    if (!txBody) throw new Error(`unsupported envelope type: ${envelopeType}`);

    const ext = txBody.ext();
    const extType = ext.switch().name;
    if (extType === "sorobanTransactionData" || extType === "sorobanTransactionDataSigned") {
      resources = ext.sorobanData().resources();
    }
  } catch (error) {
    throw new Error(`${label}: could not inspect assembled Soroban resources: ${error.message}`);
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
