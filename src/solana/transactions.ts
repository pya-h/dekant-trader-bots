import { PublicKey, SystemProgram, ComputeBudgetProgram } from "@solana/web3.js";
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

function getAta(mint: PublicKey, owner: PublicKey): PublicKey {
  const [address] = PublicKey.findProgramAddressSync(
    [owner.toBuffer(), TOKEN_PROGRAM_ID.toBuffer(), mint.toBuffer()],
    ASSOCIATED_TOKEN_PROGRAM_ID
  );
  return address;
}

function toScaled(value: number): BN {
  return new BN(Math.round(value * SCALE));
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
    decimals
  };
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
  const { accounts, decimals } = await resolveAccounts(
    program,
    programId,
    marketPubkey,
    trader,
    resolveDecimals
  );
  return program.methods
    .buyDistribution({
      mu: toScaled(mu),
      sigma: toScaled(sigma),
      collateralAmount: toBaseUnitsBN(amount, decimals)
    })
    .accountsPartial({ ...accounts, systemProgram: SystemProgram.programId })
    .preInstructions([ComputeBudgetProgram.setComputeUnitLimit({ units: 1_400_000 })])
    .rpc({ skipPreflight: true, maxRetries: 3 });
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
  const { accounts, decimals } = await resolveAccounts(
    program,
    programId,
    marketPubkey,
    trader,
    resolveDecimals
  );
  return program.methods
    .sellDistribution({
      mu: toScaled(mu),
      sigma: toScaled(sigma),
      tokenAmount: toBaseUnitsBN(tokenAmount, decimals)
    })
    .accountsPartial(accounts)
    .preInstructions([ComputeBudgetProgram.setComputeUnitLimit({ units: 1_400_000 })])
    .rpc({ skipPreflight: true, maxRetries: 3 });
}
