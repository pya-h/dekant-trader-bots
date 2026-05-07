import Fastify, { FastifyInstance } from "fastify";
import { z } from "zod";
import { AppConfig } from "./config.js";

type StatusRuntimeSnapshot = {
  stateDir: string;
  botCount: number;
  buyChance: number;
  sellChance: number;
  maxAmount: number;
  createdBotsOnStartup: number;
  initialFundingScheduled: boolean;
};

type RuntimeSnapshotInput = StatusRuntimeSnapshot | (() => StatusRuntimeSnapshot | null);

type AdminHandlers = {
  forceBuy?: (input: { marketIds?: string[] }) => Promise<unknown>;
};

const forceBuyBodySchema = z
  .object({
    market_ids: z.array(z.string()).optional()
  })
  .strict();

export function buildApp(
  config: AppConfig,
  runtimeSnapshot?: RuntimeSnapshotInput,
  adminHandlers: AdminHandlers = {}
): FastifyInstance {
  const app = Fastify({ logger: false });
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
        return {
          status: "ok",
          service: "dekant-trader-bots",
          runtime: resolveRuntimeSnapshot()
        };
      });

      adminScope.post("/bots/buy", async (request, reply) => {
        if (!adminHandlers.forceBuy) {
          return reply.code(503).send({ error: "buy_engine_unavailable" });
        }

        const parsed = forceBuyBodySchema.safeParse(request.body ?? {});
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
    },
    { prefix: "/admin" }
  );

  return app;
}
