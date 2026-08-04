import { useEffect, useState, useCallback } from "react";

const TOKEN_KEY = "sg_token";
const USER_KEY = "sg_user";

export const getToken = () => localStorage.getItem(TOKEN_KEY);
export const getStoredUser = () => {
  try {
    return JSON.parse(localStorage.getItem(USER_KEY));
  } catch {
    return null;
  }
};
export const storeSession = (token, user) => {
  localStorage.setItem(TOKEN_KEY, token);
  localStorage.setItem(USER_KEY, JSON.stringify(user));
};
export const clearSession = () => {
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(USER_KEY);
};

export async function api(path, { method = "GET", body } = {}) {
  const headers = {};
  const token = getToken();
  if (token) headers["Authorization"] = `Bearer ${token}`;
  if (body) headers["Content-Type"] = "application/json";

  const res = await fetch(path, { method, headers, body: body ? JSON.stringify(body) : undefined });

  if (res.status === 401 && token) {
    clearSession();
    window.location.reload();
    return new Promise(() => {});
  }

  if (!res.ok) {
    let detail = `Request failed (${res.status})`;
    try {
      const data = await res.json();
      if (typeof data.detail === "string") detail = data.detail;
    } catch { /* keep default */ }
    throw new Error(detail);
  }
  return res.json();
}

/** GET `path` on mount (and whenever it changes), tracking loading/error state.
 * Pass `path` as null/false to skip. Call the returned `reload()` to refetch —
 * used after a mutation (link, acknowledge, save, …) to pull fresh data. */
export function useApi(path) {
  const [state, setState] = useState({ data: null, loading: !!path, error: "" });
  const [tick, setTick] = useState(0);

  useEffect(() => {
    if (!path) return;
    let alive = true;
    setState((s) => ({ ...s, loading: true, error: "" }));
    api(path)
      .then((data) => alive && setState({ data, loading: false, error: "" }))
      .catch((err) => alive && setState({ data: null, loading: false, error: err.message }));
    return () => { alive = false; };
  }, [path, tick]);

  const reload = useCallback(() => setTick((t) => t + 1), []);
  return { ...state, reload };
}
