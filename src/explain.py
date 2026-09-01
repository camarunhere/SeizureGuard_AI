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
            "modality": "eeg",
        }
        for name, v in ranked
        if abs(v) > 1e-4
    ]


def _vitals_reason(factor: str, severity: float, modality: str) -> dict:
    """severity: heuristic 0-1 magnitude (how far past the trigger threshold) —
    NOT a SHAP value. Reused under the `shap_contribution` key so the frontend
    can rank/scale all reasons uniformly, but this is a rule-based severity
    score, not a trained model's attribution. Every UI surface tags each
    reason with its `source`/`modality` so this distinction stays visible."""
    return {
        "factor": factor,
        "shap_contribution": round(min(max(severity, 0.05), 1.0), 4),
        "direction": "increases_risk",
        "source": "vitals",
        "modality": modality,
    }


def explain_vitals(vitals: dict) -> list[dict]:
    """Multimodal reasons from wearable biosensor data: heart-rate deviation,
    SpO2 drop, EDA/sEMG arousal, movement dynamics, and temperature.

    These are auxiliary, rule-based reasons layered on top of the deep
    model's EEG-only prediction — same role heart rate/SpO2 already played
    before EDA/sEMG were added, not a new input the neural network itself
    was trained on (no EEG+EDA+EMG-aligned dataset exists for that here)."""
    reasons = []
    hr = vitals.get("heart_rate")
    baseline_hr = vitals.get("baseline_heart_rate", 72)
    if hr is not None and baseline_hr:
        pct = (hr - baseline_hr) / baseline_hr * 100
        if pct >= 15:
            reasons.append(_vitals_reason(f"Increased heart rate (+{pct:.0f}% from baseline)", pct / 50, "cardio"))
        elif pct <= -15:
            reasons.append(_vitals_reason(f"Decreased heart rate ({pct:.0f}% from baseline)", abs(pct) / 50, "cardio"))

    spo2 = vitals.get("spo2")
    if spo2 is not None and spo2 < 95:
        reasons.append(_vitals_reason(f"Reduced oxygen saturation ({spo2:.0f}%)", (95 - spo2) / 15, "cardio"))

    eda = vitals.get("eda")
    baseline_eda = vitals.get("baseline_eda", 4.0)
    if eda is not None and baseline_eda:
        pct = (eda - baseline_eda) / baseline_eda * 100
        if pct >= 50:
            reasons.append(_vitals_reason(
                f"Elevated skin conductance / EDA (+{pct:.0f}% from baseline) — autonomic arousal", pct / 150, "eda",
            ))

    emg = vitals.get("emg")
    if emg is not None and emg >= 0.5:
        reasons.append(_vitals_reason(
            f"Increased muscle activity (sEMG RMS {emg:.2f}) — possible tonic/clonic activation",
            (emg - 0.5) / 0.5, "semg",
        ))

    movement = vitals.get("movement_level")
    if movement is not None and movement >= 0.6:
        reasons.append(_vitals_reason("Increased body movement detected", (movement - 0.6) / 0.4, "motion"))

    jerk = vitals.get("jerk")
    rotation_rate = vitals.get("rotation_rate")
    jerk_severity = (jerk - 0.5) / 0.5 if jerk is not None else 0
    rotation_severity = (rotation_rate - 100) / 400 if rotation_rate is not None else 0
    if jerk_severity > 0 or rotation_severity > 0:
        reasons.append(_vitals_reason(
            "Abnormal movement dynamics (elevated jerk/rotation rate) — convulsive-pattern motion",
            max(jerk_severity, rotation_severity), "motion",
        ))

    temp = vitals.get("temperature")
    if temp is not None and (temp >= 38.0 or temp <= 35.5):
        reasons.append(_vitals_reason(f"Abnormal skin temperature ({temp:.1f}°C)", abs(temp - 36.8) / 3, "temperature"))

    return reasons
