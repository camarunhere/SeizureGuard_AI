import { Router } from "express";
import { requireRole } from "../auth.js";
import { checkinRiskFactors, checkinRiskLevel, compareToBaseline } from "../checkinRisk.js";
import { mlMetadata } from "../mlClient.js";
import { Alert, DailyCheckin, Prediction, SeizureEvent, SensorReading, User, logActivity } from "../models.js";
import { predictionPayload, readingPayload, runMonitoringTick } from "../services.js";

const router = Router();
const patientOnly = requireRole("patient");

// ---- Model info (real training metadata — see models/metadata.json) ------------
// Only the deployed deep model and its explainability surrogate have ever
// actually been trained here; the Model Benchmark UI shows real numbers for
// those two and leaves ablation variants blank rather than inventing them.

router.get("/model-info", patientOnly, async (req, res) => {
  try {
    res.json(await mlMetadata());
  } catch (err) {
    res.status(502).json({ detail: `AI service unavailable: ${err.message}` });
  }
});

// ---- Manage Profile ----------------------------------------------------------

router.get("/profile", patientOnly, (req, res) => {
  const u = req.user;
  res.json({
    full_name: u.fullName,
    email: u.email,
    age: u.age ?? null,
    medical_history: u.medicalHistory || "",
    baseline_heart_rate: u.baselineHeartRate,
    baseline_eda: u.baselineEda,
  });
});

router.put("/profile", patientOnly, async (req, res) => {
  const { full_name, age, medical_history, baseline_heart_rate, baseline_eda } = req.body || {};
  if (full_name != null) req.user.fullName = full_name;
  if (age != null) req.user.age = age;
  if (medical_history != null) req.user.medicalHistory = medical_history;
  if (baseline_heart_rate != null) req.user.baselineHeartRate = baseline_heart_rate;
  if (baseline_eda != null) req.user.baselineEda = baseline_eda;
  await req.user.save();
  await logActivity(req.user, "update_profile");
  res.json({ message: "Profile updated." });
});

// ---- Baseline patient information (collected once, editable later) -------------
// Clinical record-keeping and context for clinicians — does not feed the
// deep learning model (see src/ml_service.py, which only ever sees raw EEG).

router.get("/baseline", patientOnly, (req, res) => {
  const u = req.user;
  res.json({
    age: u.age ?? null,
    sex: u.sex || "",
    diagnosis_date: u.diagnosisDate ? u.diagnosisDate.toISOString().slice(0, 10) : "",
    seizure_type: u.seizureType || "",
    seizure_frequency: u.seizureFrequency || "",
    last_seizure_date: u.lastSeizureDate ? u.lastSeizureDate.toISOString().slice(0, 10) : "",
    has_aura: u.hasAura || "",
    aura_symptoms: u.auraSymptoms || "",
    medications: u.medications || "",
    medications_prescribed_by: u.medicationsPrescribedByName || null,
    medications_prescribed_at: u.medicationsPrescribedAt ? u.medicationsPrescribedAt.toISOString() : null,
    recent_medication_changes: u.recentMedicationChanges || "",
    other_conditions: u.otherConditions || "",
    known_triggers: u.knownTriggers || "",
  });
});

router.put("/baseline", patientOnly, async (req, res) => {
  const b = req.body || {};
  const fields = {
    age: "age", sex: "sex", seizure_type: "seizureType", seizure_frequency: "seizureFrequency",
    has_aura: "hasAura", aura_symptoms: "auraSymptoms", medications: "medications",
    recent_medication_changes: "recentMedicationChanges", other_conditions: "otherConditions",
    known_triggers: "knownTriggers",
  };
  // A patient editing their medications themselves supersedes whatever a
  // clinician last prescribed — clear the attribution so it's never shown
  // as the clinician's plan once it no longer is.
  if (b.medications != null && b.medications !== req.user.medications) {
    req.user.medicationsPrescribedByName = "";
    req.user.medicationsPrescribedAt = null;
  }
  for (const [key, prop] of Object.entries(fields)) {
    if (b[key] != null) req.user[prop] = b[key];
  }
  if (b.diagnosis_date != null) req.user.diagnosisDate = b.diagnosis_date ? new Date(b.diagnosis_date) : null;
  if (b.last_seizure_date != null) req.user.lastSeizureDate = b.last_seizure_date ? new Date(b.last_seizure_date) : null;
  await req.user.save();
  await logActivity(req.user, "update_baseline");
  res.json({ message: "Baseline information saved." });
});

