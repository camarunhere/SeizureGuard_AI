import path from "node:path";
import { fileURLToPath } from "node:url";
import express from "express";
import { connectDb } from "./db.js";
import { ensureMlService } from "./mlProcess.js";
import { mlHealth } from "./mlClient.js";
import authRoutes from "./routes/auth.js";
import patientRoutes from "./routes/patient.js";
import clinicianRoutes from "./routes/clinician.js";
import adminRoutes from "./routes/admin.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FRONTEND_DIST = path.resolve(__dirname, "..", "..", "frontend", "dist");
const PORT = process.env.PORT || 8090;

// Express 4 doesn't route a rejected promise from an async handler to error
// middleware on its own — an uncaught one (e.g. an invalid ObjectId cast)
// becomes an unhandledRejection and takes the whole Node process down,
// dropping every other in-flight user's request too. This net converts that
// into a logged error instead of a full outage; the specific triggering
// route should still be fixed to fail cleanly, but this stops one bad
// request from being able to kill the server for everyone.
process.on("unhandledRejection", (err) => console.error("[unhandledRejection]", err));
process.on("uncaughtException", (err) => console.error("[uncaughtException]", err));

const app = express();
app.use(express.json({ limit: "2mb" }));

app.get("/health", async (req, res) => {
  const ml = await mlHealth().catch(() => ({ status: "down", model_loaded: false }));
  res.json({ status: "ok", backend: "node+mongodb", ml_service: ml });
});

app.use("/api/auth", authRoutes);
app.use("/api/patient", patientRoutes);
app.use("/api/clinician", clinicianRoutes);
app.use("/api/admin", adminRoutes);

app.use(express.static(FRONTEND_DIST));
app.get("*", (req, res) => {
  if (req.path.startsWith("/api/")) return res.status(404).json({ detail: "Not found." });
  res.sendFile(path.join(FRONTEND_DIST, "index.html"));
});

const start = async () => {
  await connectDb();
  await ensureMlService();
  app.listen(PORT, () => console.log(`[server] http://127.0.0.1:${PORT}`));
};

start();
