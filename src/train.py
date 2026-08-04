"""Train the seizure-detection system:
  1. SeizureNet (CNN + BiLSTM + Transformer, PyTorch) on raw EEG epochs —
     the primary predictive model.
  2. A gradient-boosted surrogate on clinically-interpretable features
     (band powers, signal statistics) — the Explainability Agent's model,
     whose SHAP values drive the "why" behind each prediction.

Usage:
    python -m src.train --data data/eeg_seizure_raw.csv
"""

from __future__ import annotations

import argparse
import json

import joblib
import numpy as np
import torch
import torch.nn as nn
from sklearn.ensemble import GradientBoostingClassifier
from sklearn.metrics import classification_report, roc_auc_score
from sklearn.model_selection import train_test_split
from sklearn.preprocessing import StandardScaler
from torch.utils.data import DataLoader, TensorDataset

from src.model import SeizureNet
from src.preprocessing import prepare_dataset


def train_deep_model(X_train, y_train, X_test, y_test, epochs=18, batch_size=64, lr=1e-3):
    device = torch.device("cpu")
    scaler = StandardScaler()
    Xs_train = scaler.fit_transform(X_train).astype(np.float32)
    Xs_test = scaler.transform(X_test).astype(np.float32)

    train_ds = TensorDataset(torch.tensor(Xs_train), torch.tensor(y_train, dtype=torch.float32))
    train_dl = DataLoader(train_ds, batch_size=batch_size, shuffle=True)

    model = SeizureNet().to(device)
    opt = torch.optim.Adam(model.parameters(), lr=lr)
    # Class balance is even (seizure vs rest binarized ~1:4), weight the positive class.
    pos_weight = torch.tensor([(y_train == 0).sum() / max((y_train == 1).sum(), 1)])
    criterion = nn.BCEWithLogitsLoss(pos_weight=pos_weight)

    model.train()
    for epoch in range(epochs):
        total_loss = 0.0
        for xb, yb in train_dl:
            opt.zero_grad()
            logits = model(xb)
            loss = criterion(logits, yb)
            loss.backward()
            opt.step()
            total_loss += loss.item() * len(xb)
        print(f"  epoch {epoch + 1:2d}/{epochs}  loss={total_loss / len(train_ds):.4f}")

    model.eval()
    with torch.no_grad():
        test_logits = model(torch.tensor(Xs_test))
        test_proba = torch.sigmoid(test_logits).numpy()
    auc = roc_auc_score(y_test, test_proba)
    preds = (test_proba >= 0.5).astype(int)
    print(f"\nDeep model (CNN+BiLSTM+Transformer) held-out test ROC-AUC: {auc:.4f}")
    print(classification_report(y_test, preds, target_names=["non_seizure", "seizure"]))

    return model, scaler, auc


def train_surrogate(F_train, y_train, F_test, y_test):
    model = GradientBoostingClassifier(random_state=42, n_estimators=250, max_depth=3)
    model.fit(F_train, y_train)
    proba = model.predict_proba(F_test)[:, 1]
    auc = roc_auc_score(y_test, proba)
    preds = (proba >= 0.5).astype(int)
    print(f"\nExplainability surrogate (GradientBoosting on EEG features) test ROC-AUC: {auc:.4f}")
    print(classification_report(y_test, preds, target_names=["non_seizure", "seizure"]))
    return model, auc


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--data", default="data/eeg_seizure_raw.csv")
    parser.add_argument("--out-dir", default="models")
    parser.add_argument("--epochs", type=int, default=18)
    parser.add_argument("--seed", type=int, default=42)
    args = parser.parse_args()

    print("Loading and engineering features from real EEG dataset...")
    X_raw, X_features, y = prepare_dataset(args.data)
    print(f"  {X_raw.shape[0]} epochs, {X_raw.shape[1]} raw samples/epoch, "
          f"{X_features.shape[1]} engineered features, seizure rate={y.mean():.3f}")

    idx_train, idx_test = train_test_split(
        np.arange(len(y)), test_size=0.2, random_state=args.seed, stratify=y
    )

    print("\n=== Training primary deep model ===")
    model, scaler, deep_auc = train_deep_model(
        X_raw[idx_train], y[idx_train], X_raw[idx_test], y[idx_test], epochs=args.epochs
    )

    print("\n=== Training explainability surrogate ===")
    surrogate, surrogate_auc = train_surrogate(
        X_features.iloc[idx_train], y[idx_train], X_features.iloc[idx_test], y[idx_test]
    )

    torch.save(model.state_dict(), f"{args.out_dir}/seizure_net.pt")
    joblib.dump(scaler, f"{args.out_dir}/signal_scaler.joblib")
    joblib.dump(surrogate, f"{args.out_dir}/explain_surrogate.joblib")
    joblib.dump(list(X_features.columns), f"{args.out_dir}/feature_names.joblib")

    metadata = {
        "deep_model": "CNN + BiLSTM + Transformer (PyTorch)",
        "deep_model_test_auc": round(float(deep_auc), 4),
        "surrogate_model": "GradientBoostingClassifier (engineered EEG features)",
        "surrogate_test_auc": round(float(surrogate_auc), 4),
        "n_train": int(len(idx_train)),
        "n_test": int(len(idx_test)),
        "dataset": "Epileptic Seizure Recognition (Andrzejak et al., Bonn University / UCI)",
        "feature_names": list(X_features.columns),
    }
    with open(f"{args.out_dir}/metadata.json", "w") as f:
        json.dump(metadata, f, indent=2)

    print(f"\nSaved model artifacts to {args.out_dir}/")


if __name__ == "__main__":
    main()
