import { MarketNotResolvedError, SimulationError } from "../solana/transactions.js";

/**
 * Claim pass — runs on each market refresh (no dedicated loop). It claims bot
 * payouts from markets that have CLOSED and RESOLVED, using only state we already
 * keep: the persisted position memory is the participant trail (a bot is recorded
 * there on its first successful buy and never pruned on sell), so no RPC is needed
 * to know who participated.
 *
 * A claim candidate is any market in position memory that is no longer in the
 * active set. For each candidate we attempt a claim per participant bot; the
 * on-chain instruction is the source of truth for resolution and payout. Outcomes:
 *   - success / AlreadyClaimed / NothingToClaim → terminal → prune the entry.
 *   - MarketNotResolvedError → not resolved yet → keep the whole market for later.
 *   - anything else (RPC/network) → transient → keep, retry next pass.
 * The on-chain `claimed` flag makes retries and overlapping passes safe.
 */

export type ClaimClient = {
  submitClaimPayout(input: { botId: string; marketId: string }): Promise<{ txId: string }>;
};

export type ClaimPositionMemory = {
  listMarketIds(): string[];
  botPubkeysForMarket(marketId: string): string[];
  delete(botPubkey: string, marketId: string): void;
};

export type ClaimPassDeps = {
  client: ClaimClient;
  positionMemory: ClaimPositionMemory;
  getBots: () => Array<{ id: string; publicKey: string }>;
  activeMarketIds: Set<string>;
  onClaim?: (event: { botId: string; botPubkey: string; marketId: string; txId: string }) => void;
  onTerminal?: (event: { botId: string; botPubkey: string; marketId: string; error: unknown }) => void;
  onFailure?: (event: { botId: string; botPubkey: string; marketId: string; error: unknown }) => void;
};

export type ClaimPassResult = {
  candidateMarkets: number;
  marketsResolved: number;
  marketsPending: number;
  claimed: number;
  pruned: number;
  failed: number;
};

/** Terminal Anchor error codes — the bot is done with this position, prune it. */
const TERMINAL_ANCHOR_CODES = new Set(["AlreadyClaimed", "NothingToClaim"]);

type ClaimErrorKind = "not_resolved" | "terminal" | "transient";

function classifyClaimError(error: unknown): ClaimErrorKind {
  if (error instanceof MarketNotResolvedError) {
    return "not_resolved";
  }
  if (
    error instanceof SimulationError &&
    error.anchorErrorCode &&
    TERMINAL_ANCHOR_CODES.has(error.anchorErrorCode)
  ) {
    return "terminal";
  }
  return "transient";
}

export async function runClaimPass(deps: ClaimPassDeps): Promise<ClaimPassResult> {
  const botIdByPubkey = new Map(deps.getBots().map((bot) => [bot.publicKey, bot.id]));
  const candidateMarketIds = deps.positionMemory
    .listMarketIds()
    .filter((marketId) => !deps.activeMarketIds.has(marketId));

  const result: ClaimPassResult = {
    candidateMarkets: candidateMarketIds.length,
    marketsResolved: 0,
    marketsPending: 0,
    claimed: 0,
    pruned: 0,
    failed: 0
  };

  for (const marketId of candidateMarketIds) {
    const botPubkeys = deps.positionMemory.botPubkeysForMarket(marketId);
    let marketPending = false;

    for (const botPubkey of botPubkeys) {
      const botId = botIdByPubkey.get(botPubkey);
      if (!botId) {
        // Bot was removed from the fleet — drop the stale participant entry.
        deps.positionMemory.delete(botPubkey, marketId);
        result.pruned += 1;
        continue;
      }

      try {
        const { txId } = await deps.client.submitClaimPayout({ botId, marketId });
        deps.positionMemory.delete(botPubkey, marketId);
        result.claimed += 1;
        result.pruned += 1;
        deps.onClaim?.({ botId, botPubkey, marketId, txId });
      } catch (error) {
        const kind = classifyClaimError(error);
        if (kind === "not_resolved") {
          // Resolution is per-market: if it's not resolved for one participant it
          // isn't for any. Leave the whole market's entries for a later pass.
          marketPending = true;
          break;
        }
        if (kind === "terminal") {
          deps.positionMemory.delete(botPubkey, marketId);
          result.pruned += 1;
          deps.onTerminal?.({ botId, botPubkey, marketId, error });
        } else {
          result.failed += 1;
          deps.onFailure?.({ botId, botPubkey, marketId, error });
        }
      }
    }

    if (marketPending) {
      result.marketsPending += 1;
    } else {
      result.marketsResolved += 1;
    }
  }

  return result;
}
