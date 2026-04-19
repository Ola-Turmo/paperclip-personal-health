import { detectDnaSource } from "./dna.js";
import type {
  BiologicalSex,
  BloodworkClockMethod,
  DnaSettings,
  HealthPrivacyPolicy,
  LabPanel,
  MacroTargets,
} from "./types.js";

export class ValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ValidationError";
  }
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function expectObject(value: unknown, label = "params"): Record<string, unknown> {
  if (!isObject(value)) {
    throw new ValidationError(`${label} must be an object.`);
  }
  return value;
}

export function expectString(value: unknown, label: string, options?: { min?: number; max?: number }) {
  if (typeof value !== "string") {
    throw new ValidationError(`${label} must be a string.`);
  }
  const trimmed = value.trim();
  if ((options?.min ?? 1) > 0 && trimmed.length < (options?.min ?? 1)) {
    throw new ValidationError(`${label} must be at least ${(options?.min ?? 1)} characters.`);
  }
  if (options?.max && trimmed.length > options.max) {
    throw new ValidationError(`${label} must be at most ${options.max} characters.`);
  }
  return trimmed;
}

export function optionalString(value: unknown, label: string, options?: { max?: number }) {
  if (value === undefined || value === null || value === "") {
    return undefined;
  }
  return expectString(value, label, { min: 0, max: options?.max });
}

export function expectNumber(value: unknown, label: string, options?: { min?: number; max?: number }) {
  const num = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(num)) {
    throw new ValidationError(`${label} must be a number.`);
  }
  if (options?.min !== undefined && num < options.min) {
    throw new ValidationError(`${label} must be at least ${options.min}.`);
  }
  if (options?.max !== undefined && num > options.max) {
    throw new ValidationError(`${label} must be at most ${options.max}.`);
  }
  return num;
}

export function optionalNumber(value: unknown, label: string, options?: { min?: number; max?: number }) {
  if (value === undefined || value === null || value === "") {
    return undefined;
  }
  return expectNumber(value, label, options);
}

export function expectBoolean(value: unknown, label: string) {
  if (typeof value !== "boolean") {
    throw new ValidationError(`${label} must be a boolean.`);
  }
  return value;
}

export function optionalBoolean(value: unknown, label: string) {
  if (value === undefined || value === null) {
    return undefined;
  }
  return expectBoolean(value, label);
}

export function expectEnum<T extends string>(value: unknown, label: string, options: readonly T[]) {
  if (typeof value !== "string" || !options.includes(value as T)) {
    throw new ValidationError(`${label} must be one of: ${options.join(", ")}.`);
  }
  return value as T;
}

export function optionalEnum<T extends string>(value: unknown, label: string, options: readonly T[]) {
  if (value === undefined || value === null || value === "") {
    return undefined;
  }
  return expectEnum(value, label, options);
}

export function expectArray(value: unknown, label: string, options?: { max?: number }) {
  if (!Array.isArray(value)) {
    throw new ValidationError(`${label} must be an array.`);
  }
  if (options?.max !== undefined && value.length > options.max) {
    throw new ValidationError(`${label} must contain at most ${options.max} items.`);
  }
  return value;
}

export function validateMacroTargets(value: unknown): MacroTargets {
  const obj = expectObject(value, "macroTargets");
  return {
    proteinGrams: expectNumber(obj.proteinGrams, "macroTargets.proteinGrams", { min: 0, max: 500 }),
    carbGrams: expectNumber(obj.carbGrams, "macroTargets.carbGrams", { min: 0, max: 800 }),
    fatGrams: expectNumber(obj.fatGrams, "macroTargets.fatGrams", { min: 0, max: 300 }),
    fiberGrams: optionalNumber(obj.fiberGrams, "macroTargets.fiberGrams", { min: 0, max: 150 }),
  };
}

