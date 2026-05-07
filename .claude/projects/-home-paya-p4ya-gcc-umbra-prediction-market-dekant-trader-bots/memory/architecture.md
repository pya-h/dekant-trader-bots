# Architecture & Codebase Map

## Source Structure (`src/`)
```
src/
  server.ts          - Entry point: createInitializedApp() + start(), all loops & wiring
  app.ts             - Fastify app builder with admin routes & Zod validation
  bootstrap.ts       - State bootstrapping (env -> config -> JSON files)
  config.ts          - Env schema (Zod), EnvConfig, AppConfig, buildAppConfig()
  state/types.ts     - Zod schemas for RuntimeConfigFile, BotRecord, BotsStateFile
  clients/
    http-client.ts   - requestJsonWithRetry() with timeout/retry/backoff, HttpResponseError
    dekant-client.ts - DekantClient interface + HttpDekantClient (markets, positions, buy/sell, prepareBotUser)
    price-client.ts  - PriceClient (batch+single fetch, stale policy, resolveMarketPrices)
    faucet-client.ts - FaucetClient interface + HttpFaucetClient (checkAvailability, requestTokens)
  storage/
    json-file.ts     - readJsonFile, writeJsonFileAtomic (tmp+rename pattern)
    bots-state-store.ts   - ensureBotsState, saveBotsState
    runtime-config-store.ts - ensureRuntimeConfig, makeInitialRuntimeConfig, saveRuntimeConfig
  bots/
    lifecycle.ts     - createBotRecord, reconcileBotsToTarget, reconcileAndPersistBots, addBotsAndPersist
    initial-funding.ts - scheduleInitialFundingIfNeeded (delayed timer on fresh startup)
  markets/
    cache.ts         - MarketCache class (refresh, filterEligibleMarkets, ignored market mgmt)
  trading/
    buy-engine.ts    - BuyEngine class, rollChance, buildPredictionRange, computeBuyCollateralAmount
    sell-engine.ts   - SellEngine class, isPositionFarFromPredictedRange, decideSellMode, pickPartialSellAmount
  funding/
    engine.ts        - FundingEngine class (manualFund, prefundBots, requestEmergencyTopup, cooldown)
  metrics/
    trade-stats.ts   - TradeStatsStore (ingestBuyCycle/ingestSellCycle, getSummary with pagination)
  observability/
    errors.ts        - classifyError() -> ClassifiedError (known/unknown, retryable, type)
    runtime-monitor.ts - RuntimeMonitor (job counters, health="ok"|"degraded", snapshot)
  api/
    pagination.ts    - parsePaginationQuery() (page, page_size, defaults 50/max 200)
```

## Key Design Patterns
- **Dependency injection**: All external dependencies are interfaces (DekantClient, FaucetClient, VaultClient, BalanceClient) injected via constructor/options. `server.ts` wires everything.
- **Interval loops**: Market refresh, buy, sell, funding - each with configurable intervals, start/stop, immediate-run option. Timer providers are injectable for testing.
- **Error isolation**: Each bot/market action failure is caught individually; never crashes process.
- **Two-layer config**: Immutable intervals from `.env`; mutable knobs in `state/runtime-config.json` (admin-editable via PATCH /admin/config).
- **Atomic JSON writes**: tmp file + rename pattern for corruption safety.
- **Randomness injection**: `random: () => number` parameter everywhere for deterministic testing.
- **Structured logging**: JSON error logs with timestamp, event, job, errorType, known, retryable.

## Admin API Routes (all require `x-security` header)
- GET /health (public), GET /admin/status, GET /admin/stats, GET /admin/bots/balances
- POST /admin/bots/add, /admin/bots/buy, /admin/bots/sell, /admin/bots/fund
- POST /admin/markets/ignored/add, /admin/markets/ignored/remove
- PATCH /admin/config

## Test Structure
- `test/unit/` - 15 unit test files covering all modules
- `test/e2e/` - 10 e2e test files (health, auth, state bootstrap, engines, admin, fault tolerance, full system, runtime loops)
- `test/helpers/` - config.ts, observability.ts shared helpers

## Trading Logic
- **Buy**: rollChance(buyChance) -> buildPredictionRange(price, deadline) -> computeBuyCollateralAmount(maxAmount, liquidity, fleet, bot state) -> submitBuyOrder
- **Sell**: fetchPositions -> buildPredictionRange -> isPositionFarFromPredictedRange -> rollChance(sellChance) -> decideSellMode(partial 75%/full 25%) -> pickPartialSellAmount -> submitSellOrder
- **Prediction range**: maxDeviation = clamp(0.01 + remainingDays * 0.003, 0.01, 0.3); center randomized around price; spread randomized within deviation bounds
- **Amount sizing**: base = maxAmount * (0.25 + rand * 0.6) * liquidityFactor * fleetFactor * botFactor; clamped to [minAmount, maxAmount]

## Funding Flow
- Periodic prefunding (all bots, all vault-supported tokens)
- Emergency topup with per-bot cooldown (cooldown tracked in Map)
- Vault for supported tokens (USDT, USDC default); faucet fallback for unsupported tokens
- SOL fee topup: minBotSol threshold, target = 2x minBotSol
