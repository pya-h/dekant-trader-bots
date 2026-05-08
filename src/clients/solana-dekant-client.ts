import { Connection, Keypair, PublicKey } from "@solana/web3.js";
import { AnchorProvider, Program, Wallet } from "@coral-xyz/anchor";
import idl from "../solana/program/dekant_pm.json" with { type: "json" };
import type { DekantPm } from "../solana/program/dekant_pm.js";
import { deriveMarket, deriveUserPosition } from "../solana/pdas.js";
import { executeBuyDistribution, executeSellDistribution } from "../solana/transactions.js";
import type {
  DekantClient,
  DekantMarket,
  DekantPosition,
  SubmitTradeRequest
} from "./dekant-client.js";
import type { MintRegistry } from "./mint-registry.js";

export type GetBotKeypairFn = (botId: string) => Keypair | null;

export type LookupPositionMemoryFn = (
  botPubkey: string,
  marketId: string
) => { center: number; spread: number } | null;

export type SolanaDekantClientOptions = {
  connection: Connection;
  programId: PublicKey;
  getBotKeypair: GetBotKeypairFn;
  mintRegistry: MintRegistry;
  /** Read-only delegate for endpoints we still want to hit over HTTP (e.g. /markets). */
  httpDelegate: Pick<DekantClient, "fetchMarkets">;
  /** Returns a previously-stored center/spread for (botPubkey, marketId), or null. */
  lookupPositionMemory?: LookupPositionMemoryFn;
  /** Logger for one-shot warnings about positions missing stored centers. */
  onMissingPositionCenter?: (input: { botPubkey: string; marketId: string }) => void;
};

/**
 * On-chain implementation of DekantClient. Trade methods build and sign
 * transactions against the DekantPM Anchor program using each bot's keypair.
 * fetchMarkets delegates to the HTTP backend (the only working read endpoint).
 */
export class SolanaDekantClient implements DekantClient {
  private readonly connection: Connection;
  private readonly programId: PublicKey;
  private readonly getBotKeypair: GetBotKeypairFn;
  private readonly httpDelegate: Pick<DekantClient, "fetchMarkets">;
  private readonly mintRegistry: MintRegistry;
  private readonly lookupPositionMemory?: LookupPositionMemoryFn;
  private readonly onMissingPositionCenter?: (input: { botPubkey: string; marketId: string }) => void;
  private readonly warnedMissing = new Set<string>();

  constructor(options: SolanaDekantClientOptions) {
    this.connection = options.connection;
    this.programId = options.programId;
    this.getBotKeypair = options.getBotKeypair;
    this.httpDelegate = options.httpDelegate;
    this.mintRegistry = options.mintRegistry;
    this.lookupPositionMemory = options.lookupPositionMemory;
    this.onMissingPositionCenter = options.onMissingPositionCenter;
  }

  fetchMarkets(): Promise<DekantMarket[]> {
    return this.httpDelegate.fetchMarkets();
  }

  async fetchPositions(botId: string): Promise<DekantPosition[]> {
    const keypair = this.getBotKeypair(botId);
    if (!keypair) return [];

    const markets = await this.httpDelegate.fetchMarkets();
    const program = this.buildProgram(keypair);

    const pdas = markets.map((market) => {
      const marketPubkey = this.resolveMarketPubkey(market);
      const [userPosition] = deriveUserPosition(this.programId, marketPubkey, keypair.publicKey);
      return { market, userPosition };
    });

    const accounts = await program.account.userPosition.fetchMultiple(
      pdas.map((p) => p.userPosition)
    );

    const positions: DekantPosition[] = [];
    for (let i = 0; i < pdas.length; i++) {
      const account = accounts[i];
      if (!account) continue;
      const holdingsSum = (account.holdings as Array<{ toString(): string }>).reduce<bigint>(
        (acc, h) => acc + BigInt(h.toString()),
        0n
      );
      if (holdingsSum <= 0n) continue;
      const decimals = await this.mintRegistry.getDecimals(pdas[i].market.collateralMint);
      const memory = this.lookupPositionMemory
        ? this.lookupPositionMemory(keypair.publicKey.toBase58(), pdas[i].market.id)
        : null;
      if (!memory) {
        const warnKey = `${keypair.publicKey.toBase58()}::${pdas[i].market.id}`;
        if (!this.warnedMissing.has(warnKey)) {
          this.warnedMissing.add(warnKey);
          this.onMissingPositionCenter?.({
            botPubkey: keypair.publicKey.toBase58(),
            marketId: pdas[i].market.id
          });
        }
        continue;
      }
      positions.push({
        id: pdas[i].userPosition.toBase58(),
        marketId: pdas[i].market.id,
        token: pdas[i].market.collateralMint,
        amount: Number(holdingsSum) / Math.pow(10, decimals),
        center: memory.center
      });
    }
    return positions;
  }

  async submitBuyOrder(input: SubmitTradeRequest): Promise<{ txId: string }> {
    const { keypair, program, marketPubkey } = await this.tradeContext(input);
    const txId = await executeBuyDistribution(
      program,
      this.programId,
      marketPubkey,
      keypair.publicKey,
      input.center,
      input.spread,
      input.collateralAmount.toString(),
      (mint) => this.mintRegistry.getDecimals(mint)
    );
    return { txId };
  }

  async submitSellOrder(input: SubmitTradeRequest): Promise<{ txId: string }> {
    const { keypair, program, marketPubkey } = await this.tradeContext(input);
    const txId = await executeSellDistribution(
      program,
      this.programId,
      marketPubkey,
      keypair.publicKey,
      input.center,
      input.spread,
      input.collateralAmount.toString(),
      (mint) => this.mintRegistry.getDecimals(mint)
    );
    return { txId };
  }

  private async tradeContext(input: SubmitTradeRequest) {
    const keypair = this.getBotKeypair(input.botId);
    if (!keypair) {
      throw new Error(`bot_keypair_not_found:${input.botId}`);
    }
    const program = this.buildProgram(keypair);
    const marketPubkey = this.resolveMarketPubkeyById(input.marketId);
    return { keypair, program, marketPubkey };
  }

  private buildProgram(keypair: Keypair): Program<DekantPm> {
    const provider = new AnchorProvider(this.connection, new Wallet(keypair), {
      commitment: "confirmed",
      preflightCommitment: "confirmed"
    });
    return new Program<DekantPm>(idl as DekantPm, provider);
  }

  private resolveMarketPubkey(market: DekantMarket): PublicKey {
    return this.resolveMarketPubkeyById(market.id);
  }

  private resolveMarketPubkeyById(marketId: string): PublicKey {
    const [pubkey] = deriveMarket(this.programId, BigInt(marketId));
    return pubkey;
  }
}
