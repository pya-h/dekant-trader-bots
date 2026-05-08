import { describe, expect, it, vi } from "vitest";
import { Connection, Keypair, PublicKey } from "@solana/web3.js";
import { SolanaTradingClient } from "../../src/solana/trading-client.js";
import { generateSolanaKeypair } from "../../src/solana/keypair.js";
import { DekantMarket, DekantPosition } from "../../src/clients/dekant-client.js";
import { BotRecord } from "../../src/state/types.js";

const PROGRAM_ID = new PublicKey("DKNTaFgS3UbfUEbVp6NMBo2R4RWDxoBthW8SNf1rAY2w");
const COLLATERAL_MINT = new PublicKey("4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU");

function makeBotRecord(): BotRecord {
  const kp = generateSolanaKeypair();
  return {
    id: "bot-1",
    publicKey: kp.publicKey,
    secretKey: kp.secretKey,
    createdAt: "2026-01-01T00:00:00.000Z",
    lastActiveAt: null
  };
}

describe("SolanaTradingClient", () => {
  const markets: DekantMarket[] = [
    { id: "m1", subject: "BTC", category: "crypto", status: "open" }
  ];
  const positions: DekantPosition[] = [
    { id: "p1", marketId: "m1", token: "BTC", amount: 10 }
  ];

  const httpClient = {
    fetchMarkets: vi.fn().mockResolvedValue(markets),
    fetchPositions: vi.fn().mockResolvedValue(positions),
    prepareBotUser: vi.fn().mockResolvedValue({ userId: "u1", publicKey: "pk1" })
  };

  function createClient(botRecord?: BotRecord) {
    const bot = botRecord ?? makeBotRecord();
    return new SolanaTradingClient({
      connection: new Connection("https://api.devnet.solana.com"),
      programId: PROGRAM_ID,
      collateralMint: COLLATERAL_MINT,
      resolveBotRecord: (id) => (id === bot.id ? bot : undefined),
      httpClient
    });
  }

  it("delegates fetchMarkets to httpClient", async () => {
    const client = createClient();
    const result = await client.fetchMarkets();

    expect(result).toEqual(markets);
    expect(httpClient.fetchMarkets).toHaveBeenCalled();
  });

  it("delegates fetchPositions to httpClient", async () => {
    const client = createClient();
    const result = await client.fetchPositions("bot-1");

    expect(result).toEqual(positions);
    expect(httpClient.fetchPositions).toHaveBeenCalledWith("bot-1");
  });

  it("delegates prepareBotUser to httpClient", async () => {
    const client = createClient();
    const result = await client.prepareBotUser({ botId: "bot-1", publicKey: "pk1" });

    expect(result).toEqual({ userId: "u1", publicKey: "pk1" });
  });

  it("submitBuyOrder throws when bot is not found", async () => {
    const client = createClient();

    await expect(
      client.submitBuyOrder({
        botId: "unknown-bot",
        marketId: "m1",
        collateralAmount: 100,
        center: 95000,
        spread: 500
      })
    ).rejects.toThrow("bot_not_found");
  });

  it("submitSellOrder throws when bot is not found", async () => {
    const client = createClient();

    await expect(
      client.submitSellOrder({
        botId: "unknown-bot",
        marketId: "m1",
        collateralAmount: 50,
        center: 95000,
        spread: 500
      })
    ).rejects.toThrow("bot_not_found");
  });
});
