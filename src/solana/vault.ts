import {
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
  LAMPORTS_PER_SOL,
  Commitment
} from "@solana/web3.js";
import {
  createTransferInstruction,
  getAssociatedTokenAddressSync,
  createAssociatedTokenAccountInstruction,
  getAccount,
  TokenAccountNotFoundError
} from "@solana/spl-token";
import { VaultClient } from "../funding/engine.js";
import { buildAndSendTransaction } from "./transaction.js";
import { TokenMintMap } from "./balance.js";

export type SolanaVaultClientOptions = {
  connection: Connection;
  vaultKeypair: Keypair;
  tokenMints: TokenMintMap;
  commitment?: Commitment;
};

export class SolanaVaultClient implements VaultClient {
  private readonly connection: Connection;
  private readonly vaultKeypair: Keypair;
  private readonly tokenMints: TokenMintMap;
  private readonly commitment: Commitment;

  constructor(options: SolanaVaultClientOptions) {
    this.connection = options.connection;
    this.vaultKeypair = options.vaultKeypair;
    this.tokenMints = options.tokenMints;
    this.commitment = options.commitment ?? "confirmed";
  }

  get publicKey(): PublicKey {
    return this.vaultKeypair.publicKey;
  }

  async transferToken(input: {
    token: string;
    toAddress: string;
    amount: number;
  }): Promise<{ txId: string }> {
    const normalized = input.token.trim().toUpperCase();
    const mintAddress = this.tokenMints[normalized];
    if (!mintAddress) {
      throw new Error(`unsupported_token: ${normalized}`);
    }

    const mint = new PublicKey(mintAddress);
    const recipient = new PublicKey(input.toAddress);

    const decimals = await this.getTokenDecimals(mint);
    const rawAmount = BigInt(Math.round(input.amount * Math.pow(10, decimals)));

    const sourceAta = getAssociatedTokenAddressSync(mint, this.vaultKeypair.publicKey, true);
    const destinationAta = getAssociatedTokenAddressSync(mint, recipient, true);

    const instructions = [];

    const destExists = await this.tokenAccountExists(destinationAta);
    if (!destExists) {
      instructions.push(
        createAssociatedTokenAccountInstruction(
          this.vaultKeypair.publicKey,
          destinationAta,
          recipient,
          mint
        )
      );
    }

    instructions.push(
      createTransferInstruction(sourceAta, destinationAta, this.vaultKeypair.publicKey, rawAmount)
    );

    const txId = await buildAndSendTransaction({
      connection: this.connection,
      payer: this.vaultKeypair,
      instructions,
      commitment: this.commitment
    });

    return { txId };
  }

  async transferSol(input: {
    toAddress: string;
    amount: number;
  }): Promise<{ txId: string }> {
    const recipient = new PublicKey(input.toAddress);
    const lamports = Math.round(input.amount * LAMPORTS_PER_SOL);

    const instruction = SystemProgram.transfer({
      fromPubkey: this.vaultKeypair.publicKey,
      toPubkey: recipient,
      lamports
    });

    const txId = await buildAndSendTransaction({
      connection: this.connection,
      payer: this.vaultKeypair,
      instructions: [instruction],
      commitment: this.commitment
    });

    return { txId };
  }

  private async tokenAccountExists(ata: PublicKey): Promise<boolean> {
    try {
      await getAccount(this.connection, ata);
      return true;
    } catch (error) {
      if (error instanceof TokenAccountNotFoundError) {
        return false;
      }
      return false;
    }
  }

  private async getTokenDecimals(mint: PublicKey): Promise<number> {
    const info = await this.connection.getParsedAccountInfo(mint);
    if (info.value && "parsed" in (info.value.data as Record<string, unknown>)) {
      const parsed = (info.value.data as { parsed: { info: { decimals: number } } }).parsed;
      return parsed.info.decimals;
    }
    return 6;
  }
}
