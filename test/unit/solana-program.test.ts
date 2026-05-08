import { describe, expect, it } from "vitest";
import { Keypair, PublicKey } from "@solana/web3.js";
import {
  deriveMarketPda,
  deriveMarketEscrowPda,
  derivePositionPda,
  createBuyInstruction,
  createSellInstruction
} from "../../src/solana/program.js";

const PROGRAM_ID = new PublicKey("DKNTaFgS3UbfUEbVp6NMBo2R4RWDxoBthW8SNf1rAY2w");
const COLLATERAL_MINT = new PublicKey("4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU");

describe("PDA derivation", () => {
  it("deriveMarketPda returns a deterministic PDA for the same inputs", () => {
    const [pda1] = deriveMarketPda(PROGRAM_ID, "market-123");
    const [pda2] = deriveMarketPda(PROGRAM_ID, "market-123");

    expect(pda1.toBase58()).toBe(pda2.toBase58());
  });

  it("deriveMarketPda returns different PDAs for different market IDs", () => {
    const [pda1] = deriveMarketPda(PROGRAM_ID, "market-1");
    const [pda2] = deriveMarketPda(PROGRAM_ID, "market-2");

    expect(pda1.toBase58()).not.toBe(pda2.toBase58());
  });

  it("deriveMarketEscrowPda is deterministic", () => {
    const [marketPda] = deriveMarketPda(PROGRAM_ID, "market-1");
    const [escrow1] = deriveMarketEscrowPda(PROGRAM_ID, marketPda);
    const [escrow2] = deriveMarketEscrowPda(PROGRAM_ID, marketPda);

    expect(escrow1.toBase58()).toBe(escrow2.toBase58());
  });

  it("derivePositionPda is deterministic and differs per user", () => {
    const [marketPda] = deriveMarketPda(PROGRAM_ID, "market-1");
    const user1 = Keypair.generate().publicKey;
    const user2 = Keypair.generate().publicKey;

    const [pos1] = derivePositionPda(PROGRAM_ID, marketPda, user1);
    const [pos2] = derivePositionPda(PROGRAM_ID, marketPda, user2);
    const [pos1Again] = derivePositionPda(PROGRAM_ID, marketPda, user1);

    expect(pos1.toBase58()).toBe(pos1Again.toBase58());
    expect(pos1.toBase58()).not.toBe(pos2.toBase58());
  });
});

describe("createBuyInstruction", () => {
  it("builds a valid TransactionInstruction with correct discriminator", () => {
    const user = Keypair.generate();

    const ix = createBuyInstruction({
      programId: PROGRAM_ID,
      marketId: "market-1",
      user: user.publicKey,
      collateralMint: COLLATERAL_MINT,
      collateralAmount: 100,
      center: 95000,
      spread: 500
    });

    expect(ix.programId.toBase58()).toBe(PROGRAM_ID.toBase58());
    expect(ix.data[0]).toBe(0); // BUY discriminator
    expect(ix.keys.length).toBe(11);
    expect(ix.keys[3].pubkey.toBase58()).toBe(user.publicKey.toBase58());
    expect(ix.keys[3].isSigner).toBe(true);
  });

  it("encodes amount as u64 LE (fixed-point ×10^6)", () => {
    const user = Keypair.generate();

    const ix = createBuyInstruction({
      programId: PROGRAM_ID,
      marketId: "market-1",
      user: user.publicKey,
      collateralMint: COLLATERAL_MINT,
      collateralAmount: 1.5,
      center: 100,
      spread: 10
    });

    // 1.5 * 1_000_000 = 1_500_000
    const amountBuf = ix.data.subarray(1, 9);
    const amount = amountBuf.readBigUInt64LE();
    expect(amount).toBe(BigInt(1_500_000));
  });
});

describe("createSellInstruction", () => {
  it("builds a valid TransactionInstruction with correct discriminator", () => {
    const user = Keypair.generate();

    const ix = createSellInstruction({
      programId: PROGRAM_ID,
      marketId: "market-1",
      user: user.publicKey,
      collateralMint: COLLATERAL_MINT,
      sellAmount: 50,
      center: 95000,
      spread: 500
    });

    expect(ix.programId.toBase58()).toBe(PROGRAM_ID.toBase58());
    expect(ix.data[0]).toBe(1); // SELL discriminator
    expect(ix.keys.length).toBe(9);
    expect(ix.keys[3].pubkey.toBase58()).toBe(user.publicKey.toBase58());
    expect(ix.keys[3].isSigner).toBe(true);
  });
});
