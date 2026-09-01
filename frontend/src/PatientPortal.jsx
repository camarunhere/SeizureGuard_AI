import { useEffect, useState } from "react";
import { api, useApi } from "./api";
import {
  Alert, Button, Card, CountUp, EEGWaveform, Field, Skeleton, Spinner,
  TrendChart, RiskBadge, RiskFingerprint, classLabel, fmtDate, inputCls, primaryContributors, riskStyle,
} from "./ui";

export default function PatientPortal({ tab }) {
  switch (tab) {
    case "dashboard": return <Dashboard />;
    case "live": return <LiveMonitoring />;
    case "predictions": return <Predictions />;
    case "xai": return <ExplainableAI />;
    case "benchmark": return <ModelBenchmark />;
    case "alerts": return <Alerts />;
    case "history": return <History />;
    case "profile": return <Profile />;
    default: return null;
  }
}

// ---- Current Risk Status Card (Patient Dashboard) ------------------------------

function Dashboard() {
  const { data, loading, error, reload } = useApi("/api/patient/dashboard");

  if (loading) return <Card><Skeleton lines={4} /></Card>;
  if (error) return <Alert>{error}</Alert>;

  const { current_status, latest_vitals, total_predictions, last_seizure, active_alert } = data;

  return (
    <div className="grid sm:grid-cols-2 gap-6">
      {active_alert && (
        <div className="sm:col-span-2 bg-red-50 border border-red-300 rounded-2xl p-5 flex items-center justify-between animate-fade-in-up">
          <div>
            <p className="font-bold text-red-700">Active emergency alert</p>
            <p className="text-sm text-red-600">
              {active_alert.alert_type === "seizure_detected" ? "Seizure activity detected" : "Elevated seizure risk"} — {(active_alert.risk_probability * 100).toFixed(0)}% probability.
            </p>
          </div>
          <AckButton path={`/api/patient/alerts/${active_alert.id}/acknowledge`} onDone={reload} />
        </div>
      )}

      <Card title="Current risk status">
        {current_status ? (
          <>
            <RiskBadge level={current_status.risk_level} probability={current_status.risk_probability} />
            <p className="mt-3 text-slate-700 font-medium">{classLabel(current_status.prediction_class)}</p>
            {current_status.seizure_window && (
              <p className="text-sm text-slate-500 mt-1">Estimated window: {current_status.seizure_window}</p>
            )}
            <p className="text-xs text-slate-400 mt-3">Last updated {fmtDate(current_status.prediction_time)}</p>
          </>
        ) : (
          <p className="text-sm text-slate-400">No readings yet — visit Live Monitoring to start.</p>
        )}
      </Card>

      <Card title="Latest vitals">
        {latest_vitals ? <VitalsGrid v={latest_vitals} /> : <p className="text-sm text-slate-400">No vitals recorded yet.</p>}
      </Card>

      <Card title="Total predictions run">
        <p className="text-4xl font-bold text-blue-950"><CountUp value={total_predictions} /></p>
        <p className="text-sm text-slate-400 mt-1">AI predictions since account creation.</p>
      </Card>

      <Card title="Last seizure event">
        {last_seizure ? (
          <>
            <p className="text-slate-700 font-medium">{fmtDate(last_seizure.date)}</p>
            <p className="text-sm text-slate-500 mt-1 capitalize">
              {last_seizure.severity} · {last_seizure.duration_minutes} min
              {last_seizure.recovery_time_minutes ? ` · ${last_seizure.recovery_time_minutes} min recovery` : ""}
            </p>
          </>
        ) : (
          <p className="text-sm text-slate-400">No seizure events logged yet.</p>
        )}
      </Card>
    </div>
  );
}

function Vital({ label, value, unit, decimals }) {
  const d = decimals ?? (value % 1 !== 0 ? 1 : 0);
  return (
    <div>
      <p className="text-xs uppercase tracking-wide text-slate-400">{label}</p>
      <p className="text-xl font-bold text-slate-800"><CountUp value={value} decimals={d} /> <span className="text-sm font-medium text-slate-400">{unit}</span></p>
    </div>
  );
}

// Multimodal vitals grid shared by the Dashboard and Live Monitoring pages —
// cardiac/respiratory (HR, SpO2), autonomic (EDA), muscular (sEMG), motion
// (movement/jerk/rotation from the IMU), and temperature.
function VitalsGrid({ v }) {
  return (
    <div className="grid grid-cols-2 gap-4">
      <Vital label="Heart rate" value={v.heart_rate} unit="bpm" />
      <Vital label="SpO₂" value={v.spo2} unit="%" />
      <Vital label="EDA (skin conductance)" value={v.eda} unit="µS" decimals={1} />
      <Vital label="sEMG (muscle RMS)" value={v.emg} unit="" decimals={2} />
      <Vital label="Movement intensity" value={Math.round((v.movement_level ?? 0) * 100)} unit="%" />
      <Vital label="Jerk" value={v.jerk} unit="" decimals={2} />
      <Vital label="Rotation rate" value={v.rotation_rate} unit="°/s" />
      <Vital label="Temperature" value={v.temperature} unit="°C" decimals={1} />
    </div>
  );
}

