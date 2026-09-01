// One-off script: creates the admin and a pre-approved clinician account in
// whatever MongoDB Atlas database this machine's server/.env points to.
// Run from the server/ directory: node --env-file=.env create_accounts.mjs
// Safe to re-run — skips any account that already exists.
import bcrypt from "bcryptjs";
import mongoose from "mongoose";
import { User } from "./src/models.js";

const ACCOUNTS = [
  { fullName: "System Administrator", email: "admin@seizureguard.local", password: "Admin!2026", role: "admin", approvalStatus: "approved" },
  { fullName: "Dr. Test Physician", email: "physician.test@seizureguard.local", password: "Physician!2026", role: "clinician", approvalStatus: "approved" },
];

await mongoose.connect(process.env.MONGODB_URI, { dbName: "seizureguard" });

for (const acc of ACCOUNTS) {
  const existing = await User.findOne({ email: acc.email });
  if (existing) {
    console.log(`Already exists: ${acc.email} (role=${existing.role})`);
    continue;
  }
  const passwordHash = await bcrypt.hash(acc.password, 10);
  await User.create({
    fullName: acc.fullName,
    email: acc.email,
    passwordHash,
    role: acc.role,
    approvalStatus: acc.approvalStatus,
  });
  console.log(`Created: ${acc.email} (role=${acc.role})`);
}

await mongoose.disconnect();
console.log("Done.");