export function validateDnaImportParams(value: unknown) {
  const obj = expectObject(value);
  const rawData = expectString(obj.rawData ?? obj.rawFileContent, "rawData", { max: 1_500_000 });
  const fileName = optionalString(obj.fileName, "fileName", { max: 240 });
  const source = detectDnaSource(rawData, fileName);
  if (source === "other") {
    throw new ValidationError("DNA import must be a supported 23andMe, AncestryDNA, LivingDNA-style delimited, or VCF export.");
  }
  if (!rawData.includes("\n")) {
    throw new ValidationError("DNA import appears malformed: expected multiple lines of raw genotype data.");
  }
  const lines = rawData.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const normalizeHeader = (line: string) => line.split(/[\t,]/).map((part) => part.toLowerCase().replace(/[^a-z0-9]+/g, ""));
  const firstNonComment = lines.find((line) => !line.startsWith("#")) ?? "";
  const headers = normalizeHeader(firstNonComment);
  const hasHeaders = (...expected: string[]) => expected.every((column) => headers.includes(column));
  const dataLines = lines.filter((line) => !line.startsWith("#"));

  if (source === "vcf") {
    const hasFileFormat = lines.some((line) => line.toLowerCase().startsWith("##fileformat=vcf"));
    const hasColumnHeader = lines.some((line) => line.startsWith("#CHROM\tPOS\tID\tREF\tALT"));
    if (!hasFileFormat || !hasColumnHeader || dataLines.length < 1) {
      throw new ValidationError("VCF import appears malformed: expected VCF headers plus at least one variant row.");
    }
  } else if (source === "ancestrydna") {
    if (!hasHeaders("rsid", "chromosome", "position", "allele1", "allele2") || dataLines.length < 2) {
      throw new ValidationError("AncestryDNA import appears malformed: expected rsid/chromosome/position/allele1/allele2 columns with at least one genotype row.");
    }
  } else if (source === "23andme") {
    if (!hasHeaders("rsid", "chromosome", "position", "genotype") || dataLines.length < 2) {
      throw new ValidationError("23andMe import appears malformed: expected rsid/chromosome/position/genotype columns with at least one genotype row.");
    }
  } else if (source === "livedna") {
    const hasDelimHeaders = hasHeaders("rsid", "chromosome", "position") && headers.some((column) => ["result", "genotype", "call"].includes(column));
    if (!hasDelimHeaders || dataLines.length < 2) {
      throw new ValidationError("LivingDNA-style import appears malformed: expected rsid/chromosome/position plus result/genotype/call columns with at least one genotype row.");
    }
  }
  return {
    rawData,
    fileName,
    notes: optionalString(obj.notes, "notes", { max: 2000 }),
    privacyMode: optionalEnum(obj.privacyMode, "privacyMode", ["living", "privacy"]),
  };
}

export function validateLabPanels(value: unknown): LabPanel[] {
  const panels = expectArray(value, "panels", { max: 25 });
  return panels.map((panel, panelIndex) => {
    const panelObj = expectObject(panel, `panels[${panelIndex}]`);
    const biomarkers = expectArray(panelObj.biomarkers, `panels[${panelIndex}].biomarkers`, { max: 100 });
    return {
      name: expectString(panelObj.name, `panels[${panelIndex}].name`, { max: 120 }),
      biomarkers: biomarkers.map((entry, biomarkerIndex) => {
        const biomarkerObj = expectObject(entry, `panels[${panelIndex}].biomarkers[${biomarkerIndex}]`);
        return {
          name: expectString(biomarkerObj.name, `panels[${panelIndex}].biomarkers[${biomarkerIndex}].name`, { max: 160 }),
          value: expectNumber(biomarkerObj.value, `panels[${panelIndex}].biomarkers[${biomarkerIndex}].value`, { min: -100_000, max: 100_000 }),
          unit: expectString(biomarkerObj.unit, `panels[${panelIndex}].biomarkers[${biomarkerIndex}].unit`, { max: 40 }),
          referenceRangeLow: optionalNumber(biomarkerObj.referenceRangeLow, `panels[${panelIndex}].biomarkers[${biomarkerIndex}].referenceRangeLow`),
          referenceRangeHigh: optionalNumber(biomarkerObj.referenceRangeHigh, `panels[${panelIndex}].biomarkers[${biomarkerIndex}].referenceRangeHigh`),
          outOfRange: optionalBoolean(biomarkerObj.outOfRange, `panels[${panelIndex}].biomarkers[${biomarkerIndex}].outOfRange`),
        };
      }),
    };
  });
}

export function validateLabResultParams(value: unknown) {
  const obj = expectObject(value);
  return {
    labName: expectString(obj.labName, "labName", { max: 160 }),
    resultedAt: optionalString(obj.resultedAt, "resultedAt", { max: 80 }),
    panels: validateLabPanels(obj.panels),
    notes: optionalString(obj.notes, "notes", { max: 2000 }),
  };
}

export function validateLabImportParams(value: unknown) {
  const obj = expectObject(value);
  const rawData = expectString(obj.rawData, "rawData", { max: 1_000_000 });
  if (!rawData.includes("\n")) {
    throw new ValidationError("Lab import must include multiple lines of delimited or line-based results.");
  }
  return {
    rawData,
    fileName: optionalString(obj.fileName, "fileName", { max: 240 }),
    labName: optionalString(obj.labName, "labName", { max: 160 }),
    resultedAt: optionalString(obj.resultedAt, "resultedAt", { max: 80 }),
    defaultPanelName: optionalString(obj.defaultPanelName, "defaultPanelName", { max: 120 }),
    notes: optionalString(obj.notes, "notes", { max: 2000 }),
  };
}

