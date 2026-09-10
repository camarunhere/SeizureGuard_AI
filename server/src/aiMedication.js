// AI Medication Assistant — an LLM (Claude) reasoning over a patient's
// structured condition summary to draft anti-epileptic medication
// considerations for a clinician to review. This is genuinely "AI" in the
// sense of an LLM, but it is NOT a trained/learned clinical model: no
// dataset exists here mapping patient profiles to real prescribing outcomes
// (unlike the deep learning model in src/model.py, which is trained on real
// labeled EEG). It is always a draft — nothing it returns is saved to a
// patient's record until a clinician explicitly reviews and applies it via
// PATCH /patients/:id/medications.
const ANTHROPIC_API_URL = "https://api.anthropic.com/v1/messages";
const MODEL = "claude-sonnet-5";

const SYSTEM_PROMPT = `You are a clinical decision-support assistant helping a licensed neurologist/epileptologist think through anti-epileptic drug (AED) therapy for a patient with epilepsy.

You are NOT prescribing anything. Your output is a draft for a licensed clinician to review, edit, and approve — it will be shown with prominent "AI-generated draft, not a prescription" warnings. Never state or imply the suggestions are final or ready to administer without clinician review.

Given the patient's condition summary below, respond with ONLY a single JSON object (no markdown fences, no prose outside the JSON) matching exactly this shape:
{
  "summary": "1-2 sentence clinical summary of the patient's current situation",
  "suggestions": [
    { "medication": "drug name", "rationale": "why it fits this patient's seizure type/history", "considerations": "dosing considerations, interactions, or monitoring notes" }
  ],
  "warnings": ["important safety caveats, contraindication flags, or missing-information notes"]
}
Base suggestions on standard epilepsy treatment guidelines (e.g. ILAE) for the stated seizure type. If seizure type or other key data is missing or unclear, say so in "warnings" rather than guessing. Always include at least one entry in "warnings" reiterating this is a draft requiring clinician verification of dosing, interactions, and contraindications against the full chart.`;

export function buildConditionSummary(patient, seizureEvents = [], latestPrediction = null) {
  const lines = [];
  lines.push(`Age: ${patient.age ?? "unknown"}`);
  lines.push(`Sex: ${patient.sex || "unknown"}`);
  lines.push(`Seizure type: ${patient.seizureType || "not recorded"}`);
  lines.push(`Seizure frequency (self-reported): ${patient.seizureFrequency || "not recorded"}`);
  lines.push(`Diagnosis date: ${patient.diagnosisDate ? patient.diagnosisDate.toISOString().slice(0, 10) : "not recorded"}`);
  lines.push(`Has aura/warning symptoms: ${patient.hasAura || "not recorded"}${patient.auraSymptoms ? ` (${patient.auraSymptoms})` : ""}`);
  lines.push(`Current medications: ${patient.medications || "none recorded"}`);
  lines.push(`Past medication history (prior AEDs tried): ${patient.medicationHistory || "none recorded"}`);
  lines.push(`Recent medication changes: ${patient.recentMedicationChanges || "none recorded"}`);
  lines.push(`Other conditions: ${patient.otherConditions || "none recorded"}`);
  lines.push(`Known triggers: ${patient.knownTriggers || "none recorded"}`);
  lines.push(`Past medical history: ${patient.medicalHistory || "none recorded"}`);
  lines.push(`Family history: ${patient.familyHistory || "none recorded"}`);

  if (seizureEvents.length) {
    lines.push(`\nRecent logged seizure events (${seizureEvents.length} most recent):`);
    for (const e of seizureEvents) {
      lines.push(`- ${e.date.toISOString().slice(0, 10)}: ${e.severity}, ${e.durationMinutes ?? "?"} min` +
        `${e.lostConsciousness ? `, consciousness lost: ${e.lostConsciousness}` : ""}` +
        `${e.emsRequired ? `, EMS required: ${e.emsRequired}` : ""}`);
    }
  } else {
    lines.push("\nNo seizure events logged yet.");
  }

  if (latestPrediction) {
    lines.push(`\nMost recent AI seizure-risk reading: ${latestPrediction.riskLevel} risk (${(latestPrediction.riskProbability * 100).toFixed(0)}%), class: ${latestPrediction.predictionClass}, at ${latestPrediction.predictionTime.toISOString()}.`);
  }

  return lines.join("\n");
}

