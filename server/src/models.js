import mongoose from "mongoose";

const { Schema } = mongoose;

// ---- Patient Table (+ role for Clinician/Admin accounts) ----------------
const userSchema = new Schema({
  email: { type: String, required: true, unique: true, lowercase: true, index: true },
  passwordHash: { type: String, required: true },
  fullName: { type: String, required: true },
  role: { type: String, enum: ["patient", "clinician", "admin"], default: "patient" },
  isBlocked: { type: Boolean, default: false },
  // Clinician accounts require admin sign-off before they can log in; every
  // other role is auto-approved. "admin" is never self-registered (see
  // routes/auth.js) so it's always created already approved.
  approvalStatus: { type: String, enum: ["pending", "approved", "rejected"], default: "approved" },

  // Patient-only fields
  age: Number,
  medicalHistory: { type: String, default: "" }, // "Past medical history" in the UI
  familyHistory: { type: String, default: "" },
  medicationHistory: { type: String, default: "" }, // "Past medication history" — prior AEDs tried, distinct from `medications` (current)
  baselineHeartRate: { type: Number, default: 72 },
  baselineEda: { type: Number, default: 4.0 }, // resting skin conductance, microsiemens

  // Baseline patient information — collected once, editable later. Purely
  // clinical record-keeping and context for clinicians; none of this feeds
  // the deep learning model (which only ever sees the raw EEG signal — see
  // src/ml_service.py). It also seeds the rule-based daily check-in risk
  // factors (see checkinRisk.js) where relevant (e.g. known triggers).
  sex: { type: String, enum: ["", "male", "female", "other", "prefer_not_to_say"], default: "" },
  diagnosisDate: Date,
  seizureType: { type: String, default: "" }, // e.g. focal, generalized, absence, tonic-clonic, unknown
  seizureFrequency: { type: String, default: "" }, // free text, e.g. "2-3 times/month"
  lastSeizureDate: Date,
  hasAura: { type: String, enum: ["", "yes", "no", "sometimes"], default: "" },
  auraSymptoms: { type: String, default: "" },
  medications: { type: String, default: "" },
  // Set whenever a clinician applies a plan via the AI Medication Assistant
  // (see routes/clinician.js) — cleared if the patient later edits
  // `medications` themselves, so it never misrepresents a self-report as a
  // clinician's prescription. Denormalized (name, not a User ref) since it's
  // display-only provenance, not a relationship the app needs to traverse.
  medicationsPrescribedByName: { type: String, default: "" },
  medicationsPrescribedAt: { type: Date, default: null },
  recentMedicationChanges: { type: String, default: "" },
  otherConditions: { type: String, default: "" },
  knownTriggers: { type: String, default: "" },

  // Lifestyle modification (diet + exercise) — same provenance pattern as
  // medications above: a clinician prescribes it from the Patients page,
  // it's editable by the patient too, and editing it themselves clears the
  // "prescribed by" attribution rather than misrepresenting whose plan it is.
  dietPlan: { type: String, default: "" },
  exercisePlan: { type: String, default: "" },
  lifestylePrescribedByName: { type: String, default: "" },
  lifestylePrescribedAt: { type: Date, default: null },

  // Clinician: patients they've linked to, selected by name from the
  // clinician-facing patient directory (see GET /api/clinician/directory).
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
  // in this demo). Only "manual" (typed in by hand) is reachable today;
  // "simulated"/"device" remain in the enum for historical documents from
  // earlier iterations of this feature, not because either is still writable.
  source: { type: String, enum: ["simulated", "manual", "device"], default: "manual" },
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
// The detailed fields below (activity before, aura, symptoms, consciousness,
// falls, movement, tongue biting, incontinence, witness, EMS) are a
// structured post-seizure report — real clinical documentation value for
// the patient's own record and for clinicians reviewing the case, filled in
// after the fact by the patient. None of it is required; a seizure can
// still be logged with just a date and duration as before.
const seizureEventSchema = new Schema({
  patient: { type: Schema.Types.ObjectId, ref: "User", index: true, required: true },
  date: { type: Date, default: Date.now },
  durationMinutes: Number,
  severity: { type: String, enum: ["mild", "moderate", "severe"], default: "moderate" },
  recoveryTimeMinutes: Number,
  predictionAccuracy: Number, // % — was this event correctly flagged in advance
  triggeredByPredictionId: { type: Schema.Types.ObjectId, ref: "Prediction" },

  activityBefore: { type: String, default: "" }, // "What were you doing immediately before it?"
  hadWarningAura: { type: String, enum: ["", "yes", "no", "unsure"], default: "" },
  symptomsOccurred: { type: String, default: "" },
  lostConsciousness: { type: String, enum: ["", "yes", "no", "unsure"], default: "" },
  fell: { type: String, enum: ["", "yes", "no"], default: "" },
  unusualMovement: { type: String, enum: ["", "yes", "no"], default: "" },
  tongueBiting: { type: String, enum: ["", "yes", "no"], default: "" },
  incontinence: { type: String, enum: ["", "yes", "no"], default: "" },
  witnessPresent: { type: String, enum: ["", "yes", "no"], default: "" },
  witnessNote: { type: String, default: "" },
  emsRequired: { type: String, enum: ["", "yes", "no"], default: "" },
});

// ---- Alert Table ----------------------------------------------------------------
const alertSchema = new Schema({
  patient: { type: Schema.Types.ObjectId, ref: "User", index: true, required: true },
  prediction: { type: Schema.Types.ObjectId, ref: "Prediction" },
  alertType: { type: String, enum: ["seizure_warning", "seizure_detected"], required: true },
  riskProbability: Number,
  notifiedClinicians: [{ type: Schema.Types.ObjectId, ref: "User" }],
  acknowledged: { type: Boolean, default: false },
  createdAt: { type: Date, default: Date.now },
});

// ---- Daily Check-in Table -------------------------------------------------------
// One document per patient per calendar day (upserted, see routes/patient.js).
// Feeds the rule-based, clinically-informed risk-factor heuristics in
// checkinRisk.js — NOT the deep learning model, which only ever sees the raw
// EEG signal. Shown as a separate "self-reported risk factors" panel, never
// merged into the AI's own SHAP-based reasons.
const dailyCheckinSchema = new Schema({
  patient: { type: Schema.Types.ObjectId, ref: "User", index: true, required: true },
  date: { type: Date, required: true, index: true }, // truncated to the calendar day

  // Possible warning symptoms right now (aura/prodrome-type signs) — the
  // most clinically direct of all the check-in signals, since these can
  // directly precede a seizure rather than just elevate general risk.
  warningSymptoms: [{
    type: String,
    enum: ["unusual_smell_taste", "deja_vu", "dizziness", "visual_changes", "tingling_numbness",
      "confusion", "sudden_fear_anxiety", "unusual_sounds", "headache", "other"],
  }],
  warningSymptomsOther: { type: String, default: "" },

  // Sleep
  sleepHours: Number,
  sleepQuality: { type: String, enum: ["very_good", "good", "average", "poor", "very_poor"] },
  wokeFrequently: Boolean,

  // Medication
  medicationTaken: { type: String, enum: ["yes", "no", "partially"] },
  // Follow-up shown when medicationTaken is "no" or "partially" — what
  // actually happened: the dose was skipped entirely, taken later than
  // usual, or only part of it was taken.
  medicationIssue: { type: String, enum: ["", "missed", "late", "partial"], default: "" },

  // Stress & wellbeing (0-10 scales)
  stressLevel: { type: Number, min: 0, max: 10 },
  anxietyLevel: { type: Number, min: 0, max: 10 },
  fatigueLevel: { type: Number, min: 0, max: 10 },

  // Physical factors
  illness: { type: Boolean, default: false }, // "Been unwell recently?"
  illnessNote: { type: String, default: "" }, // what it was, if yes
  ateNormally: Boolean,
  hydrated: Boolean,
  strenuousExercise: Boolean,

  // Potential triggers
  alcohol: Boolean,
  caffeineMoreThanUsual: Boolean,
  recreationalDrugs: Boolean,
  knownTriggerExperienced: Boolean,
  triggerNote: { type: String, default: "" },

  // "Compared with your usual day, does today feel different?" — a single
  // holistic self-assessment that often catches what the itemized questions
  // above miss.
  comparedToUsual: {
    type: String,
    enum: ["much_better", "slightly_better", "normal", "slightly_worse", "much_worse"],
  },

  createdAt: { type: Date, default: Date.now },
});
dailyCheckinSchema.index({ patient: 1, date: 1 }, { unique: true });

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
export const DailyCheckin = mongoose.model("DailyCheckin", dailyCheckinSchema);
export const ActivityLog = mongoose.model("ActivityLog", activityLogSchema);

export async function logActivity(user, action, detail = "") {
  try {
    await ActivityLog.create({
      user: user?._id, userEmail: user?.email, action, detail,
    });
  } catch { /* logging must never break the request */ }
}
