# Dekant Trader Bots - Requirements and Build Spec (v1)

## 1) Purpose and Context
This service is a bot-manager application for `DekantPM` (the prediction market project).

The bot manager will:
- Create and prepare bot users automatically in DekantPM.
- Hold bot identities and runtime state.
- Periodically fetch crypto markets from DekantPM backend.
- Periodically run buy and sell logic for each bot.
- Try to make market curves move toward realistic values based on external asset prices.

Important scope notes:
- Primary integration targets are DekantPM **backend** and **program**.
- This app uses only a limited subset of DekantPM features needed for bot trading.
- Current focus is crypto price markets only:
  - `category = crypto`
  - `subject` is the asset symbol (token symbol).

## 2) Persistence and State Storage
User preference is to avoid a database.

Decision for v1:
- Use local JSON-file based persistence (no DB).
- Security requirement is relaxed (devnet bots), so storing bot keypairs in local JSON is acceptable for now.
- Bot keypairs should persist across restarts so the same bots continue working.
- Bot identities/keypairs are reset only when service state is explicitly reset.

JSON persistence should store at least:
- Bot identities and keypairs.
- Bot runtime/account states.
- Per-bot metadata needed for trading/funding.
- Global config-like runtime data that must survive restart (example: ignored market IDs).
- Operational counters/statistics snapshots.

Recommended JSON split:
- `state/bots.json`:
  - bot identities/keypairs
  - bot balances/status snapshots
  - bot-level trading/funding metadata
- `state/runtime-config.json`:
  - ignored market IDs
  - admin-updated runtime config values
  - non-sensitive mutable service settings

## 3) Bot Lifecycle Responsibilities
The manager must:
- Spawn/manage a configured number of bots.
- `BOT_COUNTS` (env) defines initial bot count target at first startup.
- Prepare each bot for operation (keypair/account readiness, balances readiness).
- Ensure bots can trade over time without manual intervention.
- On startup, load existing bots from JSON first, then create only missing bots if target count is not met.
- Support admin-triggered bot creation after startup (add bots endpoint).
- On first startup (fresh bot creation), after initial setup completes, wait a configurable startup delay then run initial funding.

## 4) Market Fetching and In-Memory Cache
The service must fetch market list from DekantPM backend on a configurable interval.

Requirements:
- Example interval: every 1 hour (configurable via `.env`).
- Keep fetched markets in memory for worker loops.
- Market refresh should be centralized (fetch once per cycle, not once per bot).
- Always refresh active/eligible markets on each market-refresh tick.
- `market.subject` is the canonical asset token ID for price lookup (for example `SOL`, `BTC`).
- Apply filters so only target markets are kept:
  - crypto category markets
  - valid market state for trading
  - not in ignored market list.

## 5) Buy Loop Behavior
Bots trade on a separate buy interval (example: every 20 minutes, configurable).

High-level buy flow per buy tick:
1. Build unique token list from eligible markets using `market.subject` and fetch prices (once per token per cycle, shared across bots).
2. For each eligible market and each bot:
   - Bot must attempt that market by running chance logic (dice) for that market.
   - If bot passes chance and has funds, generate trade params and submit trade.

### Buy chance (human-like behavior)
- Buy participation is probabilistic.
- Dice rule: generate random in `[0, 100]` and allow action when value is within configured chance threshold.
- Example: buy chance = `90` means `rand < 90` participates.
- Buy chance must be an env variable.
- Buy chance should be higher than sell chance.

### Buy prediction logic (intentionally simple, but aware)
For each market:
- Start from **current external asset price**.
- Estimate a near-future expected value based on time-to-deadline:
  - larger allowed deviation for longer remaining time
  - smaller deviation for short remaining time.
- Generate randomized center/spread around that expected value:
  - center = randomized bet point near expected value
  - spread = randomized confidence width.
- Multiple bots must follow same logic but produce different trades via randomness.

Goal:
- Trades should look like multiple aware users.
- Trades should help move curve toward logical values.

## 6) Sell Loop Behavior
Selling should run on its own interval (example: every 1 hour, configurable).

Sell logic requirements:
- At each sell tick, bots inspect their positions.
- Bot computes the currently predicted range for each market (same prediction foundation as buy flow).
- If a held position is far from predicted range, it becomes sell-candidate.
- Candidate actions are probabilistic (sell chance dice gate).
- If chance passes, bot sells either:
  - a random partial amount (default/common path), or
  - full exit (rarer path).

