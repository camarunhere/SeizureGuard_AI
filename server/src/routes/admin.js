import { Router } from "express";
import { requireRole } from "../auth.js";
import { User, logActivity } from "../models.js";

const router = Router();
const adminOnly = requireRole("admin");

function clinicianPayload(u) {
  return {
    id: String(u._id),
    full_name: u.fullName,
    email: u.email,
    approval_status: u.approvalStatus,
    is_blocked: u.isBlocked,
    created_at: u.createdAt.toISOString(),
  };
}

// ---- Clinician account approval ------------------------------------------------
// Clinician registrations land as "pending" and cannot log in (see
// routes/auth.js) until approved here.

router.get("/clinicians", adminOnly, async (req, res) => {
  const status = ["pending", "approved", "rejected"].includes(req.query.status) ? req.query.status : null;
  const query = { role: "clinician", ...(status ? { approvalStatus: status } : {}) };
  const clinicians = await User.find(query).sort({ createdAt: -1 });
  res.json(clinicians.map(clinicianPayload));
});

router.post("/clinicians/:id/approve", adminOnly, async (req, res) => {
  const user = await User.findOneAndUpdate(
    { _id: req.params.id, role: "clinician" }, { approvalStatus: "approved" }, { new: true }
  );
  if (!user) return res.status(404).json({ detail: "Clinician account not found." });
  await logActivity(req.user, "approve_clinician", String(user._id));
  res.json({ message: `${user.fullName} approved.`, clinician: clinicianPayload(user) });
});

router.post("/clinicians/:id/reject", adminOnly, async (req, res) => {
  const user = await User.findOneAndUpdate(
    { _id: req.params.id, role: "clinician" }, { approvalStatus: "rejected" }, { new: true }
  );
  if (!user) return res.status(404).json({ detail: "Clinician account not found." });
  await logActivity(req.user, "reject_clinician", String(user._id));
  res.json({ message: `${user.fullName} rejected.`, clinician: clinicianPayload(user) });
});

export default router;
