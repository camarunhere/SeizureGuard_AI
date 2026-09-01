import { useState } from "react";
import { api, useApi } from "./api";
import { Alert, Button, Card, Field, Skeleton, Spinner, classLabel, fmtDate, inputCls, RiskBadge } from "./ui";

export default function CaregiverPortal({ tab }) {
  switch (tab) {
    case "alerts": return <CaregiverAlerts />;
    default: return <MyPatients />;
  }
}

function LinkPatientForm({ onLinked }) {
  const [code, setCode] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    setError("");
    setBusy(true);
    try {
      await api("/api/caregiver/link", { method: "POST", body: { patient_code: code } });
      setCode("");
      onLinked();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card title="Link to a patient">
      <Alert>{error}</Alert>
      <form onSubmit={submit} className="flex items-end gap-3">
        <div className="flex-1">
          <Field label="Patient code">
            <input className={inputCls} placeholder="PT-XXXXXX" value={code} onChange={(e) => setCode(e.target.value)} required />
          </Field>
        </div>
        <Button type="submit" disabled={busy}>{busy && <Spinner />}Link</Button>
      </form>
    </Card>
  );
}

function MyPatients() {
  const { data, loading, error, reload } = useApi("/api/caregiver/patients");
  const [selected, setSelected] = useState(null);

  const unlink = async (id) => {
    try { await api(`/api/caregiver/link/${id}`, { method: "DELETE" }); if (selected === id) setSelected(null); reload(); } catch { /* noop */ }
  };

  return (
    <div className="space-y-6">
      <LinkPatientForm onLinked={reload} />

      <Card title="My patients">
        {loading ? <Skeleton lines={4} /> : error ? <Alert>{error}</Alert> : !data.length ? (
          <p className="text-sm text-slate-400">No patients linked yet — enter a patient's code above.</p>
        ) : (
          <div className="space-y-2">
            {data.map((p) => (
              <button
                key={p.id}
                onClick={() => setSelected(selected === p.id ? null : p.id)}
                className={`w-full flex items-center justify-between gap-3 rounded-xl px-4 py-3 border text-left transition ${
                  selected === p.id ? "border-blue-300 bg-blue-50" : "border-slate-100 bg-slate-50 hover:border-blue-200"
                }`}
              >
                <div>
                  <p className="text-sm font-semibold text-slate-700">{p.full_name}{p.age ? `, ${p.age}` : ""}</p>
                  <p className="text-xs text-slate-400">Updated {p.last_updated ? fmtDate(p.last_updated) : "never"}</p>
                </div>
                <RiskBadge level={p.current_risk_level === "unknown" ? "low" : p.current_risk_level} />
              </button>
            ))}
          </div>
        )}
      </Card>

      {selected && <PatientDetail patientId={selected} onUnlink={() => unlink(selected)} />}
    </div>
  );
}

function PatientDetail({ patientId, onUnlink }) {
  const { data, loading, error } = useApi(`/api/caregiver/patients/${patientId}`);
  const history = useApi(`/api/caregiver/patients/${patientId}/history`);

  if (loading) return <Card><Skeleton lines={4} /></Card>;
  if (error) return <Alert>{error}</Alert>;

  const { patient, current_status, latest_vitals, last_seizure } = data;

  return (
    <div className="space-y-6 animate-fade-in-up">
      <Card title={`${patient.full_name}'s status`} className="relative">
        <button onClick={onUnlink} className="absolute top-6 right-6 text-xs font-semibold text-red-500 hover:text-red-700">Unlink</button>
        <div className="grid sm:grid-cols-2 gap-6">
          <div>
            <p className="text-xs uppercase tracking-wide text-slate-400 mb-2">Current risk</p>
            {current_status ? (
              <>
                <RiskBadge level={current_status.risk_level} probability={current_status.risk_probability} />
                <p className="text-sm text-slate-600 mt-2">{classLabel(current_status.prediction_class)}</p>
                {current_status.seizure_window && <p className="text-xs text-slate-400 mt-1">Window: {current_status.seizure_window}</p>}
              </>
            ) : <p className="text-sm text-slate-400">No readings yet.</p>}
          </div>
          <div>
            <p className="text-xs uppercase tracking-wide text-slate-400 mb-2">Latest vitals</p>
            {latest_vitals ? (
              <div className="grid grid-cols-2 gap-2 text-sm text-slate-700">
                <span>HR: <b>{latest_vitals.heart_rate} bpm</b></span>
                <span>SpO₂: <b>{latest_vitals.spo2}%</b></span>
                <span>EDA: <b>{latest_vitals.eda} µS</b></span>
                <span>sEMG: <b>{latest_vitals.emg}</b></span>
                <span>Movement: <b>{Math.round(latest_vitals.movement_level * 100)}%</b></span>
                <span>Temp: <b>{latest_vitals.temperature}°C</b></span>
              </div>
            ) : <p className="text-sm text-slate-400">No vitals yet.</p>}
          </div>
        </div>
        {last_seizure && (
          <p className="text-xs text-slate-400 mt-4 pt-4 border-t border-slate-100">
            Last seizure: {fmtDate(last_seizure.date)} · {last_seizure.severity} · {last_seizure.duration_minutes} min
          </p>
        )}
      </Card>

      <Card title="Seizure history">
        {history.loading ? <Skeleton lines={2} /> : history.error ? <Alert>{history.error}</Alert> : !history.data.length ? (
          <p className="text-sm text-slate-400">No events logged.</p>
        ) : (
          <div className="space-y-2 max-h-72 overflow-y-auto">
            {history.data.map((e) => (
              <div key={e.id} className="flex items-center justify-between py-2 border-b border-slate-100 last:border-0 text-sm">
                <span className="text-slate-700">{fmtDate(e.date)}</span>
                <span className="text-slate-400 capitalize">{e.severity} · {e.duration_minutes} min</span>
              </div>
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}

function CaregiverAlerts() {
  const { data, loading, error, reload } = useApi("/api/caregiver/alerts");
  if (loading) return <Card><Skeleton lines={4} /></Card>;
  if (error) return <Alert>{error}</Alert>;
  if (!data.length) return <Card><p className="text-sm text-slate-400">No alerts for your linked patients yet.</p></Card>;

  const ack = async (id) => {
    try { await api(`/api/caregiver/alerts/${id}/acknowledge`, { method: "POST" }); reload(); } catch { /* noop */ }
  };

  return (
    <Card title={`Alerts (${data.length})`}>
      <div className="space-y-2">
        {data.map((a) => (
          <div key={a.id} className={`flex items-center justify-between gap-3 rounded-xl px-4 py-3 border ${a.acknowledged ? "border-slate-100 bg-slate-50" : "border-red-200 bg-red-50"}`}>
            <div>
              <p className="text-sm font-semibold text-slate-700">
                {a.alert_type === "seizure_detected" ? "🚨" : "⚠️"} {a.patient_name}
              </p>
              <p className="text-xs text-slate-400 mt-0.5">{fmtDate(a.created_at)} · {(a.risk_probability * 100).toFixed(0)}% probability</p>
            </div>
            {a.acknowledged
              ? <span className="text-xs font-semibold text-slate-400">Acknowledged</span>
              : <Button variant="subtle" className="text-xs px-3 py-1" onClick={() => ack(a.id)}>Acknowledge</Button>}
          </div>
        ))}
      </div>
    </Card>
  );
}