### Sell chance
- Sell chance is an env variable.
- Same dice mechanism as buy chance.
- Typically lower than buy chance.
- Partial sell amount does not require advanced logic in v1; randomization is enough.

## 7) Shared Data Fetch Optimization
The service must avoid repeated duplicated network calls.

Requirements:
- Fetch markets once per market-refresh interval.
- Fetch asset prices once per asset per cycle and share result across all bots.
- Primary price fetch path should use batch endpoint:
  - `GET /prices?tokens=BTC,ETH,SOL`
- Secondary fallback fetch can use single-token endpoint for misses/retries:
  - `GET /prices/{token}`
- Do not fetch price separately for every bot action.
- Keep fetched/cached data in memory with clear refresh strategy.
- If price response for a market token is missing, skip that market in current cycle.
- If price is marked stale, default behavior in v1 is skip trading that market for that cycle and log a warning.

## 8) Funding Strategy (Vault -> Bots)
Bots need both collateral tokens and SOL (for fees).

Funding source:
- A shared vault keypair in `.env`.
- Manager can transfer funds from vault to bots.
- Vault-supported token IDs must be maintained in a dedicated array in state/config.
- Funding from vault only applies to vault-supported tokens.

Optimization requirement:
- Avoid “request funds on every trade”.
- This causes slowness, tx bursts, higher failure risk.

Required funding model:
- Periodic pre-funding interval (configurable):
  - top up bots with random larger allocations
  - example guideline: around 10x typical trade size.
- Fallback emergency top-up:
  - when bot detects low balance during action.
  - emergency top-up must enforce a per-bot cooldown to prevent refill bursts.
  - cooldown duration must be configurable via env (example default: 5 minutes).

Additional requirement:
- Ensure each bot also has enough SOL for transaction fees.

Unsupported-token behavior:
- If market token is not in vault-supported tokens, no vault top-up should happen for that token.
- For unsupported tokens, bot should try fallback faucet flow:
  - check whether faucet exists/available for that token
  - if available, request faucet funds and trade with those limited funds
  - when faucet is exhausted/unavailable, skip that token until later cycles.

## 9) Trade Amount Sizing
Trade amounts must be meaningful but bounded.

Requirements:
- Amount logic should account for:
  - market liquidity
  - number of bots acting together
  - additional scaling considerations.
- Compute a sizing factor from market context and bot system context.
- Randomized amount generation should be multiplied by this factor.
- Hard cap with `MAX_AMOUNT` env to prevent irrationally large trades.
- Amounts should be neither too tiny nor too huge.
- Combined actions of all bots should have meaningful market impact while staying rational per bot.
- Final amount decision should consider:
  - market state
  - global bot fleet state
  - specific bot state (balance/exposure/recent activity).

## 10) API Server Responsibilities
This app is not only workers; it must also expose admin endpoints.

Server requirements:
- Provide endpoints for admin monitoring/control.
- Include lightweight authentication.

Authentication preference:
- Simple header-based secret is acceptable (example: `x-security` header).
- Does not need enterprise-grade auth for this stage.

### 10.1 Admin endpoint set (v1)
1. Ignored markets management:
   - add ignored market IDs
   - remove ignored market IDs.
2. App status:
   - uptime
   - worker/scheduler state
   - bot counts and active bot count
   - high-level service health.
3. Bot statistics:
   - per-bot traded amounts summary
   - total traded amounts across bots
   - concise aggregate operational summary.
4. Add bots:
   - create additional bots beyond initial `BOT_COUNTS`
   - generate keypairs
   - prepare accounts
   - provide SOL and supported collateral tokens for first-time readiness.
5. Bots wallet balances:
   - list of all bot wallet balances/status.
6. Runtime config update:
   - allow admin updates for mutable configs (amount limits, chances, related knobs)
   - intervals are excluded (interval changes require `.env` update + restart).
7. Manual buy trigger:
   - force buy cycle immediately
   - optional market list: if provided, only those markets are used; otherwise all eligible markets.
8. Manual sell trigger:
   - force sell cycle immediately
   - only bots with positions act
   - optional market list: if provided, only those markets are used; otherwise all eligible markets.
9. Manual fund trigger:
   - no parameters: fund all bots out-of-interval
   - optional bot IDs and/or addresses: fund only selected bots
   - optional amount: if provided, use exact amount; if omitted, use normal funding logic.

