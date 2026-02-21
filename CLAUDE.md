# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

ShockGlobe backend — NestJS 11 + TypeScript API for an interactive 3D globe that visualizes how global events propagate as financial market shockwaves. Built for **Hacklytics 2026** (Finance track) by **Nexus**.

The app runs without any API keys — every service falls back to seed data in `common/data/seed-data.ts` automatically.

## Commands

```bash
npm run start:dev                             # Dev server with hot-reload (port 3000)
npm run build                                 # TypeScript production build
npm run start:prod                            # Run compiled dist/main.js
npm run lint                                  # ESLint with --fix
npm run format                                # Prettier
npm run test                                  # Jest unit tests (src/**/*.spec.ts)
npm run test:watch                            # Jest watch mode
npm run test:e2e                              # E2E tests (test/jest-e2e.json)
npm run test -- --testPathPattern=<pattern>   # Run a single test file
docker compose up                             # Start Actian VectorAI DB + Python bridge
```

## Architecture

All REST endpoints use the `/api` prefix. Swagger UI at `/api/docs`.

### Module Dependency Graph

**AppModule** imports ConfigModule (global) and ScheduleModule, then all modules below:

**Feature modules** (controller + service + DTOs each):
- `events/` — Event CRUD + shock scores per event
- `stocks/` — Stock lookup, ticker analysis, surprise factor (imports `MarketDataModule`, `ShockEngineModule`)
- `globe/` — Heatmap and arc data for 3D visualization
- `simulate/` — What-if simulation for hypothetical events
- `sectors/` — Sector-level aggregated impact
- `historical/` — Find historically similar events
- `ingestion/` — News pipeline with cron + manual trigger (imports `NlpModule`, `VectorDbModule`, `GatewayModule`)
- `health/` — Health check at `/api/health`

**Core service modules** (injected into feature modules):
- `shock-engine/` — Composite shock formula (imports `VectorDbModule`, `NlpModule`)
- `nlp/` — OpenAI gpt-4o-mini classification + text-embedding-3-small embeddings
- `vector-db/` — Client for Actian VectorAI DB via Python FastAPI bridge (port 8001)
- `market-data/` — Price polling with cascading fallback (imports `GatewayModule`)
- `gateway/` — Socket.io WebSocket gateway; rooms: `events`, `shocks`, `prices`, `surprises`

### Key Cross-Cutting Patterns

**Seed data fallback** — Every service checks for API keys / external service availability. On failure or missing keys, it returns data from `common/data/seed-data.ts` (SEED_EVENTS, SEED_STOCKS, SEED_SHOCKS, SEED_HEATMAP, SEED_ARCS) with a log warning. This is the core design pattern; preserve it when adding new features.

**Market data cascade** — `MarketDataService.getPrice(ticker)` tries in order: Polygon (2s timeout) → Alpaca (5s) → FMP (5s) → seed price. Returns `LivePrice` with `source` field indicating which succeeded. Polls every 1 minute during market hours (EST 9:30–16:00 weekdays), batching 5 tickers with 200ms delays.

**Ingestion pipeline** — `@Cron('0 */5 * * * *')` or `POST /api/ingest`: NewsIngestionService fetches from GDELT/NewsAPI/ACLED → NLP classifies each article (type, severity, location, tickers) → embeds to 1536-dim vector → upserts to VectorAI DB → broadcasts via gateway WebSocket.

**Shock engine formula** — `S(c,e) = 0.35·sim + 0.25·H + 0.20·G + 0.20·SC` where sim = cosine similarity from vector DB, H = historical sensitivity, G = geographic proximity (inverse haversine), SC = supply-chain linkage via EVENT_SECTOR_MAP. Aggregates top-3 events. Risk levels: low/medium/high/critical.

**WebSocket gateway** — Clients subscribe to rooms via `subscribe:events`, `subscribe:shocks`, `subscribe:prices`, `subscribe:surprises`. Services emit via `emitNewEvent()`, `emitShockUpdate()`, `emitPriceUpdate()`, `emitSurpriseAlert()`. Falls back to mock price ticks (5s interval, ±2% jitter) when no POLYGON_API_KEY.

### Infrastructure

- **Docker**: `Dockerfile` — Node 22-alpine multi-stage build, runs as non-root `node` user
- **docker-compose.yml**: Actian VectorAI DB (gRPC on 50051) + Python FastAPI bridge (`vectorai-bridge/`, port 8001)
- **CDK** (`infra/`): `ShockglobeStack` — VPC → ECS Fargate (512 CPU / 1024 MiB) behind ALB, auto-scaling 1–4 tasks at 70% CPU / 80% memory, sticky sessions for Socket.io, secrets from AWS Secrets Manager, circuit breaker enabled

### Shared Types

Type interfaces live in `common/types/` — event, stock, shock, globe, simulation, analysis, market-data. Services return typed data matching these interfaces. Key types: `ShockEvent`, `EventShock`, `ShockScore`, `Stock`, `StockAnalysis`, `HeatmapEntry`, `ConnectionArc`, `LivePrice`, `SimulationRequest/Result`.

## Conventions

- Each feature gets its own NestJS module, controller, service, and DTO directory
- DTOs use `class-validator` decorators; endpoints use `@nestjs/swagger` decorators
- TypeScript target ES2023, module resolution `nodenext`
- `noImplicitAny: false` and `no-explicit-any: off` — `any` is allowed
- Prettier: single quotes, trailing commas
- NLP service name is `SphinxNlpService` (in `nlp/sphinx-nlp.service.ts`)

## Environment Variables

Copy `.env.example` to `.env`. All are optional — the app degrades gracefully:
- `PORT` (3000), `CORS_ORIGIN` (http://localhost:5173)
- `OPENAI_API_KEY` — classification + embeddings
- `ACTIAN_BRIDGE_URL` — vector DB bridge (http://localhost:8001 with docker compose)
- `NEWSAPI_KEY`, `ACLED_KEY`, `ACLED_EMAIL` — news sources
- `POLYGON_API_KEY`, `ALPACA_API_KEY`, `ALPACA_API_SECRET`, `FMP_API_KEY` — market data cascade
