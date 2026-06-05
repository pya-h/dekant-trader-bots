import { describe, expect, it } from "vitest";
import { createInitializedApp } from "../../src/server.js";
import { DekantClient, DekantMarket } from "../../src/clients/dekant-client.js";
import { createBaseEnv } from "../helpers/config.js";
import { InMemoryStateStore } from "../helpers/memory-state-store.js";

const timer = { setTimeout: () => "handle", clearTimeout: () => {} };

function marketClient(markets: DekantMarket[]): DekantClient {
  return {
    fetchMarkets: async () => markets,
    fetchPositions: async () => [],
    submitBuyOrder: async () => ({ txId: "buy" }),
    submitSellOrder: async () => ({ txId: "sell" })
  };
}

describe("claim pass on market refresh", () => {
  it("claims a resolved, no-longer-active market for a participant bot and prunes it", async () => {
    const env = createBaseEnv({ BOT_COUNTS: "1" });
    const claimCalls: Array<{ botId: string; marketId: string }> = [];

    const appCtx = await createInitializedApp(env, {
      store: new InMemoryStateStore(),
      timer,
      // Active set never includes "999", so it's a claim candidate.
      marketCache: { client: marketClient([]) },
      claim: {
        dekant: {
          submitClaimPayout: async (input) => {
            claimCalls.push(input);
            return { txId: `claim-${input.botId}` };
          }
        }
      }
    });

    const bot = appCtx.state.botsState.bots[0];
    // Seed a participant trail as a successful buy would have.
    appCtx.positionMemory.record({ botPubkey: bot.publicKey, marketId: "999", center: 100, spread: 1 });
    await appCtx.positionMemory.flush();

    await appCtx.markets!.refresh();

    expect(claimCalls).toEqual([{ botId: bot.id, marketId: "999" }]);
    // Pruned after a successful claim.
    expect(appCtx.positionMemory.lookup(bot.publicKey, "999")).toBeNull();

    await appCtx.app.close();
  });

  it("does not claim a market that is still active", async () => {
    const env = createBaseEnv({ BOT_COUNTS: "1" });
    let claimed = false;

    const activeMarket: DekantMarket = {
      id: "42",
      subject: "BTC",
      collateralMint: "Mint11111111111111111111111111111111111111",
      marketType: 2,
      category: "crypto",
      state: 0
    };

    const appCtx = await createInitializedApp(env, {
      store: new InMemoryStateStore(),
      timer,
      marketCache: { client: marketClient([activeMarket]) },
      claim: {
        dekant: {
          submitClaimPayout: async () => {
            claimed = true;
            return { txId: "claim" };
          }
        }
      }
    });

    const bot = appCtx.state.botsState.bots[0];
    appCtx.positionMemory.record({ botPubkey: bot.publicKey, marketId: "42", center: 100, spread: 1 });
    await appCtx.positionMemory.flush();

    await appCtx.markets!.refresh();

    expect(claimed).toBe(false);
    expect(appCtx.positionMemory.lookup(bot.publicKey, "42")).not.toBeNull();

    await appCtx.app.close();
  });
});
