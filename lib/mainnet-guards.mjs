export function requireMainnetConfirmation(name, value) {
  if (value !== "YES") {
    throw new Error(
      `MAINNET mutation blocked. Set ${name}=YES only after reviewing the printed preflight and simulation output.`,
    );
  }
}

export function getSorobanFee() {
  const raw = process.env.SOROBAN_MAX_FEE_STROOPS ?? "9000000";
  const fee = Number(raw);
  if (!Number.isSafeInteger(fee) || fee < 1 || fee >= 10_000_000) {
    throw new Error(
      `Invalid Soroban fee ceiling: ${raw}. It must be an integer below 10,000,000 stroops (<1 XLM).`,
    );
  }
  return String(fee);
}
