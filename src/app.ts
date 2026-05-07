import Fastify, { FastifyInstance } from "fastify";
import { z } from "zod";
import { parsePaginationQuery } from "./api/pagination.js";
import { AppConfig } from "./config.js";
import type { StructuredLogger } from "./observability/logger.js";

type StatusRuntimeSnapshot = {
  botCount: number;
  buyChance: number;
  sellChance: number;
  maxAmount: number;
  createdBotsOnStartup: number;
  initialFundingScheduled: boolean;
  observability?: {
    health?: string;
    [key: string]: unknown;
  };
};

type RuntimeSnapshotInput = StatusRuntimeSnapshot | (() => StatusRuntimeSnapshot | null);

type BotBalancesPage = {
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
  items: unknown[];
};

type StatsPage = {
  page: number;
  pageSize: number;
  totalBots: number;
  totalPages: number;
  global: Record<string, unknown>;
  items: unknown[];
  generatedAt: string;
};

type AdminHandlers = {
  forceBuy?: (input: { marketIds?: string[] }) => Promise<unknown>;
  forceSell?: (input: { marketIds?: string[] }) => Promise<unknown>;
  addBots?: (input: { count: number }) => Promise<unknown>;
  manualFund?: (input: {
    botIds?: string[];
    addresses?: string[];
    amount?: number;
    token?: string;
  }) => Promise<unknown>;
  getStats?: (input: { page: number; pageSize: number }) => Promise<StatsPage>;
  addIgnoredMarkets?: (input: { marketIds: string[] }) => Promise<unknown>;
  removeIgnoredMarkets?: (input: { marketIds: string[] }) => Promise<unknown>;
  getBotBalances?: (input: { page: number; pageSize: number }) => Promise<BotBalancesPage>;
  updateRuntimeConfig?: (input: RuntimeConfigPatch) => Promise<unknown>;
};

const marketScopedBodySchema = z
  .object({
    market_ids: z.array(z.string()).optional()
  })
  .strict();

const ignoredMarketsBodySchema = z
  .object({
    market_ids: z.array(z.string()).min(1)
  })
  .strict();

