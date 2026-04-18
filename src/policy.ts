import type {
  DnaReport,
  DnaSettings,
  HealthAuditEntry,
  HealthNudge,
  HealthPrivacyPolicy,
} from "./types.js";
import { generateId, toIsoDateTime } from "./utils.js";

export const DEFAULT_DNA_SETTINGS: DnaSettings = {
  preferredReportSource: "genetichealth",
  privacyMode: "living",
  researchOptIn: true,
  allowAncestryInference: true,
  allowSensitiveExports: false,
  retainVariantLevelData: true,
  ambientDetailLevel: "generic",
};

export const DEFAULT_HEALTH_POLICY: HealthPrivacyPolicy = {
  privacyMode: "living",
  allowSensitiveExports: false,
  allowAncestryInference: true,
  retainVariantLevelData: true,
  requireSensitiveConfirmation: true,
  geneticsEnabled: true,
  ambientDetailLevel: "generic",
  auditRetentionDays: 30,
};

export function derivePolicy(settings?: Partial<DnaSettings>): HealthPrivacyPolicy {
  const merged = { ...DEFAULT_DNA_SETTINGS, ...settings };
  return {
    ...DEFAULT_HEALTH_POLICY,
    privacyMode: merged.privacyMode,
    allowSensitiveExports: Boolean(merged.allowSensitiveExports),
    allowAncestryInference: merged.privacyMode === "living" && Boolean(merged.allowAncestryInference),
    retainVariantLevelData: merged.privacyMode === "living" && Boolean(merged.retainVariantLevelData),
    ambientDetailLevel: merged.privacyMode === "privacy" ? "generic" : (merged.ambientDetailLevel ?? "generic"),
  };
}

export function redactNudgeMessage(nudge: HealthNudge, policy: HealthPrivacyPolicy) {
  if (policy.ambientDetailLevel === "detailed" && policy.privacyMode === "living") {
    return nudge.message;
  }

  switch (nudge.category) {
    case "medication":
      return "A medication follow-up is available in your Personal Health plugin.";
    case "appointment":
      return "An upcoming health appointment has a prep checklist available.";
    case "dna":
      return "A genetics follow-up insight is available in your Personal Health plugin.";
    default:
      return nudge.message;
  }
}

export function canAccessSensitiveDna({
  report,
  policy,
  confirmed,
}: {
  report?: DnaReport | null;
  policy: HealthPrivacyPolicy;
  confirmed?: boolean;
}) {
  if (!report || !report.isPrivacyRestricted) {
    return true;
  }
  return !policy.requireSensitiveConfirmation || Boolean(confirmed);
}

export function canExportSensitiveDna({
  report,
  policy,
  includeSensitive,
  confirmed,
}: {
  report?: DnaReport | null;
  policy: HealthPrivacyPolicy;
  includeSensitive?: boolean;
  confirmed?: boolean;
}) {
  if (!includeSensitive) {
    return true;
  }
  if (!policy.allowSensitiveExports) {
    return false;
  }
  if (!report) {
    return false;
  }
  return !policy.requireSensitiveConfirmation || Boolean(confirmed);
}

export function createAuditEntry(input: {
  action: string;
  category: HealthAuditEntry["category"];
  detail: string;
  sensitivity?: HealthAuditEntry["sensitivity"];
  success: boolean;
}): HealthAuditEntry {
  return {
    id: generateId(),
    createdAt: toIsoDateTime(),
    action: input.action,
    category: input.category,
    detail: input.detail,
    sensitivity: input.sensitivity ?? "moderate",
    success: input.success,
  };
}

export function pruneAuditLog(entries: HealthAuditEntry[], retentionDays: number) {
  const threshold = Date.now() - retentionDays * 86_400_000;
  return entries.filter((entry) => new Date(entry.createdAt).getTime() >= threshold);
}

export function summarizePrivacyStatus(settings: DnaSettings, policy: HealthPrivacyPolicy) {
  return {
    settings,
    policy,
    summary:
      policy.privacyMode === "privacy"
        ? "Privacy mode is active: ancestry inference, detailed ambient genetics, and variant-level retention are minimized."
        : "Living mode is active: richer genetics analysis is available, but sensitive exports still require explicit confirmation.",
  };
}
