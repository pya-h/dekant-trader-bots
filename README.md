# Dekant Trader Bots

Automated trading bot fleet for [dekant.xyz](https://dekant.xyz), a continuous prediction market on Solana. The system manages a configurable number of bots that independently buy and sell positions in crypto prediction markets based on reference prices from an external price oracle.

## How It Works

The service runs four concurrent job loops:

1. **Market Refresh** — Periodically fetches active crypto markets from the Dekant backend, filters out ignored markets, and caches them in memory.
2. **Buy Cycle** — For each bot and each market, rolls a configurable chance to buy. If selected, fetches the current reference price, computes a prediction range (center ± spread), and submits a buy order on-chain.
3. **Sell Cycle** — Fetches each bot's open positions, rolls a sell chance, and sells positions whose current market price has moved far outside the bot's predicted range.
4. **Prefund Cycle** — Tops up bots with SOL and collateral tokens from a central vault so they always have enough to trade.

Each bot is a real Solana keypair. Trades are submitted as on-chain transactions through the Dekant program via the Anchor framework.

## Architecture

```
┌──────────────────────────────────────────────────────┐
│                   Admin Panel (HTML)                  │
│              panel-server.mjs (proxy)                │
└──────────────┬───────────────────────────────────────┘
               │ HTTP (X-Security header)
┌──────────────▼───────────────────────────────────────┐
│              Fastify Admin API                       │
│   /status  /stats  /bots/*  /markets/*  /config      │
├──────────────────────────────────────────────────────┤
│  Buy Engine  │  Sell Engine  │  Funding  │  Markets   │
├──────────────┴───────┬───────┴──────┬────┴───────────┤
│   Dekant Backend     │  Price Svc   │  Solana RPC    │
│   (markets, pos.)    │  (quotes)    │  (transactions)│
└──────────────────────┴──────────────┴────────────────┘
               │
        ┌──────▼──────┐
        │  PostgreSQL  │
        │  (state)     │
        └─────────────┘
```

## Project Structure

```
src/
├── server.ts             # Entry point — wires everything, starts job loops
├── app.ts                # Fastify routes and admin API
├── config.ts             # Environment variable parsing (Zod)
├── bootstrap.ts          # State initialization on startup
├── bots/
│   └── lifecycle.ts      # Bot creation, keypair generation
├── trading/
│   ├── buy-engine.ts     # Buy cycle logic, prediction range, collateral sizing
│   └── sell-engine.ts    # Sell cycle logic, position evaluation
├── markets/
│   └── cache.ts          # Market fetching, filtering, ignored list
├── funding/
│   └── funding-engine.ts # Prefunding, emergency topups, vault transfers
├── clients/
│   ├── dekant-client.ts  # Dekant backend HTTP client (markets, positions, orders)
│   ├── price-client.ts   # Price oracle HTTP client
│   ├── faucet-client.ts  # Token faucet client
│   └── http-client.ts    # Base HTTP client with retry and timeout
├── solana/
│   ├── transactions.ts   # Transaction building, simulation, submission
│   ├── pdas.ts           # Program-derived addresses
│   ├── units.ts          # Decimal/base-unit conversion
│   └── program/          # Anchor IDL for the Dekant program
├── state/
│   ├── types.ts          # Zod schemas for BotRecord, RuntimeConfig
│   └── position-memory.ts# In-memory position tracking (center, spread per bot×market)
├── storage/
│   ├── state-store.ts    # Storage interface
│   └── pg-state-store.ts # PostgreSQL implementation
├── observability/
│   ├── logger.ts         # Pino structured logging
│   ├── runtime-monitor.ts# Per-job metrics (runs, successes, failures, last error)
│   └── errors.ts         # Error classification (type, retryable, known)
└── metrics/
    └── trade-stats.ts    # Per-bot trade statistics aggregation

panel.html                # Admin dashboard (single-file HTML/CSS/JS)
panel-server.mjs          # Lightweight proxy server for the admin panel
Dockerfile                # Multi-stage production build
```

## Configuration

Copy `.env.example` and fill in the required values:

```bash
cp .env.example .env
```

### Required

| Variable | Description |
|----------|-------------|
| `DATABASE_URL` | PostgreSQL connection string |
| `DEKANT_BACKEND_URL` | Dekant backend API |
| `PRICESERVICE_URL` | Price oracle API |
| `SOLANA_RPC_URL` | Solana RPC endpoint |
| `VAULT_SECRET_KEY` | Base58-encoded vault keypair (funds bots) |
| `ADMIN_SECRET` | Bearer token for admin API authentication |

### Optional — Fleet & Trading

| Variable | Default | Description |
|----------|---------|-------------|
| `BOT_COUNTS` | `5` | Number of bots to create on startup |
| `BUY_CHANCE` | `90` | Percent chance each bot buys per market per cycle |
| `SELL_CHANCE` | `35` | Percent chance each bot evaluates a position for sale |
| `MAX_AMOUNT` | `1000` | Maximum collateral per buy order |
| `PREFUND_MULTIPLIER` | `10` | Funding target = `MAX_AMOUNT × multiplier` |
| `MIN_BOT_SOL` | `0.1` | Minimum SOL balance before emergency topup |
| `STALE_PRICE_POLICY` | `skip` | `skip` or `allow` — how to handle stale price quotes |

### Optional — Intervals (require restart)

| Variable | Default | Description |
|----------|---------|-------------|
| `BUY_INTERVAL_MS` | `1200000` | Buy cycle interval (20 min) |
| `SELL_INTERVAL_MS` | `3600000` | Sell cycle interval (1 hour) |
| `MARKET_REFRESH_INTERVAL_MS` | `3600000` | Market cache refresh (1 hour) |
| `FUNDING_INTERVAL_MS` | `3600000` | Prefunding cycle (1 hour) |
| `INITIAL_FUNDING_DELAY_MS` | `30000` | Delay before first funding after bot creation |

### Optional — HTTP Tuning

Timeout, retry count, and backoff can be configured per client (`PRICE_*`, `DEKANT_*`, `FAUCET_*`). See `.env.example` for the full list.

## Runtime Configuration

Trading parameters can be changed at runtime without restarting, via `PATCH /admin/config`:

```bash
curl -X PATCH http://localhost:3000/admin/config \
  -H "X-Security: YOUR_SECRET" \
  -H "Content-Type: application/json" \
  -d '{"trading": {"buyChance": 80, "maxAmount": 500}}'
```

Updatable fields:
- **Trading**: `buyChance`, `sellChance`, `maxAmount`
- **Funding**: `prefundMultiplier`, `emergencyTopupCooldownMs`, `minBotSol`
- **Price**: `stalePricePolicy`

Changes are persisted to the database and take effect on the next cycle.

## Admin API

All endpoints (except `/health`) require the `X-Security` header.

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/health` | Health check (no auth) |
| `GET` | `/admin/status` | Service status, runtime config, observability metrics |
| `GET` | `/admin/stats` | Paginated per-bot trade statistics |
| `GET` | `/admin/bots/balances` | Paginated bot SOL + token balances |
| `GET` | `/admin/vault/balances` | Vault wallet balances |
| `POST` | `/admin/bots/add` | Create new bots `{count: N}` |
| `POST` | `/admin/bots/buy` | Force a buy cycle `{market_ids?: [...]}` |
| `POST` | `/admin/bots/sell` | Force a sell cycle `{market_ids?: [...]}` |
| `POST` | `/admin/bots/fund` | Manual funding `{bot_ids?, addresses?, amount?, token?}` |
| `POST` | `/admin/markets/ignored/add` | Ignore markets `{market_ids: [...]}` |
| `POST` | `/admin/markets/ignored/remove` | Unignore markets `{market_ids: [...]}` |
| `PATCH` | `/admin/config` | Update runtime config (partial) |

## Admin Panel

A single-file HTML dashboard for managing the bot fleet through a browser.

**Features:**
- Live status monitoring with auto-refresh
- Runtime config editing (buy/sell chance, amounts, funding params)
- Force buy/sell cycles with optional market scoping
- Bot management (add bots, view balances, manual funding)
- Trade statistics with pagination
- Observability dashboard (job metrics, error details)
- Ignored market management

**Running the panel:**

```bash
# Proxy to production
node panel-server.mjs

# Proxy to local dev server
node panel-server.mjs http://localhost:3000

# Custom port
PORT=9009 node panel-server.mjs
```

The proxy server serves the panel at `http://localhost:9009` and forwards API requests to the bot service, handling CORS.

## Trading Logic

### Buy Strategy

Each buy cycle:
1. Fetches cached markets and current prices from the oracle
2. For each bot × market pair, rolls `BUY_CHANCE`%
3. Computes a prediction range around the reference price:
   - **Center**: reference price ± a random offset (scaled by days to market deadline)
   - **Spread**: logarithmically scaled by market liquidity and fleet size
   - **Max deviation**: grows from ~1% near deadline to ~30% at 100+ days out
4. Sizes the collateral amount based on max amount, liquidity, fleet size, and recent bot activity
5. Submits the buy order on-chain

### Sell Strategy

Each sell cycle:
1. Fetches all open positions for each bot from the Dekant backend
2. For each position, rolls `SELL_CHANCE`%
3. Compares the current market price against the bot's stored prediction range
4. Sells if the price has moved more than ~3% outside the predicted range
5. Full position liquidation (burns all tokens, receives collateral back)

### Position Memory

When a bot buys into a market, the prediction center and spread are saved to an in-memory index (persisted to the database). This memory is used during sell cycles to decide whether a position should be closed based on how far the market has moved from the bot's original prediction.

## Observability

The service tracks per-job metrics accessible via `/admin/status`:
- Run count, success count, failure count per job
- Action-level failure counts (individual bot×market failures within a cycle)
- Last error type and message per job
- Classified error types: `validation`, `unauthorized`, `rate_limited`, `upstream_timeout`, `upstream_unavailable`, `network`, `unknown`
- Known vs unknown error distinction for alerting

Structured JSON logs via Pino cover all key events: cycle starts/completions, trade submissions, errors, and funding operations.

## Development

```bash
# Install dependencies
npm install

# Run in development (live TypeScript)
npm run dev

# Type check
npm run typecheck

# Lint and format
npm run lint
npm run format

# Run tests
npm test          # all tests
npm run test:unit # unit tests only
npm run test:e2e  # e2e tests only
```

## Deployment

Docker multi-stage build for production:

```bash
docker build -t dekant-trader-bots .
docker run -p 3000:3000 --env-file .env dekant-trader-bots
```

- Base image: `node:20-alpine`
- Runs as non-root `node` user
- Uses `tini` for proper signal handling
- Health check: `GET /health` every 30 seconds
