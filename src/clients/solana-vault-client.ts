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
  getMint,
  TokenAccountNotFoundError,
  TokenInvalidAccountOwnerError
} from "@solana/spl-token";
import bs58 from "bs58";
import type { VaultClient } from "../funding/engine.js";

export type SolanaVaultClientOptions = {
  connection: Connection;
  vaultKeypair: Keypair;
  tokenMints: Record<string, string>;
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

function normalizeToken(token: string): string {
  return token.trim().toUpperCase();
}

export class SolanaVaultClient implements VaultClient {
  private readonly connection: Connection;
  private readonly vaultKeypair: Keypair;
  private readonly tokenMints: Record<string, PublicKey>;
  private readonly mintInfoCache = new Map<string, { decimals: number }>();

  constructor(options: SolanaVaultClientOptions) {
    this.connection = options.connection;
    this.vaultKeypair = options.vaultKeypair;
    this.tokenMints = {};
    for (const [symbol, mint] of Object.entries(options.tokenMints)) {
      this.tokenMints[normalizeToken(symbol)] = new PublicKey(mint);
    }
  }

  private resolveMint(token: string): PublicKey {
    const mint = this.tokenMints[normalizeToken(token)];
    if (!mint) {
      throw new Error(`unsupported_token:${token}`);
    }
    return mint;
  }

  private async getMintDecimals(mint: PublicKey): Promise<number> {
    const key = mint.toBase58();
    const cached = this.mintInfoCache.get(key);
    if (cached) {
      return cached.decimals;
    }
    const info = await getMint(this.connection, mint);
    this.mintInfoCache.set(key, { decimals: info.decimals });
    return info.decimals;
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
    const mint = this.resolveMint(input.token);
    const decimals = await this.getMintDecimals(mint);
    const baseUnits = BigInt(Math.round(input.amount * 10 ** decimals));
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
