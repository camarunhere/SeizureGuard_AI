// Shared "run one monitoring tick" pipeline: pull an EEG epoch (always drawn
// from the recorded dataset pool — no physical headset attached in this demo),
// pair it with the patient's manually-entered vitals, run the AI prediction,
// persist both, and raise an alert if the risk is high enough — used by the
// Live Monitoring page's manual-entry flow.
import { mlPredict, mlSimulate } from "./mlClient.js";
import { Alert, Prediction, SensorReading, User } from "./models.js";

// Real seizure epochs are ~20% of the dataset; keep that roughly realistic
// but let the demo actually show a pre-ictal/ictal reading now and then.
const SEIZURE_BIAS_PROBABILITY = 0.16;

// `opts.source`: "manual" (default; the only reachable value today)
// `opts.vitals`: { heart_rate, spo2, movement_level, temperature, eda, emg,
//   jerk, rotation_rate } — overrides the simulated defaults with what the
//   patient typed in.
// `opts.biasSeizure`: force which half of the epoch pool to draw from (used
//   when the patient picks a sample EEG epoch type for manual entry).
export async function runMonitoringTick(patient, opts = {}) {
  const source = opts.source || "manual";
  const biasSeizure = opts.biasSeizure ?? (Math.random() < SEIZURE_BIAS_PROBABILITY);
  const sim = await mlSimulate(biasSeizure);
  const vitals = opts.vitals || {
    heart_rate: sim.heart_rate,
    spo2: sim.spo2,
    movement_level: sim.movement_level,
    temperature: sim.temperature,
    eda: sim.eda,
    emg: sim.emg,
    jerk: sim.jerk,
    rotation_rate: sim.rotation_rate,
  };

  const reading = await SensorReading.create({
    patient: patient._id,
    eegSignal: sim.eeg_signal,
    heartRate: vitals.heart_rate,
    spo2: vitals.spo2,
    movementLevel: vitals.movement_level,
    temperature: vitals.temperature,
    eda: vitals.eda,
    emg: vitals.emg,
    jerk: vitals.jerk,
    rotationRate: vitals.rotation_rate,
    source,
  });

  const result = await mlPredict({
    eeg_signal: sim.eeg_signal,
    heart_rate: vitals.heart_rate,
    baseline_heart_rate: patient.baselineHeartRate || 72,
    spo2: vitals.spo2,
    movement_level: vitals.movement_level,
    temperature: vitals.temperature,
    eda: vitals.eda,
    baseline_eda: patient.baselineEda || 4.0,
    emg: vitals.emg,
    jerk: vitals.jerk,
    rotation_rate: vitals.rotation_rate,
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
    const clinicians = await User.find({ role: "clinician", linkedPatients: patient._id }, "_id");
    alert = await Alert.create({
      patient: patient._id,
      prediction: prediction._id,
      alertType: result.prediction_class === "ictal" ? "seizure_detected" : "seizure_warning",
      riskProbability: result.risk_probability,
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
    eda: r.eda,
    emg: r.emg,
    jerk: r.jerk,
    rotation_rate: r.rotationRate,
    source: r.source,
  };
}
