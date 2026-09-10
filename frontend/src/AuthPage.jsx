import { useState } from "react";
import { api, storeSession } from "./api";
import { Alert, Button, Field, Spinner, inputCls } from "./ui";
import Background, { BG_TINT } from "./Background";

const ROLES = [
  { key: "patient", icon: "🧑‍🦽", label: "Patient", features: ["Personal monitoring", "Risk prediction", "Health history"] },
  { key: "clinician", icon: "🩺", label: "Clinician", features: ["Multiple patient dashboard", "Clinical analytics", "AI reports"], requiresApproval: true },
  { key: "admin", icon: "🛡️", label: "Admin", features: ["Approve clinician accounts"], loginOnly: true },
];

export default function AuthPage({ onLogin, onBack }) {
  const [role, setRole] = useState("patient");
  const [mode, setMode] = useState("login");
  const [form, setForm] = useState({ full_name: "", email: "", password: "", age: "", medical_history: "" });
  const [error, setError] = useState("");
  const [pendingMessage, setPendingMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [showPw, setShowPw] = useState(false);

  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });
  const activeRole = ROLES.find((r) => r.key === role);

  const selectRole = (key) => {
    setRole(key);
    setPendingMessage("");
    if (ROLES.find((r) => r.key === key)?.loginOnly) setMode("login");
  };

  const submit = async (e) => {
    e.preventDefault();
    setError("");
    setPendingMessage("");
    setBusy(true);
    try {
      const path = mode === "login" ? "/api/auth/login" : "/api/auth/register";
      const body =
        mode === "login"
          ? { email: form.email, password: form.password }
          : { ...form, role, age: form.age ? Number(form.age) : null };
      const data = await api(path, { method: "POST", body });
      if (data.pending) {
        // Clinician registration submitted but not approved yet — no session
        // to store, nothing to log into. See routes/auth.js.
        setPendingMessage(data.message);
        setMode("login");
        return;
      }
      storeSession(data.token, data.user);
      onLogin(data.user);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className={`min-h-screen ${BG_TINT} flex items-center justify-center px-4 py-10`}>
      <Background />
      <div className="relative z-10 w-full max-w-md">
        <div className="text-center mb-6">
          <button onClick={onBack} className="text-xs text-slate-400 hover:text-white mb-3">← Back to home</button>
          <div className="text-4xl mb-2">🧠</div>
          <h1 className="text-2xl font-bold text-white">SeizureGuard AI</h1>
          <p className="text-sm text-slate-400 mt-1">Select your user type</p>
        </div>

        <div className="grid grid-cols-4 gap-2 mb-4">
          {ROLES.map((r) => (
            <button
              key={r.key}
              onClick={() => selectRole(r.key)}
              className={`py-3 rounded-xl border text-sm font-semibold transition flex flex-col items-center gap-1 ${
                role === r.key ? "bg-blue-950 border-blue-950 text-white shadow-md" : "bg-white/70 border-slate-200 text-slate-600 hover:border-blue-300"
              }`}
            >
              <span className="text-lg">{r.icon}</span>{r.label}
            </button>
          ))}
        </div>

        <div className="bg-white/85 backdrop-blur-md border border-white/70 rounded-2xl shadow-2xl shadow-blue-950/10 p-7 animate-fade-in-up">
          <ul className="flex flex-wrap gap-2 mb-5">
            {activeRole.features.map((f) => (
              <li key={f} className="text-xs font-medium px-2.5 py-1 rounded-full bg-blue-50 text-blue-800">{f}</li>
            ))}
          </ul>

          {!activeRole.loginOnly && (
            <div className="flex rounded-lg bg-slate-100 p-1 mb-6">
              {["login", "register"].map((m) => (
                <button
                  key={m}
                  onClick={() => { setMode(m); setError(""); setPendingMessage(""); }}
                  className={`flex-1 py-2 rounded-md text-sm font-semibold capitalize transition ${
                    mode === m ? "bg-white shadow text-slate-900" : "text-slate-500"
                  }`}
                >
                  {m}
                </button>
              ))}
            </div>
          )}
          {activeRole.loginOnly && (
            <p className="text-xs text-slate-400 mb-6">Admin accounts are created directly by an existing administrator — there's no public sign-up for this role.</p>
          )}

          {mode === "register" && activeRole.requiresApproval && (
            <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 mb-4">
              Clinician accounts require admin approval before you can log in. You'll get access once an administrator reviews your registration.
            </p>
          )}

          <Alert>{error}</Alert>
          <Alert kind="success">{pendingMessage}</Alert>

          <form onSubmit={submit} className="space-y-4">
            {mode === "register" && (
              <Field label="Full name">
                <input className={inputCls} value={form.full_name} onChange={set("full_name")} required minLength={2} />
              </Field>
            )}
            <Field label="Email">
              <input type="email" className={inputCls} value={form.email} onChange={set("email")} required />
            </Field>
            <Field label="Password">
              <div className="relative">
                <input type={showPw ? "text" : "password"} className={`${inputCls} pr-16`} value={form.password} onChange={set("password")} required minLength={6} />
                <button type="button" onClick={() => setShowPw(!showPw)} className="absolute right-3 top-1/2 -translate-y-1/2 text-xs font-semibold text-slate-400 hover:text-slate-700 transition">
                  {showPw ? "Hide" : "Show"}
                </button>
              </div>
            </Field>
            {mode === "register" && role === "patient" && (
              <>
                <Field label="Age">
                  <input type="number" className={inputCls} value={form.age} onChange={set("age")} min={1} max={120} />
                </Field>
                <Field label="Past medical history (optional)">
                  <textarea className={inputCls} rows={2} value={form.medical_history} onChange={set("medical_history")} placeholder="e.g. Focal epilepsy since 2019" />
                </Field>
              </>
            )}
            <Button type="submit" className="w-full py-3" disabled={busy}>
              {busy && <Spinner />}{mode === "login" ? `Login as ${activeRole.label}` : "Create account"}
            </Button>
          </form>
        </div>
      </div>
    </div>
  );
}
