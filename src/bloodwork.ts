import biomarkerFile from "./bloodwork/biomarkers.json";
import type {
  BiologicalSex,
  BloodworkActionPlanItem,
  BloodworkAnalysis,
  BloodworkBiologicalAge,
  BloodworkBiomarkerDefinition,
  BloodworkCategoryScore,
  BloodworkComboSignal,
  BiomarkerOptimalRange,
  ClinicalReferenceRange,
  EvaluatedLabBiomarker,
  HealthspanCategory,
  LabBiomarker,
  LabResult,
} from "./types.js";
import { round } from "./utils.js";

interface BiomarkerBundle {
  biomarkers: Array<Record<string, unknown>>;
}

interface AnalyzeBloodworkInput {
  age?: number;
  chronologicalAge?: number;
  sex?: BiologicalSex;
}

interface ComboDefinition {
  name: string;
  biomarkers: string[];
}

interface KdmParams {
  k: number;
  s: number;
  w: number;
}

const CATEGORY_LIFESTYLE_GUIDANCE: Record<HealthspanCategory, string[]> = {
  "Heart Health": ["Favor a Mediterranean-style eating pattern", "Build 150+ minutes/week of aerobic activity", "Review blood pressure, sleep, and stress with the full picture in mind"],
  "Hormone Balance": ["Protect sleep regularity", "Review energy availability and recovery load", "Retest abnormal hormone markers with appropriate timing/context"],
  Sleep: ["Anchor wake time consistently", "Protect light exposure in the morning and darkness at night", "Limit late caffeine and alcohol"],
  Inflammation: ["Prioritize recovery, sleep, and whole-food nutrition", "Reduce smoking and excessive alcohol exposure", "Retest after acute illness has resolved"],
  Metabolism: ["Prioritize fiber, protein, and post-meal movement", "Use resistance training and zone-2 work consistently", "Review fasting status and meal timing before future draws"],
  Recovery: ["Check hydration and electrolytes around training", "Match training load to sleep and soreness", "Use deloads when hard efforts stack up"],
  Cognition: ["Protect B-vitamin sufficiency and glucose stability", "Pair exercise with consistent sleep", "Retest if fatigue or brain fog are persistent"],
  Endurance: ["Check iron status and oxygen-carrying markers together", "Support fueling and recovery around training", "Review menstruation, donation, or GI losses when relevant"],
  Fitness: ["Support protein intake and resistance training", "Review total energy intake and recovery", "Pair hormonal markers with symptoms, not labs alone"],
  "Gut Health": ["Favor fiber diversity and minimally processed foods", "Review alcohol intake and meal regularity", "Track GI symptoms alongside metabolic markers"],
};

const RAW_CATALOGUE = (biomarkerFile as BiomarkerBundle).biomarkers;

