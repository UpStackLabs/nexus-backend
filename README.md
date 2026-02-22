# Nexus Backend

NestJS 11 + TypeScript API server powering **Nexus** — an interactive 3D globe that visualizes how global events (geopolitical crises, military conflicts, economic shocks, natural disasters) propagate as financial market shockwaves across countries, sectors, and stocks.

Built for **Hacklytics 2026** (Finance track).

> The app runs without any API keys — every service falls back to seed data automatically.

## Getting Started

```bash
# Install dependencies
npm install

# Start the dev server (port 3000)
npm run start:dev
```

Swagger UI is available at [localhost:3000/api/docs](http://localhost:3000/api/docs).

### Optional Services

```bash
# Actian VectorAI DB + Python bridge
docker compose up

# LSTM price prediction server (port 8002, lightweight)
cd model-server && python start_lstm_only.py

# Full model server — LSTM + HuggingFace (port 8002)
cd model-server && python main.py
```

## Scripts

| Script | Description |
|--------|-------------|
| `npm run start:dev` | Dev server with hot-reload |
| `npm run build` | TypeScript production build |
| `npm run start:prod` | Run compiled `dist/main.js` |
| `npm run lint` | ESLint with `--fix` |
| `npm run format` | Prettier |
| `npm run test` | Jest unit tests |
| `npm run test:watch` | Jest in watch mode |
| `npm run test:e2e` | End-to-end tests |

## Architecture

All REST endpoints are prefixed with `/api`.

### Feature Modules

| Module | Endpoint | Purpose |
|--------|----------|---------|
| `events/` | `/api/events` | Event CRUD + shock scores per event |
| `stocks/` | `/api/stocks` | Stock lookup, ticker analysis, surprise factor |
| `globe/` | `/api/globe` | Heatmap and arc data for 3D visualization |
| `simulate/` | `/api/simulate` | What-if simulation for hypothetical events |
| `sectors/` | `/api/sectors` | Sector-level aggregated impact |
| `historical/` | `/api/historical` | Find historically similar events |
| `ingestion/` | `/api/ingest` | News ingestion pipeline (cron + manual trigger) |
| `chat/` | `/api/chat` | RAG-powered AI financial analyst with streaming |
| `osint/` | `/api/osint` | Satellite/CCTV image analysis pipeline |
| `health/` | `/api/health` | Health check |

### Core Services

- **Shock Engine** — Composite impact formula: `S(c,e) = 0.35·sim + 0.25·H + 0.20·G + 0.20·SC`
- **NLP** — OpenAI gpt-4o-mini for event classification + text-embedding-3-small for embeddings
- **Vector DB** — Actian VectorAI DB client via Python FastAPI bridge (port 8001)
- **Market Data** — Cascading price fallback: Polygon → Alpaca → FMP → seed data
- **Vision** — Object detection + scene classification via Python model-server
- **WebSocket Gateway** — Socket.io with rooms: `events`, `shocks`, `prices`, `surprises`

### Model Server (`model-server/`)

Python FastAPI server (port 8002) providing ML inference:

- `POST /classify` — Zero-shot event classification (BART-MNLI or keyword fallback)
- `POST /embed` — Sentence embedding via all-MiniLM-L6-v2 (384-dim)
- `POST /predict-price` — LSTM 30-day stock price prediction with confidence bands
- `POST /predict-shock` — Rule-based shock magnitude prediction
- `POST /vision/detect` — Object detection
- `POST /vision/classify` — Scene classification

Pre-trained LSTM models are stored in `model-server/models/<TICKER>/`. Train new ones with `python train.py`.

### Infrastructure

- **Docker** — Node 22-alpine multi-stage build, runs as non-root `node` user
- **docker-compose.yml** — Actian VectorAI DB (gRPC on 50051) + Python bridge (port 8001)
- **AWS CDK** (`infra/`) — VPC → ECS Fargate (512 CPU / 1024 MiB) behind ALB, auto-scaling 1–4 tasks

## Environment Variables

Copy `.env.example` to `.env`. All keys are optional — the app degrades gracefully to seed data.

| Variable | Default | Purpose |
|----------|---------|---------|
| `PORT` | `3000` | Server port |
| `CORS_ORIGIN` | `http://localhost:5173` | Allowed CORS origin |
| `OPENAI_API_KEY` | — | Event classification + embeddings |
| `ACTIAN_BRIDGE_URL` | `http://localhost:8001` | Vector DB bridge |
| `MODEL_SERVER_URL` | `http://localhost:8002` | LSTM predictions + vision |
| `OLLAMA_URL` | `http://localhost:11434` | Local Ollama for chat RAG |
| `NEWSAPI_KEY` | — | NewsAPI source |
| `ACLED_KEY` / `ACLED_EMAIL` | — | ACLED conflict data |
| `POLYGON_API_KEY` | — | Polygon market data |
| `FINNHUB_API_KEY` | — | Finnhub market data |

## License

Built for Hacklytics 2026.