// Fallback used when no ANTHROPIC_API_KEY is configured, so the feature
// still works with zero setup/cost. This is deliberately NOT presented as
// "AI" — it's a lookup against standard first-line AED guidance by seizure
// type (ILAE-aligned, textbook-level, not patient-specific dosing), the same
// "real but rule-based, not fabricated ML" honesty pattern used for the
// daily check-in risk factors in checkinRisk.js. It upgrades to real LLM
// reasoning automatically the moment a key is added — no other code changes.
const AED_RULES = [
  {
    match: /focal|partial/i,
    medications: [
      { medication: "Levetiracetam", rationale: "Broad-spectrum, commonly first-line for focal seizures, minimal drug interactions.", considerations: "Monitor for mood/behavioural side effects; renal dose adjustment." },
      { medication: "Lamotrigine", rationale: "Effective first-line option for focal seizures with a favorable side-effect profile.", considerations: "Requires slow titration to reduce rash risk (Stevens-Johnson syndrome)." },
      { medication: "Carbamazepine", rationale: "Long-established first-line agent for focal seizures.", considerations: "Enzyme-inducer — check interactions with other medications; monitor CBC/LFTs." },
    ],
  },
  {
    match: /absence/i,
    medications: [
      { medication: "Ethosuximide", rationale: "First-line specifically for absence seizures.", considerations: "Ineffective against tonic-clonic seizures — confirm no comorbid seizure types." },
      { medication: "Valproate", rationale: "Effective across absence and other generalized seizure types.", considerations: "Avoid in women of childbearing potential unless no suitable alternative — teratogenicity risk." },
    ],
  },
  {
    match: /myoclonic/i,
    medications: [
      { medication: "Valproate", rationale: "First-line for myoclonic seizures.", considerations: "Avoid in women of childbearing potential unless no suitable alternative — teratogenicity risk." },
      { medication: "Levetiracetam", rationale: "Effective alternative for myoclonic seizures with a cleaner interaction profile than valproate.", considerations: "Monitor for mood/behavioural side effects." },
    ],
  },
  {
    match: /generali[sz]ed|tonic.?clonic/i,
    medications: [
      { medication: "Levetiracetam", rationale: "Broad-spectrum first-line option for generalized tonic-clonic seizures.", considerations: "Monitor for mood/behavioural side effects." },
      { medication: "Lamotrigine", rationale: "Effective first-line option for generalized seizures.", considerations: "Requires slow titration to reduce rash risk." },
      { medication: "Valproate", rationale: "Highly effective for generalized seizures.", considerations: "Avoid in women of childbearing potential unless no suitable alternative — teratogenicity risk." },
    ],
  },
];

function generateRuleBasedSuggestions(patient) {
  const seizureType = patient.seizureType || "";
  const rule = AED_RULES.find((r) => r.match.test(seizureType));
  const warnings = [
    "This is a RULE-BASED reference list from standard first-line AED guidance by seizure type — not personalized AI/LLM reasoning, and not a prescription. A clinician must verify dosing, interactions, and contraindications against the full chart before applying anything.",
  ];

  if (!rule) {
    warnings.push(seizureType
      ? `Seizure type "${seizureType}" wasn't recognized by this reference list — classify more specifically (e.g. focal, generalized, absence, myoclonic) for a targeted suggestion.`
      : "No seizure type is recorded for this patient — suggestions cannot be targeted without it.");
    return {
      summary: "Insufficient seizure-type classification to draft targeted suggestions.",
      suggestions: [],
      warnings,
      source: "rule_based",
    };
  }

  if (patient.medications) {
    warnings.push(`Patient is already recorded on: "${patient.medications}" — review for interactions and dose optimization before adding a new agent rather than assuming a first prescription.`);
  }
  if (["female"].includes((patient.sex || "").toLowerCase())) {
    warnings.push("Patient sex is recorded as female — valproate carries a well-established teratogenicity risk and is generally avoided in women of childbearing potential unless no suitable alternative exists.");
  }

  return {
    summary: `Standard first-line AED options for a ${seizureType} seizure presentation (reference guidance, not personalized to this patient beyond seizure type).`,
    suggestions: rule.medications,
    warnings,
    source: "rule_based",
  };
}

export async function generateMedicationSuggestions(conditionSummary, patient) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return generateRuleBasedSuggestions(patient);
  }

  let res;
  try {
    res = await fetch(ANTHROPIC_API_URL, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 1024,
        system: SYSTEM_PROMPT,
        messages: [{ role: "user", content: `Patient condition summary:\n\n${conditionSummary}` }],
      }),
    });
  } catch (err) {
    const wrapped = new Error(`Could not reach the AI service: ${err.message}`);
    wrapped.status = 502;
    throw wrapped;
  }

  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    const err = new Error(`AI service returned an error (${res.status}): ${detail.slice(0, 300)}`);
    err.status = 502;
    throw err;
  }

  const data = await res.json();
  const text = (data.content || []).map((c) => c.text || "").join("").trim();

  try {
    const parsed = JSON.parse(text);
    return {
      summary: String(parsed.summary || ""),
      suggestions: Array.isArray(parsed.suggestions) ? parsed.suggestions : [],
      warnings: Array.isArray(parsed.warnings) ? parsed.warnings : [],
      source: "ai",
    };
  } catch {
    // Model didn't return clean JSON — surface the raw text rather than
    // silently dropping it, but flag that structured parsing failed.
    return {
      summary: text || "The AI service returned an empty response.",
      suggestions: [],
      warnings: ["The AI response could not be parsed into structured suggestions — review the summary text directly and treat with extra caution."],
      source: "ai",
    };
  }
}
