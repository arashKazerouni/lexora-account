export function requireMainnetConfirmation(name, value) {
  if (value !== "YES") {
    throw new Error(
      `MAINNET mutation blocked. Set ${name}=YES only after reviewing the printed preflight and simulation output.`,
    );
  }
}