### 10.2 Pagination requirement
- Endpoints returning large arrays must support optional pagination.
- Minimum query params:
  - `page`
  - `page_size`
- If pagination is omitted, server should use safe defaults.

## 11) Configuration Surface (.env)
All key intervals/chances/limits must be configurable via env.

Minimum expected env groups:
- Integration:
  - Dekant backend URL
  - chain/program context
  - price service base URL (`PRICESERVICE_URL`, placeholder for now until service is live)
- Vault:
  - vault secret key
- Scheduling:
  - market refresh interval
  - buy interval
  - sell interval
  - funding interval
  - initial funding delay after first startup setup
- Bot fleet:
  - `BOT_COUNTS` initial target
- Probabilities:
  - buy chance
  - sell chance
- Funding/amounts:
  - min bot balances
  - prefund multipliers
  - emergency top-up cooldown
  - max amount cap
  - vault-supported tokens list (or equivalent bootstrap source)
- Price client:
  - request timeout
  - retry count
  - retry backoff
  - stale-price policy (default: skip stale markets)
- Security:
  - admin secret header value.
- Randomness:
  - use true runtime randomness (no deterministic seed mode in v1).

### 11.1 Env-to-JSON config lifecycle
- On first server start:
  - read config defaults from `.env`
  - create runtime config JSON and persist mutable values there.
- On subsequent restarts:
  - read mutable configs from runtime config JSON (source of truth for mutable knobs)
  - intervals still come from `.env` and are not runtime-mutable.
- Admin config endpoint may update mutable JSON config values only (not intervals).

## 12) Runtime Characteristics
The bot system should:
- Run continuously.
- Keep shared caches in memory.
- Execute per-bot actions independently, but share common fetched data.
- Favor stability and retry-safe behavior over raw speed.
- Be fault-tolerant: individual action failures must not crash the process.
- Handle known errors with targeted behavior (retry/skip/backoff/log).
- Handle unknown errors by logging context and continuing with next action.
- Enforce per-task error isolation so one bot/market failure does not block others.

## 13) Suggested Initial Architecture (Implementation-Oriented)
Proposed internal modules:
- `config`: env parsing and validation.
- `storage`: JSON state read/write with safe atomic updates.
- `dekant-client`:
  - markets fetch
  - user auth/signature workflow if needed
  - buy/sell execution wrappers.
- `price-client`: external asset price fetch + in-memory cache.
- `bot-engine`:
  - prediction model
  - trade param generation
  - buy/sell decision logic.
- `funding-engine`:
  - periodic prefunding
  - fallback top-up
  - SOL fee top-up.
- `faucet-client`:
  - faucet availability checks
  - faucet request flow for unsupported vault tokens.
- `scheduler`: interval orchestration.
- `api-server`: admin endpoints + security middleware.
- `metrics`: counters/statistics for API reporting.
- `error-policy`:
  - known-error classification
  - retry/backoff policy
  - unknown-error guardrails and safe-continue behavior

## 14) Stack Discussion and Recommendation
You suggested Node + TypeScript, and asked whether ElysiaJS is a good fit.

### Practical recommendation for this project
- **Runtime**: `Node.js`
- **Language**: `TypeScript`
- **Server framework**: `Fastify` (recommended default)

Why this default:
- Strong compatibility with Solana/Dekant tooling ecosystem.
- Mature operational behavior for long-running worker + API service.
- Easy plugin/middleware and structured logging.
- No Bun runtime dependency required.

### ElysiaJS option
Elysia can also work, and it is valid if you want it.

Caveat for this project:
- Elysia is Bun-optimized; while multi-runtime support exists, the lowest-friction path for this bot service + Solana stack is still Node-first.

Conclusion:
- If priority is **lowest integration risk**: choose **Node + TS + Fastify**.
- If priority is **Elysia DX and Bun-first experimentation**: Elysia is possible, but I’d still keep the bot core runtime assumptions conservative.

