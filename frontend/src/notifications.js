// Alerts-as-notifications for the current laptop, two layers:
//  1. In-app toast pop-ups — pure React/DOM, work every time the app is
//     open, regardless of any browser/OS permission. This is the reliable
//     layer and needs no opt-in.
//  2. Native OS desktop notifications via the browser's Notification API —
//     a bonus on top, but genuinely outside this app's control: once the
//     site permission is "granted", whether a banner actually appears also
//     depends on OS-level settings (e.g. macOS System Settings > Notifications
//     > <browser> > Allow Notifications, and Focus/Do Not Disturb) that no
//     web page can detect or override. If layer 2 stays silent even via the
//     test button, that's the OS/browser blocking it, not this code.
// Both layers share the same "only alerts created after we started
// watching" freshness rule, and no push subscription/service worker here —
// so nothing fires once the tab/browser is fully closed.
import { useEffect, useRef, useState } from "react";
import { api } from "./api";

const POLL_MS = 15000;
const SEEN_KEY = "sg_notified_alert_ids";
const TOAST_MS = 12000;
// How far back to still treat an alert as "new" relative to when watching
// started — covers clock skew and the brief gap between mount and the first
// poll landing, without resurrecting old history.
const RECENCY_GRACE_MS = 15000;

function loadSeen() {
  try { return new Set(JSON.parse(localStorage.getItem(SEEN_KEY)) || []); } catch { return new Set(); }
}
function saveSeen(set) {
  try { localStorage.setItem(SEEN_KEY, JSON.stringify([...set].slice(-200))); } catch { /* best-effort */ }
}

export function notificationsSupported() {
  return typeof window !== "undefined" && "Notification" in window;
}

function fireNativeNotification(title, body, tag) {
  try {
    const n = new Notification(title, { body, tag });
    n.onerror = (e) => console.error("[notifications] Notification failed to display — likely an OS-level block, not a code error:", e);
    return n;
  } catch (err) {
    console.error("[notifications] new Notification() threw:", err);
    return null;
  }
}

function alertText(a) {
  const title = a.alert_type === "seizure_detected" ? "🚨 Seizure detected" : "⚠️ Elevated seizure risk";
  const body = a.patient_name
    ? `${a.patient_name} — ${(a.risk_probability * 100).toFixed(0)}% probability`
    : `${(a.risk_probability * 100).toFixed(0)}% probability`;
  return { title, body };
}

/** Polls `alertsPath` while `enabled`, always raising an in-app toast for
 * each alert created after watching started, plus a native OS notification
 * when permission has been granted. Alerts already present when watching
 * started are recorded as seen but not raised, so mounting/re-enabling
 * doesn't replay old history. */
export function useDesktopAlertNotifications(alertsPath, enabled) {
  const [permission, setPermission] = useState(() => (notificationsSupported() ? Notification.permission : "unsupported"));
  const [toasts, setToasts] = useState([]);
  const seenRef = useRef(loadSeen());
  const baselineAtRef = useRef(0);
  const toastSeqRef = useRef(0);
  const permissionRef = useRef(permission);
  permissionRef.current = permission;

  const pushToast = (title, body) => {
    const id = ++toastSeqRef.current;
    setToasts((t) => [...t, { id, title, body }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), TOAST_MS);
  };
  const dismissToast = (id) => setToasts((t) => t.filter((x) => x.id !== id));

  useEffect(() => {
    if (!enabled || !alertsPath) return;
    let alive = true;
    baselineAtRef.current = Date.now();

    const poll = async () => {
      let alerts;
      try {
        alerts = await api(alertsPath);
      } catch (err) {
        console.warn("[notifications] alert poll failed, will retry:", err.message);
        return; // transient failure — try again next tick
      }
      if (!alive) return;
      for (const a of alerts) {
        if (seenRef.current.has(a.id)) continue;
        seenRef.current.add(a.id);
        const createdMs = new Date(a.created_at).getTime();
        const isPreExisting = !Number.isFinite(createdMs) || createdMs < baselineAtRef.current - RECENCY_GRACE_MS;
        if (isPreExisting || a.acknowledged) continue;
        const { title, body } = alertText(a);
        pushToast(title, body);
        if (permissionRef.current === "granted") fireNativeNotification(title, body, a.id);
      }
      saveSeen(seenRef.current);
    };

    poll();
    const id = setInterval(poll, POLL_MS);
    return () => { alive = false; clearInterval(id); };
  }, [alertsPath, enabled]);

  const requestPermission = async () => {
    if (!notificationsSupported()) return "unsupported";
    const result = await Notification.requestPermission();
    setPermission(result);
    return result;
  };

  /** Fires an immediate real OS notification plus an in-app toast, with no
   * dependency on alerts or polling — the fastest way to tell "site
   * permission granted but the OS is blocking the browser itself" apart
   * from "our polling is broken" (the toast will always appear either way). */
  const sendTestNotification = () => {
    pushToast("🔔 Test notification", "This in-app pop-up always works. If a native OS banner also appeared, desktop notifications are fully set up.");
    if (permission === "granted") fireNativeNotification("🔔 Test notification", "If you can see this as a native OS banner, desktop alerts are fully working.", "sg-test");
  };

  return { permission, requestPermission, sendTestNotification, toasts, dismissToast, supported: notificationsSupported() };
}
