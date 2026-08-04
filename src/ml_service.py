"""SeizureGuard AI — internal ML microservice (port 8001).

The Node.js + MongoDB backend is the public API; this service only does the
AI work: run the CNN+BiLSTM+Transformer seizure-detection network on an EEG
epoch, explain the result (EEG surrogate SHAP + wearable vitals), classify
into Inter-Ictal / Pre-Ictal / Ictal, and provide a realistic simulated
EEG+vitals stream (real recorded epochs from the Bonn/UCI dataset, since no
physical EEG headset is attached) for the Live Monitoring page.

Run with: uvicorn src.ml_service:app --port 8001
"""

from __future__ import annotations

import json
import random
from pathlib import Path

import joblib
import numpy as np
import pandas as pd
import torch
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel, Field

from src.explain import explain_eeg, explain_vitals
from src.model import SeizureNet
from src.preprocessing import SIGNAL_COLUMNS, load_raw, binarize, engineer_features

MODEL_DIR = Path("models")
DATA_PATH = Path("data/eeg_seizure_raw.csv")

app = FastAPI(title="SeizureGuard AI - ML Service", version="1.0.0")

_state = {"model": None, "scaler": None, "surrogate": None, "feature_names": None,
          "metadata": {}, "sim_pool": None}


def _load():
    if not (MODEL_DIR / "seizure_net.pt").exists():
        return
    model = SeizureNet()
    model.load_state_dict(torch.load(MODEL_DIR / "seizure_net.pt", map_location="cpu"))
    model.eval()
    _state["model"] = model
    _state["scaler"] = joblib.load(MODEL_DIR / "signal_scaler.joblib")
    _state["surrogate"] = joblib.load(MODEL_DIR / "explain_surrogate.joblib")
    _state["feature_names"] = joblib.load(MODEL_DIR / "feature_names.joblib")
    meta_path = MODEL_DIR / "metadata.json"
    _state["metadata"] = json.loads(meta_path.read_text()) if meta_path.exists() else {}

    if DATA_PATH.exists():
        df = binarize(load_raw(str(DATA_PATH)))
        _state["sim_pool"] = df


@app.on_event("startup")
def startup():
    _load()


class PredictRequest(BaseModel):
    eeg_signal: list[float] = Field(..., min_length=178, max_length=178)
    heart_rate: float = Field(72, ge=30, le=220)
    baseline_heart_rate: float = Field(72, ge=30, le=150)
    spo2: float = Field(98, ge=70, le=100)
    movement_level: float = Field(0.1, ge=0, le=1)
    temperature: float = Field(36.8, ge=34, le=42)


def _classify(probability: float) -> tuple[str, str, str | None]:
    """Returns (risk_level, prediction_class, seizure_window)."""
    if probability >= 0.85:
        return "high", "ictal", None
    if probability >= 0.4:
        window = f"{max(5, round(30 - probability * 20))}-{max(15, round(45 - probability * 20))} minutes"
        level = "high" if probability >= 0.7 else "moderate"
        return level, "pre_ictal", window
    return "low", "inter_ictal", None


@app.get("/health")
def health():
    return {"status": "ok", "model_loaded": _state["model"] is not None}


@app.get("/metadata")
def metadata():
    return _state["metadata"]


@app.post("/predict")
def predict(req: PredictRequest):
    if _state["model"] is None:
        raise HTTPException(503, "Model not loaded. Train it first: python -m src.train")

    signal = np.asarray(req.eeg_signal, dtype=np.float32).reshape(1, -1)
    scaled = _state["scaler"].transform(signal).astype(np.float32)
    with torch.no_grad():
        logit = _state["model"](torch.tensor(scaled))
        probability = float(torch.sigmoid(logit).item())

    risk_level, prediction_class, window = _classify(probability)

    features = engineer_features(signal)
    eeg_reasons = explain_eeg(
        _state["surrogate"], features.to_numpy(), _state["feature_names"]
    )
    vital_reasons = explain_vitals(req.model_dump())
    reasons = eeg_reasons + vital_reasons

    return {
        "risk_probability": round(probability, 4),
        "risk_level": risk_level,
        "prediction_class": prediction_class,
        "seizure_window": window,
        "reasons": reasons,
        "eeg_features": features.iloc[0].to_dict(),
    }


@app.get("/simulate")
def simulate(bias_seizure: bool = False):
    """A realistic 'live EEG feed' epoch, drawn from real recorded patient
    data (no physical headset attached in this demo). `bias_seizure` lets
    the frontend occasionally demo a pre-ictal/ictal reading."""
    pool = _state["sim_pool"]
    if pool is None:
        raise HTTPException(503, "Simulation data not loaded.")

    subset = pool[pool["seizure"] == 1] if bias_seizure else pool[pool["seizure"] == 0]
    row = subset.sample(1).iloc[0]
    signal = row[SIGNAL_COLUMNS].tolist()
    true_seizure = bool(row["seizure"])

    if true_seizure:
        vitals = {
            "heart_rate": round(random.uniform(95, 130)),
            "spo2": round(random.uniform(89, 95), 1),
            "movement_level": round(random.uniform(0.55, 0.95), 2),
            "temperature": round(random.uniform(37.3, 38.2), 1),
        }
    else:
        vitals = {
            "heart_rate": round(random.uniform(60, 88)),
            "spo2": round(random.uniform(96, 99.5), 1),
            "movement_level": round(random.uniform(0.02, 0.35), 2),
            "temperature": round(random.uniform(36.3, 37.1), 1),
        }

    return {"eeg_signal": signal, "true_label_for_demo": true_seizure, **vitals}
