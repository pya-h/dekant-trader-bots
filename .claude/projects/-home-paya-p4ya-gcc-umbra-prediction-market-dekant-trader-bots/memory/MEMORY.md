# Dekant Trader Bots - Project Memory

## Project Overview
Bot-manager service for DekantPM prediction market. Automates bot lifecycle, market polling, buy/sell cycles, and funding workflows. Crypto markets only (`category=crypto`, `subject=token symbol`). See [architecture.md](architecture.md) for details.

## Stack
- Node.js 20+ / TypeScript / Fastify / Zod / Vitest / Supertest
- ESM modules (`"type": "module"`, NodeNext resolution)
- No database - JSON file persistence in `state/` dir

## Key Commands
- `npm run dev` (tsx), `npm run build` (tsc), `npm run start` (node dist/server.js)
- `npm run typecheck`, `npm run lint`, `npm test` (unit + e2e)
- `npm run test:unit`, `npm run test:e2e` (separate vitest configs)

## Development Status
All 12 phases complete (TASKS.md). Clean git on `main` branch.

## External Services
- Dekant backend (`DEKANT_BACKEND_URL`) - markets, positions, buy/sell orders, bot prep
- Price service (`PRICESERVICE_URL`) - batch/single token prices from `github.com/pydea-rs/price-service`
- Faucet - fallback funding for non-vault-supported tokens
- Vault wallet - primary funding source for bots (SOL + supported tokens)

## Deployment
- Docker multi-stage build (node:20-alpine), Coolify deployment
- Persistent volume for `STATE_DIR`, healthcheck on `/health`