// ---- Daily check-in --------------------------------------------------------------
// One document per calendar day (upserted). Risk factors derived from it are
// rule-based (checkinRisk.js), not machine-learned — shown as a separate
// "self-reported risk factors" panel, never merged into the AI's own
// SHAP-based reasons from a Live Monitoring reading.

function startOfDay(d) {
  const day = new Date(d);
  day.setHours(0, 0, 0, 0);
  return day;
}

const WARNING_SYMPTOMS = [
  "unusual_smell_taste", "deja_vu", "dizziness", "visual_changes", "tingling_numbness",
  "confusion", "sudden_fear_anxiety", "unusual_sounds", "headache", "other",
];

function checkinFields(c) {
  return {
    warningSymptoms: c.warningSymptoms, warningSymptomsOther: c.warningSymptomsOther,
    sleepHours: c.sleepHours, sleepQuality: c.sleepQuality, wokeFrequently: c.wokeFrequently,
    medicationTaken: c.medicationTaken, medicationLate: c.medicationLate,
    stressLevel: c.stressLevel, anxietyLevel: c.anxietyLevel, fatigueLevel: c.fatigueLevel,
    illness: c.illness, ateNormally: c.ateNormally, hydrated: c.hydrated, strenuousExercise: c.strenuousExercise,
    alcohol: c.alcohol, caffeineMoreThanUsual: c.caffeineMoreThanUsual, recreationalDrugs: c.recreationalDrugs,
    knownTriggerExperienced: c.knownTriggerExperienced, triggerNote: c.triggerNote, comparedToUsual: c.comparedToUsual,
  };
}

// `history` (recent DailyCheckin docs, most-recent-first, optional) enables
// the real statistical "compared to your own baseline" comparison — see
// compareToBaseline in checkinRisk.js. Omit it (e.g. for /checkin/history
// list items) to skip that comparison and save the extra computation.
function checkinPayload(c, history) {
  if (!c) return null;
  const riskFactors = checkinRiskFactors(checkinFields(c));
  return {
    id: String(c._id),
    date: c.date.toISOString().slice(0, 10),
    warning_symptoms: c.warningSymptoms || [],
    warning_symptoms_other: c.warningSymptomsOther || "",
    sleep_hours: c.sleepHours ?? null,
    sleep_quality: c.sleepQuality || null,
    woke_frequently: c.wokeFrequently ?? null,
    medication_taken: c.medicationTaken || null,
    medication_late: c.medicationLate ?? null,
    stress_level: c.stressLevel ?? null,
    anxiety_level: c.anxietyLevel ?? null,
    fatigue_level: c.fatigueLevel ?? null,
    illness: c.illness || "none",
    ate_normally: c.ateNormally ?? null,
    hydrated: c.hydrated ?? null,
    strenuous_exercise: c.strenuousExercise ?? null,
    alcohol: c.alcohol ?? null,
    caffeine_more_than_usual: c.caffeineMoreThanUsual ?? null,
    recreational_drugs: c.recreationalDrugs ?? null,
    known_trigger_experienced: c.knownTriggerExperienced ?? null,
    trigger_note: c.triggerNote || "",
    compared_to_usual: c.comparedToUsual || null,
    risk_factors: riskFactors,
    risk_level: checkinRiskLevel(riskFactors),
    baseline_comparison: history ? compareToBaseline(c, history) : null,
  };
}

