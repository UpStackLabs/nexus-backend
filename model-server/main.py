"""
Nexus Model Server
==================
FastAPI wrapper around pre-trained HuggingFace models.
Serves NLP classification, text embeddings, shock prediction,
and vision inference for the ShockGlobe NestJS backend.

Endpoints
---------
GET  /health              - Liveness + loaded model list
POST /classify            - Zero-shot event classification (BART-MNLI / keyword fallback)
POST /embed               - Sentence embedding via all-MiniLM-L6-v2 (384-dim)
POST /predict-shock       - Rule-based shock magnitude prediction
POST /vision/detect       - Object detection (realistic mock — avoids ultralytics dep)
POST /vision/classify     - Scene classification (realistic mock)
"""

from __future__ import annotations

import asyncio
import io
import logging
import math
import random
import re
import time
from contextlib import asynccontextmanager
from functools import partial
from typing import Any

import numpy as np
import requests
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from PIL import Image
from pydantic import BaseModel

# ---------------------------------------------------------------------------
# Logging
# ---------------------------------------------------------------------------
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s [%(name)s] %(message)s",
)
logger = logging.getLogger("model-server")

# ---------------------------------------------------------------------------
# Global model registry
# ---------------------------------------------------------------------------
_models: dict[str, Any] = {}
_loaded_model_names: list[str] = []


# ---------------------------------------------------------------------------
# Domain knowledge: keywords, countries, sectors, tickers
# ---------------------------------------------------------------------------

EVENT_TYPE_KEYWORDS: dict[str, list[str]] = {
    "military": [
        "war", "attack", "missile", "bomb", "troops", "military", "combat",
        "invasion", "airstrike", "conflict", "weapon", "artillery", "navy",
        "army", "drone", "explosion", "terrorist", "insurgent", "coup",
        "offensive", "battalion", "soldier", "casualty", "casualties", "siege",
        "blockade", "warship", "fighter jet", "nuclear", "warhead", "arms",
    ],
    "economic": [
        "recession", "inflation", "gdp", "trade", "tariff", "sanction",
        "bank", "interest rate", "federal reserve", "fed", "debt", "default",
        "unemployment", "market crash", "stock market", "currency", "dollar",
        "yuan", "euro", "oil price", "commodity", "supply chain", "export",
        "import", "deficit", "surplus", "fiscal", "monetary", "bond yield",
        "credit rating", "bankruptcy", "bailout", "stimulus", "quantitative",
    ],
    "policy": [
        "regulation", "law", "legislation", "congress", "parliament", "senate",
        "election", "vote", "government", "policy", "reform", "executive order",
        "treaty", "agreement", "accord", "summit", "diplomat", "ambassador",
        "foreign policy", "trade deal", "ban", "restriction", "subsidy",
        "tax", "budget", "spending", "appropriation", "mandate", "directive",
    ],
    "natural_disaster": [
        "earthquake", "tsunami", "hurricane", "typhoon", "cyclone", "flood",
        "wildfire", "drought", "tornado", "volcano", "eruption", "landslide",
        "avalanche", "blizzard", "storm", "disaster", "emergency", "magnitude",
        "richter", "fema", "evacuation", "relief", "damage", "destruction",
        "climate", "weather", "seismic", "aftershock", "fatalities",
    ],
    "geopolitical": [
        "tension", "dispute", "protest", "unrest", "demonstration", "riot",
        "border", "territorial", "sovereignty", "sanction", "embargo",
        "spy", "espionage", "intelligence", "nato", "un", "united nations",
        "security council", "alliance", "coalition", "opposition", "regime",
        "dictator", "democracy", "authoritarian", "human rights",
        "refugee", "migrant", "crisis", "standoff", "ultimatum",
    ],
}

SEVERITY_AMPLIFIERS: dict[str, int] = {
    "catastrophic": 3, "devastating": 3, "massive": 2, "critical": 2,
    "severe": 2, "major": 2, "significant": 1, "serious": 1,
    "urgent": 1, "emergency": 2, "crisis": 2, "unprecedented": 2,
    "escalation": 1, "escalating": 1, "spreading": 1, "worsening": 1,
    "nuclear": 4, "world war": 4, "global": 2, "widespread": 2,
    "collapse": 3, "meltdown": 3, "explosion": 2, "killing": 2,
    "thousands": 2, "millions": 3, "billions": 1, "record": 1,
}