const SUPPLEMENTAL_BIOMARKERS: BloodworkBiomarkerDefinition[] = [
  {
    id: "blood-urea-nitrogen",
    name: "Blood urea nitrogen",
    abbreviation: "BUN",
    aliases: ["Urea nitrogen", "BUN"],
    category: "Recovery",
    secondaryCategories: ["Metabolism"],
    unit: "mg/dL",
    specimenType: "serum",
    optimalRanges: [
      { sex: "all", ageMin: 20, ageMax: 120, low: 7, high: 20, source: "Clinical reference" },
    ],
    clinicalReferenceRanges: { adult: { low: 7, high: 20, unit: "mg/dL" } },
    physiologicalRole: "Blood urea nitrogen reflects nitrogen waste clearance and hydration context.",
    associatedHealthOutcomes: [{ outcome: "Kidney function and hydration status", direction: "high", evidence: "Clinical reference use" }],
    dietaryInterventions: [{ intervention: "Review hydration and protein load", effect: "normalizes", evidenceLevel: "moderate" }],
    supplementConsiderations: [],
    biomarkerInteractions: [{ interactsWith: "creatinine", relationship: "Interpret together for renal/hydration context" }],
    keyActions: ["Review hydration status", "Interpret with creatinine and recent protein intake"],
  },
  {
    id: "alkaline-phosphatase",
    name: "Alkaline phosphatase",
    abbreviation: "ALP",
    aliases: ["Alkaline phosphatase", "ALKP", "ALP"],
    category: "Recovery",
    secondaryCategories: ["Metabolism"],
    unit: "U/L",
    specimenType: "serum",
    optimalRanges: [
      { sex: "all", ageMin: 20, ageMax: 120, low: 44, high: 147, source: "Clinical reference" },
    ],
    clinicalReferenceRanges: { adult: { low: 44, high: 147, unit: "U/L" } },
    physiologicalRole: "ALP helps frame liver, biliary, and bone turnover context.",
    associatedHealthOutcomes: [{ outcome: "Liver/bone turnover context", direction: "high", evidence: "Clinical reference use" }],
    dietaryInterventions: [{ intervention: "Review alcohol load and overall liver-supportive nutrition", effect: "normalizes", evidenceLevel: "moderate" }],
    supplementConsiderations: [],
    biomarkerInteractions: [{ interactsWith: "GGT", relationship: "Interpret together for liver context" }],
    keyActions: ["Interpret with ALT, AST, and GGT", "Review alcohol, medications, and training context"],
  },
  {
    id: "lymphocyte-percentage",
    name: "Lymphocyte percentage",
    abbreviation: "LYMPH%",
    aliases: ["Lymphocyte %", "Lymphocyte percentage", "Lymphocytes %", "LYMPH%"],
    category: "Inflammation",
    secondaryCategories: ["Recovery"],
    unit: "%",
    specimenType: "whole blood",
    optimalRanges: [
      { sex: "all", ageMin: 20, ageMax: 120, low: 20, high: 40, source: "Clinical reference" },
    ],
    clinicalReferenceRanges: { adult: { low: 20, high: 40, unit: "%" } },
    physiologicalRole: "Lymphocyte percentage is a basic immune-balance marker.",
    associatedHealthOutcomes: [{ outcome: "Immune balance", direction: "low/high", evidence: "Clinical reference use" }],
    dietaryInterventions: [{ intervention: "Retest after acute illness or major training stress", effect: "normalizes", evidenceLevel: "moderate" }],
    supplementConsiderations: [],
    biomarkerInteractions: [{ interactsWith: "high-sensitivity-crp", relationship: "Adds inflammatory context" }],
    keyActions: ["Interpret with acute illness/training context", "Retest if markedly abnormal"],
  },
];

const KDM_COEFFICIENTS: Record<string, KdmParams> = {
  albumin: { k: 3.85, s: -0.012, w: 0.85 },
  creatinine: { k: 0.65, s: 0.008, w: 0.72 },
  glucose: { k: 72.0, s: 0.45, w: 0.68 },
  crp: { k: 0.30, s: 0.025, w: 0.55 },
  lymphocyte_pct: { k: 35.0, s: -0.18, w: 0.62 },
  mcv: { k: 82.0, s: 0.22, w: 0.70 },
  rdw: { k: 12.0, s: 0.035, w: 0.65 },
  alp: { k: 55.0, s: 0.55, w: 0.60 },
  bun: { k: 10.0, s: 0.12, w: 0.75 },
  ldl: { k: 85.0, s: 0.65, w: 0.70 },
  hdl: { k: 55.0, s: -0.25, w: 0.72 },
  total_cholesterol: { k: 165.0, s: 0.80, w: 0.68 },
  triglycerides: { k: 80.0, s: 1.20, w: 0.62 },
};

const KDM_MEDIANS: Record<string, number> = {
  albumin: 4.3,
  creatinine: 0.9,
  glucose: 95,
  crp: 1.5,
  lymphocyte_pct: 30,
  mcv: 90,
  rdw: 13.0,
  alp: 70,
  bun: 15,
  ldl: 110,
  hdl: 55,
  total_cholesterol: 190,
  triglycerides: 120,
};

