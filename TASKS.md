# Dekant Trader Bots - Development Tasks

This plan is phase-based and test-first. We only move to the next phase when current phase tests pass.

## Delivery Rules
- Write tests with each phase (unit + e2e), not at the end.
- Keep intervals immutable at runtime (from `.env`), mutable knobs in JSON runtime config.
- Never let worker errors crash the process; failures are isolated, logged, and skipped.
- Every endpoint that returns large arrays must support optional pagination.
- Stack decision for this roadmap is fixed: Node.js + TypeScript + Fastify.
- Elysia refactor is explicitly out-of-scope for current phases; it is only a possible future optimization.

## Suggested Tooling (Node + TS)
- Runtime and server: Node.js + TypeScript + Fastify.
- Unit tests: Vitest.
- HTTP e2e tests: Supertest.
- Contract/schema validation: Zod.
- HTTP mocking for external services: Nock or MSW (node mode).

## [x] Phase 1 - Project Bootstrap and Test Harness
- Create project skeleton (`src`, `test/unit`, `test/e2e`, `state`, `docs`).
- Initialize Node + TypeScript + Fastify setup.
- Add lint/format/typecheck scripts.
- Add unit/e2e test runners and base CI scripts.
- Add basic app bootstrap and `GET /health` endpoint.

Unit tests:
- App config loads with defaults.
- Fastify app instance boots/shuts down cleanly.

E2E tests:
- `GET /health` returns `200` and expected payload.
- Invalid admin header on protected route returns `401` or `403`.

Exit criteria:
- `npm run typecheck`, unit tests, and e2e tests all pass.

## [x] Phase 2 - Config System and Persistence Core
- Implement `.env` parser/validator for required keys.
- Implement runtime config JSON lifecycle:
  - first run reads `.env`, creates `state/runtime-config.json`.
  - next runs read mutable config from JSON.
- Implement bot state JSON store (`state/bots.json`) with atomic writes.
- Define typed models for bot records, runtime config, ignored markets, vault-supported tokens.

Unit tests:
- Missing/invalid env values fail fast with clear errors.
- Runtime config bootstrap and reload behavior works as specified.
- Atomic write/read and corruption guard behavior.

E2E tests:
- App starts from empty `state/` and creates required JSON files.
- App restart uses persisted JSON values for mutable config.

Exit criteria:
- State files are created/read correctly and validated.

## [x] Phase 3 - External Clients (Dekant, Price, Faucet)
- Implement `dekant-client` interfaces (markets, positions, buy, sell, user prep hooks).
- Implement `price-client` using `PRICESERVICE_URL`:
  - batch `GET /prices?tokens=...`
  - single `GET /prices/{token}` fallback
  - stale/missing handling policy.
- Implement optional `faucet-client` interface for unsupported vault tokens.
- Add retry/backoff/timeout wrappers for all outbound calls.

Unit tests:
- Price token normalization (`trim + uppercase`).
- Batch response parsing, missing token handling, stale policy behavior.
- Retry/backoff triggers only within configured limits.

E2E tests:
- With mocked price service, app correctly maps `market.subject -> price`.
- Batch miss triggers single-token fallback.
- Stale price causes skip for affected markets.

Exit criteria:
- All client adapters are typed, tested, and resilient.

## [x] Phase 4 - Bot Lifecycle and Initial Provisioning
- Implement startup bot manager:
  - load existing bots
  - create missing bots to reach `BOT_COUNTS`
  - persist keypairs/states.
- Implement first-start delayed initial funding flow.
- Implement admin add-bots workflow internals.

Unit tests:
- Startup reconciliation creates only missing bots.
- Reuse existing bot keypairs on restart.
- Initial funding delay behavior respects configured delay.

E2E tests:
- Fresh startup creates target bot count and schedules initial funding.
- Restart does not duplicate bots.
- Add-bots operation increases bot count and persists records.

Exit criteria:
- Bot identity lifecycle is stable across restarts.

## [x] Phase 5 - Funding Engine (Vault + SOL + Cooldown + Fallback)
- Implement periodic prefunding strategy.
- Implement emergency low-balance top-up with per-bot cooldown.
- Implement SOL fee top-up checks.
- Enforce vault-supported token list behavior.
- Implement unsupported-token fallback flow:
  - faucet check/request
  - graceful skip when unavailable/exhausted.

Unit tests:
- Cooldown blocks repeated quick refills.
- Vault-supported token filter logic.
- Amount selection with optional manual amount override.

E2E tests:
- Out-of-interval manual fund: all bots when no selector.
- Selector-based fund targets union of bot IDs/addresses.
- Unsupported token path uses faucet fallback and then skip when unavailable.

Exit criteria:
- Funding behavior is predictable, safe, and non-bursty.

