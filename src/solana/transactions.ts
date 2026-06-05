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

/** On-chain `Market.state` value meaning the outcome is finalized and claimable (constants.rs STATE_RESOLVED). */
const MARKET_STATE_RESOLVED = 3;

/**
 * Thrown by {@link executeClaimPayout} when a market is not yet resolved (still
 * active / pending resolution). The caller should leave the position in place and
 * retry on a later pass — it is NOT a terminal condition. Distinct from a
 * SimulationError so the claim engine can keep, rather than prune, the entry.
 */
export class MarketNotResolvedError extends Error {
  readonly marketState: number;
  constructor(marketState: number) {
    super(`market_not_resolved:${marketState}`);
    this.name = "MarketNotResolvedError";
    this.marketState = marketState;
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

const TOKEN_PROGRAM_ID_STR = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";
const SYSTEM_PROGRAM_ID_STR = "11111111111111111111111111111111";

function parseProgramError(
  logs: string[] | null | undefined
): { program?: "spl_token" | "system" | "other"; code?: string; detail?: string } {
  if (!logs) return {};
  let lamportDetail: string | undefined;
  let directError: string | undefined;
  for (const line of logs) {
    const t = line.match(/Transfer:\s+(insufficient lamports[^,]*,\s*need\s*\d+)/i);
    if (t) lamportDetail = t[1];
    const direct = line.match(/Program log: Error:\s+(.+?)\.?$/);
    if (direct && !directError) directError = direct[1];
  }
  for (const line of logs) {
    const m = line.match(/Program\s+(\S+)\s+failed:\s+custom program error:\s+0x([0-9a-fA-F]+)/);
    if (!m) continue;
    const programId = m[1];
    const num = Number.parseInt(m[2], 16);
    if (programId === TOKEN_PROGRAM_ID_STR) {
      return {
        program: "spl_token",
        code: SPL_TOKEN_ERRORS[num] ?? `0x${m[2]}`,
        detail: directError
      };
    }
    if (programId === SYSTEM_PROGRAM_ID_STR) {
      return {
        program: "system",
        code: lamportDetail ? "InsufficientLamports" : `0x${m[2]}`,
        detail: lamportDetail ?? directError
      };
    }
    return { program: "other", code: `${programId}:0x${m[2]}`, detail: directError };
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

export type MuResolution = {
  /** On-chain mu actually submitted (scaled i64), clamped into the market range. */
  mu: BN;
  /** Spot-derived center scaled to i64, before clamping. */
  requested: BN;
  /** True when `requested` fell outside [rangeMin, rangeMax] and was clamped. */
  clamped: boolean;
};

/**
 * Scale a human-unit center into the on-chain i64 fixed-point space and clamp
 * it into the market's valid [rangeMin, rangeMax] band.
 *
 * The bot derives `mu` from the external spot price, which can legitimately sit
 * outside a market's configured range (e.g. spot just below rangeMin). Rather
 * than rejecting the trade outright — which previously failed every buy with
 * `mu_outside_market_range` — we clamp to the nearest in-range bound so the bot
 * still nudges the curve toward the closest logical value. `clamped` is surfaced
 * (via TradeImpact) so callers can flag markets whose spot price is persistently
 * out of range, which usually signals a price/range unit mismatch in the market
 * definition itself.
 */
export function clampMu(value: number, rangeMin: BN, rangeMax: BN): MuResolution {
  const requested = new BN(scaleBigInt(value, "mu").toString());
  if (requested.lt(rangeMin)) {
    return { mu: rangeMin, requested, clamped: true };
  }
  if (requested.gt(rangeMax)) {
    return { mu: rangeMax, requested, clamped: true };
  }
  return { mu: requested, requested, clamped: false };
}

function scaleSigma(value: number): BN {
  const scaled = scaleBigInt(value, "sigma");
  if (scaled <= 0n) {
    throw new OutOfRangeError(`sigma_must_be_positive:${value}`);
  }
  return new BN(scaled.toString());
}

/** On-chain Gaussian tail cutoff (constants.rs `Z_CUTOFF`): bins with |z| > 5 get weight 0. */
const SIGMA_BIN_COVERAGE_Z = 5;

export type SigmaResolution = {
  /** On-chain sigma actually submitted (scaled i64), floored to keep ≥1 bin in range. */
  sigma: BN;
  /** Spot-derived spread scaled to i64, before flooring. */
  requested: BN;
  /** True when `requested` was below the bin-coverage floor and was bumped up. */
  floored: boolean;
};

/**
 * Scale a human-unit spread into the on-chain i64 fixed-point space and floor it
 * so the Gaussian covers at least one bin of the market.
 *
 * On-chain (`normal_pdf::compute_bin_weights`), a bin gets weight 0 when its
 * center is farther than `Z_CUTOFF * sigma` (= 5·sigma) from `mu`. Bin centers
 * are spaced `span / num_outcomes` apart, so the worst-case distance from any
 * in-range mu to the nearest bin center is half a bin width, `span / (2·n)`.
 * When `5·sigma` is below that, EVERY bin is cut off → all weights are zero →
 * the program aborts the buy/sell with `DivisionByZero(6032)` (amm.rs:208, the
 * `require!(w2 > 0)` guard, since w2 = Σ weight²).
 *
 * The bot derives `sigma` from the external spot price with no knowledge of the
 * market's range or bin count, so a market whose range is wide relative to spot
 * (a units mismatch, same class as the mu-clamp case) yields a spread too small
 * to land in any bin. We floor sigma to `span / (2·n·Z_CUTOFF)` — the minimum
 * that guarantees coverage for any in-range mu — and surface `floored` so callers
 * can flag the underlying market-definition issue. In normal operation sigma is
 * far above this floor and the value passes through untouched.
 */
export function resolveSigma(
  value: number,
  rangeMin: BN,
  rangeMax: BN,
  numOutcomes: number
): SigmaResolution {
  const requested = scaleSigma(value);
  const span = rangeMax.sub(rangeMin);
  if (numOutcomes <= 0 || span.lten(0)) {
    return { sigma: requested, requested, floored: false };
  }
  // ceil(span / (2 · numOutcomes · Z_CUTOFF)); always ≥ 1 since span > 0.
  const denom = new BN(2 * SIGMA_BIN_COVERAGE_Z * numOutcomes);
  const minSigma = span.add(denom).subn(1).div(denom);
  if (requested.lt(minSigma)) {
    return { sigma: minSigma, requested, floored: true };
  }
  return { sigma: requested, requested, floored: false };
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
    marketAccount,
    collateralMint,
    traderAta,
    decimals,
    rangeMin: marketAccount.rangeMin as BN,
    rangeMax: marketAccount.rangeMax as BN,
    numOutcomes: Number(marketAccount.numOutcomes as number)
  };
}

export type TradeImpact = {
  decimals: number;
  rangeMin: string;
  rangeMax: string;
  collateralBaseUnits: string;
  before: { totalMinted: string; kSquared: string; lpSharesTotal: string };
  after: { totalMinted: string; kSquared: string; lpSharesTotal: string };
  delta: { totalMinted: string; kSquared: string; lpSharesTotal: string };
  /** Tokens transacted (delta of total_minted) in human units. */
  tokensTransacted: number;
  /** Effective per-token price = collateral / tokensTransacted, in collateral human units. */
  effectivePrice: number | null;
  /** k_squared post / pre — scalar curvature change. */
  kSquaredRatio: number | null;
  /** mu actually submitted (scaled i64), after range clamping. */
  muApplied: string;
  /** Spot-derived mu (scaled i64) before clamping. */
  muRequested: string;
  /** True when the requested mu was outside [rangeMin, rangeMax] and clamped. */
  muClamped: boolean;
  /** sigma actually submitted (scaled i64), after the bin-coverage floor. */
  sigmaApplied: string;
  /** Spot-derived sigma (scaled i64) before flooring. */
  sigmaRequested: string;
  /** True when the requested sigma was below the bin-coverage floor and bumped up. */
  sigmaFloored: boolean;
};

function snapshot(account: { totalMinted: BN; kSquared: BN; lpSharesTotal: BN }) {
  return {
    totalMinted: (account.totalMinted as BN).toString(),
    kSquared: (account.kSquared as BN).toString(),
    lpSharesTotal: (account.lpSharesTotal as BN).toString()
  };
}

function computeImpact(args: {
  before: ReturnType<typeof snapshot>;
  after: ReturnType<typeof snapshot>;
  decimals: number;
  rangeMin: BN;
  rangeMax: BN;
  muApplied: BN;
  muRequested: BN;
  muClamped: boolean;
  sigmaApplied: BN;
  sigmaRequested: BN;
  sigmaFloored: boolean;
  /** Collateral paid (buy) — omit for sells where collateral received isn't known here. */
  collateralBaseUnits?: string;
}): TradeImpact {
  const beforeMinted = BigInt(args.before.totalMinted);
  const afterMinted = BigInt(args.after.totalMinted);
  const mintedDelta = afterMinted - beforeMinted;
  const absMintedDelta = mintedDelta < 0n ? -mintedDelta : mintedDelta;
  const scale = 10 ** args.decimals;
  const tokensTransacted = Number(absMintedDelta) / scale;
  let effectivePrice: number | null = null;
  if (args.collateralBaseUnits !== undefined && tokensTransacted > 0) {
    const collateralHuman = Number(BigInt(args.collateralBaseUnits)) / scale;
    effectivePrice = collateralHuman / tokensTransacted;
  }

  const beforeK = BigInt(args.before.kSquared);
  const afterK = BigInt(args.after.kSquared);
  const kSquaredRatio = beforeK > 0n ? Number(afterK) / Number(beforeK) : null;

  const beforeLp = BigInt(args.before.lpSharesTotal);
  const afterLp = BigInt(args.after.lpSharesTotal);

  return {
    decimals: args.decimals,
    rangeMin: args.rangeMin.toString(),
    rangeMax: args.rangeMax.toString(),
    collateralBaseUnits: args.collateralBaseUnits ?? "",
    before: args.before,
    after: args.after,
    delta: {
      totalMinted: (afterMinted - beforeMinted).toString(),
      kSquared: (afterK - beforeK).toString(),
      lpSharesTotal: (afterLp - beforeLp).toString()
    },
    tokensTransacted,
    effectivePrice,
    kSquaredRatio,
    muApplied: args.muApplied.toString(),
    muRequested: args.muRequested.toString(),
    muClamped: args.muClamped,
    sigmaApplied: args.sigmaApplied.toString(),
    sigmaRequested: args.sigmaRequested.toString(),
    sigmaFloored: args.sigmaFloored
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
        const prog = parseProgramError(logs);
        if (prog.program && prog.code) {
          parts.push(`${prog.program}=${prog.code}`);
          if (prog.detail) parts.push(`detail="${prog.detail}"`);
        }
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

export type TradeResult = { txId: string; impact?: TradeImpact };

async function fetchSnapshotSafe(
  program: Program<DekantPm>,
  marketPubkey: PublicKey
): Promise<ReturnType<typeof snapshot> | null> {
  try {
    const account = await program.account.market.fetch(marketPubkey);
    return snapshot(account as unknown as { totalMinted: BN; kSquared: BN; lpSharesTotal: BN });
  } catch {
    return null;
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
): Promise<TradeResult> {
  const {
    accounts,
    marketAccount,
    collateralMint,
    traderAta,
    decimals,
    rangeMin,
    rangeMax,
    numOutcomes
  } = await resolveAccounts(program, programId, marketPubkey, trader, resolveDecimals);
  const collateralBaseUnits = toBaseUnitsBN(amount, decimals);
  const muResolution = clampMu(mu, rangeMin, rangeMax);
  const sigmaResolution = resolveSigma(sigma, rangeMin, rangeMax, numOutcomes);
  const builder = program.methods
    .buyDistribution({
      mu: muResolution.mu,
      sigma: sigmaResolution.sigma,
      collateralAmount: collateralBaseUnits
    })
    .accountsPartial({ ...accounts, systemProgram: SystemProgram.programId })
    .preInstructions([
      ComputeBudgetProgram.setComputeUnitLimit({ units: 1_400_000 }),
      ComputeBudgetProgram.setComputeUnitPrice({ microLamports: priorityFeeMicroLamports() }),
      ensureTraderAtaIx(trader, traderAta, collateralMint)
    ]);

  await simulateOrThrow(program, builder);

  const before = snapshot(
    marketAccount as unknown as { totalMinted: BN; kSquared: BN; lpSharesTotal: BN }
  );
  const txId = await builder.rpc({ skipPreflight: false, maxRetries: 3, commitment: "confirmed" });
  const after = await fetchSnapshotSafe(program, marketPubkey);
  const impact = after
    ? computeImpact({
        before,
        after,
        decimals,
        rangeMin,
        rangeMax,
        muApplied: muResolution.mu,
        muRequested: muResolution.requested,
        muClamped: muResolution.clamped,
        sigmaApplied: sigmaResolution.sigma,
        sigmaRequested: sigmaResolution.requested,
        sigmaFloored: sigmaResolution.floored,
        collateralBaseUnits: collateralBaseUnits.toString()
      })
    : undefined;
  return { txId, impact };
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
): Promise<TradeResult> {
  const {
    accounts,
    marketAccount,
    collateralMint,
    traderAta,
    decimals,
    rangeMin,
    rangeMax,
    numOutcomes
  } = await resolveAccounts(program, programId, marketPubkey, trader, resolveDecimals);
  const tokenAmountBaseUnits = toBaseUnitsBN(tokenAmount, decimals);
  const muResolution = clampMu(mu, rangeMin, rangeMax);
  const sigmaResolution = resolveSigma(sigma, rangeMin, rangeMax, numOutcomes);
  const builder = program.methods
    .sellDistribution({
      mu: muResolution.mu,
      sigma: sigmaResolution.sigma,
      tokenAmount: tokenAmountBaseUnits
    })
    .accountsPartial(accounts)
    .preInstructions([
      ComputeBudgetProgram.setComputeUnitLimit({ units: 1_400_000 }),
      ComputeBudgetProgram.setComputeUnitPrice({ microLamports: priorityFeeMicroLamports() }),
      ensureTraderAtaIx(trader, traderAta, collateralMint)
    ]);

  await simulateOrThrow(program, builder);

  const before = snapshot(
    marketAccount as unknown as { totalMinted: BN; kSquared: BN; lpSharesTotal: BN }
  );
  const txId = await builder.rpc({ skipPreflight: false, maxRetries: 3, commitment: "confirmed" });
  const after = await fetchSnapshotSafe(program, marketPubkey);
  const impact = after
    ? computeImpact({
        before,
        after,
        decimals,
        rangeMin,
        rangeMax,
        muApplied: muResolution.mu,
        muRequested: muResolution.requested,
        muClamped: muResolution.clamped,
        sigmaApplied: sigmaResolution.sigma,
        sigmaRequested: sigmaResolution.requested,
        sigmaFloored: sigmaResolution.floored
      })
    : undefined;
  return { txId, impact };
}

export type ClaimResult = { txId: string };

/**
 * Claim a bot's payout from a RESOLVED market via the `claim_payout` instruction
 * (no args — the on-chain handler computes the payout from market resolution +
 * the bot's holdings). Its accounts are a strict subset of {@link resolveAccounts}'
 * output, so we reuse the same resolver.
 *
 * Guards on the market account we already fetch: if the market is not resolved
 * yet, throws {@link MarketNotResolvedError} BEFORE building/simulating, so no
 * doomed transaction is sent. Double-claim is impossible on-chain (the
 * `user_position.claimed` flag) — a second attempt simulates to `AlreadyClaimed`,
 * which the caller treats as terminal. An already-existing trader ATA is fine;
 * the idempotent create instruction is a no-op then.
 */
export async function executeClaimPayout(
  program: Program<DekantPm>,
  programId: PublicKey,
  marketPubkey: PublicKey,
  trader: PublicKey,
  resolveDecimals: DecimalsResolver
): Promise<ClaimResult> {
  const { accounts, collateralMint, traderAta, marketAccount } = await resolveAccounts(
    program,
    programId,
    marketPubkey,
    trader,
    resolveDecimals
  );

  const marketState = Number(marketAccount.state as number);
  if (marketState !== MARKET_STATE_RESOLVED) {
    throw new MarketNotResolvedError(marketState);
  }

  const builder = program.methods
    .claimPayout()
    .accountsPartial(accounts)
    .preInstructions([
      ComputeBudgetProgram.setComputeUnitLimit({ units: 400_000 }),
      ComputeBudgetProgram.setComputeUnitPrice({ microLamports: priorityFeeMicroLamports() }),
      ensureTraderAtaIx(trader, traderAta, collateralMint)
    ]);

  await simulateOrThrow(program, builder);

  const txId = await builder.rpc({ skipPreflight: false, maxRetries: 3, commitment: "confirmed" });
  return { txId };
}
