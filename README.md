# Nexus — Backend API

**Hacklytics 2026 · Finance Track · Nexus**

Nexus is the backend for an interactive 3D globe that connects global events (geopolitical crises, military conflicts, economic shocks, policy changes) to their predicted market impacts across countries, sectors, and stocks.

Built with **NestJS 11 + TypeScript**. Swagger UI at `/api/docs`.

---

## Architecture

```
src/
  app.module.ts
  common/types/          Shared TypeScript interfaces
  common/data/           Seed / mock data
  events/                GET /api/events
  stocks/                GET /api/stocks, GET /api/stocks/:ticker/analysis
  globe/                 GET /api/globe/heatmap, /arcs
  simulate/              POST /api/simulate
  sectors/               GET /api/sectors
  historical/            GET /api/historical/similar
  nlp/                   OpenAI embedding + event classification
  vector-db/             Actian VectorAI bridge client
  ingestion/             GDELT / NewsAPI / ACLED → NLP → VectorDB cron
  market-data/           Polygon → Alpaca → FMP price polling
  shock-engine/          S(c,e) composite shock formula
  gateway/               Socket.io WebSocket gateway

vectorai-bridge/
  main.py                FastAPI REST wrapper around actiancortex (gRPC)
  Dockerfile
  requirements.txt

docker-compose.yml       Actian VectorAI DB + Python bridge
```

---

## Prerequisites

- Node.js 20+
- Docker + Docker Compose (for Actian VectorAI DB)
- Python 3.11+ is **not** required locally — Docker handles the bridge

---

## Quick Start

### 1. Install Node dependencies

```bash
npm install
```

### 2. Configure environment

```bash
cp .env.example .env
```

Open `.env` and fill in any keys you have. The app runs fine without them — it falls back to seed data automatically.

| Variable | Purpose | Required for |
|---|---|---|
| `OPENAI_API_KEY` | Event classification + embeddings | Real ingestion |
| `ACTIAN_BRIDGE_URL` | Vector similarity search | Real vector search |
| `NEWSAPI_KEY` | NewsAPI event feed | Real ingestion |
| `ACLED_KEY` / `ACLED_EMAIL` | ACLED conflict feed | Real ingestion |
| `POLYGON_API_KEY` | Live stock prices (primary) | Real market data |
| `ALPACA_API_KEY` / `ALPACA_API_SECRET` | Live prices (fallback) | Real market data |
| `FMP_API_KEY` | Live prices (fallback) | Real market data |

### 3. Start Actian VectorAI DB + bridge

```bash
docker compose up
```

This starts two containers:

- **vectoraidb** — Actian VectorAI DB gRPC server on port `50051`
- **vectorai-bridge** — Python FastAPI wrapper on port `8001`

The bridge auto-creates the `event_vectors` collection (1536-dim, cosine) on startup. Set `ACTIAN_BRIDGE_URL=http://localhost:8001` in `.env`.

> **macOS Apple Silicon**: Docker pulls a `linux/amd64` image — make sure Rosetta 2 is installed (`softwareupdate --install-rosetta`).

### 4. Start the API server

```bash
npm run start:dev
```

The server starts on `http://localhost:3000`.

---

## Key Endpoints

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/events` | List global events |
| `GET` | `/api/events/:id/shocks` | Shock scores for an event |
| `GET` | `/api/stocks` | List stocks (filter by sector/country) |
| `GET` | `/api/stocks/:ticker/analysis` | Full shock analysis via vector search |
| `GET` | `/api/stocks/:ticker/surprise` | Surprise factor / anomaly detection |
| `POST` | `/api/simulate` | What-if simulation for a custom event |
| `GET` | `/api/globe/heatmap` | Country-level shock heatmap |
| `GET` | `/api/globe/arcs` | Connection arcs for globe visualisation |
| `GET` | `/api/sectors` | Sector-level aggregated impacts |
| `GET` | `/api/historical/similar` | Find historically similar events |
| `POST` | `/api/ingest` | Manually trigger news ingestion pipeline |

Full interactive docs: **`http://localhost:3000/api/docs`**

---

## WebSocket

Connect with Socket.io to `http://localhost:3000`. Emit subscription events to join rooms:

| Emit | Room | Receives |
|---|---|---|
| `subscribe:events` | events | `events:new` — live ingested events |
| `subscribe:shocks` | shocks | `shocks:update` — shock score updates |
| `subscribe:prices` | prices | `prices:update` — live price ticks |
| `subscribe:surprises` | surprises | `surprises:alert` — anomaly alerts |

Price ticks come from `MarketDataService` (real, every 60 s during market hours) or a mock 5-second interval when no `POLYGON_API_KEY` is set.

---

## Shock Formula

```
S(c,e) = 0.35 · sim  +  0.25 · H  +  0.20 · G  +  0.20 · SC
```

- **sim** — vector similarity between stock embedding and event embedding (Actian VectorAI)
- **H** — historical sensitivity of the stock to similar events
- **G** — geographic proximity (Haversine distance, normalised)
- **SC** — supply-chain / sector linkage score

---

## Data Pipeline

```
GDELT / NewsAPI / ACLED
        ↓  (every 5 min via cron)
  OpenAI gpt-4o-mini  →  classify event (type, severity, location, tickers)
  OpenAI text-embedding-3-small  →  1536-dim vector
        ↓
  Actian VectorAI DB  (via Python bridge)
        ↓
  WebSocket  →  frontend globe
```

`POST /api/ingest` triggers the pipeline manually.

---

## Available Scripts

```bash
npm run start:dev    # Dev server with hot-reload
npm run build        # Production TypeScript build
npm run start:prod   # Run production build
npm run test         # Unit tests
npm run test:e2e     # End-to-end tests
```