const KDM_ALIASES: Record<string, string[]> = {
  albumin: ["albumin", "alb"],
  creatinine: ["creatinine", "cre"],
  glucose: ["glucose", "fasting glucose", "glu"],
  crp: ["high-sensitivity c-reactive protein", "high sensitivity c reactive protein", "hscrp", "hs-crp", "crp"],
  lymphocyte_pct: ["lymphocyte %", "lymphocyte percentage", "lymphocytes %", "lymph%", "lymph pct"],
  mcv: ["mcv", "mean corpuscular volume"],
  rdw: ["rdw", "red cell distribution width", "red blood cell distribution width"],
  alp: ["alkaline phosphatase", "alp", "alkp"],
  bun: ["blood urea nitrogen", "bun", "urea nitrogen"],
  ldl: ["ldl", "ldl cholesterol", "low density lipoprotein cholesterol"],
  hdl: ["hdl", "hdl cholesterol", "high density lipoprotein cholesterol"],
  total_cholesterol: ["total cholesterol", "cholesterol", "tc"],
  triglycerides: ["triglycerides", "tg"],
};

const COMBO_DEFINITIONS: ComboDefinition[] = [
  { name: "Albumin Combo", biomarkers: ["albumin", "calcium", "glucose", "ldl"] },
  { name: "Glucose + hsCRP", biomarkers: ["glucose", "crp"] },
  { name: "Metabolic Combo", biomarkers: ["glucose", "hba1c", "ldl", "triglycerides", "crp"] },
  { name: "Hormone Combo", biomarkers: ["free testosterone", "hba1c", "shbg"] },
];

function normalizeToken(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "").trim();
}

function coerceSex(value?: BiologicalSex | string): BiologicalSex {
  if (!value) {
    return "all";
  }
  const normalized = String(value).toLowerCase();
  if (normalized.startsWith("m")) {
    return "male";
  }
  if (normalized.startsWith("f")) {
    return "female";
  }
  return "all";
}

function toCategory(value: string): HealthspanCategory {
  return value as HealthspanCategory;
}

function normalizeCatalogueEntry(entry: Record<string, unknown>): BloodworkBiomarkerDefinition {
  const referenceRanges = Object.fromEntries(Object.entries((entry.clinical_reference_ranges as Record<string, any> | undefined) ?? {}).map(([key, range]) => [key, {
    low: range.low,
    high: range.high,
    unit: range.unit ?? String(entry.unit_of_measure ?? ""),
  }]));

  return {
    id: String(entry.id),
    name: String(entry.name),
    abbreviation: String(entry.abbreviation),
    aliases: ((entry.aliases as string[] | undefined) ?? []).filter(Boolean),
    category: toCategory(String(entry.category)),
    secondaryCategories: ((entry.secondary_categories as string[] | undefined) ?? []).map((item) => toCategory(String(item))),
    unit: String(entry.unit_of_measure ?? ""),
    specimenType: String(entry.specimen_type ?? ""),
    nhanesVariableCode: entry.nhanes_variable_code ? String(entry.nhanes_variable_code) : undefined,
    optimalRanges: ((entry.optimal_ranges as Array<Record<string, any>> | undefined) ?? []).map((range) => ({
      sex: coerceSex(range.sex),
      ageMin: Number(range.age_min ?? 0),
      ageMax: Number(range.age_max ?? 120),
      low: Number(range.low),
      high: Number(range.high),
      source: range.source ? String(range.source) : undefined,
    })),
    clinicalReferenceRanges: Object.keys(referenceRanges).length ? referenceRanges : undefined,
    physiologicalRole: entry.physiological_role ? String(entry.physiological_role).trim() : undefined,
    associatedHealthOutcomes: ((entry.associated_health_outcomes as Array<Record<string, any>> | undefined) ?? []).map((outcome) => ({
      outcome: String(outcome.outcome),
      direction: String(outcome.direction),
      evidence: outcome.evidence ? String(outcome.evidence) : undefined,
    })),
    dietaryInterventions: ((entry.dietary_interventions as Array<Record<string, any>> | undefined) ?? []).map((item) => ({
      intervention: String(item.intervention),
      effect: String(item.effect),
      evidenceLevel: item.evidence_level ? String(item.evidence_level) : undefined,
    })),
    supplementConsiderations: ((entry.supplement_considerations as Array<Record<string, any>> | undefined) ?? []).map((item) => ({
      supplement: String(item.supplement),
      effect: String(item.effect),
      dosage: item.dosage ? String(item.dosage) : undefined,
      evidenceLevel: item.evidence_level ? String(item.evidence_level) : undefined,
    })),
    biomarkerInteractions: ((entry.biomarker_interactions as Array<Record<string, any>> | undefined) ?? []).map((item) => ({
      interactsWith: String(item.interacts_with),
      relationship: item.relationship ? String(item.relationship) : undefined,
    })),
    keyActions: ((entry.key_actions as string[] | undefined) ?? []).map(String),
  };
}

