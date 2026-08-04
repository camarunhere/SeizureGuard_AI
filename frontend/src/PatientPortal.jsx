import { useEffect, useRef, useState } from "react";
import { api, useApi } from "./api";
import {
  Alert, Button, Card, CountUp, EEGWaveform, Field, Skeleton, Spinner,
  TrendChart, RiskBadge, classLabel, fmtDate, inputCls, riskStyle,
} from "./ui";

export default function PatientPortal({ tab }) {
  switch (tab) {
    case "dashboard": return <Dashboard />;
    case "live": return <LiveMonitoring />;
    case "predictions": return <Predictions />;
    case "xai": return <ExplainableAI />;
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
        {latest_vitals ? (
          <div className="grid grid-cols-2 gap-4">
            <Vital label="Heart rate" value={latest_vitals.heart_rate} unit="bpm" />
            <Vital label="SpO₂" value={latest_vitals.spo2} unit="%" />
            <Vital label="Movement" value={Math.round(latest_vitals.movement_level * 100)} unit="%" />
            <Vital label="Temperature" value={latest_vitals.temperature} unit="°C" />
          </div>
        ) : (
          <p className="text-sm text-slate-400">No vitals recorded yet.</p>
        )}
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

function Vital({ label, value, unit }) {
  return (
    <div>
      <p className="text-xs uppercase tracking-wide text-slate-400">{label}</p>
      <p className="text-xl font-bold text-slate-800"><CountUp value={value} decimals={value % 1 !== 0 ? 1 : 0} /> <span className="text-sm font-medium text-slate-400">{unit}</span></p>
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

// ---- Live Monitoring: continuous EEG/wearable stream + AI prediction ----------

function LiveMonitoring() {
  const [running, setRunning] = useState(false);
  const [ticking, setTicking] = useState(false);
  const [latest, setLatest] = useState(null);
  const [history, setHistory] = useState([]);
  const [error, setError] = useState("");
  const timer = useRef(null);

  const tick = async () => {
    setTicking(true);
    try {
      const res = await api("/api/patient/live/tick", { method: "POST" });
      setLatest(res);
      setError("");
      setHistory((h) => [...h.slice(-19), { t: res.prediction.prediction_time, v: res.prediction.risk_probability }]);
    } catch (err) {
      setError(err.message);
    } finally {
      setTicking(false);
    }
  };

  useEffect(() => {
    if (!running) return;
    tick();
    timer.current = setInterval(tick, 4000);
    return () => clearInterval(timer.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [running]);

  const s = latest ? riskStyle(latest.prediction.risk_level) : null;

  return (
    <div className="space-y-6">
      <Card>
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div>
            <p className="font-semibold text-slate-800">Simulated EEG + wearable stream</p>
            <p className="text-xs text-slate-400 mt-0.5">No physical headset attached — draws real recorded epochs for this demo.</p>
          </div>
          <Button variant={running ? "danger" : "success"} onClick={() => setRunning((r) => !r)}>
            {running ? "Stop monitoring" : "Start monitoring"}
          </Button>
        </div>
      </Card>

      <Alert>{error}</Alert>

      {latest?.alert_raised && (
        <Alert kind="error">Elevated risk detected — an alert was sent to your linked caregivers/clinicians.</Alert>
      )}

      <Card title="Live EEG epoch">
        {latest ? (
          <EEGWaveform signal={latest.reading.eeg_signal} abnormal={latest.prediction.risk_level !== "low"} />
        ) : (
          <p className="text-sm text-slate-400">{running ? "Waiting for first reading…" : "Start monitoring to see the live signal."}</p>
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

        <Card title="Wearable vitals">
          {latest ? (
            <div className="grid grid-cols-2 gap-4">
              <Vital label="Heart rate" value={latest.reading.heart_rate} unit="bpm" />
              <Vital label="SpO₂" value={latest.reading.spo2} unit="%" />
              <Vital label="Movement" value={Math.round(latest.reading.movement_level * 100)} unit="%" />
              <Vital label="Temperature" value={latest.reading.temperature} unit="°C" />
            </div>
          ) : (
            <p className="text-sm text-slate-400">No vitals yet.</p>
          )}
        </Card>
      </div>

      {history.length > 1 && (
        <Card title="Risk probability (this session)">
          <TrendChart points={history} domain={[0, 1]} format={(v) => `${Math.round(v * 100)}%`} color={s?.bar === "bg-red-600" ? "#dc2626" : "#1e3a8a"} />
        </Card>
      )}
      {ticking && <p className="text-xs text-slate-400 text-center"><Spinner />Refreshing reading…</p>}
    </div>
  );
}

// ---- AI Prediction Dashboard ----------------------------------------------------

function Predictions() {
  const { data, loading, error } = useApi("/api/patient/predictions?limit=50");
  if (loading) return <Card><Skeleton lines={4} /></Card>;
  if (error) return <Alert>{error}</Alert>;
  if (!data.length) return <Card><p className="text-sm text-slate-400">No AI predictions yet — visit Live Monitoring to generate one.</p></Card>;

  const chartPoints = [...data].reverse().map((p) => ({ t: p.prediction_time, v: p.risk_probability }));

  return (
    <div className="space-y-6">
      <Card title="Risk probability over time">
        <TrendChart points={chartPoints} domain={[0, 1]} format={(v) => `${Math.round(v * 100)}%`} />
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
                <div className="flex items-center justify-between text-sm mb-1">
                  <span className="font-medium text-slate-700">{r.factor}</span>
                  <span className={`text-xs font-semibold ${up ? "text-red-600" : "text-emerald-600"}`}>
                    {up ? "↑ increases risk" : "↓ decreases risk"}
                  </span>
                </div>
                <div className="h-2 rounded-full bg-slate-100 overflow-hidden">
                  <div className={`h-full rounded-full ${up ? "bg-red-500" : "bg-emerald-500"}`} style={{ width: `${pct}%` }} />
                </div>
                <p className="text-xs text-slate-400 mt-0.5 capitalize">{r.source}</p>
              </div>
            );
          })}
        </div>
      </Card>

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

// ---- Emergency Alerts -------------------------------------------------------------

function Alerts() {
  const { data, loading, error, reload } = useApi("/api/patient/alerts");
  if (loading) return <Card><Skeleton lines={4} /></Card>;
  if (error) return <Alert>{error}</Alert>;
  if (!data.length) return <Card><p className="text-sm text-slate-400">No alerts yet — good sign.</p></Card>;

  return (
    <Card title={`Alerts (${data.length})`}>
      <div className="space-y-2">
        {data.map((a) => (
          <div key={a.id} className={`flex items-center justify-between gap-3 rounded-xl px-4 py-3 border ${a.acknowledged ? "border-slate-100 bg-slate-50" : "border-red-200 bg-red-50"}`}>
            <div>
              <p className="text-sm font-semibold text-slate-700">
                {a.alert_type === "seizure_detected" ? "🚨 Seizure detected" : "⚠️ Elevated seizure risk"}
              </p>
              <p className="text-xs text-slate-400 mt-0.5">{fmtDate(a.created_at)} · {(a.risk_probability * 100).toFixed(0)}% probability</p>
            </div>
            {a.acknowledged
              ? <span className="text-xs font-semibold text-slate-400">Acknowledged</span>
              : <AckButton path={`/api/patient/alerts/${a.id}/acknowledge`} onDone={reload} small />}
          </div>
        ))}
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
    if (data && !form) setForm({ full_name: data.full_name, age: data.age ?? "", medical_history: data.medical_history, baseline_heart_rate: data.baseline_heart_rate });
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
        body: { full_name: form.full_name, age: form.age ? Number(form.age) : null, medical_history: form.medical_history, baseline_heart_rate: Number(form.baseline_heart_rate) },
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