SEVERITY_DIMINISHERS: dict[str, int] = {
    "minor": -2, "small": -1, "limited": -1, "contained": -2,
    "manageable": -2, "stable": -2, "recovery": -1, "easing": -2,
    "de-escalation": -3, "ceasefire": -2, "peace": -2, "resolved": -3,
    "improving": -2, "slight": -1, "minimal": -2, "moderate": -1,
}

# Country name/demonym -> ISO2 code mapping (subset covering most news events)
COUNTRY_TO_ISO2: dict[str, str] = {
    "united states": "US", "usa": "US", "america": "US", "american": "US",
    "united kingdom": "GB", "uk": "GB", "britain": "GB", "british": "GB",
    "china": "CN", "chinese": "CN", "prc": "CN",
    "russia": "RU", "russian": "RU",
    "ukraine": "UA", "ukrainian": "UA",
    "germany": "DE", "german": "DE",
    "france": "FR", "french": "FR",
    "japan": "JP", "japanese": "JP",
    "india": "IN", "indian": "IN",
    "iran": "IR", "iranian": "IR",
    "israel": "IL", "israeli": "IL",
    "saudi arabia": "SA", "saudi": "SA",
    "south korea": "KR", "korean": "KR",
    "north korea": "KP",
    "taiwan": "TW", "taiwanese": "TW",
    "brazil": "BR", "brazilian": "BR",
    "canada": "CA", "canadian": "CA",
    "australia": "AU", "australian": "AU",
    "turkey": "TR", "turkish": "TR",
    "pakistan": "PK", "pakistani": "PK",
    "mexico": "MX", "mexican": "MX",
    "indonesia": "ID", "indonesian": "ID",
    "nigeria": "NG", "nigerian": "NG",
    "south africa": "ZA",
    "venezuela": "VE", "venezuelan": "VE",
    "colombia": "CO", "colombian": "CO",
    "argentina": "AR", "argentinian": "AR",
    "egypt": "EG", "egyptian": "EG",
    "ethiopia": "ET", "ethiopian": "ET",
    "poland": "PL", "polish": "PL",
    "ukraine": "UA", "ukrainian": "UA",
    "philippines": "PH", "filipino": "PH",
    "vietnam": "VN", "vietnamese": "VN",
    "thailand": "TH", "thai": "TH",
    "iraq": "IQ", "iraqi": "IQ",
    "syria": "SY", "syrian": "SY",
    "afghanistan": "AF", "afghan": "AF",
    "myanmar": "MM", "burmese": "MM",
    "sudan": "SD", "sudanese": "SD",
    "somalia": "SO", "somali": "SO",
    "libya": "LY", "libyan": "LY",
    "yemen": "YE", "yemeni": "YE",
    "haiti": "HT", "haitian": "HT",
    "guyana": "GY", "guyanese": "GY",
    "venezuela": "VE",
    "caracas": "VE",  # capital -> country fallback
    "beijing": "CN",
    "moscow": "RU",
    "washington": "US",
    "kyiv": "UA",
    "kiev": "UA",
    "tehran": "IR",
    "jerusalem": "IL",
    "tel aviv": "IL",
    "seoul": "KR",
    "pyongyang": "KP",
    "taipei": "TW",
    "tokyo": "JP",
    "new delhi": "IN",
    "islamabad": "PK",
    "ankara": "TR",
    "riyadh": "SA",
}

# Event type -> relevant financial sectors
EVENT_SECTOR_MAP: dict[str, list[str]] = {
    "military": ["Defense", "Energy", "Cybersecurity", "Aerospace", "Materials"],
    "economic": ["Financials", "Consumer Staples", "Industrials", "Real Estate", "Technology"],
    "policy": ["Healthcare", "Financials", "Technology", "Utilities", "Consumer Discretionary"],
    "natural_disaster": ["Insurance", "Utilities", "Real Estate", "Materials", "Consumer Staples"],
    "geopolitical": ["Energy", "Financials", "Materials", "Agriculture", "Transportation"],
}

