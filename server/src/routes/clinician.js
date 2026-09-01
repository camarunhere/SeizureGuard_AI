import { Router } from "express";
import { requireRole } from "../auth.js";
import { Alert, Prediction, SeizureEvent, SensorReading, User, logActivity } from "../models.js";
import { predictionPayload, readingPayload } from "../services.js";

const router = Router();
const clinicianOnly = requireRole("clinician");

async function loadLinkedPatient(req, res, next) {
  const patient = await User.findOne({ _id: req.params.patientId, role: "patient" });
  if (!patient) return res.status(404).json({ detail: "Patient not found." });
  if (!req.user.linkedPatients.some((id) => String(id) === String(patient._id)))
    return res.status(403).json({ detail: "You are not linked to this patient." });
  req.patient = patient;
  next();
}

// ---- Link to a patient using their shareable Patient Code ----------------------

router.post("/link", clinicianOnly, async (req, res) => {
  const code = String(req.body?.patient_code || "").trim().toUpperCase();
  const patient = await User.findOne({ patientCode: code, role: "patient" });
  if (!patient) return res.status(404).json({ detail: "No patient found with that code." });

  if (!req.user.linkedPatients.some((id) => String(id) === String(patient._id))) {
    req.user.linkedPatients.push(patient._id);
    await req.user.save();
  }
  await logActivity(req.user, "link_patient", String(patient._id));
  res.json({ message: `Linked to ${patient.fullName}.`, patient_id: String(patient._id) });
});

router.delete("/link/:patientId", clinicianOnly, async (req, res) => {
  req.user.linkedPatients = req.user.linkedPatients.filter(
    (id) => String(id) !== req.params.patientId
  );
  await req.user.save();
  res.json({ message: "Unlinked." });
});

// ---- Multiple Patient Monitoring (Clinician Dashboard) -------------------------

router.get("/patients", clinicianOnly, async (req, res) => {
  const patients = await User.find({ _id: { $in: req.user.linkedPatients } });
  const out = [];
  for (const p of patients) {
    const latest = await Prediction.findOne({ patient: p._id }).sort({ predictionTime: -1 });
    const lastEvent = await SeizureEvent.findOne({ patient: p._id }).sort({ date: -1 });
    out.push({
      id: String(p._id),
      full_name: p.fullName,
      age: p.age,
      current_risk_level: latest?.riskLevel || "unknown",
      ai_confidence: latest ? Math.round(Math.max(latest.riskProbability, 1 - latest.riskProbability) * 100) : null,
      last_seizure: lastEvent ? lastEvent.date.toISOString() : null,
      last_updated: latest?.predictionTime?.toISOString() || null,
    });
  }
  res.json(out);
});

// ---- Review patient data / Analyse AI predictions ------------------------------

router.get("/patients/:patientId", clinicianOnly, loadLinkedPatient, async (req, res) => {
  const [predictions, reading, events] = await Promise.all([
    Prediction.find({ patient: req.patient._id }).sort({ predictionTime: -1 }).limit(50),
    SensorReading.findOne({ patient: req.patient._id }).sort({ timestamp: -1 }),
    SeizureEvent.find({ patient: req.patient._id }).sort({ date: -1 }),
  ]);
  res.json({
    patient: {
      id: String(req.patient._id), full_name: req.patient.fullName, age: req.patient.age,
      medical_history: req.patient.medicalHistory, patient_code: req.patient.patientCode,
    },
    predictions: predictions.map(predictionPayload),
    latest_vitals: reading ? readingPayload(reading) : null,
    seizure_events: events.map((e) => ({
      id: String(e._id), date: e.date.toISOString(), duration_minutes: e.durationMinutes,
      severity: e.severity, prediction_accuracy: e.predictionAccuracy,
    })),
  });
});

// ---- Support clinical decision-making: add a note to a prediction --------------

router.post("/predictions/:id/note", clinicianOnly, async (req, res) => {
  const note = String(req.body?.note || "").trim();
  if (note.length < 3) return res.status(422).json({ detail: "Note is too short." });
  const prediction = await Prediction.findById(req.params.id);
  if (!prediction) return res.status(404).json({ detail: "Prediction not found." });
  if (!req.user.linkedPatients.some((id) => String(id) === String(prediction.patient)))
    return res.status(403).json({ detail: "You are not linked to this patient." });

  prediction.clinicianNote = note;
  prediction.reviewedBy = req.user._id;
  prediction.reviewedAt = new Date();
  await prediction.save();
  await logActivity(req.user, "review_prediction", String(prediction._id));
  res.json({ message: "Clinical note saved." });
});

// ---- AI Report Section: prediction summary + biomarkers + XAI + suggested action

router.get("/patients/:patientId/report/:predictionId", clinicianOnly, loadLinkedPatient, async (req, res) => {
  const prediction = await Prediction.findOne({ _id: req.params.predictionId, patient: req.patient._id });
  if (!prediction) return res.status(404).json({ detail: "Prediction not found." });

  const topReasons = (prediction.reasons || []).slice(0, 5);
  const suggestions = [];
  if (prediction.predictionClass === "ictal")
    suggestions.push("Seizure activity detected in the current epoch — follow the patient's emergency seizure protocol immediately.");
  else if (prediction.predictionClass === "pre_ictal")
    suggestions.push(`Elevated seizure risk with an estimated window of ${prediction.seizureWindow || "the near term"} — consider proactive rescue medication per care plan and notify caregivers.`);
  else
    suggestions.push("No elevated seizure risk detected in this reading — continue routine monitoring.");
  if (topReasons.some((r) => r.source === "vitals" && /heart rate/i.test(r.factor)))
    suggestions.push("Autonomic changes (heart rate) accompanied this reading — consider cardiac correlation review.");
  if (topReasons.some((r) => /oxygen/i.test(r.factor)))
    suggestions.push("Oxygen desaturation noted — monitor airway and consider supplemental oxygen per protocol.");
  if (topReasons.some((r) => /skin conductance|EDA/i.test(r.factor)))
    suggestions.push("Elevated electrodermal activity noted — autonomic arousal consistent with pre-ictal state; correlate with patient-reported prodrome.");
  if (topReasons.some((r) => /muscle activity|sEMG/i.test(r.factor)))
    suggestions.push("Increased sEMG activity noted — assess for tonic/clonic motor involvement.");

  res.json({
    patient_name: req.patient.fullName,
    prediction_summary: {
      risk_level: prediction.riskLevel,
      prediction_class: prediction.predictionClass,
      risk_probability: prediction.riskProbability,
      prediction_time: prediction.predictionTime.toISOString(),
    },
    important_biomarkers: prediction.eegFeatures,
    xai_explanation: topReasons,
    suggested_clinical_action: suggestions,
  });
});

export default router;
