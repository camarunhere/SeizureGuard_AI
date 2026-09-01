import { useState } from "react";
import { api, useApi } from "./api";
import { Alert, Button, Card, Field, Skeleton, Spinner, classLabel, fmtDate, inputCls, primaryContributors, RiskBadge, RiskFingerprint } from "./ui";

export default function ClinicianPortal() {
  const { data, loading, error, reload } = useApi("/api/clinician/patients");
  const [selected, setSelected] = useState(null);

  const unlink = async (id) => {
    try { await api(`/api/clinician/link/${id}`, { method: "DELETE" }); if (selected === id) setSelected(null); reload(); } catch { /* noop */ }
  };

  return (
    <div className="space-y-6">
      <LinkPatientForm onLinked={reload} />

      <Card title="Patients under your care">
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
                  <p className="text-xs text-slate-400">
                    {p.ai_confidence != null ? `${p.ai_confidence}% AI confidence` : "No predictions yet"}
                    {p.last_seizure ? ` · last seizure ${fmtDate(p.last_seizure)}` : ""}
                  </p>
                </div>
                <RiskBadge level={p.current_risk_level === "unknown" ? "low" : p.current_risk_level} />
              </button>
            ))}
          </div>
        )}
      </Card>

      {selected && <PatientReview patientId={selected} onUnlink={() => unlink(selected)} />}
    </div>
  );
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
      await api("/api/clinician/link", { method: "POST", body: { patient_code: code } });
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