const BLOODWORK_CATALOGUE = [...RAW_CATALOGUE.map(normalizeCatalogueEntry), ...SUPPLEMENTAL_BIOMARKERS];

const BLOODWORK_LOOKUP = new Map<string, BloodworkBiomarkerDefinition>();
for (const biomarker of BLOODWORK_CATALOGUE) {
  const tokens = new Set([
    biomarker.id,
    biomarker.name,
    biomarker.abbreviation,
    ...(biomarker.aliases ?? []),
    biomarker.id.replace(/-/g, " "),
  ].map(normalizeToken));

  if (biomarker.id === "high-sensitivity-crp") {
    tokens.add(normalizeToken("hsCRP"));
    tokens.add(normalizeToken("CRP"));
  }
  if (biomarker.id === "hemoglobin-a1c") {
    tokens.add(normalizeToken("A1c"));
    tokens.add(normalizeToken("HbA1c"));
  }
  if (biomarker.id === "free-testosterone") {
    tokens.add(normalizeToken("free testosterone"));
    tokens.add(normalizeToken("free t"));
  }

  for (const token of tokens) {
    BLOODWORK_LOOKUP.set(token, biomarker);
  }
}

const KDM_BASELINE_RAW_AGE = computeRawKdmAge(KDM_MEDIANS);

function getPrimaryClinicalRange(definition: BloodworkBiomarkerDefinition): ClinicalReferenceRange | undefined {
  return definition.clinicalReferenceRanges?.adult ?? Object.values(definition.clinicalReferenceRanges ?? {})[0];
}

function selectOptimalRange(definition: BloodworkBiomarkerDefinition, age?: number, sex: BiologicalSex = "all") {
  const candidateAge = age ?? 40;
  const normalizedSex = coerceSex(sex);
  return definition.optimalRanges.find((range) => (range.sex === normalizedSex || range.sex === "all") && candidateAge >= range.ageMin && candidateAge <= range.ageMax)
    ?? definition.optimalRanges.find((range) => range.sex === normalizedSex)
    ?? definition.optimalRanges.find((range) => range.sex === "all")
    ?? definition.optimalRanges[0];
}

function evaluateStatus(value: number, optimalRange?: BiomarkerOptimalRange, clinicalRange?: ClinicalReferenceRange) {
  const low = optimalRange?.low ?? clinicalRange?.low;
  const high = optimalRange?.high ?? clinicalRange?.high;

  if (typeof low !== "number" && typeof high !== "number") {
    return { status: "unknown" as const, deviation: 0 };
  }
  if (typeof low === "number" && value < low) {
    return { status: "low" as const, deviation: round(value - low, 2) };
  }
  if (typeof high === "number" && value > high) {
    return { status: "high" as const, deviation: round(value - high, 2) };
  }
  return { status: "optimal" as const, deviation: 0 };
}

