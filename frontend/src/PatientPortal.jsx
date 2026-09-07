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
    case "checkin": return <DailyCheckin />;
    case "baseline": return <BaselineInfo />;
    case "profile": return <Profile />;
    default: return null;
  }
}

// ---- Current Risk Status Card (Patient Dashboard) ------------------------------

function Dashboard() {
  const { data, loading, error, reload } = useApi("/api/patient/dashboard");
  const checkin = useApi("/api/patient/checkin/today");

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

      <Card title="Today's self-reported risk factors" className="sm:col-span-2">
        {checkin.loading ? <Skeleton lines={2} /> : !checkin.data ? (
          <p className="text-sm text-slate-400">No check-in yet today — visit Daily Check-in to log sleep, medication, and stress.</p>
        ) : (
          <CheckinRiskFactors checkin={checkin.data} />
        )}
      </Card>
    </div>
  );
}

/** Rule-based (not AI) risk factors from the daily check-in — see
 * server/src/checkinRisk.js. Always rendered separately from AI/SHAP
 * reasons so the two kinds of "why" (model-derived vs. self-reported
 * heuristic) never look like the same thing. */
function CheckinRiskFactors({ checkin }) {
  const factors = checkin.risk_factors || [];
  const level = checkin.risk_level || { level: "low", label: "Low" };
  const style = RISK_LEVEL_STYLES[level.level] || RISK_LEVEL_STYLES.low;
  const comparisons = checkin.baseline_comparison || [];

  return (
    <div>
      <div className={`flex items-center gap-3 rounded-xl border px-4 py-3 mb-4 ${style.box}`}>
        <span className="text-2xl">{style.emoji}</span>
        <div>
          <p className="font-semibold">Today's self-reported risk level: {style.label}</p>
          <p className="text-xs opacity-80">Based on {factors.length} flagged factor{factors.length === 1 ? "" : "s"} from today's check-in — a heuristic summary, not a machine prediction.</p>
        </div>
      </div>

      {factors.length === 0 ? (
        <p className="text-sm text-emerald-700 font-medium mb-4">No elevated self-reported risk factors today.</p>
      ) : (
        <div className="space-y-2 mb-4">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">Factors contributing to today's assessment</p>
          {factors.map((f, i) => (
            <div key={i} className="flex items-start gap-2 text-sm">
              <span className="text-xs font-mono text-slate-400 w-5 shrink-0 mt-0.5">{String(i + 1).padStart(2, "0")}</span>
              <span className="text-slate-700">{f.factor}</span>
            </div>
          ))}
        </div>
      )}

      {comparisons.length > 0 && (
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-400 mb-2">Compared with your own recent average</p>
          <div className="grid sm:grid-cols-2 gap-2">
            {comparisons.map((c) => (
              <div key={c.field} className="bg-slate-50 rounded-lg px-3 py-2 text-sm">
                <span className="text-slate-700">{c.label} today: <b>{c.today}</b></span>
                <span className="text-slate-400"> · your average: {c.average}</span>
                <span className={`ml-1 font-semibold ${c.direction === "higher" ? "text-red-600" : "text-blue-600"}`}>
                  {c.direction === "higher" ? "↑ higher" : "↓ lower"} than usual
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      <p className="text-xs text-slate-400 mt-4 pt-3 border-t border-slate-100">
        Clinically-informed heuristic flags from today's check-in — not a machine prediction, shown separately from the AI's
        EEG-based risk score.
      </p>
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

const EMPTY_SEIZURE_EVENT = {
  date: "", duration_minutes: "", severity: "moderate", recovery_time_minutes: "", prediction_accuracy: "",
  activity_before: "", had_warning_aura: "", symptoms_occurred: "", lost_consciousness: "", fell: "",
  unusual_movement: "", tongue_biting: "", incontinence: "", witness_present: "", witness_note: "", ems_required: "",
};

function YesNoUnsureField({ label, value, onChange, includeUnsure }) {
  return (
    <Field label={label}>
      <select className={inputCls} value={value} onChange={onChange}>
        <option value="">—</option>
        <option value="yes">Yes</option>
        <option value="no">No</option>
        {includeUnsure && <option value="unsure">Not sure</option>}
      </select>
    </Field>
  );
}

function History() {
  const events = useApi("/api/patient/seizure-events");
  const trends = useApi("/api/patient/trends");
  const [form, setForm] = useState(EMPTY_SEIZURE_EVENT);
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
          activity_before: form.activity_before || undefined,
          had_warning_aura: form.had_warning_aura || undefined,
          symptoms_occurred: form.symptoms_occurred || undefined,
          lost_consciousness: form.lost_consciousness || undefined,
          fell: form.fell || undefined,
          unusual_movement: form.unusual_movement || undefined,
          tongue_biting: form.tongue_biting || undefined,
          incontinence: form.incontinence || undefined,
          witness_present: form.witness_present || undefined,
          witness_note: form.witness_present === "yes" ? form.witness_note || undefined : undefined,
          ems_required: form.ems_required || undefined,
        },
      });
      setForm(EMPTY_SEIZURE_EVENT);
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
        <form onSubmit={submit} className="space-y-4">
          <div className="grid sm:grid-cols-2 gap-4">
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
          </div>

          <details className="bg-slate-50 border border-slate-100 rounded-lg px-4 py-3">
            <summary className="cursor-pointer text-sm font-semibold text-slate-600">Add more details about this seizure (optional)</summary>
            <div className="mt-4 grid sm:grid-cols-2 gap-4">
              <div className="sm:col-span-2">
                <Field label="What were you doing immediately before it?">
                  <input className={inputCls} value={form.activity_before} onChange={set("activity_before")} placeholder="e.g. watching TV, just woke up" />
                </Field>
              </div>
              <YesNoUnsureField label="Did you have a warning/aura?" value={form.had_warning_aura} onChange={set("had_warning_aura")} includeUnsure />
              <div className="sm:col-span-2">
                <Field label="What symptoms occurred?">
                  <input className={inputCls} value={form.symptoms_occurred} onChange={set("symptoms_occurred")} />
                </Field>
              </div>
              <YesNoUnsureField label="Did you lose consciousness?" value={form.lost_consciousness} onChange={set("lost_consciousness")} includeUnsure />
              <YesNoUnsureField label="Did you fall?" value={form.fell} onChange={set("fell")} />
              <YesNoUnsureField label="Unusual movement or shaking?" value={form.unusual_movement} onChange={set("unusual_movement")} />
              <YesNoUnsureField label="Tongue biting?" value={form.tongue_biting} onChange={set("tongue_biting")} />
              <YesNoUnsureField label="Loss of bladder/bowel control?" value={form.incontinence} onChange={set("incontinence")} />
              <YesNoUnsureField label="Was emergency medical assistance required?" value={form.ems_required} onChange={set("ems_required")} />
              <YesNoUnsureField label="Did someone witness the seizure?" value={form.witness_present} onChange={set("witness_present")} />
              {form.witness_present === "yes" && (
                <div className="sm:col-span-2">
                  <Field label="Additional information from the witness">
                    <textarea rows={2} className={inputCls} value={form.witness_note} onChange={set("witness_note")} />
                  </Field>
                </div>
              )}
            </div>
          </details>

          <Button type="submit" disabled={busy}>{busy && <Spinner />}Log event</Button>
        </form>
      </Card>

      <Card title="Seizure history">
        {events.loading ? <Skeleton lines={3} /> : events.error ? <Alert>{events.error}</Alert> : !events.data.length ? (
          <p className="text-sm text-slate-400">No seizure events logged yet.</p>
        ) : (
          <div className="space-y-2 max-h-96 overflow-y-auto">
            {events.data.map((e) => {
              const details = [
                e.activity_before && ["Before", e.activity_before],
                e.had_warning_aura && ["Warning/aura", e.had_warning_aura],
                e.symptoms_occurred && ["Symptoms", e.symptoms_occurred],
                e.lost_consciousness && ["Lost consciousness", e.lost_consciousness],
                e.fell && ["Fell", e.fell],
                e.unusual_movement && ["Unusual movement", e.unusual_movement],
                e.tongue_biting && ["Tongue biting", e.tongue_biting],
                e.incontinence && ["Incontinence", e.incontinence],
                e.ems_required && ["EMS required", e.ems_required],
                e.witness_present && ["Witnessed", e.witness_present],
                e.witness_note && ["Witness note", e.witness_note],
              ].filter(Boolean);
              return (
                <div key={e.id} className="py-2.5 border-b border-slate-100 last:border-0">
                  <p className="text-sm font-medium text-slate-700">{fmtDate(e.date)}</p>
                  <p className="text-xs text-slate-400 capitalize">
                    {e.severity} · {e.duration_minutes} min
                    {e.recovery_time_minutes ? ` · ${e.recovery_time_minutes} min recovery` : ""}
                    {e.prediction_accuracy != null ? ` · ${e.prediction_accuracy}% predicted` : ""}
                  </p>
                  {details.length > 0 && (
                    <details className="mt-1.5 text-xs">
                      <summary className="cursor-pointer font-semibold text-blue-800">Details</summary>
                      <div className="mt-2 grid sm:grid-cols-2 gap-x-4 gap-y-1 text-slate-500 capitalize">
                        {details.map(([k, v]) => <div key={k}><span className="text-slate-400">{k}:</span> {v}</div>)}
                      </div>
                    </details>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </Card>
    </div>
  );
}

// ---- Daily Check-in ---------------------------------------------------------------
// Submits once per calendar day (upserted server-side — resubmitting the
// same day overwrites, not duplicates). Risk factors are rule-based, not
// AI-generated — see server/src/checkinRisk.js and the note on the card.

const EMPTY_CHECKIN = {
  warning_symptoms: [], warning_symptoms_other: "",
  compared_to_usual: "",
  sleep_hours: "", sleep_quality: "", woke_frequently: "",
  medication_taken: "", medication_late: "",
  stress_level: "", anxiety_level: "", fatigue_level: "",
  illness: "none", ate_normally: "", hydrated: "", strenuous_exercise: "",
  alcohol: "", caffeine_more_than_usual: "", recreational_drugs: "",
  known_trigger_experienced: "", trigger_note: "",
};

const WARNING_SYMPTOM_OPTIONS = [
  ["unusual_smell_taste", "Unusual smell/taste"], ["deja_vu", "Déjà vu"], ["dizziness", "Dizziness"],
  ["visual_changes", "Visual changes"], ["tingling_numbness", "Tingling/numbness"], ["confusion", "Confusion"],
  ["sudden_fear_anxiety", "Sudden fear/anxiety"], ["unusual_sounds", "Unusual sounds"], ["headache", "Headache"],
  ["other", "Other"],
];

const COMPARED_TO_USUAL_OPTIONS = [
  ["much_better", "Much better than usual"], ["slightly_better", "Slightly better"], ["normal", "Normal"],
  ["slightly_worse", "Slightly worse"], ["much_worse", "Much worse than usual"],
];

const RISK_LEVEL_STYLES = {
  low: { emoji: "🟢", label: "Low", box: "bg-green-50 border-green-200 text-green-800" },
  moderate: { emoji: "🟡", label: "Moderate", box: "bg-amber-50 border-amber-200 text-amber-800" },
  elevated: { emoji: "🔴", label: "Elevated", box: "bg-red-50 border-red-300 text-red-800" },
};

function boolToStr(v) { return v === true ? "yes" : v === false ? "no" : ""; }
function strToBool(v) { return v === "yes" ? true : v === "no" ? false : undefined; }

function YesNoField({ label, value, onChange }) {
  return (
    <Field label={label}>
      <select className={inputCls} value={value} onChange={onChange}>
        <option value="">—</option>
        <option value="yes">Yes</option>
        <option value="no">No</option>
      </select>
    </Field>
  );
}

function ScaleField({ label, value, onChange }) {
  return (
    <Field label={`${label}${value !== "" ? ` (${value}/10)` : ""}`}>
      <input type="range" min={0} max={10} className="w-full" value={value === "" ? 0 : value} onChange={onChange} />
    </Field>
  );
}

function DailyCheckin() {
  const { data, loading, error: loadError, reload } = useApi("/api/patient/checkin/today");
  const [form, setForm] = useState(null);
  const [saveError, setSaveError] = useState("");
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (!loading && !form) {
      setForm(data ? {
        warning_symptoms: data.warning_symptoms || [], warning_symptoms_other: data.warning_symptoms_other || "",
        compared_to_usual: data.compared_to_usual || "",
        sleep_hours: data.sleep_hours ?? "", sleep_quality: data.sleep_quality || "", woke_frequently: boolToStr(data.woke_frequently),
        medication_taken: data.medication_taken || "", medication_late: boolToStr(data.medication_late),
        stress_level: data.stress_level ?? "", anxiety_level: data.anxiety_level ?? "", fatigue_level: data.fatigue_level ?? "",
        illness: data.illness || "none", ate_normally: boolToStr(data.ate_normally), hydrated: boolToStr(data.hydrated),
        strenuous_exercise: boolToStr(data.strenuous_exercise), alcohol: boolToStr(data.alcohol),
        caffeine_more_than_usual: boolToStr(data.caffeine_more_than_usual), recreational_drugs: boolToStr(data.recreational_drugs),
        known_trigger_experienced: boolToStr(data.known_trigger_experienced), trigger_note: data.trigger_note || "",
      } : EMPTY_CHECKIN);
    }
  }, [data, loading, form]);

  if (loading || !form) return <Card><Skeleton lines={6} /></Card>;
  if (loadError) return <Alert>{loadError}</Alert>;

  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });
  const toggleSymptom = (key) => setForm({ ...form, warning_symptoms: form.warning_symptoms.includes(key) ? form.warning_symptoms.filter((s) => s !== key) : [...form.warning_symptoms, key] });
  const clearSymptoms = () => setForm({ ...form, warning_symptoms: [], warning_symptoms_other: "" });

  const submit = async (e) => {
    e.preventDefault();
    setSaveError("");
    setSaved(false);
    setBusy(true);
    try {
      await api("/api/patient/checkin", {
        method: "POST",
        body: {
          warning_symptoms: form.warning_symptoms,
          warning_symptoms_other: form.warning_symptoms.includes("other") ? form.warning_symptoms_other : undefined,
          compared_to_usual: form.compared_to_usual || undefined,
          sleep_hours: form.sleep_hours === "" ? undefined : Number(form.sleep_hours),
          sleep_quality: form.sleep_quality || undefined,
          woke_frequently: strToBool(form.woke_frequently),
          medication_taken: form.medication_taken || undefined,
          medication_late: strToBool(form.medication_late),
          stress_level: form.stress_level === "" ? undefined : Number(form.stress_level),
          anxiety_level: form.anxiety_level === "" ? undefined : Number(form.anxiety_level),
          fatigue_level: form.fatigue_level === "" ? undefined : Number(form.fatigue_level),
          illness: form.illness,
          ate_normally: strToBool(form.ate_normally),
          hydrated: strToBool(form.hydrated),
          strenuous_exercise: strToBool(form.strenuous_exercise),
          alcohol: strToBool(form.alcohol),
          caffeine_more_than_usual: strToBool(form.caffeine_more_than_usual),
          recreational_drugs: strToBool(form.recreational_drugs),
          known_trigger_experienced: strToBool(form.known_trigger_experienced),
          trigger_note: form.trigger_note || undefined,
        },
      });
      setSaved(true);
      reload();
    } catch (err) {
      setSaveError(err.message);
    } finally {
      setBusy(false);
    }
  };

  // Adaptive: exact sleep hours only matter enough to ask when quality was
  // rated poor — keeps the everyday form short without losing the detail
  // that actually changes the risk assessment (per checkinRisk.js).
  const showSleepHours = ["poor", "very_poor"].includes(form.sleep_quality);
  // Adaptive: the "missed vs late" follow-up only makes sense once they've
  // said medication wasn't taken cleanly as prescribed.
  const showMedicationFollowup = form.medication_taken === "no" || form.medication_taken === "partially";

  return (
    <div className="space-y-6">
      <Card title={`Today's check-in${data ? " (already submitted — editing will update it)" : ""}`}>
        <Alert>{saveError}</Alert>
        <Alert kind="success">{saved ? "Check-in saved." : ""}</Alert>
        <form onSubmit={submit} className="space-y-6">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-400 mb-1">Possible warning symptoms</p>
            <p className="text-xs text-slate-400 mb-3">Are you experiencing any unusual symptoms that you normally associate with an upcoming seizure?</p>
            <div className="flex flex-wrap gap-2">
              {WARNING_SYMPTOM_OPTIONS.map(([key, label]) => (
                <button
                  key={key} type="button" onClick={() => toggleSymptom(key)}
                  className={`px-3 py-1.5 rounded-lg text-xs font-semibold border transition ${
                    form.warning_symptoms.includes(key) ? "bg-red-600 text-white border-red-600" : "bg-white text-slate-600 border-slate-200 hover:border-red-300"
                  }`}
                >
                  {label}
                </button>
              ))}
              <button
                type="button" onClick={clearSymptoms}
                className={`px-3 py-1.5 rounded-lg text-xs font-semibold border transition ${
                  form.warning_symptoms.length === 0 ? "bg-emerald-600 text-white border-emerald-600" : "bg-white text-slate-600 border-slate-200 hover:border-emerald-300"
                }`}
              >
                None
              </button>
            </div>
            {form.warning_symptoms.includes("other") && (
              <div className="mt-3">
                <input className={inputCls} value={form.warning_symptoms_other} onChange={set("warning_symptoms_other")} placeholder="Describe the symptom" />
              </div>
            )}
          </div>

          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-400 mb-3">Compared with your usual day, does today feel different?</p>
            <div className="flex flex-wrap gap-2">
              {COMPARED_TO_USUAL_OPTIONS.map(([key, label]) => (
                <button
                  key={key} type="button" onClick={() => setForm({ ...form, compared_to_usual: key })}
                  className={`px-3 py-1.5 rounded-lg text-xs font-semibold border transition ${
                    form.compared_to_usual === key ? "bg-blue-900 text-white border-blue-900" : "bg-white text-slate-600 border-slate-200 hover:border-blue-300"
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>

          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-400 mb-3">Sleep</p>
            <div className="grid sm:grid-cols-2 gap-4">
              <Field label="How was your sleep last night?">
                <select className={inputCls} value={form.sleep_quality} onChange={set("sleep_quality")}>
                  <option value="">—</option>
                  <option value="very_good">🙂 Very good</option>
                  <option value="good">🙂 Good</option>
                  <option value="average">😐 Average</option>
                  <option value="poor">😴 Poor</option>
                  <option value="very_poor">😴 Very poor</option>
                </select>
              </Field>
              {showSleepHours && (
                <Field label="How many hours did you sleep?">
                  <input type="number" min={0} max={24} step={0.5} placeholder="e.g. 4.5" className={inputCls} value={form.sleep_hours} onChange={set("sleep_hours")} autoFocus />
                </Field>
              )}
              <YesNoField label="Woke up frequently during the night?" value={form.woke_frequently} onChange={set("woke_frequently")} />
            </div>
          </div>

          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-400 mb-3">Medication</p>
            <div className="grid sm:grid-cols-2 gap-4">
              <Field label="Took all seizure medication as prescribed?">
                <select className={inputCls} value={form.medication_taken} onChange={set("medication_taken")}>
                  <option value="">—</option>
                  <option value="yes">Yes</option>
                  <option value="no">No</option>
                  <option value="partially">Partially</option>
                </select>
              </Field>
              {showMedicationFollowup && (
                <Field label="Was it missed completely or taken late?">
                  <select className={inputCls} value={form.medication_late === "yes" ? "late" : form.medication_late === "no" ? "missed" : ""} onChange={(e) => setForm({ ...form, medication_late: e.target.value === "late" ? "yes" : e.target.value === "missed" ? "no" : "" })}>
                    <option value="">—</option>
                    <option value="missed">Missed completely</option>
                    <option value="late">Taken late</option>
                  </select>
                </Field>
              )}
            </div>
          </div>

          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-400 mb-3">Stress & wellbeing</p>
            <div className="grid sm:grid-cols-3 gap-4">
              <ScaleField label="Stress today" value={form.stress_level} onChange={set("stress_level")} />
              <ScaleField label="Anxiety today" value={form.anxiety_level} onChange={set("anxiety_level")} />
              <ScaleField label="Unusually tired today" value={form.fatigue_level} onChange={set("fatigue_level")} />
            </div>
          </div>

          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-400 mb-3">Physical factors</p>
            <div className="grid sm:grid-cols-2 gap-4">
              <Field label="Been unwell recently?">
                <select className={inputCls} value={form.illness} onChange={set("illness")}>
                  <option value="none">No</option>
                  <option value="fever">Fever</option>
                  <option value="infection">Infection</option>
                  <option value="other">Other</option>
                </select>
              </Field>
              <YesNoField label="Eaten normally today?" value={form.ate_normally} onChange={set("ate_normally")} />
              <YesNoField label="Enough fluids today?" value={form.hydrated} onChange={set("hydrated")} />
              <YesNoField label="Unusually strenuous exercise today?" value={form.strenuous_exercise} onChange={set("strenuous_exercise")} />
            </div>
          </div>

          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-400 mb-3">Potential triggers</p>
            <div className="grid sm:grid-cols-2 gap-4">
              <YesNoField label="Alcohol since your last check-in?" value={form.alcohol} onChange={set("alcohol")} />
              <YesNoField label="More caffeine than usual?" value={form.caffeine_more_than_usual} onChange={set("caffeine_more_than_usual")} />
              <YesNoField label="Any recreational drug use?" value={form.recreational_drugs} onChange={set("recreational_drugs")} />
              <YesNoField label="Experienced a known personal trigger?" value={form.known_trigger_experienced} onChange={set("known_trigger_experienced")} />
            </div>
            {form.known_trigger_experienced === "yes" && (
              <div className="mt-4">
                <Field label="What was the trigger? (optional)">
                  <input className={inputCls} value={form.trigger_note} onChange={set("trigger_note")} placeholder="e.g. flashing lights, missed meal" />
                </Field>
              </div>
            )}
          </div>

          <Button type="submit" disabled={busy}>{busy && <Spinner />}Save check-in</Button>
        </form>
      </Card>

      {data && (
        <Card title="Self-reported risk factors from this check-in">
          <CheckinRiskFactors checkin={data} />
        </Card>
      )}
    </div>
  );
}

// ---- Baseline Info -----------------------------------------------------------------
// Collected once, editable anytime. Clinical context for clinicians — does
// not feed the deep learning model (see src/ml_service.py).

function BaselineInfo() {
  const { data, loading, error, reload } = useApi("/api/patient/baseline");
  const [form, setForm] = useState(null);
  const [saveError, setSaveError] = useState("");
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (data && !form) setForm({ ...data });
  }, [data, form]);

  if (loading || !form) return <Card><Skeleton lines={6} /></Card>;
  if (error) return <Alert>{error}</Alert>;

  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });

  const submit = async (e) => {
    e.preventDefault();
    setSaveError("");
    setSaved(false);
    setBusy(true);
    try {
      await api("/api/patient/baseline", { method: "PUT", body: form });
      setSaved(true);
      reload();
    } catch (err) {
      setSaveError(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card title="Baseline patient information">
      <p className="text-xs text-slate-400 -mt-2 mb-4">
        Collected once and editable anytime — gives clinicians clinical context. This doesn't feed the AI prediction, which
        works from the raw EEG signal only.
      </p>
      <Alert>{saveError}</Alert>
      <Alert kind="success">{saved ? "Baseline information saved." : ""}</Alert>
      <form onSubmit={submit} className="grid sm:grid-cols-2 gap-4">
        <Field label="Age">
          <input type="number" min={0} max={120} className={inputCls} value={form.age ?? ""} onChange={(e) => setForm({ ...form, age: e.target.value })} />
        </Field>
        <Field label="Sex">
          <select className={inputCls} value={form.sex} onChange={set("sex")}>
            <option value="">—</option>
            <option value="male">Male</option>
            <option value="female">Female</option>
            <option value="other">Other</option>
            <option value="prefer_not_to_say">Prefer not to say</option>
          </select>
        </Field>
        <Field label="When were you first diagnosed?">
          <input type="date" className={inputCls} value={form.diagnosis_date} onChange={set("diagnosis_date")} />
        </Field>
        <Field label="Most recent seizure">
          <input type="date" className={inputCls} value={form.last_seizure_date} onChange={set("last_seizure_date")} />
        </Field>
        <Field label="Seizure type, if known">
          <input className={inputCls} value={form.seizure_type} onChange={set("seizure_type")} placeholder="e.g. focal, generalized, tonic-clonic" />
        </Field>
        <Field label="Usual seizure frequency">
          <input className={inputCls} value={form.seizure_frequency} onChange={set("seizure_frequency")} placeholder="e.g. 2-3 times per month" />
        </Field>
        <Field label="Do you usually get an aura/warning?">
          <select className={inputCls} value={form.has_aura} onChange={set("has_aura")}>
            <option value="">—</option>
            <option value="yes">Yes</option>
            <option value="no">No</option>
            <option value="sometimes">Sometimes</option>
          </select>
        </Field>
        <Field label="Typical aura/pre-seizure symptoms">
          <input className={inputCls} value={form.aura_symptoms} onChange={set("aura_symptoms")} placeholder="e.g. tingling, déjà vu, dizziness" />
        </Field>
        <div className="sm:col-span-2">
          <Field label="Current seizure medications">
            <textarea rows={2} className={inputCls} value={form.medications} onChange={set("medications")} placeholder="e.g. Levetiracetam 500mg twice daily" />
          </Field>
        </div>
        <div className="sm:col-span-2">
          <Field label="Recent medication changes (optional)">
            <textarea rows={2} className={inputCls} value={form.recent_medication_changes} onChange={set("recent_medication_changes")} />
          </Field>
        </div>
        <div className="sm:col-span-2">
          <Field label="Other medical conditions (optional)">
            <textarea rows={2} className={inputCls} value={form.other_conditions} onChange={set("other_conditions")} />
          </Field>
        </div>
        <div className="sm:col-span-2">
          <Field label="Known seizure triggers (optional)">
            <textarea rows={2} className={inputCls} value={form.known_triggers} onChange={set("known_triggers")} placeholder="e.g. flashing lights, sleep deprivation, missed meals" />
          </Field>
        </div>
        <div className="sm:col-span-2">
          <Button type="submit" disabled={busy}>{busy && <Spinner />}Save baseline information</Button>
        </div>
      </form>
    </Card>
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
