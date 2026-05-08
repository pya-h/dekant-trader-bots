import pkg from "@coral-xyz/anchor";
const { BN } = pkg;
type BN = InstanceType<typeof pkg.BN>;

function splitAmount(amount: string, decimals: number): string {
  const trimmed = amount.trim();
  if (!/^\d+(\.\d+)?$/.test(trimmed)) {
    throw new Error(`invalid_amount:${amount}`);
  }
  const [whole = "0", frac = ""] = trimmed.split(".");
  const padded = (frac + "0".repeat(decimals)).slice(0, decimals);
  return whole + padded;
}

export function toBaseUnitsBN(amount: string, decimals: number): BN {
  return new BN(splitAmount(amount, decimals));
}

export function toBaseUnitsBigInt(amount: string, decimals: number): bigint {
  return BigInt(splitAmount(amount, decimals));
}