# Sector -> representative tickers
SECTOR_TICKER_MAP: dict[str, list[str]] = {
    "Defense": ["LMT", "RTX", "NOC", "GD", "BA"],
    "Energy": ["XOM", "CVX", "COP", "SLB", "HAL"],
    "Cybersecurity": ["CRWD", "PANW", "ZS", "FTNT", "S"],
    "Aerospace": ["BA", "LMT", "RTX", "HII", "TDG"],
    "Materials": ["FCX", "NEM", "AA", "CLF", "MP"],
    "Financials": ["JPM", "BAC", "GS", "MS", "C"],
    "Consumer Staples": ["PG", "KO", "PEP", "WMT", "COST"],
    "Industrials": ["GE", "CAT", "DE", "MMM", "HON"],
    "Real Estate": ["AMT", "PLD", "CCI", "EQIX", "PSA"],
    "Technology": ["AAPL", "MSFT", "NVDA", "GOOGL", "META"],
    "Healthcare": ["JNJ", "PFE", "UNH", "MRK", "ABBV"],
    "Utilities": ["NEE", "DUK", "SO", "D", "AEP"],
    "Consumer Discretionary": ["AMZN", "TSLA", "HD", "MCD", "NKE"],
    "Insurance": ["BRK.B", "AIG", "ALL", "PGR", "TRV"],
    "Agriculture": ["ADM", "BG", "CTVA", "MOS", "NTR"],
    "Transportation": ["UPS", "FDX", "DAL", "UAL", "CSX"],
}

# Cities/regions commonly mentioned with rough coordinates for location extraction
NOTABLE_LOCATIONS: list[tuple[str, str]] = [
    ("washington", "Washington, USA"),
    ("new york", "New York, USA"),
    ("beijing", "Beijing, China"),
    ("shanghai", "Shanghai, China"),
    ("moscow", "Moscow, Russia"),
    ("kyiv", "Kyiv, Ukraine"),
    ("kiev", "Kyiv, Ukraine"),
    ("london", "London, UK"),
    ("paris", "Paris, France"),
    ("berlin", "Berlin, Germany"),
    ("tokyo", "Tokyo, Japan"),
    ("seoul", "Seoul, South Korea"),
    ("pyongyang", "Pyongyang, North Korea"),
    ("tehran", "Tehran, Iran"),
    ("jerusalem", "Jerusalem, Israel"),
    ("tel aviv", "Tel Aviv, Israel"),
    ("riyadh", "Riyadh, Saudi Arabia"),
    ("ankara", "Ankara, Turkey"),
    ("islamabad", "Islamabad, Pakistan"),
    ("new delhi", "New Delhi, India"),
    ("caracas", "Caracas, Venezuela"),
    ("taipei", "Taipei, Taiwan"),
    ("cairo", "Cairo, Egypt"),
    ("nairobi", "Nairobi, Kenya"),
    ("lagos", "Lagos, Nigeria"),
    ("sydney", "Sydney, Australia"),
    ("toronto", "Toronto, Canada"),
    ("brussels", "Brussels, Belgium"),
    ("warsaw", "Warsaw, Poland"),
    ("budapest", "Budapest, Hungary"),
    ("manila", "Manila, Philippines"),
    ("jakarta", "Jakarta, Indonesia"),
    ("bangkok", "Bangkok, Thailand"),
    ("hanoi", "Hanoi, Vietnam"),
    ("baghdad", "Baghdad, Iraq"),
    ("damascus", "Damascus, Syria"),
    ("kabul", "Kabul, Afghanistan"),
    ("yangon", "Yangon, Myanmar"),
    ("khartoum", "Khartoum, Sudan"),
    ("mogadishu", "Mogadishu, Somalia"),
    ("tripoli", "Tripoli, Libya"),
    ("sanaa", "Sana'a, Yemen"),
    ("port-au-prince", "Port-au-Prince, Haiti"),
    ("red sea", "Red Sea"),
    ("south china sea", "South China Sea"),
    ("taiwan strait", "Taiwan Strait"),
    ("persian gulf", "Persian Gulf"),
    ("black sea", "Black Sea"),
    ("strait of hormuz", "Strait of Hormuz"),
]

