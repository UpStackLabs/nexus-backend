"""
Lightweight model-server startup that only loads LSTM models.
Skips HuggingFace BART/MiniLM for faster boot during local testing.

Usage: python start_lstm_only.py
"""
import os
os.environ["TF_CPP_MIN_LOG_LEVEL"] = "2"
os.environ["SKIP_HF_MODELS"] = "1"

# Monkey-patch the lifespan to skip HuggingFace loading
import main

_original_lifespan = main.lifespan

from contextlib import asynccontextmanager

@asynccontextmanager
async def fast_lifespan(app):
    """Only load LSTM models, skip HF models."""
    import json as json_module
    from pathlib import Path
    from typing import Any
    import joblib

    main.logger.info("FAST MODE: Skipping HuggingFace models, loading LSTM only...")
    main._models["embed"] = None
    main._models["zsc"] = None

    # Load LSTM models
    models_dir = Path(__file__).parent / "models"
    lstm_models: dict[str, Any] = {}
    if models_dir.exists():
        for ticker_dir in sorted(models_dir.iterdir()):
            if not ticker_dir.is_dir():
                continue
            model_path = ticker_dir / "model.keras"
            scaler_path = ticker_dir / "scaler.pkl"
            meta_path = ticker_dir / "metadata.json"
            if model_path.exists() and scaler_path.exists():
                try:
                    import tensorflow as tf
                    model = tf.keras.models.load_model(model_path)
                    scaler = joblib.load(scaler_path)
                    meta = {}
                    if meta_path.exists():
                        with open(meta_path) as f:
                            meta = json_module.load(f)
                    ticker = ticker_dir.name.upper()
                    lstm_models[ticker] = {
                        "model": model,
                        "scaler": scaler,
                        "metadata": meta,
                    }
                    main.logger.info(f"  Loaded LSTM model for {ticker}")
                except Exception as exc:
                    main.logger.warning(f"  Failed to load LSTM for {ticker_dir.name}: {exc}")

    main._models["lstm"] = lstm_models
    main._loaded_model_names.clear()
    if lstm_models:
        main._loaded_model_names.append(f"LSTM price prediction ({len(lstm_models)} tickers)")
    main.logger.info(f"LSTM models loaded: {sorted(lstm_models.keys())}")
    main.logger.info(f"Model server ready (LSTM-only mode). {len(lstm_models)} tickers available.")

    yield

    main._models.clear()
    main._loaded_model_names.clear()

main.app.router.lifespan_context = fast_lifespan

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(main.app, host="0.0.0.0", port=8002)
