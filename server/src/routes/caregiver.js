import { Router } from "express";
import { requireRole } from "../auth.js";
import { Alert, Prediction, SeizureEvent, SensorReading, User, logActivity } from "../models.js";
import { predictionPayload, readingPayload } from "../services.js";

const router = Router();
const caregiverOnly = requireRole("caregiver");

async function loadLinkedPatient(req, res, next) {
  const patient = await User.findOne({ _id: req.params.patientId, role: "patient" });
  if (!patient) return res.status(404).json({ detail: "Patient not found." });
  if (!req.user.linkedPatients.some((id) => String(id) === String(patient._id)))
    return res.status(403).json({ detail: "You are not linked to this patient." });
  req.patient = patient;
  next();
}

// ---- Link to a patient using their shareable Patient Code ----------------------

router.post("/link", caregiverOnly, async (req, res) => {
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

router.delete("/link/:patientId", caregiverOnly, async (req, res) => {
  req.user.linkedPatients = req.user.linkedPatients.filter(
    (id) => String(id) !== req.params.patientId
  );
  await req.user.save();
  res.json({ message: "Unlinked." });
});

// ---- Monitor patient condition remotely ----------------------------------------

router.get("/patients", caregiverOnly, async (req, res) => {
  const patients = await User.find({ _id: { $in: req.user.linkedPatients } });
  const out = [];
  for (const p of patients) {
    const latest = await Prediction.findOne({ patient: p._id }).sort({ predictionTime: -1 });
    out.push({
      id: String(p._id),
      full_name: p.fullName,
      age: p.age,
      current_risk_level: latest?.riskLevel || "unknown",
      current_prediction_class: latest?.predictionClass || null,
      last_updated: latest?.predictionTime?.toISOString() || null,
    });
  }
  res.json(out);
});

router.get("/patients/:patientId", caregiverOnly, loadLinkedPatient, async (req, res) => {
  const [latest, reading, lastEvent] = await Promise.all([
    Prediction.findOne({ patient: req.patient._id }).sort({ predictionTime: -1 }),
    SensorReading.findOne({ patient: req.patient._id }).sort({ timestamp: -1 }),
    SeizureEvent.findOne({ patient: req.patient._id }).sort({ date: -1 }),
  ]);
  res.json({
    patient: { id: String(req.patient._id), full_name: req.patient.fullName, age: req.patient.age },
    current_status: latest ? predictionPayload(latest) : null,
    latest_vitals: reading ? readingPayload(reading) : null,
    last_seizure: lastEvent
      ? { date: lastEvent.date.toISOString(), duration_minutes: lastEvent.durationMinutes, severity: lastEvent.severity }
      : null,
  });
});

// ---- Access seizure history -----------------------------------------------------

router.get("/patients/:patientId/history", caregiverOnly, loadLinkedPatient, async (req, res) => {
  const events = await SeizureEvent.find({ patient: req.patient._id }).sort({ date: -1 });
  res.json(events.map((e) => ({
    id: String(e._id), date: e.date.toISOString(), duration_minutes: e.durationMinutes,
    severity: e.severity, prediction_accuracy: e.predictionAccuracy,
  })));
});

// ---- Emergency notifications (alerts feed for linked patients) -----------------

router.get("/alerts", caregiverOnly, async (req, res) => {
  const alerts = await Alert.find({ notifiedCaregivers: req.user._id }).sort({ createdAt: -1 }).limit(50)
    .populate("patient", "fullName");
  res.json(alerts.map((a) => ({
    id: String(a._id),
    patient_name: a.patient?.fullName || "Patient",
    patient_id: String(a.patient?._id || ""),
    alert_type: a.alertType,
    risk_probability: a.riskProbability,
    acknowledged: a.acknowledged,
    created_at: a.createdAt.toISOString(),
  })));
});

router.post("/alerts/:id/acknowledge", caregiverOnly, async (req, res) => {
  const a = await Alert.findOneAndUpdate(
    { _id: req.params.id, notifiedCaregivers: req.user._id }, { acknowledged: true }, { new: true }
  );
  if (!a) return res.status(404).json({ detail: "Alert not found." });
  res.json({ message: "Alert acknowledged." });
});

export default router;
