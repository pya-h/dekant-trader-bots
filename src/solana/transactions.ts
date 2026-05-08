import {
  PublicKey,
  SystemProgram,
  ComputeBudgetProgram,
  Transaction
} from "@solana/web3.js";
import anchorPkg, { Program } from "@coral-xyz/anchor";
import { createAssociatedTokenAccountIdempotentInstruction } from "@solana/spl-token";
const { BN } = anchorPkg;
type BN = InstanceType<typeof anchorPkg.BN>;
import type { DekantPm } from "./program/dekant_pm.js";
import {
  deriveProtocolConfig,
  deriveUserPosition,
  deriveVaultAuthority
} from "./pdas.js";
import { toBaseUnitsBN } from "./units.js";

const TOKEN_PROGRAM_ID = new PublicKey("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA");
const ASSOCIATED_TOKEN_PROGRAM_ID = new PublicKey("ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL");

const SCALE = 1_000_000_000n;

function priorityFeeMicroLamports(): number {
  const raw = process.env.PRIORITY_FEE_MICROLAMPORTS;
  if (!raw) return 1000;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed >= 0 ? Math.floor(parsed) : 1000;
}

export class OutOfRangeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "OutOfRangeError";
  }
}

export class SimulationError extends Error {
  readonly logs?: string[];
  readonly anchorAccount?: string;
  readonly anchorErrorCode?: string;
  readonly anchorErrorNumber?: number;
  constructor(
    message: string,
    logs?: string[],
    anchor?: { account?: string; code?: string; number?: number }
  ) {
    super(message);
    this.name = "SimulationError";
    this.logs = logs;
    this.anchorAccount = anchor?.account;
    this.anchorErrorCode = anchor?.code;
    this.anchorErrorNumber = anchor?.number;
  }
}

function parseAnchorError(logs: string[] | null | undefined): {
  account?: string;
  code?: string;
  number?: number;
  message?: string;
} {
  if (!logs) return {};
  const out: { account?: string; code?: string; number?: number; message?: string } = {};
  for (const line of logs) {
    const acc = line.match(/AnchorError caused by account:\s*([A-Za-z0-9_]+)/);
    if (acc) out.account = acc[1];
    const code = line.match(/Error Code:\s*([A-Za-z0-9_]+)/);
    if (code) out.code = code[1];
    const num = line.match(/Error Number:\s*(\d+)/);
    if (num) out.number = Number(num[1]);
    const msg = line.match(/Error Message:\s*(.+?)\.?$/);
    if (msg) out.message = msg[1];
  }
  return out;
}

const SPL_TOKEN_ERRORS: Record<number, string> = {
  0x0: "NotRentExempt",
  0x1: "InsufficientFunds",
  0x2: "InvalidMint",
  0x3: "MintMismatch",
  0x4: "OwnerMismatch",
  0x5: "FixedSupply",
  0x6: "AlreadyInUse",
  0x7: "InvalidNumberOfProvidedSigners",
  0x8: "InvalidNumberOfRequiredSigners",
  0x9: "UninitializedState",
  0xa: "NativeNotSupported",
  0xb: "NonNativeHasBalance",
  0xc: "InvalidInstruction",
  0xd: "InvalidState",
  0xe: "Overflow",
  0xf: "AuthorityTypeNotSupported",
  0x10: "MintCannotFreeze",
  0x11: "AccountFrozen",
  0x12: "MintDecimalsMismatch",
  0x13: "NonNativeNotSupported"
};

function parseSplTokenError(logs: string[] | null | undefined): { code?: string; line?: string } {
  if (!logs) return {};
  for (const line of logs) {
    const m = line.match(/Token[^\s]*\s+failed:\s+custom program error:\s+0x([0-9a-fA-F]+)/);
    if (m) {
      const num = Number.parseInt(m[1], 16);
      return { code: SPL_TOKEN_ERRORS[num] ?? `0x${m[1]}`, line };
    }
    const direct = line.match(/Program log: Error:\s+(.+?)\.?$/);
    if (direct) return { code: direct[1].replace(/\s+/g, ""), line };
  }
  return {};
}

function getAta(mint: PublicKey, owner: PublicKey): PublicKey {
  const [address] = PublicKey.findProgramAddressSync(
    [owner.toBuffer(), TOKEN_PROGRAM_ID.toBuffer(), mint.toBuffer()],
    ASSOCIATED_TOKEN_PROGRAM_ID
  );
  return address;
}

function scaleBigInt(value: number, label: string): bigint {
  if (!Number.isFinite(value)) {
    throw new OutOfRangeError(`${label}_not_finite`);
  }
  // BigInt arithmetic so we cover the full i64 range (~±9.2e9 in human units)
  // instead of being capped by Number.MAX_SAFE_INTEGER (~±9e6 scaled).
  const sign = value < 0 ? -1n : 1n;
  const abs = Math.abs(value);
  const whole = BigInt(Math.trunc(abs));
  const frac = BigInt(Math.round((abs - Math.trunc(abs)) * Number(SCALE)));
  return sign * (whole * SCALE + frac);
}

function scaleMu(value: number, rangeMin: BN, rangeMax: BN): BN {
  const scaled = scaleBigInt(value, "mu");
  const bn = new BN(scaled.toString());
  if (bn.lt(rangeMin) || bn.gt(rangeMax)) {
    throw new OutOfRangeError(
      `mu_outside_market_range:${value}:[${rangeMin.toString()},${rangeMax.toString()}]`
    );
  }
  return bn;
}

