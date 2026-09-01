import bcrypt from "bcryptjs";
import { Router } from "express";
import { createToken, requireAuth } from "../auth.js";
import { User, genPatientCode, logActivity } from "../models.js";

const router = Router();

function userPayload(u) {
  return {
    id: String(u._id),
    email: u.email,
    full_name: u.fullName,
    role: u.role,
    approval_status: u.approvalStatus,
    patient_code: u.patientCode || null,
    age: u.age ?? null,
    medical_history: u.medicalHistory || "",
    linked_patients_count: u.linkedPatients?.length || 0,
  };
}

router.post("/register", async (req, res) => {
  const { full_name, email, password, role, age, medical_history } = req.body || {};
  if (!full_name || String(full_name).trim().length < 2)
    return res.status(422).json({ detail: "Name is too short." });
  if (!email || !/^\S+@\S+\.\S+$/.test(email))
    return res.status(422).json({ detail: "A valid email is required." });
  if (!password || String(password).length < 6)
    return res.status(422).json({ detail: "Password must be at least 6 characters." });
  // "admin" is deliberately excluded — never self-registerable via the public form.
  if (!["patient", "caregiver", "clinician"].includes(role))
    return res.status(422).json({ detail: "Role must be patient, caregiver or clinician." });

  const existing = await User.findOne({ email: String(email).toLowerCase() });
  if (existing) return res.status(409).json({ detail: "An account with this email already exists." });

  const passwordHash = await bcrypt.hash(password, 10);
  const doc = {
    fullName: full_name,
    email: String(email).toLowerCase(),
    passwordHash,
    role,
  };
  if (role === "patient") {
    doc.patientCode = genPatientCode();
    doc.age = age || null;
    doc.medicalHistory = medical_history || "";
  }
  if (role === "clinician") doc.approvalStatus = "pending";

  const user = await User.create(doc);
  await logActivity(user, "register", `role=${role}`);

  if (user.approvalStatus === "pending") {
    // No token issued — a pending clinician account cannot be "opened" until
    // an admin approves it (see /login below).
    return res.json({
      pending: true,
      message: "Registration submitted. Your clinician account is pending admin approval before you can log in.",
    });
  }
  res.json({ token: createToken(user), user: userPayload(user) });
});

router.post("/login", async (req, res) => {
  const { email, password } = req.body || {};
  const user = await User.findOne({ email: String(email || "").toLowerCase() });
  if (!user || !(await bcrypt.compare(password || "", user.passwordHash)))
    return res.status(401).json({ detail: "Invalid email or password." });
  if (user.isBlocked) return res.status(403).json({ detail: "This account has been blocked." });
  if (user.role === "clinician" && user.approvalStatus !== "approved") {
    const detail = user.approvalStatus === "rejected"
      ? "This clinician account was not approved. Contact an administrator."
      : "This clinician account is pending admin approval and cannot log in yet.";
    return res.status(403).json({ detail });
  }

  await logActivity(user, "login");
  res.json({ token: createToken(user), user: userPayload(user) });
});

router.post("/logout", requireAuth, async (req, res) => {
  await logActivity(req.user, "logout");
  res.json({ message: "Logged out." });
});

router.get("/me", requireAuth, (req, res) => res.json(userPayload(req.user)));

export default router;
