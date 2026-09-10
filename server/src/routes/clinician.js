import { Router } from "express";
import mongoose from "mongoose";
import { requireRole } from "../auth.js";
import { Alert, Prediction, SeizureEvent, SensorReading, User, logActivity } from "../models.js";
import { predictionPayload, readingPayload } from "../services.js";
import { buildConditionSummary, generateMedicationSuggestions } from "../aiMedication.js";

const router = Router();
const clinicianOnly = requireRole("clinician");

// A short, human-readable identity label derived from the patient's own
// Mongo ID — purely so a clinician can visually tell apart two patients who
// happen to share a name. It's display-only: never accepted as input, never
// used to search/select/link a patient (that's name-based — see /directory
// and /link below). Deterministic and always unique since it's sliced from
// an already-unique ObjectId, so there's no separate field to store or keep
// in sync.
function shortCode(id) {
  return String(id).slice(-6).toUpperCase();
}

// The frontend always supplies a real patient ID here (selected by name from
// a dropdown/directory — see GET /directory and POST /link below), never
// hand-typed, but never trust that blindly: an invalid ObjectId cast throws
// synchronously inside the query and, uncaught, takes down the whole Node
// process (see the unhandledRejection note in index.js) — every other
// user's in-flight request with it.
async function loadLinkedPatient(req, res, next) {
  const raw = String(req.params.patientId || "").trim();
  if (!mongoose.isValidObjectId(raw)) return res.status(400).json({ detail: "Invalid patient ID." });
  try {
    const patient = await User.findOne({ _id: raw, role: "patient" });
    if (!patient) return res.status(404).json({ detail: "Patient not found." });
    if (!req.user.linkedPatients.some((id) => String(id) === String(patient._id)))
      return res.status(403).json({ detail: "You are not linked to this patient." });
    req.patient = patient;
    next();
  } catch (err) {
    console.error("[clinician] loadLinkedPatient failed:", err.message);
    res.status(400).json({ detail: "Invalid patient ID." });
  }
}

// ---- Link to a patient, selected by name from the patient directory ------------

// All registered patients not already linked to this clinician — lets the
// clinician search/select someone by name instead of needing a shared code.
router.get("/directory", clinicianOnly, async (req, res) => {
  const patients = await User.find(
    { role: "patient", _id: { $nin: req.user.linkedPatients } },
    "fullName age"
  ).sort({ fullName: 1 });
  res.json(patients.map((p) => ({ id: String(p._id), full_name: p.fullName, age: p.age ?? null, code: shortCode(p._id) })));
});

router.post("/link", clinicianOnly, async (req, res) => {
  const patientId = String(req.body?.patient_id || "").trim();
  if (!mongoose.isValidObjectId(patientId)) return res.status(422).json({ detail: "A valid patient must be selected." });
  const patient = await User.findOne({ _id: patientId, role: "patient" });
  if (!patient) return res.status(404).json({ detail: "Patient not found." });

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
      code: shortCode(p._id),
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
      id: String(req.patient._id), full_name: req.patient.fullName, code: shortCode(req.patient._id), age: req.patient.age,
      medical_history: req.patient.medicalHistory,
      family_history: req.patient.familyHistory || "",
      medication_history: req.patient.medicationHistory || "",
      medications: req.patient.medications || "",
      medications_prescribed_by: req.patient.medicationsPrescribedByName || null,
      medications_prescribed_at: req.patient.medicationsPrescribedAt ? req.patient.medicationsPrescribedAt.toISOString() : null,
      diet_plan: req.patient.dietPlan || "",
      exercise_plan: req.patient.exercisePlan || "",
      lifestyle_prescribed_by: req.patient.lifestylePrescribedByName || null,
      lifestyle_prescribed_at: req.patient.lifestylePrescribedAt ? req.patient.lifestylePrescribedAt.toISOString() : null,
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
    suggestions.push(`Elevated seizure risk with an estimated window of ${prediction.seizureWindow || "the near term"} — consider proactive rescue medication per care plan.`);
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

// ---- AI Medication Assistant ----------------------------------------------------
// Given a patient's ID (must already be linked to this clinician, same
// consent model as every other clinician route here), an LLM drafts
// anti-epileptic medication considerations from the patient's condition.
// This is always a draft: nothing is written to the patient's record until
// the clinician explicitly applies it via the /medications route below.

router.post("/patients/:patientId/medication-suggestions", clinicianOnly, loadLinkedPatient, async (req, res) => {
  const [events, latestPrediction] = await Promise.all([
    SeizureEvent.find({ patient: req.patient._id }).sort({ date: -1 }).limit(10),
    Prediction.findOne({ patient: req.patient._id }).sort({ predictionTime: -1 }),
  ]);
  const conditionSummary = buildConditionSummary(req.patient, events, latestPrediction);

  try {
    const result = await generateMedicationSuggestions(conditionSummary, req.patient);
    await logActivity(req.user, "generate_medication_suggestions", String(req.patient._id));
    res.json({
      patient_id: String(req.patient._id),
      patient_name: req.patient.fullName,
      condition_summary: conditionSummary,
      ...result,
    });
  } catch (err) {
    res.status(err.status || 502).json({ detail: err.message });
  }
});

// Explicit clinician action to record a reviewed medication plan on the
// patient's chart — separate from the AI draft above on purpose, so nothing
// AI-generated ever reaches the patient record without a human step.
router.post("/patients/:patientId/medications", clinicianOnly, loadLinkedPatient, async (req, res) => {
  const medications = String(req.body?.medications || "").trim();
  if (!medications) return res.status(422).json({ detail: "Medications text is required." });

  req.patient.recentMedicationChanges =
    `Updated by Dr. ${req.user.fullName} on ${new Date().toISOString().slice(0, 10)} (via AI Medication Assistant, clinician-reviewed): ${medications}`;
  req.patient.medications = medications;
  req.patient.medicationsPrescribedByName = req.user.fullName;
  req.patient.medicationsPrescribedAt = new Date();
  await req.patient.save();
  await logActivity(req.user, "update_patient_medications", String(req.patient._id));
  res.json({ message: "Medications updated on the patient's record." });
});

// ---- Lifestyle Modification -------------------------------------------------------
// Clinician-authored diet and exercise recommendations, applied directly to
// the patient's Baseline Info (not AI-generated) — a doctor prescribing food/
// diet guidance and physical activity, same provenance pattern as medications.
router.post("/patients/:patientId/lifestyle", clinicianOnly, loadLinkedPatient, async (req, res) => {
  const dietPlan = String(req.body?.diet_plan || "").trim();
  const exercisePlan = String(req.body?.exercise_plan || "").trim();
  if (!dietPlan && !exercisePlan) return res.status(422).json({ detail: "At least a diet or exercise recommendation is required." });

  req.patient.dietPlan = dietPlan;
  req.patient.exercisePlan = exercisePlan;
  req.patient.lifestylePrescribedByName = req.user.fullName;
  req.patient.lifestylePrescribedAt = new Date();
  await req.patient.save();
  await logActivity(req.user, "update_patient_lifestyle", String(req.patient._id));
  res.json({ message: "Lifestyle modification plan updated on the patient's record." });
});

export default router;
