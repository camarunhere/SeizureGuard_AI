"""Explainability Agent: turns the surrogate model's SHAP values plus the
wearable vitals into the plain-English "reasons" shown on the XAI page —
e.g. "Abnormal EEG activity", "Increased heart rate (+25% from baseline)".
"""

from __future__ import annotations

import numpy as np
import shap

EEG_LABELS = {
    "delta_power": "Elevated delta-band EEG activity (0.5-4 Hz)",
    "theta_power": "Elevated theta-band EEG activity (4-8 Hz)",
    "alpha_power": "Disrupted alpha-band EEG activity (8-13 Hz)",
    "beta_power": "Elevated beta-band EEG activity (13-30 Hz)",
    "gamma_power": "Abnormal high-frequency (gamma) EEG activity",
    "mean_amplitude": "Shifted baseline EEG amplitude",
    "std_amplitude": "Increased EEG signal variability",
    "peak_amplitude": "High-amplitude EEG spikes detected",
    "line_length": "Increased EEG signal irregularity",
    "zero_crossing_rate": "Abnormal EEG oscillation frequency",
}


def explain_eeg(surrogate, feature_row, feature_names, top_n: int = 4) -> list[dict]:
    explainer = shap.TreeExplainer(surrogate)
    shap_values = explainer.shap_values(feature_row)
    values = np.asarray(shap_values)
    if values.ndim == 2:
        values = values[0]
    ranked = sorted(zip(feature_names, values), key=lambda t: abs(t[1]), reverse=True)[:top_n]
    return [
        {
            "factor": EEG_LABELS.get(name, name),
            "shap_contribution": round(float(v), 4),
            "direction": "increases_risk" if v > 0 else "decreases_risk",
            "source": "eeg",
        }
        for name, v in ranked
        if abs(v) > 1e-4
    ]


def explain_vitals(vitals: dict) -> list[dict]:
    """Multimodal reasons from wearable biosensor data, matching the design
    doc's example: heart-rate deviation, SpO2 drop, movement, temperature."""
    reasons = []
    hr = vitals.get("heart_rate")
    baseline_hr = vitals.get("baseline_heart_rate", 72)
    if hr is not None and baseline_hr:
        pct = (hr - baseline_hr) / baseline_hr * 100
        if pct >= 15:
            reasons.append({
                "factor": f"Increased heart rate (+{pct:.0f}% from baseline)",
                "direction": "increases_risk", "source": "vitals",
            })
        elif pct <= -15:
            reasons.append({
                "factor": f"Decreased heart rate ({pct:.0f}% from baseline)",
                "direction": "increases_risk", "source": "vitals",
            })

    spo2 = vitals.get("spo2")
    if spo2 is not None and spo2 < 95:
        reasons.append({
            "factor": f"Reduced oxygen saturation ({spo2:.0f}%)",
            "direction": "increases_risk", "source": "vitals",
        })

    movement = vitals.get("movement_level")
    if movement is not None and movement >= 0.6:
        reasons.append({
            "factor": "Increased body movement detected",
            "direction": "increases_risk", "source": "vitals",
        })

    temp = vitals.get("temperature")
    if temp is not None and (temp >= 38.0 or temp <= 35.5):
        reasons.append({
            "factor": f"Abnormal skin temperature ({temp:.1f}°C)",
            "direction": "increases_risk", "source": "vitals",
        })

    return reasons