## [x] Phase 6 - Market Cache and Active Market Refresh Loop
- Implement market refresh scheduler.
- Keep in-memory active market cache synchronized by interval.
- Apply eligibility filters (crypto, tradable, not ignored).

Unit tests:
- Market filter correctness.
- Cache update behavior and stale cache fallback policy.

E2E tests:
- Scheduler refresh updates active market set over time.
- Ignored market updates affect next trade cycles.

Exit criteria:
- Active market cache is reliable and filter-correct.

## [x] Phase 7 - Buy Engine
- Implement per-buy-tick sequence:
  - collect active markets
  - fetch unique token prices once
  - run per-bot per-market buy chance
  - generate prediction center/spread
  - compute collateral amount with caps and factors
  - submit buys.
- Enforce price missing/stale skip behavior.

Unit tests:
- Chance gate math (`0..100`, threshold handling).
- Prediction range widening/narrowing by time-to-deadline.
- Amount sizing (market state + fleet state + bot state + max cap).

E2E tests:
- Forced buy endpoint triggers immediate cycle.
- Optional market list restricts buy scope.
- Multi-bot cycle uses shared price fetch (no per-bot duplicate fetch).

Exit criteria:
- Buy loop produces realistic, bounded, and diverse bot actions.

## [x] Phase 8 - Sell Engine
- Implement per-sell-tick sequence:
  - inspect positions
  - compute predicted range
  - identify far-out positions
  - sell-chance gate
  - choose partial vs full exit (partial-biased randomness)
  - submit sells.

Unit tests:
- Far-from-range classifier behavior.
- Partial vs full decision weighting.
- Random partial amount boundaries and validity.

E2E tests:
- Forced sell endpoint only acts on bots with positions.
- Optional market list restricts sell scope.
- Non-position bots are skipped cleanly.

Exit criteria:
- Sell loop consistently de-risks out-of-range positions without over-selling.

## [x] Phase 9 - Admin API (Core Controls)
- Implement admin auth middleware (`x-security`).
- Implement endpoints:
  - ignored markets add/remove
  - app status
  - wallet balances
  - runtime config update (mutable keys only).
- Enforce pagination on large-list responses.

Unit tests:
- Auth middleware success/failure paths.
- Config patch validator rejects interval mutations.
- Pagination parser and defaults.

E2E tests:
- Endpoints enforce auth.
- Ignored markets persist and affect runtime behavior.
- Config changes persist to JSON and survive restart.

Exit criteria:
- Admin control surface is secure enough for v1 and persistence-correct.

## [x] Phase 10 - Admin API (Operations and Stats)
- Implement endpoints:
  - stats summary
  - add bots
  - force buy
  - force sell
  - manual fund.
- Add stats aggregation model:
  - per-bot traded totals
  - global totals
  - concise operational metrics.

Unit tests:
- Stats aggregation correctness across mock trade events.
- Manual operation payload validation.
- Fund selector union logic.

E2E tests:
- Force buy/sell/fund operations execute correctly with and without market selectors.
- Add bots endpoint runs full creation + first-time readiness path.
- Stats endpoint returns paginated per-bot details plus global totals.

Exit criteria:
- Ops endpoints are reliable for admin-driven interventions.

## [x] Phase 11 - Fault Tolerance, Observability, and Recovery
- Implement known-error classification and retry policy.
- Add global safety wrappers for scheduler jobs (never crash process).
- Add structured logging with context: bot ID, market ID, token, cycle type, error type.
- Add uptime/runtime counters for status endpoint.

Unit tests:
- Known vs unknown error routing behavior.
- Retry limits and backoff timing logic.
- Job isolation ensures one failure does not stop other bot/market actions.

E2E tests:
- Inject failing external dependencies; app continues operating.
- Verify status endpoint reflects degraded but running state.

Exit criteria:
- App is resilient under partial outages and bad responses.

## [x] Phase 12 - Full System E2E and Release Readiness
- Build comprehensive scenario suite using mocked integrations.
- Validate end-to-end flows:
  - startup bootstrap
  - scheduled trading
  - manual operations
  - restart persistence
  - funding fallback paths.
- Add production runbook (`docs/RUNBOOK.md`) and env template (`.env.example`).
- Add final readiness checklist for Coolify deployment.

Unit tests:
- Final regression suite for core engines and helpers.

E2E tests:
- Golden path: normal buy/sell/funding cycles.
- Stress path: many bots + market subsets + intermittent failures.
- Restart path: state continuity and config continuity.

Exit criteria:
- All test suites green, runbook ready, and deployment checklist complete.

## Ongoing Quality Gates (for Every PR)
- Typecheck, lint, unit tests, and e2e tests must pass.
- New behavior requires tests in the same PR.
- Bug fixes require a failing test first, then implementation.
- No silent fallback that hides critical data corruption.
