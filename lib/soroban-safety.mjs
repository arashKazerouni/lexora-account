export function validateAssembledSorobanResources(prepared, simulatedInstructions, label) {
  const simulated = Number(simulatedInstructions);
  if (!Number.isFinite(simulated) || simulated <= 0) {
    throw new Error(`${label}: invalid simulated instruction requirement: ${simulatedInstructions}`);
  }

  let resources;
  try {
    const envelope = prepared.toEnvelope();
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
