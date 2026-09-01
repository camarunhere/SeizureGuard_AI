import mongoose from "mongoose";

const { Schema } = mongoose;

// ---- Patient Table (+ role for Caregiver/Clinician accounts) ----------------
const userSchema = new Schema({
  email: { type: String, required: true, unique: true, lowercase: true, index: true },
  passwordHash: { type: String, required: true },
  fullName: { type: String, required: true },
  role: { type: String, enum: ["patient", "caregiver", "clinician"], default: "patient" },
  isBlocked: { type: Boolean, default: false },

  // Patient-only fields
  patientCode: { type: String, unique: true, sparse: true, index: true }, // shareable link code
  age: Number,
  medicalHistory: { type: String, default: "" },
  baselineHeartRate: { type: Number, default: 72 },
  baselineEda: { type: Number, default: 4.0 }, // resting skin conductance, microsiemens

  // Caregiver/Clinician: patients they've linked to (by consent via patientCode)
  linkedPatients: [{ type: Schema.Types.ObjectId, ref: "User" }],

  createdAt: { type: Date, default: Date.now },
});

// ---- Sensor Data Table -------------------------------------------------------
const sensorReadingSchema = new Schema({
  patient: { type: Schema.Types.ObjectId, ref: "User", index: true, required: true },
  timestamp: { type: Date, default: Date.now },
  eegSignal: [Number],       // 178-point raw epoch
  heartRate: Number,
  spo2: Number,
  movementLevel: Number,
  temperature: Number,
  eda: Number,          // electrodermal activity (skin conductance), microsiemens
  emg: Number,          // surface EMG, normalized RMS muscle activation (0-1)
  jerk: Number,         // IMU-derived rate of change of acceleration (0-1, normalized)
  rotationRate: Number, // IMU gyroscope rotational velocity, deg/s
  // Where the vitals+EEG for this reading came from — the EEG epoch itself is
  // always drawn from the recorded dataset pool (no physical headset attached
  // in this demo), but vitals may be simulated, typed in by hand, or read
  // from a paired Bluetooth heart-rate device.
  source: { type: String, enum: ["simulated", "manual", "device"], default: "simulated" },
});

// ---- Prediction Table ---------------------------------------------------------
const predictionSchema = new Schema({
  patient: { type: Schema.Types.ObjectId, ref: "User", index: true, required: true },
  reading: { type: Schema.Types.ObjectId, ref: "SensorReading" },
  predictionTime: { type: Date, default: Date.now },
  riskProbability: { type: Number, required: true },
  riskLevel: { type: String, enum: ["low", "moderate", "high"], required: true },
  predictionClass: { type: String, enum: ["inter_ictal", "pre_ictal", "ictal"], required: true },
  seizureWindow: String,
  reasons: [{ factor: String, shap_contribution: Number, direction: String, source: String, modality: String }],
  eegFeatures: Schema.Types.Mixed,
  // Filled in when a clinician reviews this prediction
  clinicianNote: String,
  reviewedBy: { type: Schema.Types.ObjectId, ref: "User" },
  reviewedAt: Date,
});

// ---- Seizure History (logged actual events, per the History & Analytics page) --
const seizureEventSchema = new Schema({
  patient: { type: Schema.Types.ObjectId, ref: "User", index: true, required: true },
  date: { type: Date, default: Date.now },
  durationMinutes: Number,
  severity: { type: String, enum: ["mild", "moderate", "severe"], default: "moderate" },
  recoveryTimeMinutes: Number,
  predictionAccuracy: Number, // % — was this event correctly flagged in advance
  triggeredByPredictionId: { type: Schema.Types.ObjectId, ref: "Prediction" },
});

// ---- Alert Table ----------------------------------------------------------------
const alertSchema = new Schema({
  patient: { type: Schema.Types.ObjectId, ref: "User", index: true, required: true },
  prediction: { type: Schema.Types.ObjectId, ref: "Prediction" },
  alertType: { type: String, enum: ["seizure_warning", "seizure_detected"], required: true },
  riskProbability: Number,
  notifiedCaregivers: [{ type: Schema.Types.ObjectId, ref: "User" }],
  notifiedClinicians: [{ type: Schema.Types.ObjectId, ref: "User" }],
  acknowledged: { type: Boolean, default: false },
  createdAt: { type: Date, default: Date.now },
});

const activityLogSchema = new Schema({
  user: { type: Schema.Types.ObjectId, ref: "User" },
  userEmail: String,
  action: { type: String, required: true },
  detail: String,
  createdAt: { type: Date, default: Date.now, index: true },
});

export const User = mongoose.model("User", userSchema);
export const SensorReading = mongoose.model("SensorReading", sensorReadingSchema);
export const Prediction = mongoose.model("Prediction", predictionSchema);
export const SeizureEvent = mongoose.model("SeizureEvent", seizureEventSchema);
export const Alert = mongoose.model("Alert", alertSchema);
export const ActivityLog = mongoose.model("ActivityLog", activityLogSchema);

export async function logActivity(user, action, detail = "") {
  try {
    await ActivityLog.create({
      user: user?._id, userEmail: user?.email, action, detail,
    });
  } catch { /* logging must never break the request */ }
}

export function genPatientCode() {
  return "PT-" + Math.random().toString(36).slice(2, 8).toUpperCase();
}