router.get("/checkin/today", patientOnly, async (req, res) => {
  const today = startOfDay(new Date());
  const [checkin, history] = await Promise.all([
    DailyCheckin.findOne({ patient: req.user._id, date: today }),
    DailyCheckin.find({ patient: req.user._id }).sort({ date: -1 }).limit(30),
  ]);
  res.json(checkinPayload(checkin, history));
});

router.post("/checkin", patientOnly, async (req, res) => {
  const b = req.body || {};
  if (b.warning_symptoms != null) {
    if (!Array.isArray(b.warning_symptoms) || b.warning_symptoms.some((s) => !WARNING_SYMPTOMS.includes(s))) {
      return res.status(422).json({ detail: "warning_symptoms must be an array of recognised symptom keys." });
    }
  }
  const today = startOfDay(new Date());
  const update = {
    warningSymptoms: b.warning_symptoms, warningSymptomsOther: b.warning_symptoms_other,
    sleepHours: b.sleep_hours != null ? Number(b.sleep_hours) : undefined,
    sleepQuality: b.sleep_quality, wokeFrequently: b.woke_frequently,
    medicationTaken: b.medication_taken, medicationLate: b.medication_late,
    stressLevel: b.stress_level != null ? Number(b.stress_level) : undefined,
    anxietyLevel: b.anxiety_level != null ? Number(b.anxiety_level) : undefined,
    fatigueLevel: b.fatigue_level != null ? Number(b.fatigue_level) : undefined,
    illness: b.illness, ateNormally: b.ate_normally, hydrated: b.hydrated,
    strenuousExercise: b.strenuous_exercise, alcohol: b.alcohol,
    caffeineMoreThanUsual: b.caffeine_more_than_usual, recreationalDrugs: b.recreational_drugs,
    knownTriggerExperienced: b.known_trigger_experienced, triggerNote: b.trigger_note,
    comparedToUsual: b.compared_to_usual,
  };
  Object.keys(update).forEach((k) => update[k] === undefined && delete update[k]);

  const [checkin, history] = await Promise.all([
    DailyCheckin.findOneAndUpdate(
      { patient: req.user._id, date: today },
      { $set: update, $setOnInsert: { patient: req.user._id, date: today } },
      { upsert: true, new: true, runValidators: true }
    ),
    DailyCheckin.find({ patient: req.user._id }).sort({ date: -1 }).limit(30),
  ]);
  await logActivity(req.user, "daily_checkin");
  res.json(checkinPayload(checkin, history));
});

router.get("/checkin/history", patientOnly, async (req, res) => {
  const limit = Math.min(Number(req.query.limit) || 30, 90);
  const checkins = await DailyCheckin.find({ patient: req.user._id }).sort({ date: -1 }).limit(limit);
  res.json(checkins.map((c) => checkinPayload(c)));
});

// ---- Who's monitoring me (clinicians linked via my patient code) ----

router.get("/linked", patientOnly, async (req, res) => {
  const clinicians = await User.find({ role: "clinician", linkedPatients: req.user._id }, "fullName email");
  res.json({
    clinicians: clinicians.map((c) => ({ id: String(c._id), full_name: c.fullName, email: c.email })),
  });
});

router.delete("/linked/:userId", patientOnly, async (req, res) => {
  await User.updateOne({ _id: req.params.userId }, { $pull: { linkedPatients: req.user._id } });
  await logActivity(req.user, "revoke_link", req.params.userId);
  res.json({ message: "Access revoked." });
});

// ---- Live Monitoring: manual entry -----------------------------------------------
// The patient supplies vitals directly, paired with a sample EEG epoch drawn
// from the recorded dataset pool (no physical headset here).

const VITALS_RANGE = {
  heart_rate: [30, 220],
  spo2: [70, 100],
  movement_level: [0, 1],
  temperature: [34, 42],
  eda: [0.5, 25],
  emg: [0, 1],
  jerk: [0, 1],
  rotation_rate: [0, 500],
};

