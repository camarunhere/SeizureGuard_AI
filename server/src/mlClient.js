const ML_URL = process.env.ML_SERVICE_URL || "http://127.0.0.1:8091";
const MAX_RETRIES = 2; // total attempts = 3
const RETRY_DELAY_MS = 300;

async function callJson(path, opts) {
  for (let attempt = 0; ; attempt++) {
    let res;
    try {
      res = await fetch(`${ML_URL}${path}`, opts);
    } catch (err) {
      // Network-level failure (connection refused, service mid-restart) is
      // usually transient — e.g. this is exactly what happens if a request
      // lands in the few seconds while the ML service is starting up. Retry
      // a couple of times before giving up. An HTTP error response from a
      // live service (validation error, 5xx from real failure) is a genuine
      // application error and must NOT be retried — that's handled below,
      // outside this catch.
      if (attempt < MAX_RETRIES) {
        await new Promise((r) => setTimeout(r, RETRY_DELAY_MS * (attempt + 1)));
        continue;
      }
      const wrapped = new Error(
        `Could not reach the AI service at ${ML_URL} after ${MAX_RETRIES + 1} attempts — ` +
        "it may still be starting up, or has crashed. Check the server logs for [ml] messages."
      );
      wrapped.cause = err;
      throw wrapped;
    }
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      const err = new Error(body.detail || `ML service error (${res.status})`);
      err.status = res.status;
      throw err;
    }
    return res.json();
  }
}

export const mlHealth = () => callJson("/health");
export const mlMetadata = () => callJson("/metadata");

export const mlSimulate = (biasSeizure = false) =>
  callJson(`/simulate?bias_seizure=${biasSeizure}`);

export const mlPredict = (payload) =>
  callJson("/predict", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
