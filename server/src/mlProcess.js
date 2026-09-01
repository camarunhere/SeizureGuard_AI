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
let intentionalStop = false;
let respawnAttempts = 0;
const MAX_RESPAWN_ATTEMPTS = 5;

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
  const venvUnix = path.join(REPO_ROOT, ".venv", "bin", "python");
  if (existsSync(venvUnix)) return venvUnix;
  const venvWindows = path.join(REPO_ROOT, ".venv", "Scripts", "python.exe");
  if (existsSync(venvWindows)) return venvWindows;
  return process.platform === "win32" ? "python" : "python3";
}

// Polls /health for up to `timeoutMs`, resetting the crash-loop counter the
// moment it comes up (used both for the initial startup wait and after a
// mid-session auto-respawn, so a service that stabilizes gets a fresh
// restart budget instead of eventually tripping MAX_RESPAWN_ATTEMPTS from
// accumulated lifetime crashes).
async function waitUntilUp(timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await isUp()) {
      respawnAttempts = 0;
      return true;
    }
    if (!child) return false; // process died before it ever came up
    await new Promise((r) => setTimeout(r, 1000));
  }
  return false;
}

// Spawns the ML service and, if it dies unexpectedly *after* having started
// successfully, auto-restarts it with backoff. Without this, a mid-session
// crash of the Python process would silently fail every prediction
// thereafter until someone manually restarted the whole Node server.
function spawnChild() {
  const py = pythonBin();
  console.log(`[ml] Starting Python ML service (${py}, port ${ML_PORT})…`);
  child = spawn(
    py,
    ["-m", "uvicorn", "src.ml_service:app", "--port", ML_PORT, "--host", "127.0.0.1"],
    { cwd: REPO_ROOT, stdio: ["ignore", "inherit", "inherit"] }
  );

  child.on("exit", (code) => {
    child = null;
    if (intentionalStop || code === null || code === 0) return;
    console.error(`[ml] ML service exited unexpectedly with code ${code}.`);
    if (respawnAttempts >= MAX_RESPAWN_ATTEMPTS) {
      console.error(
        `[ml] Gave up after ${MAX_RESPAWN_ATTEMPTS} restart attempts — predictions will fail ` +
        "until the server is restarted manually. Check the crash reason above."
      );
      return;
    }
    respawnAttempts += 1;
    const delayMs = Math.min(1000 * 2 ** respawnAttempts, 30000);
    console.warn(`[ml] Restarting it in ${Math.round(delayMs / 1000)}s (attempt ${respawnAttempts}/${MAX_RESPAWN_ATTEMPTS})…`);
    setTimeout(() => {
      spawnChild();
      waitUntilUp(60000).then((up) => {
        if (up) console.log("[ml] ML service is back up.");
      });
    }, delayMs);
  });
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

  spawnChild();
  if (await waitUntilUp(60000)) {
    console.log("[ml] ML service is up.");
    return;
  }
  console.warn(
    "[ml] ML service did not come up. Check that the Python venv exists " +
    "(python3 -m venv .venv && pip install -r requirements.txt) and that the " +
    "model is trained (python -m src.train)."
  );
}

export function stopMlService() {
  intentionalStop = true;
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