function severityForBiomarker(biomarker: EvaluatedLabBiomarker): number {
  if (biomarker.status === "optimal" || biomarker.status === "unknown") {
    return 0;
  }
  const range = biomarker.optimalRange;
  const span = range ? Math.max(range.high - range.low, 1) : 1;
  return Math.abs(biomarker.deviation ?? 0) / span;
}

function inferPriority(biomarker: EvaluatedLabBiomarker): BloodworkActionPlanItem["priority"] {
  const severity = severityForBiomarker(biomarker);
  if (severity >= 0.5) {
    return "high";
  }
  if (severity >= 0.15) {
    return "medium";
  }
  return "low";
}

function buildActionPlan(evaluated: EvaluatedLabBiomarker[]): BloodworkActionPlanItem[] {
  return evaluated
    .filter((biomarker) => biomarker.status === "low" || biomarker.status === "high")
    .sort((left, right) => severityForBiomarker(right) - severityForBiomarker(left))
    .slice(0, 8)
    .map((biomarker) => {
      const definition = getBloodworkBiomarker(biomarker.id)!;
      return {
        biomarkerId: biomarker.id,
        biomarkerName: biomarker.name,
        category: biomarker.category,
        priority: inferPriority(biomarker),
        issue: biomarker.status === "low"
          ? `${biomarker.name} is below the selected optimal zone`
          : `${biomarker.name} is above the selected optimal zone`,
        nutrition: definition.dietaryInterventions?.slice(0, 3).map((item) => item.intervention) ?? definition.keyActions.slice(0, 2),
        supplements: definition.supplementConsiderations?.slice(0, 2).map((item) => item.dosage ? `${item.supplement} (${item.dosage})` : item.supplement) ?? [],
        lifestyle: CATEGORY_LIFESTYLE_GUIDANCE[biomarker.category].slice(0, 2),
        rationale: definition.associatedHealthOutcomes?.[0]?.outcome,
      };
    });
}

function computeCategoryScores(evaluated: EvaluatedLabBiomarker[]): BloodworkCategoryScore[] {
  const byCategory = evaluated.reduce<Record<string, EvaluatedLabBiomarker[]>>((acc, biomarker) => {
    acc[biomarker.category] ??= [];
    acc[biomarker.category].push(biomarker);
    return acc;
  }, {});

  return Object.entries(byCategory)
    .map(([category, biomarkers]) => {
      const optimalCount = biomarkers.filter((item) => item.status === "optimal").length;
      return {
        category: category as HealthspanCategory,
        score: Math.max(1, Math.min(10, Math.round((optimalCount / Math.max(biomarkers.length, 1)) * 10))),
        optimalCount,
        biomarkersConsidered: biomarkers.length,
        flaggedBiomarkers: biomarkers.filter((item) => item.status === "low" || item.status === "high").map((item) => item.abbreviation),
      };
    })
    .sort((left, right) => left.category.localeCompare(right.category));
}

function resolveKdmValue(input: Record<string, number>, key: string) {
  const aliases = KDM_ALIASES[key] ?? [key];
  for (const alias of aliases) {
    const token = normalizeToken(alias);
    const found = Object.entries(input).find(([entryKey]) => normalizeToken(entryKey) === token);
    if (found) {
      return found[1];
    }
  }
  return undefined;
}

function computeRawKdmAge(values: Record<string, number>) {
  let weightedAge = 0;
  let weightSum = 0;
  for (const [key, params] of Object.entries(KDM_COEFFICIENTS)) {
    const value = values[key];
    if (typeof value !== "number") {
      continue;
    }
    const impliedAge = (value - params.k) / params.s;
    weightedAge += impliedAge * params.w;
    weightSum += params.w;
  }
  return weightSum ? weightedAge / weightSum : 40;
}

