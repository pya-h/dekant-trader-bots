import {
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
  Transaction,
  sendAndConfirmTransaction
} from "@solana/web3.js";
import {
  createAssociatedTokenAccountInstruction,
  createTransferCheckedInstruction,
  getAccount,
  getAssociatedTokenAddress,
  TokenAccountNotFoundError,
  TokenInvalidAccountOwnerError
} from "@solana/spl-token";
import bs58 from "bs58";
import type { VaultClient } from "../funding/engine.js";
import type { MintRegistry } from "./mint-registry.js";
import { toBaseUnitsBigInt } from "../solana/units.js";

export type SolanaVaultClientOptions = {
  connection: Connection;
  vaultKeypair: Keypair;
  mintRegistry: MintRegistry;
};

export function loadKeypairFromSecret(raw: string): Keypair {
  const trimmed = raw.trim();
  if (trimmed.startsWith("[")) {
    const bytes = JSON.parse(trimmed) as number[];
    if (!Array.isArray(bytes) || bytes.length !== 64) {
      throw new Error("vault_secret_invalid_byte_array");
    }
    return Keypair.fromSecretKey(Uint8Array.from(bytes));
  }
  const decoded = bs58.decode(trimmed);
  if (decoded.length !== 64) {
    throw new Error("vault_secret_invalid_length");
  }
  return Keypair.fromSecretKey(decoded);
}

export class SolanaVaultClient implements VaultClient {
  private readonly connection: Connection;
  private readonly vaultKeypair: Keypair;
  private readonly mintRegistry: MintRegistry;

  constructor(options: SolanaVaultClientOptions) {
    this.connection = options.connection;
    this.vaultKeypair = options.vaultKeypair;
    this.mintRegistry = options.mintRegistry;
  }

  async transferSol(input: { toAddress: string; amount: number }): Promise<{ txId: string }> {
    const toPubkey = new PublicKey(input.toAddress);
    const lamports = Math.round(input.amount * 1_000_000_000);
    if (lamports <= 0) {
      throw new Error("transfer_sol_amount_must_be_positive");
    }

    const transaction = new Transaction().add(
      SystemProgram.transfer({
        fromPubkey: this.vaultKeypair.publicKey,
        toPubkey,
        lamports
      })
    );

    const signature = await sendAndConfirmTransaction(this.connection, transaction, [this.vaultKeypair], {
      commitment: "confirmed"
    });

    return { txId: signature };
  }

  async transferToken(input: { token: string; toAddress: string; amount: number }): Promise<{ txId: string }> {
    const mint = new PublicKey(input.token);
    const decimals = await this.mintRegistry.getDecimals(input.token);
    const baseUnits = toBaseUnitsBigInt(input.amount.toString(), decimals);
    if (baseUnits <= 0n) {
      throw new Error("transfer_token_amount_must_be_positive");
    }

    const recipient = new PublicKey(input.toAddress);
    const fromAta = await getAssociatedTokenAddress(mint, this.vaultKeypair.publicKey);
    const toAta = await getAssociatedTokenAddress(mint, recipient);

    const transaction = new Transaction();

    let recipientAtaExists = true;
    try {
      await getAccount(this.connection, toAta);
    } catch (error) {
      if (error instanceof TokenAccountNotFoundError || error instanceof TokenInvalidAccountOwnerError) {
        recipientAtaExists = false;
      } else {
        throw error;
      }
    }

    if (!recipientAtaExists) {
      transaction.add(
        createAssociatedTokenAccountInstruction(
          this.vaultKeypair.publicKey,
          toAta,
          recipient,
          mint
        )
      );
    }

    transaction.add(
      createTransferCheckedInstruction(
        fromAta,
        mint,
        toAta,
        this.vaultKeypair.publicKey,
        baseUnits,
        decimals
      )
    );

    const signature = await sendAndConfirmTransaction(this.connection, transaction, [this.vaultKeypair], {
      commitment: "confirmed"
    });

    return { txId: signature };
  }
}
