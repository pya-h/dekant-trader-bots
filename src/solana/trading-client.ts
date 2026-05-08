import { Connection, Keypair, PublicKey, Commitment } from "@solana/web3.js";
import { DekantClient, DekantMarket, DekantPosition, SubmitTradeRequest, PrepareBotRequest } from "../clients/dekant-client.js";
import { createBuyInstruction, createSellInstruction } from "./program.js";
import { buildAndSendTransaction } from "./transaction.js";
import { keypairFromSecretKey } from "./keypair.js";
import { BotRecord } from "../state/types.js";

export type BotKeyResolver = (botId: string) => BotRecord | undefined;

export type SolanaTradingClientOptions = {
  connection: Connection;
  programId: PublicKey;
  collateralMint: PublicKey;
  commitment?: Commitment;
  resolveBotRecord: BotKeyResolver;
  httpClient: Pick<DekantClient, "fetchMarkets" | "fetchPositions" | "prepareBotUser">;
};

export class SolanaTradingClient implements DekantClient {
  private readonly connection: Connection;
  private readonly programId: PublicKey;
  private readonly collateralMint: PublicKey;
  private readonly commitment: Commitment;
  private readonly resolveBotRecord: BotKeyResolver;
  private readonly httpClient: Pick<DekantClient, "fetchMarkets" | "fetchPositions" | "prepareBotUser">;

  constructor(options: SolanaTradingClientOptions) {
    this.connection = options.connection;
    this.programId = options.programId;
    this.collateralMint = options.collateralMint;
    this.commitment = options.commitment ?? "confirmed";
    this.resolveBotRecord = options.resolveBotRecord;
    this.httpClient = options.httpClient;
  }

  async fetchMarkets(): Promise<DekantMarket[]> {
    return this.httpClient.fetchMarkets();
  }

  async fetchPositions(botId: string): Promise<DekantPosition[]> {
    return this.httpClient.fetchPositions(botId);
  }

  async prepareBotUser(input: PrepareBotRequest): Promise<{ userId: string; publicKey: string }> {
    return this.httpClient.prepareBotUser(input);
  }

  async submitBuyOrder(input: SubmitTradeRequest): Promise<{ txId: string }> {
    const botRecord = this.resolveBotRecord(input.botId);
    if (!botRecord) {
      throw new Error(`bot_not_found: ${input.botId}`);
    }

    const botKeypair = keypairFromSecretKey(botRecord.secretKey);

    const instruction = createBuyInstruction({
      programId: this.programId,
      marketId: input.marketId,
      user: botKeypair.publicKey,
      collateralMint: this.collateralMint,
      collateralAmount: input.collateralAmount,
      center: input.center,
      spread: input.spread
    });

    const txId = await buildAndSendTransaction({
      connection: this.connection,
      payer: botKeypair,
      instructions: [instruction],
      commitment: this.commitment
    });

    return { txId };
  }

  async submitSellOrder(input: SubmitTradeRequest): Promise<{ txId: string }> {
    const botRecord = this.resolveBotRecord(input.botId);
    if (!botRecord) {
      throw new Error(`bot_not_found: ${input.botId}`);
    }

    const botKeypair = keypairFromSecretKey(botRecord.secretKey);

    const instruction = createSellInstruction({
      programId: this.programId,
      marketId: input.marketId,
      user: botKeypair.publicKey,
      collateralMint: this.collateralMint,
      sellAmount: input.collateralAmount,
      center: input.center,
      spread: input.spread
    });

    const txId = await buildAndSendTransaction({
      connection: this.connection,
      payer: botKeypair,
      instructions: [instruction],
      commitment: this.commitment
    });

    return { txId };
  }
}
