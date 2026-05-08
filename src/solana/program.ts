import {
  PublicKey,
  TransactionInstruction,
  SystemProgram,
  SYSVAR_RENT_PUBKEY
} from "@solana/web3.js";
import { TOKEN_PROGRAM_ID, getAssociatedTokenAddressSync, ASSOCIATED_TOKEN_PROGRAM_ID } from "@solana/spl-token";

const INSTRUCTION_BUY = 0;
const INSTRUCTION_SELL = 1;

function toU64Le(value: number): Buffer {
  const buf = Buffer.alloc(8);
  buf.writeBigUInt64LE(BigInt(Math.round(value * 1_000_000)));
  return buf;
}

export function deriveMarketPda(programId: PublicKey, marketId: string): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("market"), Buffer.from(marketId)],
    programId
  );
}

export function deriveMarketEscrowPda(programId: PublicKey, marketPda: PublicKey): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("escrow"), marketPda.toBuffer()],
    programId
  );
}

export function derivePositionPda(
  programId: PublicKey,
  marketPda: PublicKey,
  user: PublicKey
): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("position"), marketPda.toBuffer(), user.toBuffer()],
    programId
  );
}

export type BuyInstructionInput = {
  programId: PublicKey;
  marketId: string;
  user: PublicKey;
  collateralMint: PublicKey;
  collateralAmount: number;
  center: number;
  spread: number;
};

export function createBuyInstruction(input: BuyInstructionInput): TransactionInstruction {
  const [marketPda] = deriveMarketPda(input.programId, input.marketId);
  const [escrowPda] = deriveMarketEscrowPda(input.programId, marketPda);
  const [positionPda] = derivePositionPda(input.programId, marketPda, input.user);

  const userCollateralAta = getAssociatedTokenAddressSync(input.collateralMint, input.user, true);
  const escrowCollateralAta = getAssociatedTokenAddressSync(input.collateralMint, escrowPda, true);

  const data = Buffer.concat([
    Buffer.from([INSTRUCTION_BUY]),
    toU64Le(input.collateralAmount),
    toU64Le(input.center),
    toU64Le(input.spread)
  ]);

  return new TransactionInstruction({
    programId: input.programId,
    keys: [
      { pubkey: marketPda, isSigner: false, isWritable: true },
      { pubkey: escrowPda, isSigner: false, isWritable: false },
      { pubkey: positionPda, isSigner: false, isWritable: true },
      { pubkey: input.user, isSigner: true, isWritable: true },
      { pubkey: userCollateralAta, isSigner: false, isWritable: true },
      { pubkey: escrowCollateralAta, isSigner: false, isWritable: true },
      { pubkey: input.collateralMint, isSigner: false, isWritable: false },
      { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
      { pubkey: ASSOCIATED_TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      { pubkey: SYSVAR_RENT_PUBKEY, isSigner: false, isWritable: false }
    ],
    data
  });
}

export type SellInstructionInput = {
  programId: PublicKey;
  marketId: string;
  user: PublicKey;
  collateralMint: PublicKey;
  sellAmount: number;
  center: number;
  spread: number;
};

export function createSellInstruction(input: SellInstructionInput): TransactionInstruction {
  const [marketPda] = deriveMarketPda(input.programId, input.marketId);
  const [escrowPda] = deriveMarketEscrowPda(input.programId, marketPda);
  const [positionPda] = derivePositionPda(input.programId, marketPda, input.user);

  const userCollateralAta = getAssociatedTokenAddressSync(input.collateralMint, input.user, true);
  const escrowCollateralAta = getAssociatedTokenAddressSync(input.collateralMint, escrowPda, true);

  const data = Buffer.concat([
    Buffer.from([INSTRUCTION_SELL]),
    toU64Le(input.sellAmount),
    toU64Le(input.center),
    toU64Le(input.spread)
  ]);

  return new TransactionInstruction({
    programId: input.programId,
    keys: [
      { pubkey: marketPda, isSigner: false, isWritable: true },
      { pubkey: escrowPda, isSigner: false, isWritable: false },
      { pubkey: positionPda, isSigner: false, isWritable: true },
      { pubkey: input.user, isSigner: true, isWritable: true },
      { pubkey: userCollateralAta, isSigner: false, isWritable: true },
      { pubkey: escrowCollateralAta, isSigner: false, isWritable: true },
      { pubkey: input.collateralMint, isSigner: false, isWritable: false },
      { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false }
    ],
    data
  });
}