function scaleSigma(value: number): BN {
  const scaled = scaleBigInt(value, "sigma");
  if (scaled <= 0n) {
    throw new OutOfRangeError(`sigma_must_be_positive:${value}`);
  }
  return new BN(scaled.toString());
}

export type DecimalsResolver = (mint: string) => Promise<number>;

async function resolveAccounts(
  program: Program<DekantPm>,
  programId: PublicKey,
  marketPubkey: PublicKey,
  trader: PublicKey,
  resolveDecimals: DecimalsResolver
) {
  const marketAccount = await program.account.market.fetch(marketPubkey);
  const [protocolConfig] = deriveProtocolConfig(programId);
  const [userPosition] = deriveUserPosition(programId, marketPubkey, trader);
  const [vaultAuthority] = deriveVaultAuthority(programId, marketPubkey);
  const collateralMint = marketAccount.collateralMint as PublicKey;
  const traderAta = getAta(collateralMint, trader);
  const decimals = await resolveDecimals(collateralMint.toBase58());

  return {
    accounts: {
      trader,
      market: marketPubkey,
      protocolConfig,
      userPosition,
      vaultAuthority,
      vault: marketAccount.vault as PublicKey,
      traderAta,
      tokenProgram: TOKEN_PROGRAM_ID
    },
    collateralMint,
    traderAta,
    decimals,
    rangeMin: marketAccount.rangeMin as BN,
    rangeMax: marketAccount.rangeMax as BN
  };
}

function ensureTraderAtaIx(trader: PublicKey, traderAta: PublicKey, mint: PublicKey) {
  return createAssociatedTokenAccountIdempotentInstruction(
    trader,
    traderAta,
    trader,
    mint,
    TOKEN_PROGRAM_ID,
    ASSOCIATED_TOKEN_PROGRAM_ID
  );
}

async function simulateOrThrow(
  program: Program<DekantPm>,
  builder: { transaction: () => Promise<Transaction> }
): Promise<void> {
  const tx: Transaction = await builder.transaction();
  const provider = program.provider;
  if (!provider.connection) return;
  const wallet = provider.publicKey;
  if (wallet) {
    tx.feePayer = wallet;
  }
  try {
    const sim = await provider.connection.simulateTransaction(tx, undefined);
    if (sim.value.err) {
      const logs = sim.value.logs ?? undefined;
      const anchor = parseAnchorError(logs);
      const parts = [`simulate_failed:${JSON.stringify(sim.value.err)}`];
      if (anchor.code) {
        parts.push(`anchor=${anchor.code}${anchor.number !== undefined ? `(${anchor.number})` : ""}`);
      }
      if (anchor.account) parts.push(`account=${anchor.account}`);
      if (anchor.message) parts.push(`reason="${anchor.message}"`);
      if (!anchor.code) {
        const spl = parseSplTokenError(logs);
        if (spl.code) parts.push(`spl_token=${spl.code}`);
      }
      throw new SimulationError(parts.join(" "), logs, anchor);
    }
  } catch (error) {
    if (error instanceof SimulationError) throw error;
    throw new SimulationError(
      error instanceof Error ? `simulate_threw:${error.message}` : "simulate_threw"
    );
  }
}

export async function executeBuyDistribution(
  program: Program<DekantPm>,
  programId: PublicKey,
  marketPubkey: PublicKey,
  trader: PublicKey,
  mu: number,
  sigma: number,
  amount: string,
  resolveDecimals: DecimalsResolver
): Promise<string> {
  const { accounts, collateralMint, traderAta, decimals, rangeMin, rangeMax } =
    await resolveAccounts(program, programId, marketPubkey, trader, resolveDecimals);
  const builder = program.methods
    .buyDistribution({
      mu: scaleMu(mu, rangeMin, rangeMax),
      sigma: scaleSigma(sigma),
      collateralAmount: toBaseUnitsBN(amount, decimals)
    })
    .accountsPartial({ ...accounts, systemProgram: SystemProgram.programId })
    .preInstructions([
      ComputeBudgetProgram.setComputeUnitLimit({ units: 1_400_000 }),
      ComputeBudgetProgram.setComputeUnitPrice({ microLamports: priorityFeeMicroLamports() }),
      ensureTraderAtaIx(trader, traderAta, collateralMint)
    ]);

  await simulateOrThrow(program, builder);

  return builder.rpc({ skipPreflight: false, maxRetries: 3, commitment: "confirmed" });
}

export async function executeSellDistribution(
  program: Program<DekantPm>,
  programId: PublicKey,
  marketPubkey: PublicKey,
  trader: PublicKey,
  mu: number,
  sigma: number,
  tokenAmount: string,
  resolveDecimals: DecimalsResolver
): Promise<string> {
  const { accounts, collateralMint, traderAta, decimals, rangeMin, rangeMax } =
    await resolveAccounts(program, programId, marketPubkey, trader, resolveDecimals);
  const builder = program.methods
    .sellDistribution({
      mu: scaleMu(mu, rangeMin, rangeMax),
      sigma: scaleSigma(sigma),
      tokenAmount: toBaseUnitsBN(tokenAmount, decimals)
    })
    .accountsPartial(accounts)
    .preInstructions([
      ComputeBudgetProgram.setComputeUnitLimit({ units: 1_400_000 }),
      ComputeBudgetProgram.setComputeUnitPrice({ microLamports: priorityFeeMicroLamports() }),
      ensureTraderAtaIx(trader, traderAta, collateralMint)
    ]);

  await simulateOrThrow(program, builder);

  return builder.rpc({ skipPreflight: false, maxRetries: 3, commitment: "confirmed" });
}
