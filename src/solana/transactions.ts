import {
  PublicKey,
  SystemProgram,
  ComputeBudgetProgram,
  Transaction
} from "@solana/web3.js";
import { Program, BN } from "@coral-xyz/anchor";
import type { DekantPm } from "./program/dekant_pm.js";
import {
  deriveProtocolConfig,
  deriveUserPosition,
  deriveVaultAuthority
} from "./pdas.js";
import { toBaseUnitsBN } from "./units.js";

const TOKEN_PROGRAM_ID = new PublicKey("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA");
const ASSOCIATED_TOKEN_PROGRAM_ID = new PublicKey("ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL");

const SCALE = 1_000_000_000;

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
  constructor(message: string, logs?: string[]) {
    super(message);
    this.name = "SimulationError";
    this.logs = logs;
  }
}

function getAta(mint: PublicKey, owner: PublicKey): PublicKey {
  const [address] = PublicKey.findProgramAddressSync(
    [owner.toBuffer(), TOKEN_PROGRAM_ID.toBuffer(), mint.toBuffer()],
    ASSOCIATED_TOKEN_PROGRAM_ID
  );
  return address;
}

function toScaled(value: number, label: string, rangeMin: BN, rangeMax: BN): BN {
  if (!Number.isFinite(value)) {
    throw new OutOfRangeError(`${label}_not_finite`);
  }
  const scaled = Math.round(value * SCALE);
  if (!Number.isSafeInteger(scaled)) {
    throw new OutOfRangeError(`${label}_outside_safe_integer:${value}`);
  }
  const bn = new BN(scaled);
  if (bn.lt(rangeMin) || bn.gt(rangeMax)) {
    throw new OutOfRangeError(
      `${label}_outside_market_range:${value}:[${rangeMin.toString()},${rangeMax.toString()}]`
    );
  }
  return bn;
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
    decimals,
    rangeMin: marketAccount.rangeMin as BN,
    rangeMax: marketAccount.rangeMax as BN
  };
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
      throw new SimulationError(
        `simulate_failed:${JSON.stringify(sim.value.err)}`,
        sim.value.logs ?? undefined
      );
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
  const { accounts, decimals, rangeMin, rangeMax } = await resolveAccounts(
    program,
    programId,
    marketPubkey,
    trader,
    resolveDecimals
  );
  const builder = program.methods
    .buyDistribution({
      mu: toScaled(mu, "mu", rangeMin, rangeMax),
      sigma: toScaled(sigma, "sigma", rangeMin, rangeMax),
      collateralAmount: toBaseUnitsBN(amount, decimals)
    })
    .accountsPartial({ ...accounts, systemProgram: SystemProgram.programId })
    .preInstructions([
      ComputeBudgetProgram.setComputeUnitLimit({ units: 1_400_000 }),
      ComputeBudgetProgram.setComputeUnitPrice({ microLamports: priorityFeeMicroLamports() })
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
  const { accounts, decimals, rangeMin, rangeMax } = await resolveAccounts(
    program,
    programId,
    marketPubkey,
    trader,
    resolveDecimals
  );
  const builder = program.methods
    .sellDistribution({
      mu: toScaled(mu, "mu", rangeMin, rangeMax),
      sigma: toScaled(sigma, "sigma", rangeMin, rangeMax),
      tokenAmount: toBaseUnitsBN(tokenAmount, decimals)
    })
    .accountsPartial(accounts)
    .preInstructions([
      ComputeBudgetProgram.setComputeUnitLimit({ units: 1_400_000 }),
      ComputeBudgetProgram.setComputeUnitPrice({ microLamports: priorityFeeMicroLamports() })
    ]);

  await simulateOrThrow(program, builder);

  return builder.rpc({ skipPreflight: false, maxRetries: 3, commitment: "confirmed" });
}
