"""
Actian VectorAI Bridge
======================
Thin FastAPI wrapper around the actiancortex Python client.
Exposes three REST endpoints for the NestJS backend:

  GET  /health   — liveness check
  POST /upsert   — store an event embedding
  POST /search   — nearest-neighbour query
"""

from __future__ import annotations

import asyncio
import logging
import os
from contextlib import asynccontextmanager

from fastapi import FastAPI, HTTPException
from pydantic import BaseModel

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
logger = logging.getLogger(__name__)

COLLECTION_NAME = "event_vectors"
DIMENSION = 1536
VECTORAI_HOST = os.getenv("VECTORAI_HOST", "localhost")
VECTORAI_PORT = os.getenv("VECTORAI_PORT", "50051")

_client = None


@asynccontextmanager
async def lifespan(app: FastAPI):
    global _client
    address = f"{VECTORAI_HOST}:{VECTORAI_PORT}"
    logger.info(f"Connecting to Actian VectorAI at {address}")
    try:
        from actiancortex import CortexClient, DistanceMetric  # type: ignore

        client = CortexClient(address=address)
        client.connect()

        if not client.collection_exists(COLLECTION_NAME):
            client.create_collection(
                name=COLLECTION_NAME,
                dimension=DIMENSION,
                distance_metric=DistanceMetric.COSINE,
            )
            logger.info(f"Created collection '{COLLECTION_NAME}' (dim={DIMENSION}, COSINE)")
        else:
            logger.info(f"Collection '{COLLECTION_NAME}' already exists — reusing")

        _client = client
        logger.info("VectorAI bridge ready")
    except Exception as exc:
        logger.warning(f"Could not connect to VectorAI DB: {exc} — bridge will return 503")
        _client = None

    yield

    if _client is not None:
        try:
            _client.close()
        except Exception:
            pass


app = FastAPI(title="Actian VectorAI Bridge", lifespan=lifespan)


class UpsertRequest(BaseModel):
    event_id: str
    embedding: list[float]
    metadata: dict


class SearchRequest(BaseModel):
    embedding: list[float]
    top_k: int = 10


class SearchResult(BaseModel):
    event_id: str
    similarity: float
    metadata: dict


@app.get("/health")
async def health():
    return {"status": "ok", "connected": _client is not None}


@app.post("/upsert")
async def upsert(req: UpsertRequest):
    if _client is None:
        raise HTTPException(status_code=503, detail="Vector DB not connected")
    try:
        vector_id = abs(hash(req.event_id)) % (2**31)
        payload = {**req.metadata, "_event_id": req.event_id}
        await asyncio.to_thread(
            _client.upsert,
            collection_name=COLLECTION_NAME,
            id=vector_id,
            vector=req.embedding,
            payload=payload,
        )
        return {"success": True}
    except Exception as exc:
        logger.error(f"Upsert error: {exc}")
        raise HTTPException(status_code=500, detail=str(exc))


@app.post("/search", response_model=list[SearchResult])
async def search(req: SearchRequest):
    if _client is None:
        raise HTTPException(status_code=503, detail="Vector DB not connected")
    try:
        results = await asyncio.to_thread(
            _client.search,
            collection_name=COLLECTION_NAME,
            query=req.embedding,
            top_k=req.top_k,
            with_payload=True,
        )
        return [
            SearchResult(
                event_id=r.payload.get("_event_id", str(r.id)),
                similarity=float(r.score),
                metadata={k: v for k, v in r.payload.items() if k != "_event_id"},
            )
            for r in results
        ]
    except Exception as exc:
        logger.error(f"Search error: {exc}")
        raise HTTPException(status_code=500, detail=str(exc))