const runtimeConfigPatchSchema = z
  .object({
    trading: z
      .object({
        buyChance: z.number().min(0).max(100).optional(),
        sellChance: z.number().min(0).max(100).optional(),
        maxAmount: z.number().positive().optional(),
        prefundMultiplier: z.number().positive().optional()
      })
      .strict()
      .optional(),
    funding: z
      .object({
        emergencyTopupCooldownMs: z.number().int().positive().optional(),
        minBotSol: z.number().positive().optional(),
        vaultSupportedTokens: z.array(z.string().min(1)).optional()
      })
      .strict()
      .optional(),
    price: z
      .object({
        stalePricePolicy: z.enum(["skip", "allow"]).optional()
      })
      .strict()
      .optional()
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0, { message: "empty_patch" });

const addBotsBodySchema = z
  .object({
    count: z.number().int().positive()
  })
  .strict();

const manualFundBodySchema = z
  .object({
    bot_ids: z.array(z.string()).optional(),
    addresses: z.array(z.string()).optional(),
    amount: z.number().positive().optional(),
    token: z.string().min(1).optional()
  })
  .strict();

type RuntimeConfigPatch = z.infer<typeof runtimeConfigPatchSchema>;

export function buildApp(
  config: AppConfig,
  runtimeSnapshot?: RuntimeSnapshotInput,
  adminHandlers: AdminHandlers = {},
  logger?: StructuredLogger
): FastifyInstance {
  const app = Fastify({ logger: false });

  if (logger) {
    app.addHook("onRequest", async (request) => {
      logger.debug?.("http_request", {
        method: request.method,
        url: request.url,
        remoteAddress: request.ip
      });
    });

    app.addHook("onResponse", async (request, reply) => {
      const statusCode = reply.statusCode;
      const fields = {
        method: request.method,
        url: request.url,
        statusCode,
        durationMs: Math.round(reply.elapsedTime ?? 0)
      };
      if (statusCode >= 500) {
        logger.error("http_response", fields);
      } else if (statusCode >= 400) {
        logger.warn?.("http_response", fields);
      } else {
        logger.info?.("http_response", fields);
      }
    });

    app.setErrorHandler((error, request, reply) => {
      logger.error("http_unhandled_error", {
        method: request.method,
        url: request.url,
        message: error.message,
        statusCode: reply.statusCode
      });
      reply.send(error);
    });
  }
  const resolveRuntimeSnapshot = () => {
    if (!runtimeSnapshot) {
      return null;
    }

    if (typeof runtimeSnapshot === "function") {
      return runtimeSnapshot();
    }

    return runtimeSnapshot;
  };

  app.get("/health", async () => {
    return { status: "ok" };
  });

  app.register(
    async (adminScope) => {
      adminScope.addHook("onRequest", async (request, reply) => {
        const securityHeader = request.headers["x-security"];
        if (securityHeader !== config.adminSecret) {
          return reply.code(401).send({ error: "unauthorized" });
        }
      });

      adminScope.get("/status", async () => {
        const runtime = resolveRuntimeSnapshot();
        const status =
          runtime?.observability?.health === "degraded"
            ? "degraded"
            : runtime?.observability?.health === "ok"
              ? "ok"
              : "ok";

        return {
          status,
          service: "dekant-trader-bots",
          runtime
        };
      });

      adminScope.get("/stats", async (request, reply) => {
        if (!adminHandlers.getStats) {
          return reply.code(503).send({ error: "stats_unavailable" });
        }

        try {
          const pagination = parsePaginationQuery(request.query as { page?: unknown; page_size?: unknown });
          const data = await adminHandlers.getStats({
            page: pagination.page,
            pageSize: pagination.pageSize
          });

          return {
            status: "ok",
            ...data
          };
        } catch (error) {
          if (error instanceof Error && error.message.startsWith("invalid_")) {
            return reply.code(400).send({ error: error.message });
          }

          throw error;
        }
      });

      adminScope.post("/bots/add", async (request, reply) => {
        if (!adminHandlers.addBots) {
          return reply.code(503).send({ error: "bot_lifecycle_unavailable" });
        }

        const parsed = addBotsBodySchema.safeParse(request.body ?? {});
        if (!parsed.success) {
          return reply.code(400).send({ error: "invalid_payload" });
        }

        const result = await adminHandlers.addBots({
          count: parsed.data.count
        });

        return {
          status: "ok",
          result
        };
      });

      adminScope.post("/markets/ignored/add", async (request, reply) => {
        if (!adminHandlers.addIgnoredMarkets) {
          return reply.code(503).send({ error: "market_control_unavailable" });
        }

        const parsed = ignoredMarketsBodySchema.safeParse(request.body ?? {});
        if (!parsed.success) {
          return reply.code(400).send({ error: "invalid_payload" });
        }

        const result = await adminHandlers.addIgnoredMarkets({
          marketIds: parsed.data.market_ids
        });

        return {
          status: "ok",
          result
        };
      });

      adminScope.post("/markets/ignored/remove", async (request, reply) => {
        if (!adminHandlers.removeIgnoredMarkets) {
          return reply.code(503).send({ error: "market_control_unavailable" });
        }

        const parsed = ignoredMarketsBodySchema.safeParse(request.body ?? {});
        if (!parsed.success) {
          return reply.code(400).send({ error: "invalid_payload" });
        }

        const result = await adminHandlers.removeIgnoredMarkets({
          marketIds: parsed.data.market_ids
        });

        return {
          status: "ok",
          result
        };
      });

      adminScope.post("/bots/buy", async (request, reply) => {
        if (!adminHandlers.forceBuy) {
          return reply.code(503).send({ error: "buy_engine_unavailable" });
        }

        const parsed = marketScopedBodySchema.safeParse(request.body ?? {});
        if (!parsed.success) {
          return reply.code(400).send({ error: "invalid_payload" });
        }

        const cycle = await adminHandlers.forceBuy({
          marketIds: parsed.data.market_ids
        });

        return {
          status: "ok",
          cycle
        };
      });

      adminScope.post("/bots/sell", async (request, reply) => {
        if (!adminHandlers.forceSell) {
          return reply.code(503).send({ error: "sell_engine_unavailable" });
        }

        const parsed = marketScopedBodySchema.safeParse(request.body ?? {});
        if (!parsed.success) {
          return reply.code(400).send({ error: "invalid_payload" });
        }

        const cycle = await adminHandlers.forceSell({
          marketIds: parsed.data.market_ids
        });

        return {
          status: "ok",
          cycle
        };
      });

      adminScope.get("/bots/balances", async (request, reply) => {
        if (!adminHandlers.getBotBalances) {
          return reply.code(503).send({ error: "balances_unavailable" });
        }

        try {
          const pagination = parsePaginationQuery(request.query as { page?: unknown; page_size?: unknown });
          const data = await adminHandlers.getBotBalances({
            page: pagination.page,
            pageSize: pagination.pageSize
          });

          return {
            status: "ok",
            ...data
          };
        } catch (error) {
          if (error instanceof Error && error.message.startsWith("invalid_")) {
            return reply.code(400).send({ error: error.message });
          }

          throw error;
        }
      });

      adminScope.post("/bots/fund", async (request, reply) => {
        if (!adminHandlers.manualFund) {
          return reply.code(503).send({ error: "funding_unavailable" });
        }

        const parsed = manualFundBodySchema.safeParse(request.body ?? {});
        if (!parsed.success) {
          return reply.code(400).send({ error: "invalid_payload" });
        }

        const result = await adminHandlers.manualFund({
          botIds: parsed.data.bot_ids,
          addresses: parsed.data.addresses,
          amount: parsed.data.amount,
          token: parsed.data.token
        });

        return {
          status: "ok",
          result
        };
      });

      adminScope.patch("/config", async (request, reply) => {
        if (!adminHandlers.updateRuntimeConfig) {
          return reply.code(503).send({ error: "config_update_unavailable" });
        }

        const parsed = runtimeConfigPatchSchema.safeParse(request.body ?? {});
        if (!parsed.success) {
          return reply.code(400).send({ error: "invalid_payload" });
        }

        const config = await adminHandlers.updateRuntimeConfig(parsed.data);
        return {
          status: "ok",
          config
        };
      });
    },
    { prefix: "/admin" }
  );

  return app;
}
