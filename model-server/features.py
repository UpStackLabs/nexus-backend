"""
Shared feature engineering for LSTM stock price prediction.

Used by both train.py (training) and main.py (inference).
"""

from __future__ import annotations

import numpy as np
import pandas as pd

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------
LOOKBACK = 60       # trading days of history fed into the LSTM
HORIZON = 30        # trading days to predict forward
FEATURE_COLUMNS = [
    "close",
    "log_return",
    "ma_5",
    "ma_10",
    "ma_20",
    "ma_50",
    "rsi_14",
    "volume_change",
]

# S&P 100 (OEX) components + original seed-data tickers, deduplicated
ALL_TICKERS = sorted(set([
    # --- S&P 100 components ---
    "AAPL", "ABBV", "ABT", "ACN", "ADBE", "AIG", "AMGN", "AMT", "AMZN", "AVGO",
    "AXP", "BA", "BAC", "BK", "BKNG", "BLK", "BMY", "BRK-B", "C", "CAT",
    "CHTR", "CL", "CMCSA", "COF", "COP", "COST", "CRM", "CSCO", "CVS", "CVX",
    "DE", "DHR", "DIS", "DOW", "DUK", "EMR", "EXC", "F", "FDX", "GD",
    "GE", "GILD", "GM", "GOOG", "GOOGL", "GS", "HD", "HON", "IBM", "INTC",
    "INTU", "JNJ", "JPM", "KHC", "KO", "LIN", "LLY", "LMT", "LOW", "MA",
    "MCD", "MDLZ", "MDT", "MET", "META", "MMM", "MO", "MRK", "MS", "MSFT",
    "NEE", "NFLX", "NKE", "NOC", "NVDA", "ORCL", "PEP", "PFE", "PG", "PM",
    "PYPL", "QCOM", "RTX", "SBUX", "SCHW", "SO", "SPG", "T", "TGT", "TMO",
    "TMUS", "TXN", "UNH", "UNP", "UPS", "USB", "V", "VZ", "WFC",
    "WMT", "XOM",
    # --- Original seed-data tickers (non-S&P 100) ---
    "BP", "SLB", "OXY",                                # Energy
    "TSM",                                               # Technology
    "ADM", "BG", "CTVA",                                 # Agriculture
    "ZIM", "MATX", "DAC",                                # Shipping
    "GLD", "TLT",                                        # ETFs
    "VALE", "PBR", "ITUB", "AMX",                        # LatAm
]))


# ---------------------------------------------------------------------------
# Feature engineering
# ---------------------------------------------------------------------------

def _rsi(series: pd.Series, period: int = 14) -> pd.Series:
    """Compute Relative Strength Index."""
    delta = series.diff()
    gain = delta.clip(lower=0)
    loss = -delta.clip(upper=0)
    avg_gain = gain.rolling(window=period, min_periods=period).mean()
    avg_loss = loss.rolling(window=period, min_periods=period).mean()
    rs = avg_gain / avg_loss.replace(0, np.nan)
    rsi = 100 - (100 / (1 + rs))
    return rsi


def compute_features(df: pd.DataFrame) -> pd.DataFrame:
    """
    Takes a DataFrame with OHLCV columns (Open, High, Low, Close, Volume)
    and returns a DataFrame with engineered features.

    The returned DataFrame will have NaN rows at the top (due to rolling
    windows); callers should dropna() before use.
    """
    out = pd.DataFrame(index=df.index)
    out["close"] = df["Close"]
    out["log_return"] = np.log(df["Close"] / df["Close"].shift(1))
    out["ma_5"] = df["Close"].rolling(5).mean()
    out["ma_10"] = df["Close"].rolling(10).mean()
    out["ma_20"] = df["Close"].rolling(20).mean()
    out["ma_50"] = df["Close"].rolling(50).mean()
    out["rsi_14"] = _rsi(df["Close"], 14)
    out["volume_change"] = df["Volume"].pct_change()
    return out


def create_sequences(
    data: np.ndarray,
    lookback: int = LOOKBACK,
    horizon: int = HORIZON,
) -> tuple[np.ndarray, np.ndarray]:
    """
    Sliding-window sequence creation for LSTM training.

    Parameters
    ----------
    data : np.ndarray
        2D array of shape (timesteps, features). The first column must be
        the normalised close price.
    lookback : int
        Number of past timesteps per input sample.
    horizon : int
        Number of future close prices to predict.

    Returns
    -------
    X : np.ndarray  — shape (samples, lookback, features)
    y : np.ndarray  — shape (samples, horizon)
    """
    X, y = [], []
    for i in range(lookback, len(data) - horizon):
        X.append(data[i - lookback : i])           # all features
        y.append(data[i : i + horizon, 0])          # close price only
    return np.array(X), np.array(y)
