import { useState } from "react";
import { api, useApi } from "./api";
import { Alert, Button, Card, Skeleton, Spinner, fmtDate } from "./ui";

const TABS = [
  { key: "pending", label: "Pending approval" },
  { key: "approved", label: "Approved" },
  { key: "rejected", label: "Rejected" },
];

export default function AdminPortal() {
  const [tab, setTab] = useState("pending");
  const { data, loading, error, reload } = useApi(`/api/admin/clinicians?status=${tab}`);

  return (
    <div className="space-y-6">
      <Card>
        <div className="flex flex-wrap gap-2">
          {TABS.map((t) => (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              className={`px-3.5 py-1.5 rounded-lg text-sm font-semibold transition ${
                tab === t.key ? "bg-blue-900 text-white shadow-md shadow-blue-900/25" : "bg-white/70 border border-slate-200 text-slate-600 hover:bg-white"
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>
      </Card>

      <Card title={`Clinician accounts — ${TABS.find((t) => t.key === tab).label.toLowerCase()}`}>
        {loading ? <Skeleton lines={4} /> : error ? <Alert>{error}</Alert> : !data.length ? (
          <p className="text-sm text-slate-400">
            {tab === "pending" ? "No clinician registrations waiting for approval." : `No ${tab} clinician accounts.`}
          </p>
        ) : (
          <div className="space-y-2">
            {data.map((c) => (
              <ClinicianRow key={c.id} clinician={c} onDone={reload} />
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}

function ClinicianRow({ clinician, onDone }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const act = async (action) => {
    setError("");
    setBusy(true);
    try {
      await api(`/api/admin/clinicians/${clinician.id}/${action}`, { method: "POST" });
      onDone();
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  };

  return (
    <div className="rounded-xl border border-slate-100 bg-slate-50 px-4 py-3">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <p className="text-sm font-semibold text-slate-700">{clinician.full_name}</p>
          <p className="text-xs text-slate-400">{clinician.email} · registered {fmtDate(clinician.created_at)}</p>
        </div>
        {clinician.approval_status === "pending" ? (
          <div className="flex gap-2">
            <Button variant="success" className="text-xs px-3 py-1.5" onClick={() => act("approve")} disabled={busy}>
              {busy && <Spinner />}Approve
            </Button>
            <Button variant="danger" className="text-xs px-3 py-1.5" onClick={() => act("reject")} disabled={busy}>
              Reject
            </Button>
          </div>
        ) : (
          <span className={`text-xs font-semibold capitalize ${clinician.approval_status === "approved" ? "text-emerald-600" : "text-red-500"}`}>
            {clinician.approval_status}
          </span>
        )}
      </div>
      <Alert>{error}</Alert>
    </div>
  );
}
