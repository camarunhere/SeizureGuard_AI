// Shared "run one monitoring tick" pipeline: pull a simulated EEG+vitals
// reading, run the AI prediction, persist both, and raise an alert if the
// risk is high enough — used by the Live Monitoring page's polling loop.
import { mlPredict, mlSimulate } from "./mlClient.js";
import { Alert, Prediction, SensorReading, User } from "./models.js";

// Real seizure epochs are ~20% of the dataset; keep that roughly realistic
// but let the demo actually show a pre-ictal/ictal reading now and then.
const SEIZURE_BIAS_PROBABILITY = 0.16;

export async function runMonitoringTick(patient) {
  const biasSeizure = Math.random() < SEIZURE_BIAS_PROBABILITY;
  const sim = await mlSimulate(biasSeizure);

  const reading = await SensorReading.create({
    patient: patient._id,
    eegSignal: sim.eeg_signal,
    heartRate: sim.heart_rate,
    spo2: sim.spo2,
    movementLevel: sim.movement_level,
    temperature: sim.temperature,
    simulated: true,
  });

  const result = await mlPredict({
    eeg_signal: sim.eeg_signal,
    heart_rate: sim.heart_rate,
    baseline_heart_rate: patient.baselineHeartRate || 72,
    spo2: sim.spo2,
    movement_level: sim.movement_level,
    temperature: sim.temperature,
  });

  const prediction = await Prediction.create({
    patient: patient._id,
    reading: reading._id,
    riskProbability: result.risk_probability,
    riskLevel: result.risk_level,
    predictionClass: result.prediction_class,
    seizureWindow: result.seizure_window,
    reasons: result.reasons,
    eegFeatures: result.eeg_features,
  });

  let alert = null;
  if (result.risk_level !== "low") {
    const [caregivers, clinicians] = await Promise.all([
      User.find({ role: "caregiver", linkedPatients: patient._id }, "_id"),
      User.find({ role: "clinician", linkedPatients: patient._id }, "_id"),
    ]);
    alert = await Alert.create({
      patient: patient._id,
      prediction: prediction._id,
      alertType: result.prediction_class === "ictal" ? "seizure_detected" : "seizure_warning",
      riskProbability: result.risk_probability,
      notifiedCaregivers: caregivers.map((c) => c._id),
      notifiedClinicians: clinicians.map((c) => c._id),
    });
  }

  return { reading, prediction, alert };
}

export function predictionPayload(p) {
  return {
    id: String(p._id),
    prediction_time: p.predictionTime.toISOString(),
    risk_probability: p.riskProbability,
    risk_level: p.riskLevel,
    prediction_class: p.predictionClass,
    seizure_window: p.seizureWindow || null,
    reasons: p.reasons || [],
    eeg_features: p.eegFeatures || {},
    clinician_note: p.clinicianNote || null,
    reviewed_at: p.reviewedAt ? p.reviewedAt.toISOString() : null,
  };
}

export function readingPayload(r) {
  return {
    id: String(r._id),
    timestamp: r.timestamp.toISOString(),
    eeg_signal: r.eegSignal,
    heart_rate: r.heartRate,
    spo2: r.spo2,
    movement_level: r.movementLevel,
    temperature: r.temperature,
  };
}