# Vision mock data pools by inferred scene type
MILITARY_DETECTIONS = [
    {"label": "military_vehicle", "confidence": 0.92},
    {"label": "armored_personnel_carrier", "confidence": 0.87},
    {"label": "military_truck", "confidence": 0.84},
    {"label": "helicopter", "confidence": 0.79},
    {"label": "soldier", "confidence": 0.95},
    {"label": "tank", "confidence": 0.88},
    {"label": "warship", "confidence": 0.83},
    {"label": "military_aircraft", "confidence": 0.91},
]
CIVILIAN_DETECTIONS = [
    {"label": "crowd", "confidence": 0.89},
    {"label": "building", "confidence": 0.94},
    {"label": "vehicle", "confidence": 0.87},
    {"label": "person", "confidence": 0.96},
    {"label": "street", "confidence": 0.82},
    {"label": "infrastructure", "confidence": 0.78},
]
DISASTER_DETECTIONS = [
    {"label": "flood_damage", "confidence": 0.85},
    {"label": "collapsed_structure", "confidence": 0.91},
    {"label": "fire", "confidence": 0.88},
    {"label": "debris", "confidence": 0.86},
    {"label": "emergency_vehicle", "confidence": 0.83},
    {"label": "rescue_team", "confidence": 0.79},
]

SCENE_LABEL_POOLS: dict[str, list[dict]] = {
    "military": [
        {"label": "military_conflict", "score": 0.87},
        {"label": "armed_forces_deployment", "score": 0.81},
        {"label": "weapons_system", "score": 0.76},
        {"label": "military_installation", "score": 0.72},
        {"label": "urban_combat_zone", "score": 0.68},
    ],
    "natural_disaster": [
        {"label": "natural_disaster", "score": 0.91},
        {"label": "flood_zone", "score": 0.84},
        {"label": "structural_damage", "score": 0.79},
        {"label": "emergency_response", "score": 0.73},
        {"label": "disaster_relief", "score": 0.67},
    ],
    "protest": [
        {"label": "civil_unrest", "score": 0.88},
        {"label": "mass_protest", "score": 0.83},
        {"label": "public_demonstration", "score": 0.77},
        {"label": "urban_area", "score": 0.65},
        {"label": "crowd_gathering", "score": 0.61},
    ],
    "generic": [
        {"label": "news_event", "score": 0.79},
        {"label": "urban_area", "score": 0.65},
        {"label": "public_space", "score": 0.58},
        {"label": "infrastructure", "score": 0.54},
        {"label": "crowd_gathering", "score": 0.49},
    ],
}


# ---------------------------------------------------------------------------
# Startup: load models with graceful fallbacks
# ---------------------------------------------------------------------------

@asynccontextmanager
async def lifespan(app: FastAPI):
    """Load ML models at startup; degrade gracefully on failure."""
    global _models, _loaded_model_names

    # --- Sentence embeddings ---
    logger.info("Loading sentence-transformers/all-MiniLM-L6-v2 ...")
    try:
        from sentence_transformers import SentenceTransformer
        embed_model = SentenceTransformer("sentence-transformers/all-MiniLM-L6-v2")
        _models["embed"] = embed_model
        _loaded_model_names.append("all-MiniLM-L6-v2 (sentence-transformers)")
        logger.info("Embedding model loaded successfully.")
    except Exception as exc:
        logger.warning(f"Could not load embedding model: {exc} — /embed will return zero-vectors")
        _models["embed"] = None

    # --- Zero-shot classification ---
    logger.info("Loading facebook/bart-large-mnli for zero-shot classification ...")
    try:
        from transformers import pipeline as hf_pipeline
        zsc = hf_pipeline(
            "zero-shot-classification",
            model="facebook/bart-large-mnli",
            device=-1,  # CPU
        )
        _models["zsc"] = zsc
        _loaded_model_names.append("bart-large-mnli (zero-shot-classification)")
        logger.info("Zero-shot classification model loaded successfully.")
    except Exception as exc:
        logger.warning(
            f"Could not load zero-shot classification model: {exc} "
            "— /classify will use keyword fallback"
        )
        _models["zsc"] = None

    logger.info(
        f"Model server ready. Loaded models: {_loaded_model_names or ['none (keyword/rule fallback)']}"
    )

    yield

    # Cleanup (models are GC-able; nothing explicit needed here)
    _models.clear()
    _loaded_model_names.clear()
    logger.info("Model server shut down.")


# ---------------------------------------------------------------------------
# App + CORS
# ---------------------------------------------------------------------------