function PatientReview({ patientId, onUnlink }) {
  const { data, loading, error, reload } = useApi(`/api/clinician/patients/${patientId}`);
  const [reportId, setReportId] = useState(null);

  if (loading) return <Card><Skeleton lines={4} /></Card>;
  if (error) return <Alert>{error}</Alert>;

  const { patient, predictions, latest_vitals, seizure_events } = data;

  return (
    <div className="space-y-6 animate-fade-in-up">
      <Card title={`${patient.full_name}'s chart`} className="relative">
        <button onClick={onUnlink} className="absolute top-6 right-6 text-xs font-semibold text-red-500 hover:text-red-700">Unlink</button>
        <div className="grid sm:grid-cols-3 gap-4 text-sm">
          <div><p className="text-xs uppercase tracking-wide text-slate-400">Age</p><p className="font-medium text-slate-700">{patient.age ?? "—"}</p></div>
          <div><p className="text-xs uppercase tracking-wide text-slate-400">Patient code</p><p className="font-medium text-slate-700">{patient.patient_code}</p></div>
          <div><p className="text-xs uppercase tracking-wide text-slate-400">Medical history</p><p className="font-medium text-slate-700">{patient.medical_history || "—"}</p></div>
        </div>
        {latest_vitals && (
          <div className="grid grid-cols-3 sm:grid-cols-6 gap-4 text-sm mt-4 pt-4 border-t border-slate-100">
            <span>HR: <b>{latest_vitals.heart_rate} bpm</b></span>
            <span>SpO₂: <b>{latest_vitals.spo2}%</b></span>
            <span>EDA: <b>{latest_vitals.eda} µS</b></span>
            <span>sEMG: <b>{latest_vitals.emg}</b></span>
            <span>Movement: <b>{Math.round(latest_vitals.movement_level * 100)}%</b></span>
            <span>Temp: <b>{latest_vitals.temperature}°C</b></span>
          </div>
        )}
      </Card>

      <Card title="AI predictions">
        <div className="space-y-3 max-h-[32rem] overflow-y-auto">
          {predictions.length === 0 && <p className="text-sm text-slate-400">No predictions yet.</p>}
          {predictions.map((p) => (
            <PredictionRow
              key={p.id}
              prediction={p}
              patientId={patientId}
              onNoteSaved={reload}
              onViewReport={() => setReportId(p.id)}
            />
          ))}
        </div>
      </Card>

      {reportId && <AiReport patientId={patientId} predictionId={reportId} onClose={() => setReportId(null)} />}

      <Card title="Seizure history">
        {seizure_events.length === 0 ? <p className="text-sm text-slate-400">No events logged.</p> : (
          <div className="space-y-2 max-h-72 overflow-y-auto">
            {seizure_events.map((e) => (
              <div key={e.id} className="flex items-center justify-between py-2 border-b border-slate-100 last:border-0 text-sm">
                <span className="text-slate-700">{fmtDate(e.date)}</span>
                <span className="text-slate-400 capitalize">{e.severity} · {e.duration_minutes} min{e.prediction_accuracy != null ? ` · ${e.prediction_accuracy}% predicted` : ""}</span>
              </div>
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}

function PredictionRow({ prediction, patientId, onNoteSaved, onViewReport }) {
  const [editing, setEditing] = useState(false);
  const [note, setNote] = useState(prediction.clinician_note || "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const saveNote = async () => {
    setError("");
    setBusy(true);
    try {
      await api(`/api/clinician/predictions/${prediction.id}/note`, { method: "POST", body: { note } });
      setEditing(false);
      onNoteSaved();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="rounded-xl border border-slate-100 bg-slate-50 p-4">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <p className="text-sm font-medium text-slate-700">{classLabel(prediction.prediction_class)}</p>
          <p className="text-xs text-slate-400">{fmtDate(prediction.prediction_time)}{prediction.seizure_window ? ` · window ${prediction.seizure_window}` : ""}</p>
        </div>
        <div className="flex items-center gap-2">
          <RiskBadge level={prediction.risk_level} probability={prediction.risk_probability} />
          <Button variant="subtle" className="text-xs px-3 py-1" onClick={onViewReport}>AI Report</Button>
        </div>
      </div>

      <div className="mt-3">
        <Alert>{error}</Alert>
        {editing ? (
          <div className="flex items-start gap-2">
            <textarea className={`${inputCls} flex-1`} rows={2} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Clinical note…" />
            <div className="flex flex-col gap-1">
              <Button className="text-xs px-3 py-1" onClick={saveNote} disabled={busy}>{busy && <Spinner />}Save</Button>
              <Button variant="subtle" className="text-xs px-3 py-1" onClick={() => setEditing(false)}>Cancel</Button>
            </div>
          </div>
        ) : prediction.clinician_note ? (
          <div className="flex items-center justify-between gap-3">
            <p className="text-sm text-slate-600 italic">"{prediction.clinician_note}"</p>
            <button onClick={() => setEditing(true)} className="text-xs font-semibold text-blue-800 hover:text-blue-950 whitespace-nowrap">Edit</button>
          </div>
        ) : (
          <button onClick={() => setEditing(true)} className="text-xs font-semibold text-blue-800 hover:text-blue-950">+ Add clinical note</button>
        )}
      </div>
    </div>
  );
}

function AiReport({ patientId, predictionId, onClose }) {
  const { data, loading, error } = useApi(`/api/clinician/patients/${patientId}/report/${predictionId}`);

  return (
    <div className="fixed inset-0 z-30 flex items-center justify-center bg-slate-950/40 backdrop-blur-sm p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-2xl max-w-lg w-full max-h-[85vh] overflow-y-auto p-6 animate-fade-in-up" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-bold text-blue-950">AI Clinical Report</h2>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-700 text-xl leading-none">×</button>
        </div>
        {loading ? <Skeleton lines={5} /> : error ? <Alert>{error}</Alert> : (
          <div className="space-y-5">
            <div>
              <p className="text-sm font-semibold text-slate-700">{data.patient_name}</p>
              <div className="flex items-center gap-2 mt-1">
                <RiskBadge level={data.prediction_summary.risk_level} probability={data.prediction_summary.risk_probability} />
                <span className="text-xs text-slate-400">{fmtDate(data.prediction_summary.prediction_time)}</span>
              </div>
              <p className="text-sm text-slate-600 mt-1">{classLabel(data.prediction_summary.prediction_class)}</p>
            </div>

            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-400 mb-2">Risk fingerprint — contribution by modality</p>
              <RiskFingerprint reasons={data.xai_explanation} riskProbability={data.prediction_summary.risk_probability} />
            </div>

            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-400 mb-2">Important biomarkers</p>
              <div className="grid grid-cols-2 gap-2 text-sm">
                {Object.entries(data.important_biomarkers || {}).map(([k, v]) => (
                  <div key={k} className="bg-slate-50 rounded-lg px-3 py-2">
                    <p className="text-xs text-slate-400 truncate">{k.replace(/_/g, " ")}</p>
                    <p className="font-semibold text-slate-700">{typeof v === "number" ? v.toFixed(3) : String(v)}</p>
                  </div>
                ))}
              </div>
            </div>

            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-400 mb-2">Explainable AI</p>
              <ul className="space-y-1.5">
                {data.xai_explanation.map((r, i) => (
                  <li key={i} className="text-sm text-slate-600">
                    <span className="font-medium text-slate-800">{r.factor}</span> — {r.direction === "increases" || r.shap_contribution > 0 ? "increased" : "decreased"} risk <span className="capitalize text-xs text-slate-400">({r.source})</span>
                  </li>
                ))}
              </ul>
              {data.xai_explanation.length > 0 && (
                <p className="text-xs text-slate-500 mt-2 pt-2 border-t border-slate-100">
                  <span className="font-semibold">Primary contributors:</span> {primaryContributors(data.xai_explanation).join(" + ")}
                </p>
              )}
            </div>

            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-400 mb-2">AI model</p>
              <div className="text-sm text-slate-600 bg-slate-50 rounded-lg px-3 py-2 space-y-0.5">
                <p><span className="text-slate-400">Model:</span> CNN + BiLSTM + Transformer (PyTorch)</p>
                <p><span className="text-slate-400">Explainability surrogate:</span> Gradient Boosting on engineered EEG features (SHAP)</p>
              </div>
            </div>

            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-400 mb-2">Suggested clinical action</p>
              <ul className="space-y-2">
                {data.suggested_clinical_action.map((s, i) => (
                  <li key={i} className="text-sm bg-blue-50 text-blue-900 rounded-lg px-3 py-2">{s}</li>
                ))}
              </ul>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
