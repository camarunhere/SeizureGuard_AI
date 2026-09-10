// Rule-based, clinically-informed risk factors from a patient's daily
// check-in — sleep deprivation, missed medication, high stress, and alcohol
// are well-established real seizure triggers in epilepsy literature. This is
// NOT a machine-learned prediction: the deep learning model (src/model.py)
// only ever sees the raw EEG signal, and no dataset exists here mapping
// self-reported lifestyle factors to actual seizure outcomes. These flags
// are shown as a separate "self-reported risk factors" panel, deliberately
// never merged into the AI's own SHAP-based reasons, so the two different
// kinds of "why" (model-derived vs. rule-based) stay distinguishable.
//
// Same shape as the vitals reasons in src/explain.py's explain_vitals(), so
// the frontend's existing RiskFingerprint/reasons components render them
// with no special-casing: { factor, shap_contribution (0-1 heuristic
// severity, not a real SHAP value), direction, source, modality }.

function factor(text, severity, modality = "checkin") {
  return {
    factor: text,
    shap_contribution: Math.min(Math.max(severity, 0.05), 1),
    direction: "increases_risk",
    source: "checkin",
    modality,
  };
}

export const WARNING_SYMPTOM_LABELS = {
  unusual_smell_taste: "Unusual smell/taste",
  deja_vu: "Déjà vu",
  dizziness: "Dizziness",
  visual_changes: "Visual changes",
  tingling_numbness: "Tingling/numbness",
  confusion: "Confusion",
  sudden_fear_anxiety: "Sudden fear/anxiety",
  unusual_sounds: "Unusual sounds",
  headache: "Headache",
  other: "Other",
};

export function checkinRiskFactors(checkin) {
  if (!checkin) return [];
  const reasons = [];

  // Warning symptoms right now (aura/prodrome-type signs) are the most
  // clinically direct signal here — these can immediately precede a
  // seizure, unlike the other, more general lifestyle risk factors below —
  // so this is checked first and carries the highest heuristic severity.
  if (checkin.warningSymptoms && checkin.warningSymptoms.length > 0) {
    const labels = checkin.warningSymptoms.map((s) =>
      s === "other" && checkin.warningSymptomsOther ? checkin.warningSymptomsOther : (WARNING_SYMPTOM_LABELS[s] || s)
    );
    reasons.push(factor(
      `Possible seizure warning symptoms reported right now: ${labels.join(", ")} — these can directly precede a seizure`,
      0.9, "warning_symptoms",
    ));
  }

  if (checkin.sleepHours != null && checkin.sleepHours < 6) {
    reasons.push(factor(`Short sleep last night (${checkin.sleepHours}h) — sleep deprivation is a well-documented seizure trigger`, (6 - checkin.sleepHours) / 4));
  }
  if (["poor", "very_poor"].includes(checkin.sleepQuality)) {
    reasons.push(factor(`Poor self-rated sleep quality (${checkin.sleepQuality.replace("_", " ")})`, checkin.sleepQuality === "very_poor" ? 0.7 : 0.4));
  }
  if (checkin.wokeFrequently) {
    reasons.push(factor("Woke frequently during the night", 0.3));
  }

  if (checkin.medicationTaken === "no") {
    reasons.push(factor("Seizure medication not taken today — missed doses are one of the most common preventable seizure triggers", 0.9));
  } else if (checkin.medicationTaken === "partially") {
    reasons.push(factor("Seizure medication only partially taken today", 0.6));
  }
  if (checkin.medicationIssue === "late") {
    reasons.push(factor("A dose was taken later than usual", 0.35));
  } else if (checkin.medicationIssue === "partial") {
    reasons.push(factor("Only part of a dose was taken rather than the full prescribed amount", 0.5));
  }

  if (checkin.stressLevel != null && checkin.stressLevel >= 7) {
    reasons.push(factor(`Elevated stress today (${checkin.stressLevel}/10)`, checkin.stressLevel / 10));
  }
  if (checkin.anxietyLevel != null && checkin.anxietyLevel >= 7) {
    reasons.push(factor(`Elevated anxiety today (${checkin.anxietyLevel}/10)`, checkin.anxietyLevel / 10));
  }
  if (checkin.fatigueLevel != null && checkin.fatigueLevel >= 7) {
    reasons.push(factor(`Unusually tired today (${checkin.fatigueLevel}/10)`, checkin.fatigueLevel / 10));
  }

  if (checkin.illness) {
    reasons.push(factor(
      checkin.illnessNote
        ? `Feeling unwell today (${checkin.illnessNote}) — illness can lower seizure threshold`
        : "Feeling unwell today — illness can lower seizure threshold",
      0.5,
    ));
  }
  if (checkin.ateNormally === false) {
    reasons.push(factor("Did not eat normally today", 0.25));
  }
  if (checkin.hydrated === false) {
    reasons.push(factor("Insufficient fluid intake today", 0.25));
  }
  if (checkin.strenuousExercise) {
    reasons.push(factor("Unusually strenuous exercise today", 0.3));
  }

  if (checkin.alcohol) {
    reasons.push(factor("Alcohol consumed since last check-in — a well-documented seizure trigger", 0.6));
  }
  if (checkin.caffeineMoreThanUsual) {
    reasons.push(factor("More caffeine than usual", 0.25));
  }
  if (checkin.recreationalDrugs) {
    reasons.push(factor("Recreational drug use reported", 0.7));
  }
  if (checkin.knownTriggerExperienced) {
    reasons.push(factor(
      checkin.triggerNote ? `Reported exposure to a known personal trigger: ${checkin.triggerNote}` : "Reported exposure to a known personal trigger",
      0.8,
    ));
  }

  if (checkin.comparedToUsual === "much_worse") {
    reasons.push(factor("Self-rated today as feeling much worse than usual overall", 0.6));
  } else if (checkin.comparedToUsual === "slightly_worse") {
    reasons.push(factor("Self-rated today as feeling slightly worse than usual overall", 0.3));
  }

  return reasons;
}

