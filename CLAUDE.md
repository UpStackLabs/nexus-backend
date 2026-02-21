# ShockGlobe — NestJS Backend

## Project Overview
ShockGlobe is the backend API for an interactive 3D globe-based visualization platform
that connects global events (geopolitical crises, economic shifts, military movements,
policy changes) to their predicted market impacts across countries, sectors, and stocks.

Built for **Hacklytics 2026** (Finance track) by team **UpStackLabs**.

## Tech Stack
- **Runtime**: Node.js with NestJS 11 + TypeScript
- **API Docs**: Swagger/OpenAPI at `/api/docs`
- **WebSockets**: Socket.io via `@nestjs/websockets`
- **Validation**: class-validator + class-transformer
- **Config**: @nestjs/config with `.env` files

## Architecture
```
src/
  main.ts                     # Bootstrap, Swagger, CORS
  app.module.ts               # Root module
  common/
    types/                    # Shared TypeScript interfaces
    dto/                      # Shared DTOs (pagination, etc.)
    data/                     # Seed/mock data for demo
  events/                     # GET /api/events, /api/events/:id, /api/events/:id/shocks
  stocks/                     # GET /api/stocks, /api/stocks/:ticker, /api/stocks/:ticker/surprise
  globe/                      # GET /api/globe/heatmap, /api/globe/arcs
  simulate/                   # POST /api/simulate
  sectors/                    # GET /api/sectors
  historical/                 # GET /api/historical/similar
  gateway/                    # WebSocket gateway (events/live, shocks/live, prices/live, surprises/alerts)
```

## API Prefix
All REST endpoints are prefixed with `/api`. Swagger UI is at `/api/docs`.

## Key Domain Concepts
- **Event**: A global event (geopolitical, economic, military, policy, natural disaster) with location, severity, type
- **Shock Score**: `S(c,e) = α·sim(ve,vc) + β·H(c,e) + γ·G(c,e) + δ·SC(c,e)` — composite score for a company given an event
- **Surprise Factor**: `|ΔP_actual - ΔP_predicted| / σ` — how unexpectedly a stock moved
- **Interlinkedness Score**: Average pairwise correlation of price changes conditioned on an event

## Conventions
- Use NestJS module pattern: each feature has its own module, controller, service, and DTOs
- All DTOs use class-validator decorators for validation
- All endpoints are documented with @nestjs/swagger decorators
- Services return typed data matching the interfaces in `common/types/`
- Currently uses in-memory mock data; designed for easy swap to real DB/APIs later
- WebSocket gateway uses Socket.io namespaces matching the plan's channels

## Running
```bash
npm run start:dev    # Development with hot-reload
npm run build        # Production build
npm run start:prod   # Production server
```

## Environment Variables
Copy `.env.example` to `.env`:
- `PORT` — Server port (default: 3000)
- `CORS_ORIGIN` — Allowed CORS origin (default: http://localhost:5173)

## Frontend Integration
The frontend (React + Globe.GL + Vite) connects to this backend:
- REST API: `http://localhost:3000/api/*`
- WebSocket: `http://localhost:3000` with Socket.io client
- CORS is configured to allow the frontend origin
