"""Data loading and feature engineering for the Epileptic Seizure Recognition
dataset (Andrzejak et al., Bonn University / UCI ML Repository).

Each row is one 1-second EEG epoch: 178 raw signal samples (X1..X178) plus a
class label y in {1..5}. Per the dataset's standard usage, y=1 is ictal
(seizure) activity; y in {2,3,4,5} are non-seizure states (eyes open, eyes
closed, healthy-region and tumour-region recordings). We binarize to
seizure vs non-seizure, which is the common framing for seizure detection
papers using this dataset.
"""

from __future__ import annotations

import numpy as np
import pandas as pd

SIGNAL_COLUMNS = [f"X{i}" for i in range(1, 179)]
RAW_TARGET = "y"
TARGET = "seizure"

# Human-readable EEG frequency bands (Hz) for the interpretable surrogate model.
# The dataset epochs are 1 second @ 178 Hz sampling.
SAMPLING_RATE = 178
BANDS = {
    "delta": (0.5, 4),
    "theta": (4, 8),
    "alpha": (8, 13),
    "beta": (13, 30),
    "gamma": (30, 45),
}


def load_raw(csv_path: str) -> pd.DataFrame:
    df = pd.read_csv(csv_path)
    if "Unnamed: 0" in df.columns:
        df = df.drop(columns=["Unnamed: 0"])
    return df


def binarize(df: pd.DataFrame) -> pd.DataFrame:
    df = df.copy()
    df[TARGET] = (df[RAW_TARGET] == 1).astype(int)
    return df


def band_power(signal: np.ndarray, sr: int = SAMPLING_RATE) -> dict:
    """Welch-style band power via FFT — the standard EEG feature set."""
    n = len(signal)
    freqs = np.fft.rfftfreq(n, d=1.0 / sr)
    power = np.abs(np.fft.rfft(signal * np.hanning(n))) ** 2
    out = {}
    for name, (lo, hi) in BANDS.items():
        mask = (freqs >= lo) & (freqs < hi)
        out[f"{name}_power"] = float(power[mask].mean()) if mask.any() else 0.0
    return out


def engineer_features(X_raw: np.ndarray) -> pd.DataFrame:
    """Turn each row's 178-point raw signal into clinically-interpretable
    features (band powers + statistics) for the explainability surrogate."""
    rows = []
    for signal in X_raw:
        feats = band_power(signal)
        feats["mean_amplitude"] = float(np.mean(signal))
        feats["std_amplitude"] = float(np.std(signal))
        feats["peak_amplitude"] = float(np.max(np.abs(signal)))
        feats["line_length"] = float(np.sum(np.abs(np.diff(signal))))
        zero_crossings = np.sum(np.diff(np.sign(signal)) != 0)
        feats["zero_crossing_rate"] = float(zero_crossings) / len(signal)
        rows.append(feats)
    return pd.DataFrame(rows)


def prepare_dataset(csv_path: str):
    """Returns (X_raw signal matrix [n,178], X_features DataFrame, y binary array)."""
    df = load_raw(csv_path)
    df = binarize(df)
    X_raw = df[SIGNAL_COLUMNS].to_numpy(dtype=np.float32)
    y = df[TARGET].to_numpy()
    X_features = engineer_features(X_raw)
    return X_raw, X_features, y