// Buckets the heuristic severities into a single Low/Moderate/Elevated badge
// — a simple, transparent aggregation (highest severity present, with a
// floor bump when several moderate factors co-occur), not a learned score.
export function checkinRiskLevel(reasons) {
  if (!reasons.length) return { level: "low", label: "Low" };
  const maxSeverity = Math.max(...reasons.map((r) => r.shap_contribution));
  const count = reasons.length;
  if (maxSeverity >= 0.75 || (maxSeverity >= 0.5 && count >= 3)) return { level: "elevated", label: "Elevated" };
  if (maxSeverity >= 0.4 || count >= 2) return { level: "moderate", label: "Moderate" };
  return { level: "low", label: "Low" };
}

// Real statistical comparison against the patient's OWN recent history
// (simple rolling average over past check-ins) — genuinely "personalised"
// in the sense of being specific to this patient's own baseline, but this
// is descriptive statistics, not a trained/learned model. A true
// personalised ML model would need real longitudinal data linking these
// answers to actual seizure outcomes, which doesn't exist yet — see the
// dissertation note in routes/patient.js.
const BASELINE_FIELDS = {
  sleepHours: "Sleep (hours)",
  stressLevel: "Stress",
  anxietyLevel: "Anxiety",
  fatigueLevel: "Fatigue",
};

export function compareToBaseline(today, history) {
  const past = history.filter((h) => String(h._id) !== String(today?._id));
  if (past.length < 3) return null; // not enough history for a meaningful average yet

  const comparisons = [];
  for (const [field, label] of Object.entries(BASELINE_FIELDS)) {
    const values = past.map((h) => h[field]).filter((v) => v != null);
    const todayValue = today?.[field];
    if (values.length < 3 || todayValue == null) continue;
    const avg = values.reduce((a, b) => a + b, 0) / values.length;
    const delta = todayValue - avg;
    const threshold = field === "sleepHours" ? 1 : 2; // meaningful-difference thresholds per scale
    if (Math.abs(delta) < threshold) continue;
    comparisons.push({
      field, label, today: todayValue, average: Math.round(avg * 10) / 10,
      direction: delta > 0 ? "higher" : "lower",
    });
  }
  return comparisons;
}
