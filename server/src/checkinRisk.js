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

export function checkinRiskFactors(checkin) {
  if (!checkin) return [];
  const reasons = [];

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
  if (checkin.medicationLate) {
    reasons.push(factor("A dose was taken later than usual", 0.35));
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

  if (checkin.illness && checkin.illness !== "none") {
    reasons.push(factor(`Feeling unwell today (${checkin.illness}) — illness/fever can lower seizure threshold`, checkin.illness === "fever" ? 0.6 : 0.45));
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

  return reasons;
}