function computeComboSignals(values: Record<string, number>): BloodworkComboSignal[] {
  return COMBO_DEFINITIONS.map((combo) => {
    const present = combo.biomarkers.filter((marker) => values[marker] !== undefined);
    const ratio = present.length / combo.biomarkers.length;
    if (!present.length) {
      return {
        name: combo.name,
        biomarkers: combo.biomarkers,
        status: "watch",
        summary: "Insufficient biomarkers logged to score this combination yet.",
      };
    }

    const stress = present.reduce((acc, marker) => {
      const value = values[marker];
      if (typeof value !== "number") {
        return acc;
      }
      const median = KDM_MEDIANS[marker as keyof typeof KDM_MEDIANS] ?? value;
      const relative = Math.abs(value - median) / Math.max(Math.abs(median), 1);
      return acc + relative;
    }, 0) / present.length;

    const status: BloodworkComboSignal["status"] = ratio < 0.5
      ? "watch"
      : stress > 0.25
        ? "needs-attention"
        : stress > 0.1
          ? "watch"
          : "low-risk";

    return {
      name: combo.name,
      biomarkers: combo.biomarkers,
      status,
      summary: status === "low-risk"
        ? `${combo.name} looks relatively stable from the available biomarkers.`
        : status === "needs-attention"
          ? `${combo.name} is carrying multiple above-baseline signals and deserves review.`
          : `${combo.name} has partial or mildly mixed signal coverage.`,
    };
  });
}

function calculateBiologicalAgeFromEntries(entries: EvaluatedLabBiomarker[], input: AnalyzeBloodworkInput): BloodworkBiologicalAge {
  const inputValues = Object.fromEntries(entries.map((entry) => [entry.name, entry.value]));
  const normalizedValues: Record<string, number> = {};
  const imputedBiomarkers: string[] = [];
  let providedCount = 0;

  for (const key of Object.keys(KDM_COEFFICIENTS)) {
    const found = resolveKdmValue(inputValues, key)
      ?? resolveKdmValue(Object.fromEntries(entries.map((entry) => [entry.abbreviation, entry.value])), key)
      ?? resolveKdmValue(Object.fromEntries(entries.map((entry) => [entry.id, entry.value])), key);

    if (typeof found === "number" && Number.isFinite(found)) {
      normalizedValues[key] = found;
      providedCount += 1;
    } else {
      normalizedValues[key] = KDM_MEDIANS[key];
      imputedBiomarkers.push(key);
    }
  }

  const rawAge = computeRawKdmAge(normalizedValues);
  const chronologicalAge = input.chronologicalAge ?? input.age;
  const baseAge = chronologicalAge ?? 40;
  const ageDelta = round((rawAge - KDM_BASELINE_RAW_AGE) * 0.45, 1);
  const biologicalAge = round(Math.max(18, Math.min(95, baseAge + ageDelta)), 1);

  return {
    method: "kdm-style-clinical-clock",
    biologicalAge,
    chronologicalAge,
    ageDelta: chronologicalAge !== undefined ? round(biologicalAge - chronologicalAge, 1) : ageDelta,
    imputedBiomarkers,
    coverage: round(providedCount / Object.keys(KDM_COEFFICIENTS).length, 2),
    comboSignals: computeComboSignals(normalizedValues),
    notes: [
      "Uses BloodWork-inspired NHANES-style coefficients with median imputation for missing biomarkers.",
      "This is a transparent KDM-style clinical estimate for educational planning, not a medical diagnosis.",
    ],
  };
}

function numericValue(biomarker: LabBiomarker) {
  const value = typeof biomarker.value === "number" ? biomarker.value : Number(biomarker.value);
  return Number.isFinite(value) ? value : null;
}