function validateVitals(body) {
  const vitals = {};
  for (const [key, [min, max]] of Object.entries(VITALS_RANGE)) {
    const v = Number(body[key]);
    if (!Number.isFinite(v) || v < min || v > max) {
      return { error: `${key.replace(/_/g, " ")} must be a number between ${min} and ${max}.` };
    }
    vitals[key] = v;
  }
  return { vitals };
}

router.post("/live/reading", patientOnly, async (req, res) => {
  const { source, epoch_type } = req.body || {};
  if (source !== "manual")
    return res.status(422).json({ detail: "source must be 'manual'." });
  if (!["normal", "seizure"].includes(epoch_type))
    return res.status(422).json({ detail: "epoch_type must be 'normal' or 'seizure'." });

  const { vitals, error } = validateVitals(req.body || {});
  if (error) return res.status(422).json({ detail: error });

  try {
    const { reading, prediction, alert } = await runMonitoringTick(req.user, {
      source,
      vitals,
      biasSeizure: epoch_type === "seizure",
    });
    await logActivity(req.user, "live_reading", `source=${source} risk=${prediction.riskLevel}`);
    res.json({
      reading: readingPayload(reading),
      prediction: predictionPayload(prediction),
      alert_raised: !!alert,
    });
  } catch (err) {
    res.status(502).json({ detail: `AI service unavailable: ${err.message}` });
  }
});

// ---- Current Risk Status Card (Patient Dashboard) ------------------------------

router.get("/dashboard", patientOnly, async (req, res) => {
  const latestPrediction = await Prediction.findOne({ patient: req.user._id }).sort({ predictionTime: -1 });
  const latestReading = await SensorReading.findOne({ patient: req.user._id }).sort({ timestamp: -1 });
  const lastEvent = await SeizureEvent.findOne({ patient: req.user._id }).sort({ date: -1 });
  const totalPredictions = await Prediction.countDocuments({ patient: req.user._id });
  const activeAlert = await Alert.findOne({ patient: req.user._id, acknowledged: false }).sort({ createdAt: -1 });

  res.json({
    current_status: latestPrediction ? predictionPayload(latestPrediction) : null,
    latest_vitals: latestReading ? readingPayload(latestReading) : null,
    total_predictions: totalPredictions,
    last_seizure: lastEvent
      ? {
          date: lastEvent.date.toISOString(),
          duration_minutes: lastEvent.durationMinutes,
          severity: lastEvent.severity,
          recovery_time_minutes: lastEvent.recoveryTimeMinutes,
        }
      : null,
    active_alert: activeAlert
      ? { id: String(activeAlert._id), alert_type: activeAlert.alertType, risk_probability: activeAlert.riskProbability }
      : null,
  });
});

// ---- AI Prediction Dashboard + Explainable AI page -----------------------------

router.get("/predictions", patientOnly, async (req, res) => {
  const limit = Math.min(Number(req.query.limit) || 50, 200);
  const predictions = await Prediction.find({ patient: req.user._id }).sort({ predictionTime: -1 }).limit(limit);
  res.json(predictions.map(predictionPayload));
});

router.get("/predictions/:id", patientOnly, async (req, res) => {
  const p = await Prediction.findOne({ _id: req.params.id, patient: req.user._id });
  if (!p) return res.status(404).json({ detail: "Prediction not found." });
  res.json(predictionPayload(p));
});

// ---- Emergency Alerts -----------------------------------------------------------