function AckButton({ path, onDone, small }) {
  const [busy, setBusy] = useState(false);
  const ack = async () => {
    setBusy(true);
    try { await api(path, { method: "POST" }); onDone(); } catch { /* noop */ }
    setBusy(false);
  };
  return (
    <Button variant={small ? "subtle" : "danger"} className={small ? "text-xs px-3 py-1" : ""} onClick={ack} disabled={busy}>
      {busy && <Spinner />}Acknowledge
    </Button>
  );
}

// ---- Live Monitoring: manual entry ----------------------------------------------

function LiveMonitoring() {
  const [latest, setLatest] = useState(null);
  const [history, setHistory] = useState([]);

  const onResult = (res) => {
    setLatest(res);
    setHistory((h) => [...h.slice(-19), { t: res.prediction.prediction_time, v: res.prediction.risk_probability }]);
  };

  const s = latest ? riskStyle(latest.prediction.risk_level) : null;

  return (
    <div className="space-y-6">
      <ManualEntry onResult={onResult} />

      {latest?.alert_raised && (
        <Alert kind="error">
          Elevated risk detected — recorded as an alert, visible to your linked caregivers/clinicians next time they check
          (this is an in-app record, not a push/email/SMS notification, unless that's separately configured).
        </Alert>
      )}

      <Card title="Live EEG epoch">
        {latest ? (
          <EEGWaveform signal={latest.reading.eeg_signal} abnormal={latest.prediction.risk_level !== "low"} />
        ) : (
          <p className="text-sm text-slate-400">No reading yet — use the controls above to get a live reading.</p>
        )}
      </Card>

      <div className="grid sm:grid-cols-2 gap-6">
        <Card title="Current AI prediction">
          {latest ? (
            <>
              <RiskBadge level={latest.prediction.risk_level} probability={latest.prediction.risk_probability} />
              <p className="mt-3 text-slate-700 font-medium">{classLabel(latest.prediction.prediction_class)}</p>
              {latest.prediction.seizure_window && (
                <p className="text-sm text-slate-500 mt-1">Estimated window: {latest.prediction.seizure_window}</p>
              )}
            </>
          ) : (
            <p className="text-sm text-slate-400">No prediction yet.</p>
          )}
        </Card>

        <Card title="Vitals">
          {latest ? (
            <>
              <VitalsGrid v={latest.reading} />
              <p className="text-xs text-slate-400 mt-3 capitalize">Source: {latest.reading.source}</p>
            </>
          ) : (
            <p className="text-sm text-slate-400">No vitals yet.</p>
          )}
        </Card>
      </div>

      {latest && (
        <div className="grid sm:grid-cols-2 gap-6">
          <Card title="Risk fingerprint — contribution by modality">
            <RiskFingerprint reasons={latest.prediction.reasons} riskProbability={latest.prediction.risk_probability} />
          </Card>
          <Card title="Decision support summary">
            <DecisionSupportSummary prediction={latest.prediction} history={history} />
          </Card>
        </div>
      )}

      {history.length > 1 && (
        <Card title="Risk probability (this session)">
          <TrendChart points={history} domain={[0, 1]} format={(v) => `${Math.round(v * 100)}%`} color={s?.bar === "bg-red-600" ? "#dc2626" : "#1e3a8a"} />
        </Card>
      )}

      {latest && (
        <Card title="Processing pipeline">
          <p className="text-xs text-slate-400 -mt-2 mb-3">
            The real stages this reading was processed through, in order. All ran server-side within a single request — this
            app doesn't stream per-stage progress, so they're shown as completed together rather than ticking live.
          </p>
          <PipelineStatus complete />
        </Card>
      )}
    </div>
  );
}

const PIPELINE_STAGES = [
  "Data Collection — EEG epoch + wearable vitals",
  "Preprocessing — signal scaling",
  "Feature Extraction — band power & signal statistics",
  "Prediction — CNN + BiLSTM + Transformer",
  "Explainability — SHAP (EEG surrogate) + heuristic severity (vitals)",
  "Decision Support — risk level & prediction class",
  "Alert — raised only if risk is above low",
];

function PipelineStatus({ complete }) {
  return (
    <div className="space-y-1.5">
      {PIPELINE_STAGES.map((stage, i) => (
        <div key={i} className="flex items-center gap-2 text-sm">
          <span className={complete ? "text-emerald-600" : "text-slate-300"}>{complete ? "✓" : "○"}</span>
          <span className={complete ? "text-slate-700" : "text-slate-400"}>{stage}</span>
        </div>
      ))}
    </div>
  );
}

/** Risk trend + recommended actions, derived from real data only — no
 * invented confidence numbers. Trend uses this session's own risk history;
 * with fewer than 2 points it's simply omitted rather than guessed. */
function DecisionSupportSummary({ prediction, history }) {
  const contributors = primaryContributors(prediction.reasons);
  let trend = null;
  if (history.length >= 2) {
    const delta = history[history.length - 1].v - history[0].v;
    trend = delta > 0.05 ? "Increasing" : delta < -0.05 ? "Decreasing" : "Stable";
  }

  const actions = {
    low: ["Continue routine monitoring."],
    moderate: ["Stay somewhere safe.", "Let a linked caregiver know you're being monitored.", "Continue enhanced monitoring."],
    high: ["Move to a safe location if possible.", "Alert a linked caregiver/clinician now.", "Follow your seizure action plan."],
  }[prediction.risk_level] || [];

  return (
    <div className="space-y-3 text-sm">
      <div className="flex justify-between"><span className="text-slate-400">AI risk</span><span className="font-semibold text-slate-700 capitalize">{prediction.risk_level}</span></div>
      <div className="flex justify-between"><span className="text-slate-400">Probability</span><span className="font-semibold text-slate-700">{(prediction.risk_probability * 100).toFixed(1)}%</span></div>
      {trend && <div className="flex justify-between"><span className="text-slate-400">Trend (this session)</span><span className="font-semibold text-slate-700">{trend}</span></div>}
      {contributors.length > 0 && (
        <div className="flex justify-between gap-3"><span className="text-slate-400 shrink-0">Main contributors</span><span className="font-semibold text-slate-700 text-right">{contributors.join(" + ")}</span></div>
      )}
      <div className="pt-2 border-t border-slate-100">
        <p className="text-xs uppercase tracking-wide text-slate-400 mb-1.5">Suggested response (decision support, not diagnosis)</p>
        <ul className="space-y-1 list-disc list-inside text-slate-600">
          {actions.map((a, i) => <li key={i}>{a}</li>)}
        </ul>
      </div>
    </div>
  );
}


// ---- Manual entry: patient types in vitals, picks a sample EEG epoch type -----

// Every field starts genuinely blank — no pre-filled "typical" values that
// could get silently submitted without the patient actually entering a real
// reading. Placeholders only hint at the expected magnitude/units; they are
// not values and are never sent. Movement is the one exception: it's a
// slider (HTML range inputs can't be "empty"), so it starts at its natural
// floor of 0% rather than an assumed value.
const EMPTY_VITALS = {
  heart_rate: "", spo2: "", movement_level: "0", temperature: "",
  eda: "", emg: "", jerk: "", rotation_rate: "",
};

function VitalsFields({ vitals, setVitals }) {
  const set = (k) => (e) => setVitals({ ...vitals, [k]: e.target.value });
  return (
    <div className="grid sm:grid-cols-2 gap-4">
      <Field label="Heart rate (bpm)">
        <input type="number" min={30} max={220} required placeholder="e.g. 72" className={inputCls} value={vitals.heart_rate} onChange={set("heart_rate")} />
      </Field>
      <Field label="SpO₂ (%)">
        <input type="number" min={70} max={100} step={0.1} required placeholder="e.g. 98" className={inputCls} value={vitals.spo2} onChange={set("spo2")} />
      </Field>
      <Field label="EDA — skin conductance (µS)">
        <input type="number" min={0.5} max={25} step={0.1} required placeholder="e.g. 4.0" className={inputCls} value={vitals.eda} onChange={set("eda")} />
      </Field>
      <Field label="sEMG — muscle activity RMS (0-1)">
        <input type="number" min={0} max={1} step={0.01} required placeholder="e.g. 0.15" className={inputCls} value={vitals.emg} onChange={set("emg")} />
      </Field>
      <Field label={`Movement intensity (${vitals.movement_level}%)`}>
        <input type="range" min={0} max={100} className="w-full" value={vitals.movement_level} onChange={set("movement_level")} />
      </Field>
      <Field label="Jerk — motion smoothness (0-1)">
        <input type="number" min={0} max={1} step={0.01} required placeholder="e.g. 0.1" className={inputCls} value={vitals.jerk} onChange={set("jerk")} />
      </Field>
      <Field label="Rotation rate (°/s)">
        <input type="number" min={0} max={500} step={1} required placeholder="e.g. 20" className={inputCls} value={vitals.rotation_rate} onChange={set("rotation_rate")} />
      </Field>
      <Field label="Temperature (°C)">
        <input type="number" min={34} max={42} step={0.1} required placeholder="e.g. 36.8" className={inputCls} value={vitals.temperature} onChange={set("temperature")} />
      </Field>
    </div>
  );
}

function ManualEntry({ onResult }) {
  const [vitals, setVitals] = useState(EMPTY_VITALS);
  const [epochType, setEpochType] = useState("normal");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const submit = async (e) => {
    e.preventDefault();
    setError("");
    setBusy(true);
    try {
      const res = await api("/api/patient/live/reading", {
        method: "POST",
        body: {
          source: "manual",
          epoch_type: epochType,
          heart_rate: Number(vitals.heart_rate),
          spo2: Number(vitals.spo2),
          movement_level: Number(vitals.movement_level) / 100,
          temperature: Number(vitals.temperature),
          eda: Number(vitals.eda),
          emg: Number(vitals.emg),
          jerk: Number(vitals.jerk),
          rotation_rate: Number(vitals.rotation_rate),
        },
      });
      onResult(res);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card title="Enter a reading manually">
      <p className="text-xs text-slate-400 -mt-2 mb-4">
        No wearable handy? Type in cardiac, autonomic (EDA), muscular (sEMG), and motion vitals from a manual check, pick a
        sample EEG epoch — the AI still runs a real prediction on it.
      </p>
      <Alert>{error}</Alert>
      <form onSubmit={submit} className="space-y-4">
        <Field label="Sample EEG epoch">
          <select className={inputCls} value={epochType} onChange={(e) => setEpochType(e.target.value)}>
            <option value="normal">Normal (baseline recording)</option>
            <option value="seizure">Seizure activity (ictal recording)</option>
          </select>
        </Field>
        <VitalsFields vitals={vitals} setVitals={setVitals} />
        <Button type="submit" disabled={busy}>{busy && <Spinner />}Run prediction</Button>
      </form>
    </Card>
  );
}

// ---- AI Prediction Dashboard ----------------------------------------------------

/** Risk trend/change/stability from real prediction history — omitted (not
 * guessed) when there's too little data to say anything meaningful. `data`
 * is newest-first, as returned by the API. */
function riskTimelineStats(data) {
  if (data.length < 2) return null;
  const n = Math.min(5, Math.floor(data.length / 2));
  const recent = data.slice(0, n).map((p) => p.risk_probability);
  const baseline = data.slice(-n).map((p) => p.risk_probability);
  const avg = (arr) => arr.reduce((a, b) => a + b, 0) / arr.length;
  const recentAvg = avg(recent);
  const baselineAvg = avg(baseline);
  const delta = recentAvg - baselineAvg;
  const trend = delta > 0.05 ? "Increasing" : delta < -0.05 ? "Decreasing" : "Stable";

  const all = data.map((p) => p.risk_probability);
  const mean = avg(all);
  const variance = avg(all.map((v) => (v - mean) ** 2));
  const std = Math.sqrt(variance);
  const stability = std < 0.1 ? "Good" : std < 0.25 ? "Moderate" : "Volatile";

  return { trend, deltaPct: delta * 100, stability };
}

function Predictions() {
  const { data, loading, error } = useApi("/api/patient/predictions?limit=50");
  if (loading) return <Card><Skeleton lines={4} /></Card>;
  if (error) return <Alert>{error}</Alert>;
  if (!data.length) return <Card><p className="text-sm text-slate-400">No AI predictions yet — visit Live Monitoring to generate one.</p></Card>;

  const chartPoints = [...data].reverse().map((p) => ({ t: p.prediction_time, v: p.risk_probability }));
  const stats = riskTimelineStats(data);

  return (
    <div className="space-y-6">
      <Card title="Risk probability over time">
        <TrendChart points={chartPoints} domain={[0, 1]} format={(v) => `${Math.round(v * 100)}%`} />
        {stats && (
          <div className="grid grid-cols-3 gap-4 mt-4 pt-4 border-t border-slate-100 text-sm">
            <div><p className="text-xs uppercase tracking-wide text-slate-400">Risk trend</p><p className="font-semibold text-slate-700">{stats.trend}</p></div>
            <div><p className="text-xs uppercase tracking-wide text-slate-400">Change (recent vs earlier)</p><p className="font-semibold text-slate-700">{stats.deltaPct >= 0 ? "+" : ""}{stats.deltaPct.toFixed(1)}%</p></div>
            <div><p className="text-xs uppercase tracking-wide text-slate-400">Risk stability</p><p className="font-semibold text-slate-700">{stats.stability}</p></div>
          </div>
        )}
      </Card>
      <Card title={`Prediction log (${data.length})`}>
        <div className="space-y-2 max-h-[28rem] overflow-y-auto">
          {data.map((p) => (
            <div key={p.id} className="flex items-center justify-between gap-3 py-2.5 border-b border-slate-100 last:border-0">
              <div>
                <p className="text-sm font-medium text-slate-700">{classLabel(p.prediction_class)}</p>
                <p className="text-xs text-slate-400">{fmtDate(p.prediction_time)}{p.seizure_window ? ` · window ${p.seizure_window}` : ""}</p>
              </div>
              <RiskBadge level={p.risk_level} probability={p.risk_probability} />
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
}

// ---- Explainable AI --------------------------------------------------------------

function ExplainableAI() {
  const { data, loading, error } = useApi("/api/patient/predictions?limit=20");
  const [selected, setSelected] = useState(null);

  useEffect(() => {
    if (data?.length && !selected) setSelected(data[0].id);
  }, [data, selected]);

  if (loading) return <Card><Skeleton lines={4} /></Card>;
  if (error) return <Alert>{error}</Alert>;
  if (!data.length) return <Card><p className="text-sm text-slate-400">No predictions to explain yet.</p></Card>;

  const prediction = data.find((p) => p.id === selected) || data[0];
  const maxContribution = Math.max(...prediction.reasons.map((r) => Math.abs(r.shap_contribution)), 0.001);

  return (
    <div className="space-y-6">
      <Card title="Select a prediction">
        <select
          className={inputCls}
          value={selected || ""}
          onChange={(e) => setSelected(e.target.value)}
        >
          {data.map((p) => (
            <option key={p.id} value={p.id}>
              {fmtDate(p.prediction_time)} — {classLabel(p.prediction_class)} ({(p.risk_probability * 100).toFixed(0)}%)
            </option>
          ))}
        </select>
      </Card>

      <div className="grid sm:grid-cols-2 gap-6">
        <Card title="Risk fingerprint — contribution by modality">
          <RiskFingerprint reasons={prediction.reasons} riskProbability={prediction.risk_probability} />
        </Card>

        <Card title="Why the AI made this prediction">
          <RiskBadge level={prediction.risk_level} probability={prediction.risk_probability} />
          {prediction.clinician_note && (
            <div className="mt-3 bg-blue-50 border border-blue-100 rounded-lg px-3 py-2 text-sm text-blue-800">
              <span className="font-semibold">Clinician note:</span> {prediction.clinician_note}
            </div>
          )}
          <div className="mt-4 space-y-3">
            {prediction.reasons.length === 0 && <p className="text-sm text-slate-400">No contributing factors recorded.</p>}
            {prediction.reasons.map((r, i) => {
              const pct = (Math.abs(r.shap_contribution) / maxContribution) * 100;
              const up = r.direction === "increases" || r.shap_contribution > 0;
              return (
                <div key={i}>
                  <div className="flex items-center gap-2 text-sm mb-1">
                    <span className="text-xs font-mono text-slate-400 w-5 shrink-0">{String(i + 1).padStart(2, "0")}</span>
                    <span className="font-medium text-slate-700 flex-1">{r.factor}</span>
                    <span className={`text-xs font-semibold shrink-0 ${up ? "text-red-600" : "text-emerald-600"}`}>
                      {up ? "↑ increases risk" : "↓ decreases risk"}
                    </span>
                  </div>
                  <div className="h-2 rounded-full bg-slate-100 overflow-hidden ml-7">
                    <div className={`h-full rounded-full ${up ? "bg-red-500" : "bg-emerald-500"}`} style={{ width: `${pct}%` }} />
                  </div>
                  <p className="text-xs text-slate-400 mt-0.5 ml-7 capitalize">{r.source}</p>
                </div>
              );
            })}
            {prediction.reasons.length > 0 && (
              <p className="text-xs text-slate-500 pt-2 border-t border-slate-100">
                <span className="font-semibold text-slate-600">Primary contributors: </span>
                {primaryContributors(prediction.reasons).join(" + ")}
              </p>
            )}
          </div>
        </Card>
      </div>

      <Card title="EEG-derived features">
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
          {Object.entries(prediction.eeg_features || {}).map(([k, v]) => (
            <div key={k} className="bg-slate-50 rounded-lg px-3 py-2">
              <p className="text-xs text-slate-400 truncate">{k.replace(/_/g, " ")}</p>
              <p className="text-sm font-semibold text-slate-700">{typeof v === "number" ? v.toFixed(3) : String(v)}</p>
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
}

// ---- Model Benchmark ---------------------------------------------------------------
// Real numbers only, from models/metadata.json (written by src/train.py after
// an actual training run) — never invented. Rows for model variants that
// were never actually trained here (plain CNN, plain BiLSTM, CNN-BiLSTM
// without the Transformer) are left blank rather than guessed. XGBoost is
// the deployed explainability surrogate (SHAP runs against it); Gradient
// Boosting is trained purely as a real comparison baseline, not deployed.

const BENCHMARK_ROWS = [
  { key: "gb_baseline", label: "Gradient Boosting (comparison baseline, not deployed)", metaKey: "baseline" },
  { key: "cnn", label: "CNN only", metaKey: null },
  { key: "bilstm", label: "BiLSTM only", metaKey: null },
  { key: "cnn_bilstm", label: "CNN + BiLSTM (no Transformer)", metaKey: null },
  { key: "xgb_surrogate", label: "XGBoost (explainability surrogate, deployed)", metaKey: "surrogate" },
  { key: "full", label: "CNN + BiLSTM + Transformer (deployed primary model)", metaKey: "deep_model" },
];

function fmtMetric(v) { return v == null ? "—" : `${(v * 100).toFixed(1)}%`; }

function ModelBenchmark() {
  const { data, loading, error } = useApi("/api/patient/model-info");
  if (loading) return <Card><Skeleton lines={5} /></Card>;
  if (error) return <Alert>{error}</Alert>;

  const metricsFor = (metaKey) => {
    if (metaKey === "deep_model") return data.deep_model_metrics || { roc_auc: data.deep_model_test_auc };
    if (metaKey === "surrogate") return data.surrogate_metrics || { roc_auc: data.surrogate_test_auc };
    if (metaKey === "baseline") return data.baseline_metrics;
    return null;
  };

  return (
    <div className="space-y-6">
      <Card title="AI model benchmark">
        <p className="text-xs text-slate-400 -mt-2 mb-4">
          Real held-out test results from the actual training run ({data.n_train} train / {data.n_test} test epochs,{" "}
          {data.dataset}). Rows for model variants never actually trained in this project are left blank rather than
          estimated — this table reflects what has genuinely been run, not a projection.
        </p>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs uppercase tracking-wide text-slate-400 border-b border-slate-100">
                <th className="py-2 pr-3">Model</th>
                <th className="py-2 px-3 text-right">Accuracy</th>
                <th className="py-2 px-3 text-right">Precision</th>
                <th className="py-2 px-3 text-right">Recall</th>
                <th className="py-2 px-3 text-right">F1</th>
                <th className="py-2 pl-3 text-right">ROC-AUC</th>
              </tr>
            </thead>
            <tbody>
              {BENCHMARK_ROWS.map((row) => {
                const m = metricsFor(row.metaKey);
                const isFull = row.key === "full";
                return (
                  <tr key={row.key} className={`border-b border-slate-50 last:border-0 ${isFull ? "font-semibold text-slate-800" : "text-slate-600"}`}>
                    <td className="py-2 pr-3">{row.label}</td>
                    <td className="py-2 px-3 text-right">{fmtMetric(m?.accuracy)}</td>
                    <td className="py-2 px-3 text-right">{fmtMetric(m?.precision)}</td>
                    <td className="py-2 px-3 text-right">{fmtMetric(m?.recall)}</td>
                    <td className="py-2 px-3 text-right">{fmtMetric(m?.f1)}</td>
                    <td className="py-2 pl-3 text-right">{fmtMetric(m?.roc_auc)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <p className="text-xs text-slate-400 mt-4">
          Accuracy/precision/recall/F1 for the two trained models will populate the next time <code>python -m src.train</code>{" "}
          is run (this session's model artifacts predate that metric being persisted) — ROC-AUC above is already real either way.
        </p>
      </Card>
    </div>
  );
}

// ---- Emergency Alerts -------------------------------------------------------------

function Alerts() {
  const { data, loading, error, reload } = useApi("/api/patient/alerts");
  if (loading) return <Card><Skeleton lines={4} /></Card>;
  if (error) return <Alert>{error}</Alert>;
  if (!data.length) return <Card><p className="text-sm text-slate-400">No alerts yet — good sign.</p></Card>;

  return (
    <Card title={`Alerts (${data.length})`}>
      <div className="space-y-3">
        {data.map((a) => {
          const contributors = primaryContributors(a.reasons);
          const visibleTo = [
            a.notified_caregivers > 0 && `${a.notified_caregivers} caregiver${a.notified_caregivers > 1 ? "s" : ""}`,
            a.notified_clinicians > 0 && `${a.notified_clinicians} clinician${a.notified_clinicians > 1 ? "s" : ""}`,
          ].filter(Boolean).join(", ");
          return (
            <div key={a.id} className={`rounded-xl px-4 py-3 border ${a.acknowledged ? "border-slate-100 bg-slate-50" : "border-red-200 bg-red-50"}`}>
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="text-sm font-semibold text-slate-700">
                    {a.alert_type === "seizure_detected" ? "🚨 Seizure detected" : "⚠️ Elevated seizure risk"}
                  </p>
                  <p className="text-xs text-slate-400 mt-0.5">{fmtDate(a.created_at)} · {(a.risk_probability * 100).toFixed(0)}% probability{a.prediction_class ? ` · ${classLabel(a.prediction_class)}` : ""}</p>
                </div>
                {a.acknowledged
                  ? <span className="text-xs font-semibold text-slate-400 shrink-0">Acknowledged</span>
                  : <AckButton path={`/api/patient/alerts/${a.id}/acknowledge`} onDone={reload} small />}
              </div>
              {contributors.length > 0 && (
                <p className="text-xs text-slate-500 mt-2">
                  <span className="font-semibold">Primary signals:</span> {contributors.join(" + ")}
                </p>
              )}
              <p className="text-xs text-slate-400 mt-1">
                {visibleTo
                  ? `Recorded — visible in-app to ${visibleTo} (not a push/email/SMS notification unless separately configured)`
                  : "Recorded — no caregiver or clinician currently linked to see it"}
              </p>
            </div>
          );
        })}
      </div>
    </Card>
  );
}

// ---- History & Analytics -----------------------------------------------------------

function History() {
  const events = useApi("/api/patient/seizure-events");
  const trends = useApi("/api/patient/trends");
  const [form, setForm] = useState({ date: "", duration_minutes: "", severity: "moderate", recovery_time_minutes: "", prediction_accuracy: "" });
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });

  const submit = async (e) => {
    e.preventDefault();
    setError("");
    setBusy(true);
    try {
      await api("/api/patient/seizure-events", {
        method: "POST",
        body: {
          date: form.date || undefined,
          duration_minutes: Number(form.duration_minutes),
          severity: form.severity,
          recovery_time_minutes: form.recovery_time_minutes ? Number(form.recovery_time_minutes) : undefined,
          prediction_accuracy: form.prediction_accuracy ? Number(form.prediction_accuracy) : undefined,
        },
      });
      setForm({ date: "", duration_minutes: "", severity: "moderate", recovery_time_minutes: "", prediction_accuracy: "" });
      events.reload();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="grid sm:grid-cols-2 gap-6">
        <Card title="Heart rate trend">
          {trends.data ? <TrendChart points={trends.data.heart_rate} format={(v) => `${Math.round(v)} bpm`} color="#e11d48" /> : <Skeleton lines={3} />}
        </Card>
        <Card title="Risk probability trend">
          {trends.data ? <TrendChart points={trends.data.risk_probability} domain={[0, 1]} format={(v) => `${Math.round(v * 100)}%`} /> : <Skeleton lines={3} />}
        </Card>
      </div>

      <Card title="Log a seizure event">
        <Alert>{error}</Alert>
        <form onSubmit={submit} className="grid sm:grid-cols-2 gap-4">
          <Field label="Date/time (optional, defaults to now)">
            <input type="datetime-local" className={inputCls} value={form.date} onChange={set("date")} />
          </Field>
          <Field label="Duration (minutes)">
            <input type="number" min={1} required className={inputCls} value={form.duration_minutes} onChange={set("duration_minutes")} />
          </Field>
          <Field label="Severity">
            <select className={inputCls} value={form.severity} onChange={set("severity")}>
              <option value="mild">Mild</option>
              <option value="moderate">Moderate</option>
              <option value="severe">Severe</option>
            </select>
          </Field>
          <Field label="Recovery time (minutes, optional)">
            <input type="number" min={0} className={inputCls} value={form.recovery_time_minutes} onChange={set("recovery_time_minutes")} />
          </Field>
          <Field label="Was it predicted in advance? (0-100%, optional)">
            <input type="number" min={0} max={100} className={inputCls} value={form.prediction_accuracy} onChange={set("prediction_accuracy")} />
          </Field>
          <div className="sm:col-span-2">
            <Button type="submit" disabled={busy}>{busy && <Spinner />}Log event</Button>
          </div>
        </form>
      </Card>

      <Card title="Seizure history">
        {events.loading ? <Skeleton lines={3} /> : events.error ? <Alert>{events.error}</Alert> : !events.data.length ? (
          <p className="text-sm text-slate-400">No seizure events logged yet.</p>
        ) : (
          <div className="space-y-2 max-h-96 overflow-y-auto">
            {events.data.map((e) => (
              <div key={e.id} className="flex items-center justify-between py-2.5 border-b border-slate-100 last:border-0">
                <div>
                  <p className="text-sm font-medium text-slate-700">{fmtDate(e.date)}</p>
                  <p className="text-xs text-slate-400 capitalize">
                    {e.severity} · {e.duration_minutes} min
                    {e.recovery_time_minutes ? ` · ${e.recovery_time_minutes} min recovery` : ""}
                    {e.prediction_accuracy != null ? ` · ${e.prediction_accuracy}% predicted` : ""}
                  </p>
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}

// ---- Profile -------------------------------------------------------------------------

function Profile() {
  const { data, loading, error, reload } = useApi("/api/patient/profile");
  const linked = useApi("/api/patient/linked");
  const [form, setForm] = useState(null);
  const [saveError, setSaveError] = useState("");
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (data && !form) setForm({ full_name: data.full_name, age: data.age ?? "", medical_history: data.medical_history, baseline_heart_rate: data.baseline_heart_rate, baseline_eda: data.baseline_eda });
  }, [data, form]);

  if (loading || !form) return <Card><Skeleton lines={4} /></Card>;
  if (error) return <Alert>{error}</Alert>;

  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });

  const save = async (e) => {
    e.preventDefault();
    setSaveError("");
    setBusy(true);
    try {
      await api("/api/patient/profile", {
        method: "PUT",
        body: {
          full_name: form.full_name, age: form.age ? Number(form.age) : null, medical_history: form.medical_history,
          baseline_heart_rate: Number(form.baseline_heart_rate), baseline_eda: Number(form.baseline_eda),
        },
      });
      reload();
    } catch (err) {
      setSaveError(err.message);
    } finally {
      setBusy(false);
    }
  };

  const copyCode = () => {
    navigator.clipboard?.writeText(data.patient_code);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  const revoke = async (userId) => {
    try { await api(`/api/patient/linked/${userId}`, { method: "DELETE" }); linked.reload(); } catch { /* noop */ }
  };

  return (
    <div className="space-y-6">
      <Card title="Your shareable patient code">
        <p className="text-sm text-slate-500 mb-3">Give this to a caregiver or clinician so they can link to your account and monitor you remotely.</p>
        <div className="flex items-center gap-3">
          <code className="text-lg font-bold tracking-wider bg-blue-50 text-blue-900 px-4 py-2 rounded-lg">{data.patient_code}</code>
          <Button variant="subtle" type="button" onClick={copyCode}>{copied ? "Copied!" : "Copy"}</Button>
        </div>
      </Card>

      <Card title="Your details">
        <Alert>{saveError}</Alert>
        <form onSubmit={save} className="grid sm:grid-cols-2 gap-4">
          <Field label="Full name">
            <input className={inputCls} value={form.full_name} onChange={set("full_name")} required minLength={2} />
          </Field>
          <Field label="Email">
            <input className={`${inputCls} bg-slate-50 text-slate-400`} value={data.email} disabled />
          </Field>
          <Field label="Age">
            <input type="number" min={1} max={120} className={inputCls} value={form.age} onChange={set("age")} />
          </Field>
          <Field label="Baseline heart rate (bpm)">
            <input type="number" min={30} max={150} className={inputCls} value={form.baseline_heart_rate} onChange={set("baseline_heart_rate")} />
          </Field>
          <Field label="Baseline EDA — resting skin conductance (µS)">
            <input type="number" min={0.5} max={25} step={0.1} className={inputCls} value={form.baseline_eda} onChange={set("baseline_eda")} />
          </Field>
          <div className="sm:col-span-2">
            <Field label="Medical history">
              <textarea rows={3} className={inputCls} value={form.medical_history} onChange={set("medical_history")} />
            </Field>
          </div>
          <div className="sm:col-span-2">
            <Button type="submit" disabled={busy}>{busy && <Spinner />}Save changes</Button>
          </div>
        </form>
      </Card>

      <Card title="Who's monitoring you">
        {linked.loading ? <Skeleton lines={2} /> : linked.error ? <Alert>{linked.error}</Alert> : (
          <div className="space-y-4">
            {["caregivers", "clinicians"].map((group) => (
              <div key={group}>
                <p className="text-xs font-semibold uppercase tracking-wide text-slate-400 mb-2 capitalize">{group}</p>
                {linked.data[group].length === 0 ? (
                  <p className="text-sm text-slate-400">None linked yet.</p>
                ) : (
                  <div className="space-y-2">
                    {linked.data[group].map((u) => (
                      <div key={u.id} className="flex items-center justify-between text-sm bg-slate-50 rounded-lg px-3 py-2">
                        <div>
                          <p className="font-medium text-slate-700">{u.full_name}</p>
                          <p className="text-xs text-slate-400">{u.email}</p>
                        </div>
                        <button onClick={() => revoke(u.id)} className="text-xs font-semibold text-red-500 hover:text-red-700">Revoke</button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}
