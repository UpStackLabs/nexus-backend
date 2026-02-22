"""
LSTM Stock Price Prediction — Training Script
==============================================

Downloads 2 years of daily OHLCV data per ticker via yfinance,
engineers features, trains a per-ticker LSTM model, and saves:
  models/{TICKER}/model.keras   — trained Keras model
  models/{TICKER}/scaler.pkl    — fitted MinMaxScaler
  models/{TICKER}/metadata.json — training metadata

Usage:
  python train.py                 # Train all 31 tickers
  python train.py --ticker AAPL   # Train a single ticker
"""

from __future__ import annotations

import argparse
import json
import logging
import os
import sys
import time
from pathlib import Path

import joblib
import numpy as np
import yfinance as yf
from sklearn.preprocessing import MinMaxScaler

os.environ["TF_CPP_MIN_LOG_LEVEL"] = "2"  # suppress TF info/warnings
import tensorflow as tf

from features import (
    ALL_TICKERS,
    FEATURE_COLUMNS,
    HORIZON,
    LOOKBACK,
    compute_features,
    create_sequences,
)

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s %(message)s",
)
logger = logging.getLogger("train")

MODELS_DIR = Path(__file__).parent / "models"


def download_data(ticker: str, period: str = "2y") -> "pd.DataFrame | None":
    """Download OHLCV data from yfinance."""
    import pandas as pd  # noqa: local import to keep top-level lean

    logger.info(f"[{ticker}] Downloading {period} of daily data ...")
    try:
        df = yf.download(ticker, period=period, interval="1d", progress=False)
        if df is None or df.empty or len(df) < LOOKBACK + HORIZON + 50:
            logger.warning(f"[{ticker}] Insufficient data ({len(df) if df is not None else 0} rows)")
            return None
        # Flatten multi-level columns from yfinance if present
        if isinstance(df.columns, pd.MultiIndex):
            df.columns = df.columns.get_level_values(0)
        return df
    except Exception as exc:
        logger.error(f"[{ticker}] Download failed: {exc}")
        return None


def build_model(n_features: int) -> tf.keras.Model:
    """Build the LSTM model architecture."""
    model = tf.keras.Sequential([
        tf.keras.layers.LSTM(
            64,
            return_sequences=True,
            input_shape=(LOOKBACK, n_features),
        ),
        tf.keras.layers.Dropout(0.2),
        tf.keras.layers.LSTM(32),
        tf.keras.layers.Dropout(0.2),
        tf.keras.layers.Dense(HORIZON),
    ])
    model.compile(
        optimizer=tf.keras.optimizers.Adam(learning_rate=1e-3),
        loss="mse",
        metrics=["mae"],
    )
    return model


def train_ticker(ticker: str) -> bool:
    """
    Full training pipeline for a single ticker.
    Returns True on success, False on failure.
    """
    t0 = time.time()

    # 1. Download data
    df = download_data(ticker)
    if df is None:
        return False

    # 2. Feature engineering
    features_df = compute_features(df)
    features_df = features_df.dropna()

    if len(features_df) < LOOKBACK + HORIZON + 20:
        logger.warning(f"[{ticker}] Not enough data after feature engineering ({len(features_df)} rows)")
        return False

    # 3. Normalize with MinMaxScaler
    scaler = MinMaxScaler(feature_range=(0, 1))
    scaled_data = scaler.fit_transform(features_df[FEATURE_COLUMNS].values)

    # 4. Create sequences
    X, y = create_sequences(scaled_data, LOOKBACK, HORIZON)
    if len(X) < 20:
        logger.warning(f"[{ticker}] Too few sequences ({len(X)})")
        return False

    # 5. Train/val split (80/20, chronological)
    split_idx = int(len(X) * 0.8)
    X_train, X_val = X[:split_idx], X[split_idx:]
    y_train, y_val = y[:split_idx], y[split_idx:]

    logger.info(
        f"[{ticker}] Training: {len(X_train)} samples, Validation: {len(X_val)} samples, "
        f"Features: {scaled_data.shape[1]}"
    )

    # 6. Build and train model
    model = build_model(n_features=scaled_data.shape[1])

    early_stop = tf.keras.callbacks.EarlyStopping(
        monitor="val_loss",
        patience=10,
        restore_best_weights=True,
        verbose=1,
    )

    history = model.fit(
        X_train, y_train,
        validation_data=(X_val, y_val),
        epochs=100,
        batch_size=32,
        callbacks=[early_stop],
        verbose=1,
    )

    # 7. Evaluate
    val_loss, val_mae = model.evaluate(X_val, y_val, verbose=0)
    logger.info(f"[{ticker}] Val Loss: {val_loss:.6f}, Val MAE: {val_mae:.6f}")

    # 8. Save model, scaler, metadata
    out_dir = MODELS_DIR / ticker
    out_dir.mkdir(parents=True, exist_ok=True)

    model.save(out_dir / "model.keras")
    joblib.dump(scaler, out_dir / "scaler.pkl")

    elapsed = time.time() - t0
    metadata = {
        "ticker": ticker,
        "lookback": LOOKBACK,
        "horizon": HORIZON,
        "n_features": scaled_data.shape[1],
        "feature_columns": FEATURE_COLUMNS,
        "train_samples": len(X_train),
        "val_samples": len(X_val),
        "val_loss": float(val_loss),
        "val_mae": float(val_mae),
        "epochs_trained": len(history.history["loss"]),
        "training_time_seconds": round(elapsed, 1),
    }
    with open(out_dir / "metadata.json", "w") as f:
        json.dump(metadata, f, indent=2)

    logger.info(f"[{ticker}] Saved to {out_dir}/ in {elapsed:.1f}s")
    return True


def main():
    parser = argparse.ArgumentParser(description="Train LSTM stock prediction models")
    parser.add_argument(
        "--ticker",
        type=str,
        default=None,
        help="Train a single ticker (e.g. AAPL). Default: train all.",
    )
    args = parser.parse_args()

    tickers = [args.ticker.upper()] if args.ticker else ALL_TICKERS

    logger.info(f"Training {len(tickers)} ticker(s): {tickers}")

    successes, failures = [], []
    for ticker in tickers:
        ok = train_ticker(ticker)
        (successes if ok else failures).append(ticker)

    logger.info(f"\nDone! Successes: {len(successes)}, Failures: {len(failures)}")
    if failures:
        logger.warning(f"Failed tickers: {failures}")


if __name__ == "__main__":
    main()
