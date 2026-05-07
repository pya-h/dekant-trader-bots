import { BotRecord } from "../state/types.js";
import { FaucetClient } from "../clients/faucet-client.js";
import type { StructuredLogger } from "../observability/logger.js";

export type VaultClient = {
  transferToken(input: { token: string; toAddress: string; amount: number }): Promise<{ txId: string }>;
  transferSol(input: { toAddress: string; amount: number }): Promise<{ txId: string }>;
};

export type BalanceClient = {
  getBotBalance(
    address: string,
    tokens: string[]
  ): Promise<{
    sol: number;
    tokens: Record<string, number>;
  }>;
};

export type FundingEngineOptions = {
  runtime: {
    maxAmount: number;
    prefundMultiplier: number;
    minBotSol: number;
    emergencyTopupCooldownMs: number;
    vaultSupportedMints: string[];
  };
  clients: {
    vault: VaultClient;
    balances: BalanceClient;
    faucet: FaucetClient;
  };
  vaultAddress: string;
  now?: () => Date;
  random?: () => number;
  logger?: StructuredLogger;
};

export type ManualFundRequest = {
  bots: BotRecord[];
  botIds?: string[];
  addresses?: string[];
  amount?: number;
  token?: string;
};

export type TokenFundingAction = {
  token: string;
  source: "vault" | "faucet" | "none";
  status:
    | "funded"
    | "skipped_sufficient"
    | "skipped_unavailable"
    | "skipped_unsupported"
    | "skipped_cooldown";
  amount?: number;
  txId?: string;
  reason?: string;
};

export type BotFundingResult = {
  botId: string;
  address: string;
  sol: {
    status: "funded" | "skipped_sufficient";
    amount?: number;
    txId?: string;
  };
  tokenActions: TokenFundingAction[];
};

export type ManualFundResult = {
  targetBotIds: string[];
  results: BotFundingResult[];
};

function unique<T>(items: T[]): T[] {
  return [...new Set(items)];
}

function amountToFixed(value: number): number {
  return Math.max(0, Number(value.toFixed(6)));
}

export function selectTargetBots(
  bots: BotRecord[],
  selectors: { botIds?: string[]; addresses?: string[] }
): BotRecord[] {
  const hasBotIds = (selectors.botIds?.length ?? 0) > 0;
  const hasAddresses = (selectors.addresses?.length ?? 0) > 0;

  if (!hasBotIds && !hasAddresses) {
    return bots;
  }

  const idSet = new Set((selectors.botIds ?? []).map((id) => id.trim()));
  const addressSet = new Set((selectors.addresses ?? []).map((address) => address.trim()));

  return bots.filter((bot) => idSet.has(bot.id) || addressSet.has(bot.publicKey));
}

export function selectFundingAmount(options: {
  maxAmount: number;
  prefundMultiplier: number;
  manualAmount?: number;
  random?: () => number;
}): number {
  if (options.manualAmount !== undefined) {
    if (options.manualAmount <= 0) {
      throw new Error("manual_amount_must_be_positive");
    }
    return amountToFixed(options.manualAmount);
  }

  const random = options.random ?? Math.random;
  const min = options.maxAmount;
  const max = options.maxAmount * options.prefundMultiplier;
  const sampled = min + random() * (max - min);

  return amountToFixed(sampled);
}

export class FundingEngine {
  private runtime: FundingEngineOptions["runtime"];
  private readonly clients: FundingEngineOptions["clients"];
  private readonly vaultAddress: string;
  private readonly logger?: StructuredLogger;
  private readonly now: () => Date;
  private readonly random: () => number;
  private readonly lastEmergencyTopupByBot = new Map<string, number>();

  constructor(options: FundingEngineOptions) {
    this.runtime = {
      ...options.runtime,
      vaultSupportedMints: unique(options.runtime.vaultSupportedMints)
    };
    this.clients = options.clients;
    this.vaultAddress = options.vaultAddress;
    this.logger = options.logger;
    this.now = options.now ?? (() => new Date());
    this.random = options.random ?? Math.random;
  }

  updateRuntime(patch: Partial<FundingEngineOptions["runtime"]>): void {
    this.runtime = {
      ...this.runtime,
      ...patch,
      vaultSupportedMints: patch.vaultSupportedMints
        ? unique(patch.vaultSupportedMints)
        : this.runtime.vaultSupportedMints
    };
  }

  private isVaultSupportedMint(mint: string): boolean {
    return this.runtime.vaultSupportedMints.includes(mint);
  }

  private async vaultHoldsMint(mint: string): Promise<boolean> {
    try {
      const balance = await this.clients.balances.getBotBalance(this.vaultAddress, [mint]);
      return (balance.tokens[mint] ?? 0) > 0;
    } catch (error) {
      this.logger?.warn?.("vault_balance_check_failed", {
        mint,
        message: error instanceof Error ? error.message : String(error)
      });
      return false;
    }
  }