app = FastAPI(
    title="Nexus Model Server",
    description=(
        "HuggingFace model inference layer for ShockGlobe. "
        "Wraps BART-MNLI zero-shot classification, MiniLM embeddings, "
        "rule-based shock prediction, and vision mock endpoints."
    ),
    version="1.0.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# ---------------------------------------------------------------------------
# Pydantic request / response models
# ---------------------------------------------------------------------------

class ClassifyRequest(BaseModel):
    text: str


class ClassifyResponse(BaseModel):
    type: str
    severity: int
    location: str
    affectedCountries: list[str]
    affectedSectors: list[str]
    affectedTickers: list[str]


class EmbedRequest(BaseModel):
    text: str


class EmbedResponse(BaseModel):
    embedding: list[float]
    model: str
    dimensions: int


class ShockFeatures(BaseModel):
    severity: float
    event_type: str
    sector_relevance: float
    geographic_proximity: float


class PredictShockRequest(BaseModel):
    features: ShockFeatures


class PredictShockResponse(BaseModel):
    predicted_change: float
    confidence: float
    risk_level: str
    components: dict[str, float]


class VisionUrlRequest(BaseModel):
    image_url: str


class Detection(BaseModel):
    label: str
    confidence: float
    bbox: list[int]  # [x1, y1, x2, y2]


class DetectResponse(BaseModel):
    detections: list[Detection]
    image_size: list[int]  # [width, height]
    inference_time_ms: float


class SceneLabel(BaseModel):
    label: str
    score: float


class VisionClassifyResponse(BaseModel):
    classifications: list[SceneLabel]
    dominant_scene: str
    inference_time_ms: float


# ---------------------------------------------------------------------------
# Helper: keyword-based event classification
# ---------------------------------------------------------------------------

def _keyword_classify(text: str) -> str:
    """Score each event type by keyword matches; return winning type."""
    lower = text.lower()
    scores: dict[str, int] = {t: 0 for t in EVENT_TYPE_KEYWORDS}
    for event_type, keywords in EVENT_TYPE_KEYWORDS.items():
        for kw in keywords:
            if kw in lower:
                scores[event_type] += 1
    best = max(scores, key=lambda k: scores[k])
    # Default to geopolitical when nothing matches
    return best if scores[best] > 0 else "geopolitical"


def _compute_severity(text: str, event_type: str) -> int:
    """Heuristic severity on 1-10 scale from text signals."""
    lower = text.lower()
    base_by_type: dict[str, int] = {
        "military": 7,
        "natural_disaster": 6,
        "economic": 5,
        "geopolitical": 5,
        "policy": 4,
    }
    score = base_by_type.get(event_type, 5)
    for word, delta in SEVERITY_AMPLIFIERS.items():
        if word in lower:
            score += delta
    for word, delta in SEVERITY_DIMINISHERS.items():
        if word in lower:
            score += delta
    # Clamp to [1, 10]
    return max(1, min(10, score))


def _extract_location(text: str) -> str:
    """Return the first recognisable city/region from the text, or 'Unknown'."""
    lower = text.lower()
    for token, label in NOTABLE_LOCATIONS:
        if token in lower:
            return label
    return "Unknown"


def _extract_countries(text: str) -> list[str]:
    """Extract ISO2 country codes from country/demonym mentions."""
    lower = text.lower()
    found: list[str] = []
    seen: set[str] = set()
    for name, iso2 in COUNTRY_TO_ISO2.items():
        if name in lower and iso2 not in seen:
            found.append(iso2)
            seen.add(iso2)
    return found[:6]  # cap at 6


def _map_sectors(event_type: str, countries: list[str], text: str) -> list[str]:
    """Map event type to primary sectors; add extras based on text clues."""
    sectors = list(EVENT_SECTOR_MAP.get(event_type, ["Financials"]))
    lower = text.lower()
    # Supplement from text clues
    if any(w in lower for w in ("oil", "gas", "petroleum", "crude", "opec", "lng")):
        if "Energy" not in sectors:
            sectors.insert(0, "Energy")
    if any(w in lower for w in ("tech", "semiconductor", "chip", "software", "ai", "cyber")):
        if "Technology" not in sectors:
            sectors.insert(0, "Technology")
    if any(w in lower for w in ("bank", "financial", "credit", "rate", "bond", "yield")):
        if "Financials" not in sectors:
            sectors.insert(0, "Financials")
    if any(w in lower for w in ("food", "grain", "wheat", "corn", "soybean", "agriculture")):
        if "Agriculture" not in sectors:
            sectors.insert(0, "Agriculture")
    return sectors[:5]


def _map_tickers(sectors: list[str]) -> list[str]:
    """Pick top tickers for each affected sector (max 2 per sector, max 6 total)."""
    tickers: list[str] = []
    seen: set[str] = set()
    for sector in sectors:
        pool = SECTOR_TICKER_MAP.get(sector, [])
        for ticker in pool[:2]:
            if ticker not in seen:
                tickers.append(ticker)
                seen.add(ticker)
        if len(tickers) >= 6:
            break
    return tickers


# ---------------------------------------------------------------------------
# Helper: fetch and verify remote image
# ---------------------------------------------------------------------------

def _fetch_image(image_url: str) -> tuple[Image.Image, int, int]:
    """Download image from URL; return PIL image + (width, height)."""
    try:
        resp = requests.get(image_url, timeout=10, stream=True)
        resp.raise_for_status()
        img = Image.open(io.BytesIO(resp.content))
        w, h = img.size
        return img, w, h
    except Exception as exc:
        logger.warning(f"Could not fetch image from {image_url}: {exc}")
        return None, 640, 480


def _infer_scene_from_url(image_url: str) -> str:
    """Heuristic scene type from URL tokens."""
    lower = image_url.lower()
    if any(t in lower for t in ("military", "war", "army", "combat", "weapon", "missile", "tank")):
        return "military"
    if any(t in lower for t in ("flood", "quake", "fire", "disaster", "storm", "hurricane")):
        return "natural_disaster"
    if any(t in lower for t in ("protest", "riot", "demonstration", "unrest")):
        return "protest"
    return "generic"


def _random_bbox(img_w: int, img_h: int) -> list[int]:
    """Generate a plausible bounding box within image dimensions."""
    rng = random
    x1 = rng.randint(0, img_w // 2)
    y1 = rng.randint(0, img_h // 2)
    x2 = rng.randint(x1 + img_w // 10, min(img_w, x1 + img_w // 2))
    y2 = rng.randint(y1 + img_h // 10, min(img_h, y1 + img_h // 2))
    return [x1, y1, x2, y2]


# ---------------------------------------------------------------------------
# Shock prediction rule engine
# ---------------------------------------------------------------------------

# Base directional impact per event type (percentage shift bias)
EVENT_TYPE_BASE_IMPACT: dict[str, float] = {
    "military": -2.5,
    "natural_disaster": -1.8,
    "economic": -1.5,
    "geopolitical": -1.2,
    "policy": -0.8,
}

# Severity multiplier curve: severity 1-10 mapped to weight 0.1-1.5
def _severity_weight(severity: float) -> float:
    """Non-linear severity weight; tapers off at extremes."""
    s = max(1.0, min(10.0, severity))
    return 0.1 + 1.4 * ((s - 1) / 9) ** 0.75


def _predict_shock_rule(
    severity: float,
    event_type: str,
    sector_relevance: float,
    geographic_proximity: float,
) -> tuple[float, float, str]:
    """
    Rule-based shock predictor mimicking XGBoost outputs.

    Returns
    -------
    predicted_change : float   (percentage, negative = bearish)
    confidence       : float   (0-1)
    risk_level       : str     (low / medium / high / critical)
    """
    base = EVENT_TYPE_BASE_IMPACT.get(event_type, -1.0)
    sev_w = _severity_weight(severity)

    # Core formula: S(c,e) inspired composite
    predicted_change = base * sev_w * sector_relevance * geographic_proximity

    # Noise injection (deterministic pseudo-random from inputs, so repeatable)
    seed = int(severity * 100 + sector_relevance * 1000 + geographic_proximity * 10000)
    rng = random.Random(seed)
    noise = rng.uniform(-0.3, 0.3)
    predicted_change = round(predicted_change + noise, 2)

    # Confidence: higher when all inputs are strong and consistent
    raw_confidence = (
        0.40 * min(severity / 10, 1.0)
        + 0.30 * sector_relevance
        + 0.30 * geographic_proximity
    )
    confidence = round(max(0.30, min(0.97, raw_confidence + rng.uniform(-0.05, 0.05))), 3)

    # Risk level
    abs_change = abs(predicted_change)
    if abs_change >= 5.0 or severity >= 9:
        risk_level = "critical"
    elif abs_change >= 3.0 or severity >= 7:
        risk_level = "high"
    elif abs_change >= 1.5 or severity >= 5:
        risk_level = "medium"
    else:
        risk_level = "low"

    return predicted_change, confidence, risk_level


# ---------------------------------------------------------------------------
# Routes
# ---------------------------------------------------------------------------

@app.get("/health")
async def health() -> dict:
    """Liveness check and model inventory."""
    return {
        "status": "ok",
        "models": _loaded_model_names,
        "zsc_available": _models.get("zsc") is not None,
        "embed_available": _models.get("embed") is not None,
        "uptime_note": "Vision endpoints return realistic mock data (no YOLO/CLIP loaded).",
    }


@app.post("/classify", response_model=ClassifyResponse)
async def classify(req: ClassifyRequest) -> ClassifyResponse:
    """
    Zero-shot event classification using BART-MNLI (or keyword fallback).
    Extracts: event type, severity (1-10), location, countries, sectors, tickers.
    """
    text = req.text.strip()
    if not text:
        raise HTTPException(status_code=422, detail="text must not be empty")

    candidate_labels = ["military", "economic", "policy", "natural_disaster", "geopolitical"]

    zsc = _models.get("zsc")
    if zsc is not None:
        try:
            # BART-MNLI zero-shot
            result = await _run_in_thread(
                lambda: zsc(
                    text[:1024],  # truncate to avoid OOM on CPU
                    candidate_labels,
                    multi_label=False,
                )
            )
            event_type = result["labels"][0]
            # Use model confidence to anchor severity
            top_confidence = result["scores"][0]  # 0-1
            base_severity = round(top_confidence * 10)
        except Exception as exc:
            logger.warning(f"Zero-shot classification failed: {exc} — using keyword fallback")
            event_type = _keyword_classify(text)
            base_severity = None
    else:
        event_type = _keyword_classify(text)
        base_severity = None

    severity = _compute_severity(text, event_type)
    if base_severity is not None:
        # Blend model confidence with heuristic severity
        severity = round(0.4 * base_severity + 0.6 * severity)
        severity = max(1, min(10, severity))

    location = _extract_location(text)
    countries = _extract_countries(text)
    sectors = _map_sectors(event_type, countries, text)
    tickers = _map_tickers(sectors)

    return ClassifyResponse(
        type=event_type,
        severity=severity,
        location=location,
        affectedCountries=countries,
        affectedSectors=sectors,
        affectedTickers=tickers,
    )


@app.post("/embed", response_model=EmbedResponse)
async def embed(req: EmbedRequest) -> EmbedResponse:
    """
    Generate a 384-dimensional sentence embedding using all-MiniLM-L6-v2.
    Falls back to a zero vector if the model is unavailable.
    """
    text = req.text.strip()
    if not text:
        raise HTTPException(status_code=422, detail="text must not be empty")

    model = _models.get("embed")
    if model is not None:
        try:
            vec = await _run_in_thread(lambda: model.encode(text, convert_to_numpy=True))
            embedding = [float(v) for v in vec.tolist()]
            model_name = "sentence-transformers/all-MiniLM-L6-v2"
        except Exception as exc:
            logger.warning(f"Embedding inference failed: {exc} — returning zero vector")
            embedding = [0.0] * 384
            model_name = "zero-vector (fallback)"
    else:
        embedding = [0.0] * 384
        model_name = "zero-vector (fallback)"

    return EmbedResponse(
        embedding=embedding,
        model=model_name,
        dimensions=len(embedding),
    )


@app.post("/predict-shock", response_model=PredictShockResponse)
async def predict_shock(req: PredictShockRequest) -> PredictShockResponse:
    """
    Rule-based shock magnitude predictor that mimics XGBoost outputs.
    Uses severity * sector_relevance * geographic_proximity with event-type bias.
    """
    f = req.features

    # Validate ranges
    if not (1 <= f.severity <= 10):
        raise HTTPException(status_code=422, detail="severity must be between 1 and 10")
    if not (0.0 <= f.sector_relevance <= 1.0):
        raise HTTPException(status_code=422, detail="sector_relevance must be 0-1")
    if not (0.0 <= f.geographic_proximity <= 1.0):
        raise HTTPException(status_code=422, detail="geographic_proximity must be 0-1")

    valid_types = {"military", "economic", "policy", "natural_disaster", "geopolitical"}
    if f.event_type not in valid_types:
        raise HTTPException(
            status_code=422,
            detail=f"event_type must be one of {sorted(valid_types)}",
        )

    predicted_change, confidence, risk_level = _predict_shock_rule(
        severity=f.severity,
        event_type=f.event_type,
        sector_relevance=f.sector_relevance,
        geographic_proximity=f.geographic_proximity,
    )

    return PredictShockResponse(
        predicted_change=predicted_change,
        confidence=confidence,
        risk_level=risk_level,
        components={
            "severity_weight": round(_severity_weight(f.severity), 4),
            "event_type_base": EVENT_TYPE_BASE_IMPACT.get(f.event_type, -1.0),
            "sector_relevance": f.sector_relevance,
            "geographic_proximity": f.geographic_proximity,
        },
    )


@app.post("/vision/detect", response_model=DetectResponse)
async def vision_detect(req: VisionUrlRequest) -> DetectResponse:
    """
    Object detection endpoint. Returns realistic mock bounding box detections.
    Image is fetched to determine actual dimensions; detections are generated
    based on scene heuristics from the URL and image metadata.
    """
    t0 = time.perf_counter()

    img, img_w, img_h = _fetch_image(req.image_url)
    scene = _infer_scene_from_url(req.image_url)

    # Choose detection pool based on scene
    if scene == "military":
        pool = MILITARY_DETECTIONS
        n_detections = random.randint(3, 6)
    elif scene == "natural_disaster":
        pool = DISASTER_DETECTIONS
        n_detections = random.randint(2, 5)
    else:
        pool = CIVILIAN_DETECTIONS
        n_detections = random.randint(2, 4)

    # Sample without replacement (or with, if pool is smaller)
    sampled = random.sample(pool, min(n_detections, len(pool)))

    detections = [
        Detection(
            label=d["label"],
            confidence=round(d["confidence"] + random.uniform(-0.04, 0.04), 3),
            bbox=_random_bbox(img_w, img_h),
        )
        for d in sampled
    ]

    elapsed_ms = round((time.perf_counter() - t0) * 1000, 2)

    return DetectResponse(
        detections=detections,
        image_size=[img_w, img_h],
        inference_time_ms=elapsed_ms,
    )


@app.post("/vision/classify", response_model=VisionClassifyResponse)
async def vision_classify(req: VisionUrlRequest) -> VisionClassifyResponse:
    """
    Scene classification endpoint. Returns realistic mock scene labels.
    Scene type is inferred from URL heuristics; scores are probabilistically generated.
    """
    t0 = time.perf_counter()

    scene = _infer_scene_from_url(req.image_url)
    pool = SCENE_LABEL_POOLS.get(scene, SCENE_LABEL_POOLS["generic"])

    # Add slight realistic jitter to scores
    classifications = [
        SceneLabel(
            label=item["label"],
            score=round(
                max(0.10, min(0.99, item["score"] + random.uniform(-0.05, 0.05))),
                3,
            ),
        )
        for item in pool
    ]

    # Sort descending by score
    classifications.sort(key=lambda x: x.score, reverse=True)
    dominant = classifications[0].label if classifications else "unknown"

    elapsed_ms = round((time.perf_counter() - t0) * 1000, 2)

    return VisionClassifyResponse(
        classifications=classifications,
        dominant_scene=dominant,
        inference_time_ms=elapsed_ms,
    )


# ---------------------------------------------------------------------------
# Async threading helper (run sync model calls off the event loop)
# ---------------------------------------------------------------------------

async def _run_in_thread(fn):
    """Run a synchronous callable in the default thread pool."""
    loop = asyncio.get_running_loop()
    return await loop.run_in_executor(None, fn)


# ---------------------------------------------------------------------------
# Entrypoint (for direct python main.py usage)
# ---------------------------------------------------------------------------

if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host="0.0.0.0", port=8002, reload=False)