export function getBloodworkBiomarkers(params?: { category?: string; query?: string }) {
  return BLOODWORK_CATALOGUE.filter((entry) => (!params?.category || entry.category === params.category) && (!params?.query || [entry.id, entry.name, entry.abbreviation, ...(entry.aliases ?? [])].some((item) => item.toLowerCase().includes(params.query!.toLowerCase()))));
}

export function getBloodworkBiomarker(query: string) {
  return BLOODWORK_LOOKUP.get(normalizeToken(query)) ?? null;
}

export function evaluateBloodworkBiomarkers(result: LabResult, input: AnalyzeBloodworkInput = {}): EvaluatedLabBiomarker[] {
  const evaluated: EvaluatedLabBiomarker[] = [];
  const sex = coerceSex(input.sex);
  const age = input.age ?? input.chronologicalAge;

  for (const panel of result.panels) {
    for (const biomarker of panel.biomarkers) {
      const value = numericValue(biomarker);
      if (value === null) {
        continue;
      }
      const definition = getBloodworkBiomarker(biomarker.name);
      if (!definition) {
        continue;
      }
      const optimalRange = selectOptimalRange(definition, age, sex);
      const clinicalRange = getPrimaryClinicalRange(definition) ?? ((typeof biomarker.referenceRangeLow === "number" || typeof biomarker.referenceRangeHigh === "number")
        ? { low: biomarker.referenceRangeLow, high: biomarker.referenceRangeHigh, unit: biomarker.unit }
        : undefined);
      const { status, deviation } = evaluateStatus(value, optimalRange, clinicalRange);
      evaluated.push({
        id: definition.id,
        name: definition.name,
        abbreviation: definition.abbreviation,
        category: definition.category,
        value,
        unit: biomarker.unit || definition.unit,
        status,
        optimalRange,
        clinicalRange,
        deviation,
        supportingActions: [
          ...definition.keyActions.slice(0, 2),
          ...(definition.dietaryInterventions?.slice(0, 2).map((item) => item.intervention) ?? []),
        ].slice(0, 4),
      });
    }
  }

  return evaluated;
}

export function analyzeBloodwork(result: LabResult, input: AnalyzeBloodworkInput = {}): BloodworkAnalysis {
  const evaluatedBiomarkers = evaluateBloodworkBiomarkers(result, input);
  const categoryScores = computeCategoryScores(evaluatedBiomarkers);
  const actionPlan = buildActionPlan(evaluatedBiomarkers);
  const biologicalAge = calculateBiologicalAgeFromEntries(evaluatedBiomarkers, input);
  const flagged = evaluatedBiomarkers.filter((item) => item.status === "low" || item.status === "high");
  const strongestCategory = categoryScores.slice().sort((left, right) => right.score - left.score)[0];
  const weakestCategory = categoryScores.slice().sort((left, right) => left.score - right.score)[0];

  return {
    resultId: result.id,
    evaluatedBiomarkers,
    categoryScores,
    actionPlan,
    biologicalAge,
    overallSummary: flagged.length
      ? `${flagged.length} biomarkers are outside the selected optimal zone. Strongest category: ${strongestCategory?.category ?? "n/a"}; most attention needed: ${weakestCategory?.category ?? "n/a"}.`
      : `All ${evaluatedBiomarkers.length} matched biomarkers sit inside the selected optimal zones. Strongest category: ${strongestCategory?.category ?? "n/a"}.`,
  };
}

export function calculateBiologicalAge(result: LabResult, input: AnalyzeBloodworkInput = {}) {
  return calculateBiologicalAgeFromEntries(evaluateBloodworkBiomarkers(result, input), input);
}

export function buildBloodworkActionPlan(result: LabResult, input: AnalyzeBloodworkInput = {}) {
  return analyzeBloodwork(result, input).actionPlan;
}

export function getBloodworkCategoryScores(result: LabResult, input: AnalyzeBloodworkInput = {}) {
  return analyzeBloodwork(result, input).categoryScores;
}
