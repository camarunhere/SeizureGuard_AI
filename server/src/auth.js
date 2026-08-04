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
  if (!token) return res.status(401).json({ detail: "Not authenticated" });
  try {
    const payload = jwt.verify(token, JWT_SECRET);
    const user = await User.findById(payload.sub);
    if (!user) return res.status(401).json({ detail: "User no longer exists" });
    if (user.isBlocked) return res.status(403).json({ detail: "Account is blocked" });
    req.user = user;
    next();
  } catch {
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
