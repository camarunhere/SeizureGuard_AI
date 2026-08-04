import { useEffect, useState } from "react";

export function Card({ title, children, className = "" }) {
  return (
    <div className={`bg-white/85 backdrop-blur-md border border-white/70 rounded-2xl shadow-lg shadow-slate-900/[0.06] p-6 transition-shadow hover:shadow-xl ${className}`}>
      {title && (
        <h2 className="text-xs font-semibold uppercase tracking-wider text-slate-500 mb-4">{title}</h2>
      )}
      {children}
    </div>
  );
}

export function Button({ children, variant = "primary", className = "", ...props }) {
  const styles = {
    primary: "bg-gradient-to-r from-blue-800 to-indigo-700 hover:from-blue-900 hover:to-indigo-800 text-white shadow-md shadow-blue-800/25",
    danger: "bg-gradient-to-r from-red-600 to-rose-600 hover:from-red-700 hover:to-rose-700 text-white shadow-md shadow-red-600/25",
    subtle: "bg-white/70 hover:bg-white border border-slate-200 text-slate-700 shadow-sm",
    success: "bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-700 hover:to-teal-700 text-white shadow-md shadow-emerald-600/25",
  };
  return (
    <button
      className={`px-4 py-2 rounded-xl text-sm font-semibold transition active:scale-[0.98] disabled:opacity-50 disabled:cursor-not-allowed ${styles[variant]} ${className}`}
      {...props}
    >
      {children}
    </button>
  );
}

export function Field({ label, children, hint }) {
  return (
    <div>
      <label className="block text-sm font-semibold text-slate-700 mb-1">{label}</label>
      {children}
      {hint}
    </div>
  );
}

export const inputCls =
  "w-full px-3 py-2 border border-slate-300 rounded-lg text-sm transition focus:outline-none focus:ring-2 focus:ring-blue-800/25 focus:border-blue-700 hover:border-slate-400 bg-white";

export function Alert({ kind = "error", children }) {
  if (!children) return null;
  const styles = {
    error: "bg-red-50 border-red-200 text-red-700",
    success: "bg-green-50 border-green-200 text-green-700",
    info: "bg-blue-50 border-blue-200 text-blue-700",
  };
  return (
    <div className={`border rounded-lg px-4 py-3 text-sm mb-4 animate-fade-in-up ${styles[kind]}`}>{children}</div>
  );
}

export function Spinner() {
  return (
    <span className="inline-block w-4 h-4 border-2 border-white/50 border-t-white rounded-full animate-spin align-[-3px] mr-2" />
  );
}

export function Skeleton({ lines = 3 }) {
  return (
    <div className="space-y-3">
      {Array.from({ length: lines }).map((_, i) => (
        <div key={i} className="skeleton h-4 bg-slate-200 rounded" style={{ width: `${85 - i * 15}%`, animationDelay: `${i * 120}ms` }} />
      ))}
    </div>
  );
}

const RISK_STYLES = {
  low: { box: "bg-green-50 border-green-200", text: "text-green-700", bar: "bg-green-600", badge: "bg-green-100 text-green-700", label: "LOW RISK" },
  moderate: { box: "bg-amber-50 border-amber-200", text: "text-amber-700", bar: "bg-amber-500", badge: "bg-amber-100 text-amber-700", label: "MODERATE RISK" },
  high: { box: "bg-red-50 border-red-300", text: "text-red-700", bar: "bg-red-600", badge: "bg-red-100 text-red-700", label: "HIGH RISK" },
};
export function riskStyle(level) { return RISK_STYLES[level] || RISK_STYLES.low; }

export function RiskBadge({ level, probability }) {
  const s = riskStyle(level);
  return (
    <span className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-bold ${s.badge}`}>
      {s.label}{probability != null && ` ${(probability * 100).toFixed(0)}%`}
    </span>
  );
}

const CLASS_LABELS = {
  inter_ictal: "Inter-Ictal (baseline)",
  pre_ictal: "Pre-Ictal (seizure risk window)",
  ictal: "Ictal (seizure activity detected)",
};
export function classLabel(c) { return CLASS_LABELS[c] || c; }

/** Animated number that counts up to `value` on mount / when value changes. */
function CountUp({ value, decimals = 0, duration = 700 }) {
  const [display, setDisplay] = useState(0);
  useEffect(() => {
    let raf;
    const start = performance.now();
    const tick = (now) => {
      const t = Math.min((now - start) / duration, 1);
      const eased = 1 - Math.pow(1 - t, 3);
      setDisplay(value * eased);
      if (t < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [value, duration]);
  return <>{display.toFixed(decimals)}</>;
}
export { CountUp };

/** Static/looping EEG waveform renderer (SVG) — shared by dashboard + live monitoring. */
export function EEGWaveform({ signal, color = "#1e3a8a", height = 90, abnormal = false }) {
  if (!signal || !signal.length) return null;
  const w = 600;
  const max = Math.max(...signal.map(Math.abs), 1);
  const points = signal
    .map((v, i) => `${(i / (signal.length - 1)) * w},${height / 2 - (v / max) * (height / 2 - 6)}`)
    .join(" ");
  return (
    <svg viewBox={`0 0 ${w} ${height}`} className="w-full" style={{ height }} preserveAspectRatio="none">
      <polyline points={points} fill="none" stroke={abnormal ? "#dc2626" : color} strokeWidth="1.4" strokeLinejoin="round" />
    </svg>
  );
}

/** Small multi-series-free line chart for vitals/risk trends. */
export function TrendChart({ points, format = (v) => v, domain, color = "#1e3a8a" }) {
  if (!points || points.length < 2) return <p className="text-xs text-slate-400">Not enough data yet.</p>;
  const values = points.map((p) => p.v).filter((v) => v != null);
  const [lo, hi] = domain || [Math.min(...values), Math.max(...values)];
  const range = hi - lo || 1;
  const W = 600, H = 160, PAD = 28;
  const xs = points.map((_, i) => PAD + (i / (points.length - 1)) * (W - PAD * 2));
  const ys = points.map((p) => H - PAD - ((p.v - lo) / range) * (H - PAD * 1.5));
  const path = xs.map((x, i) => `${i ? "L" : "M"}${x.toFixed(1)},${ys[i].toFixed(1)}`).join(" ");
  const area = `${path} L${xs[xs.length - 1]},${H - PAD} L${xs[0]},${H - PAD} Z`;
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-auto">
      <path d={area} fill={color} opacity="0.08" />
      <path d={path} fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      <text x={PAD} y={14} fontSize="10" fill="#94a3b8">{format(hi)}</text>
      <text x={PAD} y={H - PAD + 14} fontSize="10" fill="#94a3b8">{format(lo)}</text>
    </svg>
  );
}

export const fmtDate = (iso) =>
  new Date(iso.endsWith("Z") ? iso : iso + "Z").toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
