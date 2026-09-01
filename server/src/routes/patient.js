import { Router } from "express";
import { requireRole } from "../auth.js";
import { mlMetadata } from "../mlClient.js";
import { Alert, Prediction, SeizureEvent, SensorReading, User, logActivity } from "../models.js";
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
    patient_code: u.patientCode,
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

// ---- Who's monitoring me (caregivers/clinicians linked via my patient code) ----

router.get("/linked", patientOnly, async (req, res) => {
  const [caregivers, clinicians] = await Promise.all([
    User.find({ role: "caregiver", linkedPatients: req.user._id }, "fullName email"),
    User.find({ role: "clinician", linkedPatients: req.user._id }, "fullName email"),
  ]);
  res.json({
    caregivers: caregivers.map((c) => ({ id: String(c._id), full_name: c.fullName, email: c.email })),
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
    // Real counts of who this alert is visible to (in-app), not a delivery
    // guarantee — no push/email/SMS is actually sent by this system.
    notified_caregivers: a.notifiedCaregivers.length,
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

router.get("/seizure-events", patientOnly, async (req, res) => {
  const events = await SeizureEvent.find({ patient: req.user._id }).sort({ date: -1 });
  res.json(events.map((e) => ({
    id: String(e._id),
    date: e.date.toISOString(),
    duration_minutes: e.durationMinutes,
    severity: e.severity,
    recovery_time_minutes: e.recoveryTimeMinutes,
    prediction_accuracy: e.predictionAccuracy,
  })));
});

router.post("/seizure-events", patientOnly, async (req, res) => {
  const { date, duration_minutes, severity, recovery_time_minutes, prediction_accuracy } = req.body || {};
  if (!duration_minutes || duration_minutes <= 0)
    return res.status(422).json({ detail: "Duration (minutes) is required." });
  const event = await SeizureEvent.create({
    patient: req.user._id,
    date: date ? new Date(date) : new Date(),
    durationMinutes: duration_minutes,
    severity: severity || "moderate",
    recoveryTimeMinutes: recovery_time_minutes || null,
    predictionAccuracy: prediction_accuracy ?? null,
  });
  await logActivity(req.user, "log_seizure_event", `${duration_minutes}min`);
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