router.get("/alerts", patientOnly, async (req, res) => {
  const alerts = await Alert.find({ patient: req.user._id }).sort({ createdAt: -1 }).limit(50)
    .populate("prediction", "reasons predictionClass");
  res.json(alerts.map((a) => ({
    id: String(a._id),
    alert_type: a.alertType,
    risk_probability: a.riskProbability,
    acknowledged: a.acknowledged,
    created_at: a.createdAt.toISOString(),
    prediction_class: a.prediction?.predictionClass || null,
    reasons: a.prediction?.reasons || [],
    // Real count of who this alert is visible to (in-app), not a delivery
    // guarantee — no push/email/SMS is actually sent by this system.
    notified_clinicians: a.notifiedClinicians.length,
  })));
});

router.post("/alerts/:id/acknowledge", patientOnly, async (req, res) => {
  const a = await Alert.findOneAndUpdate(
    { _id: req.params.id, patient: req.user._id }, { acknowledged: true }, { new: true }
  );
  if (!a) return res.status(404).json({ detail: "Alert not found." });
  await logActivity(req.user, "acknowledge_alert", req.params.id);
  res.json({ message: "Alert acknowledged." });
});

// ---- History and Analytics ------------------------------------------------------

function seizureEventPayload(e) {
  return {
    id: String(e._id),
    date: e.date.toISOString(),
    duration_minutes: e.durationMinutes,
    severity: e.severity,
    recovery_time_minutes: e.recoveryTimeMinutes,
    prediction_accuracy: e.predictionAccuracy,
    activity_before: e.activityBefore || "",
    had_warning_aura: e.hadWarningAura || "",
    symptoms_occurred: e.symptomsOccurred || "",
    lost_consciousness: e.lostConsciousness || "",
    fell: e.fell || "",
    unusual_movement: e.unusualMovement || "",
    tongue_biting: e.tongueBiting || "",
    incontinence: e.incontinence || "",
    witness_present: e.witnessPresent || "",
    witness_note: e.witnessNote || "",
    ems_required: e.emsRequired || "",
  };
}

router.get("/seizure-events", patientOnly, async (req, res) => {
  const events = await SeizureEvent.find({ patient: req.user._id }).sort({ date: -1 });
  res.json(events.map(seizureEventPayload));
});

router.post("/seizure-events", patientOnly, async (req, res) => {
  const b = req.body || {};
  if (!b.duration_minutes || b.duration_minutes <= 0)
    return res.status(422).json({ detail: "Duration (minutes) is required." });
  const event = await SeizureEvent.create({
    patient: req.user._id,
    date: b.date ? new Date(b.date) : new Date(),
    durationMinutes: b.duration_minutes,
    severity: b.severity || "moderate",
    recoveryTimeMinutes: b.recovery_time_minutes || null,
    predictionAccuracy: b.prediction_accuracy ?? null,
    activityBefore: b.activity_before || "",
    hadWarningAura: b.had_warning_aura || "",
    symptomsOccurred: b.symptoms_occurred || "",
    lostConsciousness: b.lost_consciousness || "",
    fell: b.fell || "",
    unusualMovement: b.unusual_movement || "",
    tongueBiting: b.tongue_biting || "",
    incontinence: b.incontinence || "",
    witnessPresent: b.witness_present || "",
    witnessNote: b.witness_note || "",
    emsRequired: b.ems_required || "",
  });
  await logActivity(req.user, "log_seizure_event", `${b.duration_minutes}min`);
  res.json({ message: "Seizure event logged.", id: String(event._id) });
});

router.get("/trends", patientOnly, async (req, res) => {
  const readings = await SensorReading.find({ patient: req.user._id }).sort({ timestamp: -1 }).limit(60);
  const predictions = await Prediction.find({ patient: req.user._id }).sort({ predictionTime: -1 }).limit(60);
  res.json({
    heart_rate: readings.map((r) => ({ t: r.timestamp.toISOString(), v: r.heartRate })).reverse(),
    spo2: readings.map((r) => ({ t: r.timestamp.toISOString(), v: r.spo2 })).reverse(),
    risk_probability: predictions.map((p) => ({ t: p.predictionTime.toISOString(), v: p.riskProbability })).reverse(),
  });
});

export default router;