## 15) Clarification Status (Resolved)
Resolved from latest input:
1. Bot keypairs persist in JSON and are reused after restart (reset only on explicit service/state reset).
2. Each cycle, each bot should attempt each eligible market with per-market chance gating.
3. Selling should be random partial most of the time, with occasional full exit.
4. Ignored markets and similar mutable configs should be stored in a separate JSON config file.
5. Randomness should be real runtime randomness (no deterministic seed mode needed).
6. Service must be crash-resistant: known errors handled; unknown errors logged and skipped.
7. Emergency low-balance top-up must use per-bot cooldown (configurable) to avoid repeated quick refills.
8. Endpoint set includes ignored markets, status, stats, add bots, balances, config update, force buy/sell, and manual fund.
9. Mutable config values persist in JSON and are admin-editable; interval changes require restart.
10. Vault funds only vault-supported tokens; unsupported tokens follow faucet fallback behavior.

## 16) Price Service Integration (Confirmed)
Price source for this bot manager is the dedicated price-service server (not direct Pyth calls from this app).

Service repository:
- `https://github.com/pydea-rs/price-service`

Base URL:
- configured by env `PRICESERVICE_URL` (placeholder for now until deployment is live).

### 16.1 Token mapping rules
- Use market asset symbol from `market.subject` as token ID.
- Normalize input before calls:
  - trim whitespace
  - uppercase token string.
- Example: market with `subject=SOL` must resolve through `GET /prices/SOL` (or batched query).
- v1 assumption: direct symbol match only (no alias map unless explicitly added later).

### 16.2 Endpoint contract used by bot manager
- `GET /prices/{token}`:
  - single-token fetch
  - returns 404 when token not found.
- `GET /prices?tokens=BTC,ETH,SOL`:
  - batch fetch for multiple tokens in one request
  - response is an array
  - unknown tokens may be omitted from response.
- `GET /health`:
  - connectivity/readiness check
  - expected success body: `{"status":"ok"}`.
- `GET /events` (SSE):
  - real-time stream of updates
  - optional in v1, not required for initial implementation.

### 16.3 Price object fields used by trading logic
Expected fields:
- `token_id`
- `price`
- `ema_price`
- `confidence`
- `timestamp` (UTC RFC3339)
- `stale` (optional; when present and true, data is outdated)

v1 trading usage:
- Decision baseline is `price`.
- `ema_price` and `confidence` are stored/logged for future logic improvements.
- `timestamp` and `stale` are used for freshness checks.

### 16.4 Per-tick fetch sequence (buy or sell cycle)
On each buy tick or sell tick:
1. Collect eligible markets for that cycle.
2. Build unique token set from `market.subject`.
3. Call batch endpoint once for all tokens.
4. Build in-memory map: `token -> latest price payload`.
5. For tokens missing in batch result:
   - optionally attempt targeted single-token fetch.
   - if still missing, mark token unavailable for this cycle.
6. For each market action:
   - if token has unavailable or stale price, skip trade action for that market.
   - otherwise continue with prediction and trade logic.

### 16.5 Freshness and failure policy
- Service price updates are expected about every 60 seconds.
- If response indicates `stale=true`, treat as outdated for v1 and skip affected market actions for that cycle.
- Network/API failures from price service must never crash workers:
  - log error with token/cycle context
  - continue with remaining markets/bots
  - use retry policy within configured limits.

### 16.6 SSE usage decision for v1
- v1 can run fully on REST polling and interval-based workflow.
- SSE integration is a future optimization path:
  - can reduce request overhead
  - can keep near-live cache between buy/sell ticks.

## 17) Endpoint Shape Proposal (v1 Draft)
This section proposes concrete route shapes for the confirmed endpoint set.

1. `POST /admin/markets/ignored/add`
   - body: `market_ids: string[]`
2. `POST /admin/markets/ignored/remove`
   - body: `market_ids: string[]`
3. `GET /admin/status`
4. `GET /admin/stats`
   - supports pagination for per-bot arrays
5. `POST /admin/bots/add`
   - body: `count: number`
6. `GET /admin/bots/balances`
   - supports pagination
7. `PATCH /admin/config`
   - body: mutable config keys only
8. `POST /admin/bots/buy`
   - body optional: `market_ids?: string[]`
9. `POST /admin/bots/sell`
   - body optional: `market_ids?: string[]`
10. `POST /admin/bots/fund`
   - body optional:
     - `bot_ids?: string[]`
     - `addresses?: string[]`
     - `amount?: number`
   - selector behavior:
     - if no selectors are provided, target all bots
     - if selectors are provided, target union of matched bots.

Auth for all admin routes:
- required header: `x-security: <ADMIN_SECRET>`

---

This document captures the current requirements and constraints for implementation. Additional refinements can be layered without changing core architecture.
