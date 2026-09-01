import { useState } from "react";
import { api, clearSession, getStoredUser, getToken } from "./api";
import LandingPage from "./LandingPage";
import AuthPage from "./AuthPage";
import PatientPortal from "./PatientPortal";
import CaregiverPortal from "./CaregiverPortal";
import ClinicianPortal from "./ClinicianPortal";
import AdminPortal from "./AdminPortal";
import Background, { BG_TINTS } from "./Background";

const NAV = {
  patient: [
    ["dashboard", "Dashboard"],
    ["live", "Live Monitoring"],
    ["predictions", "AI Prediction"],
    ["xai", "Explainable AI"],
    ["benchmark", "Model Benchmark"],
    ["alerts", "Emergency Alerts"],
    ["history", "History & Analytics"],
    ["profile", "Profile"],
  ],
  caregiver: [
    ["patients", "My Patients"],
    ["alerts", "Alerts"],
  ],
  clinician: [
    ["patients", "Patients"],
  ],
  admin: [
    ["clinicians", "Clinician Approvals"],
  ],
};

const PAGE_HERO = {
  patient: {
    dashboard: ["🧠", "Patient Dashboard", "Your current seizure risk status, vitals, and last seizure info at a glance.", "from-blue-900 via-blue-800 to-indigo-700"],
    live: ["📡", "Live Monitoring", "Continuous EEG and wearable biosensor stream.", "from-indigo-800 via-blue-800 to-teal-700"],
    predictions: ["🤖", "AI Prediction Dashboard", "Seizure risk prediction from the deep learning model.", "from-blue-900 via-indigo-800 to-violet-700"],
    xai: ["💡", "Explainable AI", "Understand exactly why the AI made this prediction.", "from-amber-600 via-orange-600 to-red-600"],
    benchmark: ["📈", "Model Benchmark", "Real training results for the deployed model — no invented numbers.", "from-slate-800 via-blue-900 to-indigo-900"],
    alerts: ["🚨", "Emergency Alerts", "Immediate response when high seizure risk is detected.", "from-red-700 via-rose-700 to-red-800"],
    history: ["📊", "History & Analytics", "Long-term seizure history and health trends.", "from-teal-700 via-emerald-700 to-cyan-700"],
    profile: ["👤", "Profile", "Your details and shareable patient code.", "from-slate-700 via-blue-900 to-slate-800"],
  },
  caregiver: {
    patients: ["🤝", "My Patients", "Monitor the people in your care, remotely.", "from-teal-700 via-emerald-700 to-cyan-700"],
    alerts: ["🚨", "Emergency Alerts", "Notifications the moment risk is detected.", "from-red-700 via-rose-700 to-red-800"],
  },
  clinician: {
    patients: ["🩺", "Clinical Dashboard", "Multi-patient monitoring, AI reports, clinical decision support.", "from-blue-900 via-indigo-800 to-slate-800"],
  },
  admin: {
    clinicians: ["🛡️", "Clinician Approvals", "Review and approve clinician registrations before they can log in.", "from-slate-900 via-blue-950 to-slate-800"],
  },
};

const PAGE_BG = {
  patient: { dashboard: "brain", live: "livewave", predictions: "network", xai: "insight", benchmark: "network", alerts: "alert", history: "timeline", profile: "profile" },
  caregiver: { patients: "link", alerts: "alert" },
  clinician: { patients: "clinical" },
  admin: { clinicians: "clinical" },
};

export default function App() {
  const [view, setView] = useState(() => (getToken() ? "app" : "landing")); // landing | auth | app
  const [user, setUser] = useState(() => (getToken() ? getStoredUser() : null));
  const [tab, setTab] = useState(null);

  if (view === "landing" && !user) return <LandingPage onGetStarted={() => setView("auth")} />;
  if (!user) return <AuthPage onLogin={(u) => { setUser(u); setTab(NAV[u.role][0][0]); setView("app"); }} onBack={() => setView("landing")} />;

  const nav = NAV[user.role] || [];
  const active = tab || nav[0][0];

  const logout = async () => {
    try { await api("/api/auth/logout", { method: "POST" }); } catch { /* token may be stale */ }
    clearSession();
    setUser(null);
    setTab(null);
    setView("landing");
  };

  const bgVariant = PAGE_BG[user.role]?.[active] || "brain";
  const hero = PAGE_HERO[user.role]?.[active];

  return (
      <div className={`min-h-screen ${BG_TINTS[bgVariant] || "bg-slate-100"}`}>
        <Background variant={bgVariant} />
        <header className="bg-gradient-to-r from-slate-950 via-blue-950 to-slate-900 border-b border-white/10 sticky top-0 z-20 shadow-lg shadow-slate-900/20">
          <div className="max-w-6xl mx-auto px-4 h-14 flex items-center gap-4">
            <div className="font-bold text-white whitespace-nowrap">🧠 SeizureGuard AI</div>
            <nav className="flex gap-1 overflow-x-auto">
              {nav.map(([key, label]) => (
                <button
                  key={key}
                  onClick={() => setTab(key)}
                  className={`px-3 py-1.5 rounded-lg text-sm font-medium whitespace-nowrap transition ${
                    active === key ? "bg-white/15 text-white shadow-inner" : "text-slate-400 hover:text-white hover:bg-white/5"
                  }`}
                >
                  {label}
                </button>
              ))}
            </nav>
            <div className="ml-auto flex items-center gap-3">
              <div className="text-right hidden lg:block whitespace-nowrap">
                <div className="text-sm font-semibold text-white leading-tight">{user.full_name}</div>
                <div className="text-xs text-slate-400 capitalize leading-tight">{user.role}</div>
              </div>
              <button onClick={logout} className="text-sm font-semibold text-slate-400 hover:text-red-400 transition">Logout</button>
            </div>
          </div>
        </header>

        <main key={active} className="relative z-10 max-w-5xl mx-auto px-4 py-8 animate-fade-in-up">
          {hero && (
            <div className={`relative overflow-hidden rounded-2xl bg-gradient-to-r ${hero[3]} text-white p-6 sm:p-8 mb-6 shadow-xl shadow-slate-900/20`}>
              <div className="absolute -right-4 -bottom-8 text-[7rem] opacity-20 select-none pointer-events-none">{hero[0]}</div>
              <h1 className="text-2xl font-bold relative">{hero[1]}</h1>
              <p className="text-sm text-white/80 mt-1 relative max-w-xl">{hero[2]}</p>
            </div>
          )}
          {user.role === "patient" ? <PatientPortal tab={active} />
            : user.role === "caregiver" ? <CaregiverPortal tab={active} />
            : user.role === "admin" ? <AdminPortal />
            : <ClinicianPortal />}
        </main>
      </div>
  );
}
