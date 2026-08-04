// Manages the Python ML microservice (CNN+BiLSTM+Transformer seizure model)
// as a child process so the whole app starts with a single `npm start`.
// Uses port 8091 — deliberately different from other local projects' ML
// services to avoid any port collision.
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";

const ML_URL = process.env.ML_SERVICE_URL || "http://127.0.0.1:8091";
const ML_PORT = new URL(ML_URL).port || "8091";
const REPO_ROOT = path.resolve(process.cwd(), "..");

let child = null;

async function isUp() {
  try {
    const res = await fetch(`${ML_URL}/health`, { signal: AbortSignal.timeout(2000) });
    return res.ok;
  } catch {
    return false;
  }
}

function pythonBin() {
  if (process.env.ML_PYTHON) return process.env.ML_PYTHON;
  const venv = path.join(REPO_ROOT, ".venv", "bin", "python");
  return existsSync(venv) ? venv : "python3";
}

export async function ensureMlService() {
  if (await isUp()) {
    console.log(`[ml] Reusing ML service already running at ${ML_URL}`);
    return;
  }
  if (process.env.SKIP_ML_SPAWN) {
    console.warn("[ml] SKIP_ML_SPAWN set and ML service is down — predictions will fail.");
    return;
  }

  const py = pythonBin();
  console.log(`[ml] Starting Python ML service (${py}, port ${ML_PORT})…`);
  child = spawn(
    py,
    ["-m", "uvicorn", "src.ml_service:app", "--port", ML_PORT, "--host", "127.0.0.1"],
    { cwd: REPO_ROOT, stdio: ["ignore", "inherit", "inherit"] }
  );
  child.on("exit", (code) => {
    if (code !== null && code !== 0)
      console.error(`[ml] ML service exited with code ${code}.`);
    child = null;
  });

  for (let i = 0; i < 60; i++) {
    await new Promise((r) => setTimeout(r, 1000));
    if (await isUp()) {
      console.log("[ml] ML service is up.");
      return;
    }
    if (!child) break;
  }
  console.warn(
    "[ml] ML service did not come up. Check that the Python venv exists " +
    "(python3 -m venv .venv && pip install -r requirements.txt) and that the " +
    "model is trained (python -m src.train)."
  );
}

export function stopMlService() {
  if (child) {
    child.kill("SIGTERM");
    child = null;
  }
}

for (const sig of ["SIGINT", "SIGTERM"]) {
  process.on(sig, () => {
    stopMlService();
    process.exit(0);
  });
}
process.on("exit", stopMlService);