export function validatePrivacySettingsUpdate(value: unknown): Partial<DnaSettings & HealthPrivacyPolicy> {
  const obj = expectObject(value);
  return {
    privacyMode: optionalEnum(obj.privacyMode, "privacyMode", ["living", "privacy"]),
    allowSensitiveExports: optionalBoolean(obj.allowSensitiveExports, "allowSensitiveExports"),
    allowAncestryInference: optionalBoolean(obj.allowAncestryInference, "allowAncestryInference"),
    retainVariantLevelData: optionalBoolean(obj.retainVariantLevelData, "retainVariantLevelData"),
    ambientDetailLevel: optionalEnum(obj.ambientDetailLevel, "ambientDetailLevel", ["generic", "detailed"]),
    requireSensitiveConfirmation: optionalBoolean(obj.requireSensitiveConfirmation, "requireSensitiveConfirmation"),
    geneticsEnabled: optionalBoolean(obj.geneticsEnabled, "geneticsEnabled"),
    auditRetentionDays: optionalNumber(obj.auditRetentionDays, "auditRetentionDays", { min: 1, max: 365 }),
  };
}

export function validateSensitiveConfirmation(value: unknown, label = "confirmSensitive") {
  if (value !== true) {
    throw new ValidationError(`${label} must be true for this sensitive operation.`);
  }
  return true;
}

export function validateBloodworkAnalysisInput(value: unknown) {
  const obj = expectObject(value ?? {});
  return {
    labResultId: optionalString(obj.labResultId, "labResultId", { max: 80 }),
    age: optionalNumber(obj.age, "age", { min: 0, max: 120 }),
    chronologicalAge: optionalNumber(obj.chronologicalAge, "chronologicalAge", { min: 0, max: 120 }),
    sex: optionalEnum(obj.sex, "sex", ["male", "female", "all"] satisfies readonly BiologicalSex[]),
    clockMethod: optionalEnum(obj.clockMethod, "clockMethod", ["kdm-style-clinical-clock"] satisfies readonly BloodworkClockMethod[]),
  };
}

export function validateRecordConsentParams(value: unknown) {
  const obj = expectObject(value);
  return {
    action: optionalString(obj.action, "action", { max: 160 }),
    scope: expectEnum(obj.scope, "scope", ["dna-access", "dna-export", "audit-log-access", "consent-log-access", "dna-reanalysis", "privacy-change"] as const),
    detail: expectString(obj.detail, "detail", { max: 500 }),
    reportId: optionalString(obj.reportId, "reportId", { max: 80 }),
    reason: optionalString(obj.reason, "reason", { max: 500 }),
  };
}

export function validateMedicationParams(value: unknown) {
  const obj = expectObject(value);
  return {
    name: expectString(obj.name, "name", { max: 160 }),
    dose: expectString(obj.dose ?? "", "dose", { min: 0, max: 80 }),
    frequency: expectString(obj.frequency ?? "daily", "frequency", { min: 1, max: 80 }),
    times: Array.isArray(obj.times)
      ? obj.times.map((time, index) => expectString(time, `times[${index}]`, { max: 16 }))
      : [],
    active: obj.active === undefined ? true : expectBoolean(obj.active, "active"),
  };
}

export function validateAppointmentParams(value: unknown) {
  const obj = expectObject(value);
  return {
    type: expectString(obj.type ?? "general", "type", { max: 120 }),
    provider: expectString(obj.provider ?? "", "provider", { min: 0, max: 160 }),
    scheduledAt: optionalString(obj.scheduledAt, "scheduledAt", { max: 80 }),
    durationMinutes: optionalNumber(obj.durationMinutes, "durationMinutes", { min: 5, max: 1_440 }),
    notes: optionalString(obj.notes, "notes", { max: 2000 }),
    prepNotes: optionalString(obj.prepNotes, "prepNotes", { max: 2000 }),
  };
}

export function validateWorkoutParams(value: unknown) {
  const obj = expectObject(value);
  return {
    name: expectString(obj.name ?? "Workout", "name", { max: 160 }),
    type: optionalString(obj.type, "type", { max: 40 }),
    performedAt: optionalString(obj.performedAt, "performedAt", { max: 80 }),
    durationMinutes: expectNumber(obj.durationMinutes ?? 0, "durationMinutes", { min: 0, max: 2_000 }),
    rpe: optionalNumber(obj.rpe, "rpe", { min: 0, max: 10 }),
    caloriesBurned: optionalNumber(obj.caloriesBurned, "caloriesBurned", { min: 0, max: 20_000 }),
    distanceKm: optionalNumber(obj.distanceKm, "distanceKm", { min: 0, max: 1_000 }),
    avgPaceMinPerKm: optionalNumber(obj.avgPaceMinPerKm, "avgPaceMinPerKm", { min: 0, max: 60 }),
    avgHeartRate: optionalNumber(obj.avgHeartRate, "avgHeartRate", { min: 0, max: 250 }),
    maxHeartRate: optionalNumber(obj.maxHeartRate, "maxHeartRate", { min: 0, max: 250 }),
    elevationGainM: optionalNumber(obj.elevationGainM, "elevationGainM", { min: 0, max: 20_000 }),
    notes: optionalString(obj.notes, "notes", { max: 2000 }),
  };
}
