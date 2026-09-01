import jwt from "jsonwebtoken";
import { User } from "./models.js";

export const JWT_SECRET = process.env.JWT_SECRET || "dev-secret-change-in-production!!";
const TOKEN_TTL = "7d";

export function createToken(user) {
  return jwt.sign({ sub: String(user._id), role: user.role }, JWT_SECRET, { expiresIn: TOKEN_TTL });
}

export async function requireAuth(req, res, next) {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : null;
  // A 401 here forces the frontend to clear the session and hard-reload the
  // page (see api.js) — logged with the specific cause so an unexpected
  // logout/reload is diagnosable from the server log instead of a guess.
  if (!token) {
    console.warn(`[auth] 401 on ${req.method} ${req.path} — no Authorization header`);
    return res.status(401).json({ detail: "Not authenticated" });
  }
  try {
    const payload = jwt.verify(token, JWT_SECRET);
    const user = await User.findById(payload.sub);
    if (!user) {
      console.warn(`[auth] 401 on ${req.method} ${req.path} — token valid but user ${payload.sub} no longer exists`);
      return res.status(401).json({ detail: "User no longer exists" });
    }
    if (user.isBlocked) return res.status(403).json({ detail: "Account is blocked" });
    req.user = user;
    next();
  } catch (err) {
    console.warn(`[auth] 401 on ${req.method} ${req.path} — ${err.name}: ${err.message}`);
    return res.status(401).json({ detail: "Invalid or expired token" });
  }
}

export function requireRole(...roles) {
  return [
    requireAuth,
    (req, res, next) => {
      if (!roles.includes(req.user.role))
        return res.status(403).json({ detail: `Requires role: ${roles.join(", ")}` });
      next();
    },
  ];
}