  private async ensureSol(address: string, currentSol: number): Promise<BotFundingResult["sol"]> {
    const targetSol = this.runtime.minBotSol * 2;
    if (currentSol >= this.runtime.minBotSol) {
      return { status: "skipped_sufficient" };
    }

    const topupAmount = amountToFixed(Math.max(this.runtime.minBotSol, targetSol - currentSol));
    const tx = await this.clients.vault.transferSol({
      toAddress: address,
      amount: topupAmount
    });

    return {
      status: "funded",
      amount: topupAmount,
      txId: tx.txId
    };
  }

  private async fundTokenForBot(options: {
    bot: BotRecord;
    token: string;
    currentAmount: number;
    desiredAmount: number;
  }): Promise<TokenFundingAction> {
    const token = options.token;
    if (options.currentAmount >= options.desiredAmount) {
      return {
        token,
        source: "none",
        status: "skipped_sufficient"
      };
    }

    const needAmount = amountToFixed(options.desiredAmount - options.currentAmount);

    if (this.isVaultSupportedMint(token)) {
      if (!(await this.vaultHoldsMint(token))) {
        this.logger?.warn?.("vault_missing_mint", {
          mint: token,
          botId: options.bot.id,
          botAddress: options.bot.publicKey,
          neededAmount: needAmount
        });
        return {
          token,
          source: "vault",
          status: "skipped_unavailable",
          reason: "vault_missing_mint"
        };
      }

      const tx = await this.clients.vault.transferToken({
        token,
        toAddress: options.bot.publicKey,
        amount: needAmount
      });

      return {
        token,
        source: "vault",
        status: "funded",
        amount: needAmount,
        txId: tx.txId
      };
    }

    const availability = await this.clients.faucet.checkAvailability(token, options.bot.publicKey);
    if (!availability.available) {
      return {
        token,
        source: "faucet",
        status: "skipped_unavailable",
        reason: availability.reason ?? "faucet_unavailable"
      };
    }

    const faucetResult = await this.clients.faucet.requestTokens({
      token,
      walletAddress: options.bot.publicKey
    });

    if (!faucetResult.success) {
      return {
        token,
        source: "faucet",
        status: "skipped_unavailable",
        reason: "faucet_request_failed"
      };
    }

    return {
      token,
      source: "faucet",
      status: "funded",
      amount: faucetResult.amount ?? needAmount,
      txId: faucetResult.txId
    };
  }

  private resolveTokensForFunding(request: ManualFundRequest): string[] {
    if (request.token) {
      return [request.token];
    }

    return this.runtime.vaultSupportedMints;
  }

  async manualFund(request: ManualFundRequest): Promise<ManualFundResult> {
    const targets = selectTargetBots(request.bots, {
      botIds: request.botIds,
      addresses: request.addresses
    });

    const tokens = this.resolveTokensForFunding(request);
    const results: BotFundingResult[] = [];

    for (const bot of targets) {
      const balances = await this.clients.balances.getBotBalance(bot.publicKey, tokens);
      const desiredAmount = selectFundingAmount({
        maxAmount: this.runtime.maxAmount,
        prefundMultiplier: this.runtime.prefundMultiplier,
        manualAmount: request.amount,
        random: this.random
      });

      const sol = await this.ensureSol(bot.publicKey, balances.sol);

      const tokenActions: TokenFundingAction[] = [];
      for (const token of tokens) {
        tokenActions.push(
          await this.fundTokenForBot({
            bot,
            token,
            currentAmount: balances.tokens[token] ?? 0,
            desiredAmount
          })
        );
      }

      results.push({
        botId: bot.id,
        address: bot.publicKey,
        sol,
        tokenActions
      });
    }

    return {
      targetBotIds: targets.map((bot) => bot.id),
      results
    };
  }

  async prefundBots(bots: BotRecord[]): Promise<ManualFundResult> {
    return this.manualFund({ bots });
  }

  async requestEmergencyTopup(options: {
    bot: BotRecord;
    token: string;
    amount?: number;
  }): Promise<TokenFundingAction> {
    const nowMs = this.now().getTime();
    const lastTopup = this.lastEmergencyTopupByBot.get(options.bot.id);
    const cooldownMs = this.runtime.emergencyTopupCooldownMs;

    if (lastTopup !== undefined && nowMs - lastTopup < cooldownMs) {
      return {
        token: options.token,
        source: "none",
        status: "skipped_cooldown",
        reason: "cooldown_active"
      };
    }

    const result = await this.manualFund({
      bots: [options.bot],
      token: options.token,
      amount: options.amount
    });

    const action = result.results[0]?.tokenActions[0];
    if (!action) {
      return {
        token: options.token,
        source: "none",
        status: "skipped_unsupported",
        reason: "bot_not_found"
      };
    }

    if (action.status === "funded") {
      this.lastEmergencyTopupByBot.set(options.bot.id, nowMs);
    }

    return action;
  }
}
