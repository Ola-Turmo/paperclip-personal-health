import { definePlugin, runWorker } from "@paperclipai/plugin-sdk";
import { ACTION_KEYS, DATA_KEYS } from "./constants.js";
import {
  annotateVariant,
  correlateDnaWithBloodwork,
  compareDnaReports,
  createDnaReport,
  exportComprehensiveDnaMarkdown,
  exportDnaInsightsMarkdown,
  findFoodMatches,
  getFoodDetail,
  findVariantDetail,
  getAnnotationIndex,
  getCarrierStatus,
  getDnaKnowledgeBaseStatus,
  getMonitoringPlan,
  getPriorityFindings,
  getProtectiveVariants,
  getSupplementRecommendations,
  lookupRsidAcrossReports,
  minimizeDnaReport,
  reanalyzeDnaReport,
  summarizeDiseaseRisks,
  summarizeGeneticPathways,
  summarizePharmacogenomics,
  summarizeReport,
  summarizeTraits,
} from "./dna.js";
import {
  analyzeBloodwork,
  buildBloodworkActionPlan,
  getBloodworkClockDescriptors,
  calculateBiologicalAge,
  getBloodworkBiomarker,
  getBloodworkBiomarkers,
  getBloodworkCategoryScores,
  getBloodworkTrends,
} from "./bloodwork.js";
import { buildImportedLabResult, previewLabImport } from "./bloodwork-import.js";
import type {
  Appointment,
  DailyHealthSummary,
  HealthAuditEntry,
  HealthConsentEntry,
  DnaReport,
  DnaSettings,
  Habit,
  HabitCompletion,
  HealthNudge,
  HealthPrivacyPolicy,
  HydrationEntry,
  HydrationLog,
  LabResult,
  MacroTargets,
  MealLog,
  MealPlan,
  Medication,
  MedicationLog,
  RecoveryStatus,
  RefillLog,
  SleepEntry,
  Supplement,
  SupplementLog,
  SymptomEntry,
  WearableSyncStatus,
  WorkoutLog,
  WorkoutPlan,
} from "./types.js";
import {
  DEFAULT_DNA_SETTINGS,
  createAuditEntry,
  redactNudgeMessage,
  derivePolicy,
  canExportSensitiveDna,
  canAccessSensitiveDna,
  pruneAuditLog,
  summarizePrivacyStatus,
} from "./policy.js";
import {
  buildLatestDnaProjection,
  buildLatestLabProjection,
  buildNutritionOverview,
  buildPendingReminderProjection,
  buildPrivacyProjection,
  buildWorkoutOverview,
} from "./projections.js";
import {
  appendArrayItem,
  average,
  computeHabitStreaks,
  computeHydrationTotal,
  computeLabTrendSummary,
  computeNutritionSummary,
  computeRecoveryRecommendation,
  computeSleepSummary,
  computeWorkoutPlanForWeek,
  computeWorkoutSummary,
  generateId,
  getArrayState,
  getStateValue,
  mergeMacroTargets,
  parseRangeWindow,
  removeById,
  replaceById,
  setArrayState,
  setStateValue,
  toIsoDate,
  toIsoDateTime,
  withinRange,
} from "./utils.js";
import {
  ValidationError,
  validateAppointmentParams,
  validateBloodworkAnalysisInput,
  validateDnaImportParams,
  validateLabImportParams,
  validateLabResultParams,
  validateMedicationParams,
  validatePrivacySettingsUpdate,
  validateRecordConsentParams,
  validateSensitiveConfirmation,
  validateWorkoutParams,
} from "./validation.js";

const DEFAULT_HYDRATION_GOAL_ML = 2500;

function computeMealCalories(foods: Array<{ calories?: number }>) {
  return foods.reduce((acc, food) => acc + (food.calories ?? 0), 0);
}

function computeMealMacros(foods: Array<Partial<MacroTargets> & { fiberGrams?: number }>): MacroTargets | undefined {
  if (!foods.length) {
    return undefined;
  }

  return mergeMacroTargets(foods.map((food) => ({
    proteinGrams: food.proteinGrams ?? 0,
    carbGrams: food.carbGrams ?? 0,
    fatGrams: food.fatGrams ?? 0,
    fiberGrams: food.fiberGrams ?? 0,
  })));
}

function workoutSourceFromDevice(device?: string): WorkoutLog["source"] {
  switch (String(device ?? "").toLowerCase()) {
    case "apple-health":
    case "garmin":
    case "oura":
    case "whoop":
    case "strava":
      return String(device).toLowerCase() as WorkoutLog["source"];
    default:
      return "manual";
  }
}

function recoverySourceFromDevice(device?: string): RecoveryStatus["source"] {
  switch (String(device ?? "").toLowerCase()) {
    case "garmin":
    case "oura":
    case "whoop":
      return String(device).toLowerCase() as RecoveryStatus["source"];
    default:
      return "manual";
  }
}

function sleepSourceFromDevice(device?: string): SleepEntry["source"] {
  switch (String(device ?? "").toLowerCase()) {
    case "apple-health":
    case "garmin":
    case "oura":
    case "whoop":
      return String(device).toLowerCase() as SleepEntry["source"];
    default:
      return "manual";
  }
}

async function getDnaSettings(ctx: any) {
  return getStateValue<DnaSettings>(ctx, DATA_KEYS.DNA_SETTINGS, DEFAULT_DNA_SETTINGS);
}

async function setDnaSettings(ctx: any, next: Partial<DnaSettings>) {
  const current = await getDnaSettings(ctx);
  const merged = { ...current, ...next };
  await setStateValue(ctx, DATA_KEYS.DNA_SETTINGS, merged);
  return merged;
}

async function getHealthPolicy(ctx: any) {
  const settings = await getDnaSettings(ctx);
  return getStateValue<HealthPrivacyPolicy>(ctx, DATA_KEYS.HEALTH_POLICY, derivePolicy(settings));
}

async function setHealthPolicy(ctx: any, next: Partial<HealthPrivacyPolicy>) {
  const current = await getHealthPolicy(ctx);
  const merged = { ...current, ...next };
  await setStateValue(ctx, DATA_KEYS.HEALTH_POLICY, merged);
  return merged;
}

async function appendAuditEntry(ctx: any, entry: HealthAuditEntry) {
  const policy = await getHealthPolicy(ctx);
  const existing = await getArrayState<HealthAuditEntry>(ctx, DATA_KEYS.HEALTH_AUDIT_LOG);
  existing.push(entry);
  await setArrayState(ctx, DATA_KEYS.HEALTH_AUDIT_LOG, pruneAuditLog(existing, policy.auditRetentionDays));
}

async function auditSensitiveAction(ctx: any, input: {
  action: string;
  category: HealthAuditEntry["category"];
  detail: string;
  sensitivity?: HealthAuditEntry["sensitivity"];
  success: boolean;
}) {
  await appendAuditEntry(ctx, createAuditEntry(input));
}

function pruneConsentLog(entries: HealthConsentEntry[], retentionDays: number) {
  const threshold = Date.now() - retentionDays * 86_400_000;
  return entries.filter((entry) => new Date(entry.createdAt).getTime() >= threshold);
}

async function appendConsentEntry(ctx: any, entry: HealthConsentEntry) {
  const policy = await getHealthPolicy(ctx);
  const existing = await getArrayState<HealthConsentEntry>(ctx, DATA_KEYS.HEALTH_CONSENTS);
  existing.push(entry);
  await setArrayState(ctx, DATA_KEYS.HEALTH_CONSENTS, pruneConsentLog(existing, policy.auditRetentionDays));
}

async function recordConsent(ctx: any, input: Omit<HealthConsentEntry, "id" | "createdAt">) {
  await appendConsentEntry(ctx, {
    id: generateId(),
    createdAt: toIsoDateTime(),
    ...input,
  });
}

async function getHealthConsents(ctx: any) {
  const policy = await getHealthPolicy(ctx);
  const entries = pruneConsentLog(await getArrayState<HealthConsentEntry>(ctx, DATA_KEYS.HEALTH_CONSENTS), policy.auditRetentionDays);
  await setArrayState(ctx, DATA_KEYS.HEALTH_CONSENTS, entries);
  return entries;
}

async function ensureGeneticsEnabled(ctx: any) {
  const policy = await getHealthPolicy(ctx);
  return policy.geneticsEnabled;
}

function sanitizeImportedWorkoutPayload(_workout: Record<string, unknown>) {
  return undefined;
}

function hasOwnField(value: Record<string, unknown>, key: string) {
  return Object.prototype.hasOwnProperty.call(value, key);
}

function deriveRecoveryOverall(score: number): RecoveryStatus["overall"] {
  return score >= 75 ? "green" : score >= 45 ? "yellow" : "red";
}

function dnaReportFingerprint(report: DnaReport) {
  const variants = report.retainedGenotypes?.length ? report.retainedGenotypes : report.variants;
  if (!variants.length) {
    return undefined;
  }
  return variants
    .map((variant) => `${variant.rsId}:${variant.genotype}:${variant.chromosome}:${variant.position}`)
    .sort()
    .join("|");
}

function findDuplicateDnaReport(reports: DnaReport[], report: DnaReport) {
  const fingerprint = dnaReportFingerprint(report);
  if (!fingerprint) {
    return undefined;
  }
  return reports.find((entry) => dnaReportFingerprint(entry) === fingerprint);
}

function presentDnaReport(report: DnaReport | null | undefined, options?: { includeSensitiveDerived?: boolean }) {
  if (!report) {
    return report ?? null;
  }
  const includeSensitiveDerived = options?.includeSensitiveDerived === true;
  return {
    ...report,
    fileHash: undefined,
    retainedGenotypes: undefined,
    ancestryComposition: report.isPrivacyRestricted && !includeSensitiveDerived ? undefined : report.ancestryComposition,
    variants: report.isPrivacyRestricted && !includeSensitiveDerived ? [] : report.variants,
    healthInsights: report.isPrivacyRestricted && !includeSensitiveDerived ? [] : report.healthInsights,
  };
}

async function confirmRestrictedDnaSummaryAccess(
  ctx: any,
  input: {
    action: string;
    params: any;
    report?: DnaReport | null;
    detail: string;
    error: string;
  },
) {
  if (!input.report?.isPrivacyRestricted) {
    return { allowed: true as const };
  }
  const policy = await getHealthPolicy(ctx);
  if (!canAccessSensitiveDna({ report: input.report, policy, confirmed: input.params?.confirmSensitive })) {
    return { allowed: false as const, error: input.error };
  }
  await auditSensitiveAction(ctx, {
    action: input.action,
    category: "dna",
    detail: input.detail,
    sensitivity: "high",
    success: true,
  });
  await recordConsent(ctx, {
    action: input.action,
    scope: "dna-access",
    detail: input.detail,
    reportId: input.report.id,
    reason: input.params?.reason,
  });
  return { allowed: true as const };
}

function geneticsDisabledResult(extra?: Record<string, unknown>) {
  return {
    success: false,
    error: "Genetics features are disabled in privacy settings.",
    ...(extra ?? {}),
  };
}

function buildAppointmentChecklist(type: string) {
  const normalized = type.toLowerCase();
  if (normalized.includes("lab")) {
    return ["Confirm fasting requirements", "Bring prior lab results", "Hydrate unless instructed otherwise"];
  }
  if (normalized.includes("doctor") || normalized.includes("gp") || normalized.includes("follow")) {
    return ["Bring medication/supplement list", "Write top 3 questions", "Summarize symptoms and timeline"];
  }
  if (normalized.includes("physio") || normalized.includes("therapy")) {
    return ["Bring workout/recovery notes", "Note pain triggers", "Wear comfortable clothes"];
  }
  return ["Confirm location/time", "Bring relevant notes", "Capture questions ahead of time"];
}

async function getHydrationLogForDate(ctx: any, date: string) {
  const logs = await getArrayState<HydrationLog>(ctx, DATA_KEYS.HYDRATION_LOGS);
  return logs.find((log) => log.date === date) ?? null;
}

async function getFreshAmbientNudges(ctx: any): Promise<HealthNudge[]> {
  const nudges = await collectAmbientNudges(ctx);
  const today = toIsoDate();
  const history = await getStateValue<Record<string, string>>(ctx, DATA_KEYS.NUDGE_HISTORY, {});
  const fresh = nudges.filter((nudge) => history[nudge.key] !== today);

  if (fresh.length) {
    await setStateValue(ctx, DATA_KEYS.NUDGE_HISTORY, {
      ...history,
      ...Object.fromEntries(fresh.map((nudge) => [nudge.key, today])),
    });
  }

  return fresh;
}

async function collectAmbientNudges(ctx: any): Promise<HealthNudge[]> {
  const today = toIsoDate();
  const now = new Date();
  const nudges: HealthNudge[] = [];
  const policy = await getHealthPolicy(ctx);

  const workoutLogs = await getArrayState<WorkoutLog>(ctx, DATA_KEYS.WORKOUT_LOGS);
  const recentWorkouts = workoutLogs.filter((log) => new Date(log.performedAt).getTime() >= Date.now() - 3 * 86_400_000);
  const hardStreak = recentWorkouts.filter((log) => (log.rpe ?? 0) >= 8).length;
  if (!recentWorkouts.length) {
    nudges.push({ key: "workout-inactive", category: "workout", severity: "info", message: "No workouts logged in the last 3 days — want to capture a session or plan your next one?" });
  } else if (hardStreak >= 3) {
    nudges.push({ key: "workout-recovery", category: "workout", severity: "warning", message: "You have logged 3 high-intensity workouts in a row. Consider a recovery session next." });
  }

  const mealLogs = await getArrayState<MealLog>(ctx, DATA_KEYS.MEAL_LOGS);
  const todaysMeals = mealLogs.filter((log) => log.date === today);
  if (now.getUTCHours() >= 10 && !todaysMeals.length) {
    nudges.push({ key: "nutrition-breakfast", category: "nutrition", severity: "info", message: "No meals logged yet today — want to track breakfast or lunch?" });
  }

  const hydrationGoal = await getStateValue<number>(ctx, DATA_KEYS.DAILY_HYDRATION_GOAL_ML, DEFAULT_HYDRATION_GOAL_ML);
  const hydrationLog = await getHydrationLogForDate(ctx, today);
  const hydrationTotal = computeHydrationTotal(hydrationLog);
  if (now.getUTCHours() >= 14 && hydrationTotal < hydrationGoal / 2) {
    nudges.push({ key: "hydration-lag", category: "hydration", severity: "warning", message: `You're at ${hydrationTotal}ml of ${hydrationGoal}ml today. A refill now will make the evening easier.` });
  }

  const medications = await getArrayState<Medication>(ctx, DATA_KEYS.MEDICATIONS);
  const medicationLogs = await getArrayState<MedicationLog>(ctx, DATA_KEYS.MEDICATION_LOGS);
  const overdueMedication = medications.filter((medication) => medication.active).find((medication) => !medicationLogs.some((log) => log.medicationId === medication.id && log.takenAt.startsWith(today)));
  if (overdueMedication) {
    nudges.push({ key: `medication-${overdueMedication.id}`, category: "medication", severity: "warning", message: `No dose recorded yet today for ${overdueMedication.name}. Log it if you've already taken it.` });
  }

  const appointments = await getArrayState<Appointment>(ctx, DATA_KEYS.APPOINTMENTS);
  const upcoming = appointments.find((appointment) => !appointment.cancelledAt && new Date(appointment.scheduledAt).getTime() > Date.now() && new Date(appointment.scheduledAt).getTime() - Date.now() <= 24 * 86_400_000);
  if (upcoming) {
    nudges.push({ key: `appointment-${upcoming.id}`, category: "appointment", severity: "info", message: `${upcoming.type} with ${upcoming.provider} is coming up within 24 hours. Need a prep checklist?` });
  }

  const reports = await getArrayState<DnaReport>(ctx, DATA_KEYS.DNA_REPORTS);
  const latestReport = reports.at(-1);
  if (latestReport?.healthInsights.length && policy.privacyMode !== "privacy") {
    const highlight = latestReport.healthInsights.find((insight) => insight.actionableRecommendation);
    if (highlight) {
      nudges.push({ key: `dna-${latestReport.id}`, category: "dna", severity: "success", message: `DNA highlight: ${highlight.title} — ${highlight.actionableRecommendation}` });
    }
  }

  return nudges.map((nudge) => ({
    ...nudge,
    message: redactNudgeMessage(nudge, policy),
  }));
}

const plugin = definePlugin({
  async setup(ctx) {
    ctx.events.on("agent.run.finished", async (event) => {
      const companyId = typeof event.companyId === "string" ? event.companyId : "";
      if (!companyId) {
        return;
      }

      const nudges = await getFreshAmbientNudges(ctx);
      await Promise.all(nudges.map((nudge) => ctx.activity.log({
        companyId,
        message: nudge.message,
        entityType: "plugin_nudge",
        entityId: nudge.key,
        metadata: {
          severity: nudge.severity,
          category: nudge.category,
        },
      })));
    });

    const seededAnnotations = await getStateValue(ctx, DATA_KEYS.DNA_VARIANT_ANNOTATIONS, null);
    if (!seededAnnotations) {
      await setStateValue(ctx, DATA_KEYS.DNA_VARIANT_ANNOTATIONS, getAnnotationIndex());
    }

    const existingSettings = await getStateValue<DnaSettings>(ctx, DATA_KEYS.DNA_SETTINGS, DEFAULT_DNA_SETTINGS);
    await setStateValue(ctx, DATA_KEYS.DNA_SETTINGS, { ...DEFAULT_DNA_SETTINGS, ...existingSettings });
    const seededPolicy = await getStateValue<HealthPrivacyPolicy | null>(ctx, DATA_KEYS.HEALTH_POLICY, null);
    if (!seededPolicy) {
      await setStateValue(ctx, DATA_KEYS.HEALTH_POLICY, derivePolicy(existingSettings));
    }

    ctx.data.register("health.overview", async () => {
      const today = toIsoDate();
      const workouts = await getArrayState<WorkoutLog>(ctx, DATA_KEYS.WORKOUT_LOGS);
      const meals = await getArrayState<MealLog>(ctx, DATA_KEYS.MEAL_LOGS);
      const reports = await getArrayState<DnaReport>(ctx, DATA_KEYS.DNA_REPORTS);
      const labResults = await getArrayState<LabResult>(ctx, DATA_KEYS.LAB_RESULTS);
      const hydrationGoal = await getStateValue<number>(ctx, DATA_KEYS.DAILY_HYDRATION_GOAL_ML, DEFAULT_HYDRATION_GOAL_ML);
      const hydrationLog = await getHydrationLogForDate(ctx, today);
      const medicationLogs = await getArrayState<MedicationLog>(ctx, DATA_KEYS.MEDICATION_LOGS);
      const appointments = await getArrayState<Appointment>(ctx, DATA_KEYS.APPOINTMENTS);
      const pending = buildPendingReminderProjection({
        today,
        medications: medicationLogs,
        workouts,
        meals,
        hydrationLog,
        hydrationGoal,
        appointments,
        sleepEntries: await getArrayState<SleepEntry>(ctx, DATA_KEYS.SLEEP_ENTRIES),
        habits: await getArrayState<HabitCompletion>(ctx, DATA_KEYS.HABIT_COMPLETIONS),
        recoveryEntries: await getArrayState<RecoveryStatus>(ctx, DATA_KEYS.RECOVERY_STATUS),
        nudges: await collectAmbientNudges(ctx),
      });
      const bloodworkTrends = getBloodworkTrends(labResults).slice(0, 5);
      return {
        date: today,
        today: {
          mealsLogged: meals.filter((meal) => meal.date === today).length,
          workoutsLogged: workouts.filter((workout) => workout.performedAt.startsWith(today)).length,
          medicationsLogged: medicationLogs.filter((log) => log.takenAt.startsWith(today)).length,
          hydration: {
            totalMl: computeHydrationTotal(hydrationLog),
            goalMl: hydrationGoal,
          },
        },
        workoutSummary: computeWorkoutSummary(workouts),
        latestDnaSummary: reports.at(-1) ? summarizeReport(reports.at(-1)!) : null,
        latestBloodworkSummary: labResults.at(-1) ? analyzeBloodwork(labResults.at(-1)!, {}).overallSummary : null,
        latestBloodworkTrends: bloodworkTrends,
        pending,
        provenance: {
          latestDnaReportId: reports.at(-1)?.id ?? null,
          latestLabResultId: labResults.at(-1)?.id ?? null,
        },
      };
    });

    ctx.data.register("health.workouts.overview", async () => buildWorkoutOverview(await getArrayState<WorkoutLog>(ctx, DATA_KEYS.WORKOUT_LOGS)));

    ctx.data.register("health.nutrition.overview", async () => {
      const meals = await getArrayState<MealLog>(ctx, DATA_KEYS.MEAL_LOGS);
      const calorieTarget = await getStateValue<number>(ctx, DATA_KEYS.DAILY_CALORIE_TARGET, 0);
      const macroTarget = await getStateValue<MacroTargets | undefined>(ctx, DATA_KEYS.MACRO_TARGETS, undefined);
      return buildNutritionOverview(meals, calorieTarget, macroTarget);
    });

    ctx.data.register("health.labs.latest", async () => buildLatestLabProjection(await getArrayState<LabResult>(ctx, DATA_KEYS.LAB_RESULTS)));

    ctx.data.register("health.dna.latest", async () => buildLatestDnaProjection(await getArrayState<DnaReport>(ctx, DATA_KEYS.DNA_REPORTS)));

    ctx.data.register("health.reminders.pending", async () => {
      const today = toIsoDate();
      return buildPendingReminderProjection({
        today,
        medications: await getArrayState<MedicationLog>(ctx, DATA_KEYS.MEDICATION_LOGS),
        workouts: await getArrayState<WorkoutLog>(ctx, DATA_KEYS.WORKOUT_LOGS),
        meals: await getArrayState<MealLog>(ctx, DATA_KEYS.MEAL_LOGS),
        hydrationLog: await getHydrationLogForDate(ctx, today),
        hydrationGoal: await getStateValue<number>(ctx, DATA_KEYS.DAILY_HYDRATION_GOAL_ML, DEFAULT_HYDRATION_GOAL_ML),
        appointments: await getArrayState<Appointment>(ctx, DATA_KEYS.APPOINTMENTS),
        sleepEntries: await getArrayState<SleepEntry>(ctx, DATA_KEYS.SLEEP_ENTRIES),
        habits: await getArrayState<HabitCompletion>(ctx, DATA_KEYS.HABIT_COMPLETIONS),
        recoveryEntries: await getArrayState<RecoveryStatus>(ctx, DATA_KEYS.RECOVERY_STATUS),
        nudges: await collectAmbientNudges(ctx),
      });
    });

    ctx.data.register("health.privacy.status", async () => buildPrivacyProjection(
      await getDnaSettings(ctx),
      await getHealthPolicy(ctx),
      await getArrayState<DnaReport>(ctx, DATA_KEYS.DNA_REPORTS),
    ));

    ctx.data.register("health.dna.kb-status", async () => getDnaKnowledgeBaseStatus());

    ctx.data.register("health.audit.summary", async () => {
      const auditLog = await getArrayState<HealthAuditEntry>(ctx, DATA_KEYS.HEALTH_AUDIT_LOG);
      const consents = await getHealthConsents(ctx);
      return {
        auditEntries: auditLog.length,
        consentEntries: consents.length,
        latestAuditEntry: auditLog.at(-1) ?? null,
        latestConsent: consents.at(-1) ?? null,
      };
    });

    ctx.actions.register(ACTION_KEYS.ADD_MEDICATION, async (params: any) => {
      const input = validateMedicationParams(params);
      const medication: Medication = {
        id: generateId(),
        name: input.name,
        dose: input.dose,
        frequency: input.frequency,
        times: input.times,
        active: input.active,
      };
      await appendArrayItem(ctx, DATA_KEYS.MEDICATIONS, medication);
      return { success: true, medication };
    });

    ctx.actions.register(ACTION_KEYS.GET_MEDICATIONS, async () => ({
      medications: await getArrayState<Medication>(ctx, DATA_KEYS.MEDICATIONS),
    }));

    ctx.actions.register(ACTION_KEYS.LOG_MEDICATION, async (params: any) => {
      const log: MedicationLog = {
        id: generateId(),
        medicationId: params.medicationId,
        takenAt: toIsoDateTime(params.takenAt),
        taken: params.taken ?? true,
        notes: params.notes ?? "",
      };
      await appendArrayItem(ctx, DATA_KEYS.MEDICATION_LOGS, log);
      return { success: true, log };
    });

    ctx.actions.register(ACTION_KEYS.GET_MEDICATION_LOGS, async (params: any) => {
      const range = parseRangeWindow(params ?? {});
      const logs = await getArrayState<MedicationLog>(ctx, DATA_KEYS.MEDICATION_LOGS);
      return {
        medicationLogs: logs.filter((log) => (!params?.medicationId || log.medicationId === params.medicationId) && withinRange(log.takenAt, range)),
      };
    });

    ctx.actions.register(ACTION_KEYS.REFILL_MEDICATION, async (params: any) => {
      const refill: RefillLog = {
        id: generateId(),
        medicationId: params.medicationId,
        filledAt: toIsoDateTime(params.filledAt),
        pillsRemaining: params.pillsRemaining,
      };
      await appendArrayItem(ctx, DATA_KEYS.REFILLS, refill);
      return { success: true, refill };
    });

    ctx.actions.register(ACTION_KEYS.LOG_SYMPTOM, async (params: any) => {
      const symptom: SymptomEntry = {
        id: generateId(),
        symptom: params.symptom,
        severity: params.severity ?? "mild",
        notes: params.notes ?? "",
        startedAt: toIsoDateTime(params.startedAt),
      };
      await appendArrayItem(ctx, DATA_KEYS.SYMPTOMS, symptom);
      return { success: true, symptom };
    });

    ctx.actions.register(ACTION_KEYS.GET_SYMPTOMS, async (params: any) => {
      const range = parseRangeWindow(params ?? { days: 30 });
      const symptoms = await getArrayState<SymptomEntry>(ctx, DATA_KEYS.SYMPTOMS);
      return {
        symptoms: symptoms.filter((entry) => withinRange(entry.startedAt, range)),
      };
    });

    ctx.actions.register(ACTION_KEYS.REVIEW_SYMPTOMS, async (params: any) => {
      const range = parseRangeWindow(params ?? { days: 30 });
      const symptoms = (await getArrayState<SymptomEntry>(ctx, DATA_KEYS.SYMPTOMS)).filter((entry) => withinRange(entry.startedAt, range));
      const bySymptom = symptoms.reduce<Record<string, { count: number; severeCount: number }>>((acc, entry) => {
        const bucket = acc[entry.symptom] ?? { count: 0, severeCount: 0 };
        bucket.count += 1;
        if (entry.severity === "severe") {
          bucket.severeCount += 1;
        }
        acc[entry.symptom] = bucket;
        return acc;
      }, {});
      return { symptomsReviewed: symptoms.length, bySymptom };
    });

    ctx.actions.register(ACTION_KEYS.ADD_WORKOUT_PLAN, async (params: any) => {
      const plan: WorkoutPlan = {
        id: generateId(),
        name: params.name,
        type: params.type ?? "other",
        phase: params.phase ?? "base",
        targetDurationMinutes: params.targetDurationMinutes ?? 45,
        targetDaysPerWeek: params.targetDaysPerWeek ?? 3,
        notes: params.notes,
        active: params.active ?? true,
      };
      await appendArrayItem(ctx, DATA_KEYS.WORKOUT_PLANS, plan);
      return { success: true, workoutPlan: plan };
    });

    ctx.actions.register(ACTION_KEYS.GET_WORKOUT_PLANS, async (params: any) => {
      const plans = await getArrayState<WorkoutPlan>(ctx, DATA_KEYS.WORKOUT_PLANS);
      return { workoutPlans: typeof params?.active === "boolean" ? plans.filter((plan) => plan.active === params.active) : plans };
    });

    ctx.actions.register(ACTION_KEYS.UPDATE_WORKOUT_PLAN, async (params: any) => {
      const updated = await replaceById<WorkoutPlan>(ctx, DATA_KEYS.WORKOUT_PLANS, params.id, (plan) => ({ ...plan, ...params }));
      return { success: Boolean(updated), workoutPlan: updated };
    });

    ctx.actions.register(ACTION_KEYS.LOG_WORKOUT, async (params: any) => {
      const input = validateWorkoutParams(params);
      const workout: WorkoutLog = {
        id: generateId(),
        type: input.type as WorkoutLog["type"] ?? "other",
        name: input.name,
        performedAt: toIsoDateTime(input.performedAt),
        durationMinutes: input.durationMinutes,
        rpe: input.rpe,
        caloriesBurned: input.caloriesBurned,
        distanceKm: input.distanceKm,
        avgPaceMinPerKm: input.avgPaceMinPerKm,
        avgHeartRate: input.avgHeartRate,
        maxHeartRate: input.maxHeartRate,
        elevationGainM: input.elevationGainM,
        stravaActivityId: params.stravaActivityId,
        exercises: params.exercises,
        laps: params.laps,
        strokeTypes: params.strokeTypes,
        source: params.source ?? "manual",
        wearableLogId: params.wearableLogId,
        rawData: params.rawData,
        notes: input.notes,
      };
      await appendArrayItem(ctx, DATA_KEYS.WORKOUT_LOGS, workout);
      return { success: true, workout };
    });

    ctx.actions.register(ACTION_KEYS.GET_WORKOUT_LOGS, async (params: any) => {
      const range = parseRangeWindow(params ?? { days: 30 });
      const workouts = await getArrayState<WorkoutLog>(ctx, DATA_KEYS.WORKOUT_LOGS);
      return {
        workouts: workouts.filter((workout) => withinRange(workout.performedAt, range) && (!params?.type || workout.type === params.type) && (!params?.source || workout.source === params.source)),
      };
    });

    ctx.actions.register(ACTION_KEYS.GET_WORKOUT_SUMMARY, async (params: any) => {
      const range = parseRangeWindow(params ?? { days: 30 });
      const workouts = (await getArrayState<WorkoutLog>(ctx, DATA_KEYS.WORKOUT_LOGS)).filter((workout) => withinRange(workout.performedAt, range));
      return computeWorkoutSummary(workouts);
    });

    ctx.actions.register(ACTION_KEYS.PLAN_WEEKLY_WORKOUTS, async (params: any) => {
      const plans = await getArrayState<WorkoutPlan>(ctx, DATA_KEYS.WORKOUT_PLANS);
      return computeWorkoutPlanForWeek(plans, params ?? {});
    });

    ctx.actions.register(ACTION_KEYS.DELETE_WORKOUT_LOG, async (params: any) => {
      const removed = await removeById<WorkoutLog>(ctx, DATA_KEYS.WORKOUT_LOGS, params.id);
      return { success: Boolean(removed), workout: removed };
    });

    ctx.actions.register(ACTION_KEYS.SYNC_WEARABLE, async (params: any) => {
      const statuses = await getArrayState<WearableSyncStatus>(ctx, DATA_KEYS.WEARABLE_STATUS);
      const nextStatus: WearableSyncStatus = {
        device: params.device,
        connected: params.connected ?? true,
        deviceId: params.deviceId,
        error: params.error,
        lastSyncAt: new Date().toISOString(),
      };
      const existingIndex = statuses.findIndex((status) => status.device === params.device);
      if (existingIndex >= 0) {
        statuses[existingIndex] = nextStatus;
      } else {
        statuses.push(nextStatus);
      }
      await setArrayState(ctx, DATA_KEYS.WEARABLE_STATUS, statuses);
      const source = workoutSourceFromDevice(params.device);
      const importedWorkouts = Array.isArray(params.workouts) ? params.workouts : [];
      const importedSleepEntries = Array.isArray(params.sleepEntries) ? params.sleepEntries : [];
      const importedRecoveryEntries = Array.isArray(params.recoveryEntries) ? params.recoveryEntries : [];

      if (importedWorkouts.length) {
        const existingWorkouts = await getArrayState<WorkoutLog>(ctx, DATA_KEYS.WORKOUT_LOGS);
        for (const workout of importedWorkouts) {
          const wearableLogId = String(workout.wearableLogId ?? workout.id ?? "");
          const candidate: WorkoutLog = {
            id: generateId(),
            name: String(workout.name ?? workout.type ?? "Imported workout"),
            type: workout.type ?? "other",
            performedAt: toIsoDateTime(workout.performedAt),
            durationMinutes: Number(workout.durationMinutes ?? 0),
            source,
            wearableLogId: wearableLogId || undefined,
            rawData: sanitizeImportedWorkoutPayload(workout),
          };
          if (hasOwnField(workout, "caloriesBurned")) {
            candidate.caloriesBurned = workout.caloriesBurned as number | undefined;
          }
          if (hasOwnField(workout, "distanceKm")) {
            candidate.distanceKm = workout.distanceKm as number | undefined;
          }
          if (hasOwnField(workout, "avgHeartRate")) {
            candidate.avgHeartRate = workout.avgHeartRate as number | undefined;
          }
          if (hasOwnField(workout, "maxHeartRate")) {
            candidate.maxHeartRate = workout.maxHeartRate as number | undefined;
          }
          if (hasOwnField(workout, "notes")) {
            candidate.notes = workout.notes as string | undefined;
          }
          const existing = wearableLogId
            ? existingWorkouts.find((entry) => entry.wearableLogId === wearableLogId || entry.stravaActivityId === wearableLogId)
            : undefined;
          if (existing) {
            Object.assign(existing, candidate, { id: existing.id });
          } else {
            existingWorkouts.push(candidate);
          }
        }
        await setArrayState(ctx, DATA_KEYS.WORKOUT_LOGS, existingWorkouts);
      }

      if (importedSleepEntries.length) {
        const existingSleep = await getArrayState<SleepEntry>(ctx, DATA_KEYS.SLEEP_ENTRIES);
        const sleepSource = sleepSourceFromDevice(params.device);
        for (const sleepEntry of importedSleepEntries) {
          const candidate: Partial<SleepEntry> & Pick<SleepEntry, "date" | "source"> = {
            date: toIsoDate(sleepEntry.date),
            source: sleepSource,
          };
          if (hasOwnField(sleepEntry, "totalMinutes")) {
            candidate.totalMinutes = Number(sleepEntry.totalMinutes ?? 0);
          }
          if (hasOwnField(sleepEntry, "sleepScore")) {
            candidate.sleepScore = sleepEntry.sleepScore as number | undefined;
          }
          if (hasOwnField(sleepEntry, "deepMinutes")) {
            candidate.deepMinutes = sleepEntry.deepMinutes as number | undefined;
          }
          if (hasOwnField(sleepEntry, "remMinutes")) {
            candidate.remMinutes = sleepEntry.remMinutes as number | undefined;
          }
          if (hasOwnField(sleepEntry, "wakeCount")) {
            candidate.wakeCount = sleepEntry.wakeCount as number | undefined;
          }
          const existing = existingSleep.find((entry) => entry.date === candidate.date && entry.source === candidate.source);
          if (existing) {
            Object.assign(existing, candidate);
          } else {
            existingSleep.push({
              id: generateId(),
              date: candidate.date,
              totalMinutes: candidate.totalMinutes ?? 0,
              sleepScore: candidate.sleepScore,
              deepMinutes: candidate.deepMinutes,
              remMinutes: candidate.remMinutes,
              wakeCount: candidate.wakeCount,
              source: candidate.source,
            });
          }
        }
        await setArrayState(ctx, DATA_KEYS.SLEEP_ENTRIES, existingSleep);
      }

      if (importedRecoveryEntries.length) {
        const existingRecovery = await getArrayState<RecoveryStatus>(ctx, DATA_KEYS.RECOVERY_STATUS);
        const recoverySource = recoverySourceFromDevice(params.device);
        for (const recoveryEntry of importedRecoveryEntries) {
          const candidate: Partial<RecoveryStatus> & Pick<RecoveryStatus, "date" | "source"> = {
            date: toIsoDate(recoveryEntry.date),
            source: recoverySource,
          };
          if (hasOwnField(recoveryEntry, "score")) {
            candidate.score = Number(recoveryEntry.score ?? 50);
          }
          if (hasOwnField(recoveryEntry, "overall")) {
            candidate.overall = recoveryEntry.overall as RecoveryStatus["overall"] | undefined;
          } else if (candidate.score !== undefined) {
            candidate.overall = deriveRecoveryOverall(candidate.score);
          }
          if (hasOwnField(recoveryEntry, "recommendation")) {
            candidate.recommendation = recoveryEntry.recommendation as string | undefined;
          }
          const existing = existingRecovery.find((entry) => entry.date === candidate.date && entry.source === candidate.source);
          if (existing) {
            Object.assign(existing, candidate);
          } else {
            existingRecovery.push({
              date: candidate.date,
              score: candidate.score ?? 50,
              overall: candidate.overall ?? deriveRecoveryOverall(candidate.score ?? 50),
              recommendation: candidate.recommendation,
              source: candidate.source,
            });
          }
        }
        await setArrayState(ctx, DATA_KEYS.RECOVERY_STATUS, existingRecovery);
      }
      return {
        success: true,
        wearable: nextStatus,
        importedSessions: params.importedSessions ?? importedWorkouts.length + importedSleepEntries.length + importedRecoveryEntries.length,
        note: importedWorkouts.length || importedSleepEntries.length || importedRecoveryEntries.length
          ? "Wearable sync ingested local/exported wearable data into workouts, sleep, and recovery state without requiring live API connectivity."
          : "Wearable sync scaffold updated local connection status. API polling remains a future integration boundary.",
      };
    });

    ctx.actions.register(ACTION_KEYS.GET_WEARABLE_STATUS, async () => ({
      wearables: await getArrayState<WearableSyncStatus>(ctx, DATA_KEYS.WEARABLE_STATUS),
    }));

    ctx.actions.register(ACTION_KEYS.LOG_SLEEP, async (params: any) => {
      const entry: SleepEntry = {
        id: generateId(),
        date: toIsoDate(params.date),
        totalMinutes: params.totalMinutes ?? 0,
        sleepScore: params.sleepScore,
        deepMinutes: params.deepMinutes,
        remMinutes: params.remMinutes,
        wakeCount: params.wakeCount,
        source: params.source ?? "manual",
      };
      await appendArrayItem(ctx, DATA_KEYS.SLEEP_ENTRIES, entry);
      return { success: true, sleepEntry: entry };
    });

    ctx.actions.register(ACTION_KEYS.GET_SLEEP, async (params: any) => {
      const range = parseRangeWindow(params ?? { days: 7 });
      const sleep = await getArrayState<SleepEntry>(ctx, DATA_KEYS.SLEEP_ENTRIES);
      return { sleep: sleep.filter((entry) => withinRange(`${entry.date}T00:00:00Z`, range)) };
    });

    ctx.actions.register(ACTION_KEYS.GET_SLEEP_SUMMARY, async (params: any) => {
      const range = parseRangeWindow(params ?? { days: 7 });
      const entries = (await getArrayState<SleepEntry>(ctx, DATA_KEYS.SLEEP_ENTRIES)).filter((entry) => withinRange(`${entry.date}T00:00:00Z`, range));
      return computeSleepSummary(entries);
    });

    ctx.actions.register(ACTION_KEYS.ADD_MEAL_PLAN, async (params: any) => {
      const plan: MealPlan = {
        id: generateId(),
        name: params.name,
        dailyCalorieTarget: params.dailyCalorieTarget,
        macroTargets: params.macroTargets,
        mealTemplates: params.mealTemplates ?? [],
        active: params.active ?? true,
      };
      await appendArrayItem(ctx, DATA_KEYS.MEAL_PLANS, plan);
      return { success: true, mealPlan: plan };
    });

    ctx.actions.register(ACTION_KEYS.UPDATE_MEAL_PLAN, async (params: any) => {
      const updated = await replaceById<MealPlan>(ctx, DATA_KEYS.MEAL_PLANS, params.id, (plan) => ({ ...plan, ...params }));
      return { success: Boolean(updated), mealPlan: updated };
    });

    ctx.actions.register(ACTION_KEYS.GET_MEAL_PLANS, async () => ({
      mealPlans: await getArrayState<MealPlan>(ctx, DATA_KEYS.MEAL_PLANS),
    }));

    ctx.actions.register(ACTION_KEYS.LOG_MEAL, async (params: any) => {
      const foods = params.foods ?? [];
      const totalCalories = params.totalCalories ?? computeMealCalories(foods);
      const totalMacros = params.totalMacros ?? computeMealMacros(foods);
      const meal: MealLog = {
        id: generateId(),
        date: toIsoDate(params.date),
        mealName: params.mealName,
        foods,
        totalCalories,
        totalMacros,
        source: params.source ?? "manual",
        notes: params.notes,
      };
      await appendArrayItem(ctx, DATA_KEYS.MEAL_LOGS, meal);
      return { success: true, meal };
    });

    ctx.actions.register(ACTION_KEYS.LOG_QUICK_MEAL, async (params: any) => {
      const plans = await getArrayState<MealPlan>(ctx, DATA_KEYS.MEAL_PLANS);
      const mealLogs = await getArrayState<MealLog>(ctx, DATA_KEYS.MEAL_LOGS);
      const template = plans.flatMap((plan) => plan.mealTemplates ?? []).find((entry) => entry.name.toLowerCase() === String(params.name ?? params.mealName ?? "").toLowerCase());
      const recent = mealLogs
        .slice()
        .reverse()
        .find((entry) => entry.mealName.toLowerCase() === String(params.mealName ?? params.name ?? "").toLowerCase());
      const foods = (template?.typicalFoods ?? recent?.foods?.map((food) => food.name) ?? []).map((name) => ({ name, calories: Math.round((template?.targetCalories ?? recent?.totalCalories ?? 450) / Math.max((template?.typicalFoods?.length ?? recent?.foods?.length ?? 1), 1)) }));
      const meal: MealLog = {
        id: generateId(),
        date: toIsoDate(params.date),
        mealName: params.mealName ?? template?.name ?? params.name ?? "quick-meal",
        foods,
        totalCalories: params.totalCalories ?? template?.targetCalories ?? recent?.totalCalories ?? computeMealCalories(foods),
        totalMacros: params.totalMacros ?? template?.targetMacros ?? recent?.totalMacros,
        source: "manual",
        notes: params.notes ?? `Quick meal from ${template?.name ?? recent?.mealName ?? "recent template"}`,
      };
      await appendArrayItem(ctx, DATA_KEYS.MEAL_LOGS, meal);
      return { success: true, meal, templateFound: Boolean(template), recentMealFound: Boolean(recent) };
    });

    ctx.actions.register(ACTION_KEYS.GET_MEAL_LOGS, async (params: any) => {
      const range = parseRangeWindow(params ?? { days: 14 });
      const logs = await getArrayState<MealLog>(ctx, DATA_KEYS.MEAL_LOGS);
      return {
        mealLogs: logs.filter((log) => withinRange(`${log.date}T00:00:00Z`, range) && (!params?.mealName || log.mealName === params.mealName)),
      };
    });

    ctx.actions.register(ACTION_KEYS.SET_CALORIE_TARGET, async (params: any) => {
      await setStateValue(ctx, DATA_KEYS.DAILY_CALORIE_TARGET, params.calories);
      return { success: true, dailyCalorieTarget: params.calories };
    });

    ctx.actions.register(ACTION_KEYS.SET_MACRO_TARGETS, async (params: any) => {
      await setStateValue(ctx, DATA_KEYS.MACRO_TARGETS, params);
      return { success: true, macroTargets: params };
    });

    ctx.actions.register(ACTION_KEYS.GET_NUTRITION_SUMMARY, async (params: any) => {
      const range = parseRangeWindow(params ?? { days: 7 });
      const logs = (await getArrayState<MealLog>(ctx, DATA_KEYS.MEAL_LOGS)).filter((log) => withinRange(`${log.date}T00:00:00Z`, range));
      const calorieTarget = await getStateValue<number>(ctx, DATA_KEYS.DAILY_CALORIE_TARGET, 0);
      const macroTarget = await getStateValue<MacroTargets | undefined>(ctx, DATA_KEYS.MACRO_TARGETS, undefined);
      return computeNutritionSummary(logs, calorieTarget, macroTarget);
    });

    ctx.actions.register(ACTION_KEYS.SEARCH_FOODS, async (params: any) => {
      const matches = findFoodMatches(params.query ?? "");
      const recentFoods = Array.from(new Map(
        (await getArrayState<MealLog>(ctx, DATA_KEYS.MEAL_LOGS))
          .flatMap((meal) => meal.foods)
          .filter((food) => String(food.name ?? "").toLowerCase().includes(String(params.query ?? "").toLowerCase()))
          .map((food) => [food.name.toLowerCase(), { ...food, source: food.source ?? "recent-log" }]),
      ).values());
      const dnaReports = await getArrayState<DnaReport>(ctx, DATA_KEYS.DNA_REPORTS);
      const dnaHints = dnaReports.at(-1)?.healthInsights.filter((insight) => insight.category === "nutrition" || insight.category === "metabolic").slice(0, 2).map((insight) => insight.actionableRecommendation ?? insight.title) ?? [];
      return { foods: [...recentFoods, ...matches].slice(0, 12), dnaHints };
    });

    ctx.actions.register(ACTION_KEYS.GET_FOOD_DETAILS, async (params: any) => {
      const match = params.id ? getFoodDetail(params.id) : (findFoodMatches(params.query ?? "")[0] ?? null);
      return { food: match };
    });

    ctx.actions.register(ACTION_KEYS.LOG_HYDRATION, async (params: any) => {
      const date = toIsoDate(params.date);
      const goalMl = await getStateValue<number>(ctx, DATA_KEYS.DAILY_HYDRATION_GOAL_ML, DEFAULT_HYDRATION_GOAL_ML);
      const logs = await getArrayState<HydrationLog>(ctx, DATA_KEYS.HYDRATION_LOGS);
      const entry: HydrationEntry = {
        id: generateId(),
        amountMl: params.amountMl,
        loggedAt: toIsoDateTime(params.loggedAt),
        source: params.source ?? "manual",
      };
      const existing = logs.find((log) => log.date === date);
      if (existing) {
        existing.entries.push(entry);
        existing.totalMl = computeHydrationTotal(existing);
        existing.goalMl = goalMl;
      } else {
        logs.push({
          id: generateId(),
          date,
          entries: [entry],
          totalMl: entry.amountMl,
          goalMl,
          source: params.source ?? "manual",
        });
      }
      await setArrayState(ctx, DATA_KEYS.HYDRATION_LOGS, logs);
      return { success: true, hydrationDate: date, entry };
    });

    ctx.actions.register(ACTION_KEYS.GET_HYDRATION, async (params: any) => {
      const date = toIsoDate(params?.date);
      const goalMl = await getStateValue<number>(ctx, DATA_KEYS.DAILY_HYDRATION_GOAL_ML, DEFAULT_HYDRATION_GOAL_ML);
      const log = await getHydrationLogForDate(ctx, date);
      const totalMl = computeHydrationTotal(log);
      return {
        date,
        hydration: log,
        totalMl,
        goalMl,
        completionRatio: goalMl ? Number((totalMl / goalMl).toFixed(2)) : 0,
      };
    });

    ctx.actions.register(ACTION_KEYS.SET_HYDRATION_GOAL, async (params: any) => {
      await setStateValue(ctx, DATA_KEYS.DAILY_HYDRATION_GOAL_ML, params.goalMl);
      return { success: true, goalMl: params.goalMl };
    });

    ctx.actions.register(ACTION_KEYS.DELETE_MEAL_LOG, async (params: any) => {
      const removed = await removeById<MealLog>(ctx, DATA_KEYS.MEAL_LOGS, params.id);
      return { success: Boolean(removed), meal: removed };
    });

    ctx.actions.register(ACTION_KEYS.DELETE_HYDRATION_ENTRY, async (params: any) => {
      const logs = await getArrayState<HydrationLog>(ctx, DATA_KEYS.HYDRATION_LOGS);
      let removed: HydrationEntry | null = null;
      for (const log of logs) {
        const index = log.entries.findIndex((entry) => entry.id === params.id);
        if (index >= 0) {
          removed = log.entries.splice(index, 1)[0];
          log.totalMl = computeHydrationTotal(log);
          break;
        }
      }
      await setArrayState(ctx, DATA_KEYS.HYDRATION_LOGS, logs);
      return { success: Boolean(removed), hydrationEntry: removed };
    });

    ctx.actions.register(ACTION_KEYS.ADD_APPOINTMENT, async (params: any) => {
      const input = validateAppointmentParams(params);
      const appointment: Appointment = {
        id: generateId(),
        type: input.type,
        provider: input.provider,
        scheduledAt: toIsoDateTime(input.scheduledAt),
        durationMinutes: input.durationMinutes ?? 30,
        notes: input.notes,
        prepNotes: input.prepNotes,
      };
      await appendArrayItem(ctx, DATA_KEYS.APPOINTMENTS, appointment);
      await auditSensitiveAction(ctx, {
        action: ACTION_KEYS.ADD_APPOINTMENT,
        category: "appointment",
        detail: `Stored appointment metadata for ${appointment.type}.`,
        sensitivity: "moderate",
        success: true,
      });
      return { success: true, appointment };
    });

    ctx.actions.register(ACTION_KEYS.GET_APPOINTMENTS, async (params: any) => {
      const appointments = await getArrayState<Appointment>(ctx, DATA_KEYS.APPOINTMENTS);
      const includeCancelled = params?.includeCancelled ?? false;
      return {
        appointments: appointments.filter((appointment) => includeCancelled || !appointment.cancelledAt),
      };
    });

    ctx.actions.register(ACTION_KEYS.PREP_APPOINTMENT, async (params: any) => {
      const appointments = await getArrayState<Appointment>(ctx, DATA_KEYS.APPOINTMENTS);
      const appointment = appointments.find((entry) => entry.id === params.id);
      if (!appointment) {
        return { success: false, error: "Appointment not found" };
      }
      return {
        success: true,
        appointment,
        checklist: buildAppointmentChecklist(appointment.type),
      };
    });

    ctx.actions.register(ACTION_KEYS.CANCEL_APPOINTMENT, async (params: any) => {
      const updated = await replaceById<Appointment>(ctx, DATA_KEYS.APPOINTMENTS, params.id, (appointment) => ({ ...appointment, cancelledAt: toIsoDateTime() }));
      return { success: Boolean(updated), appointment: updated };
    });

    ctx.actions.register(ACTION_KEYS.ADD_LAB_RESULT, async (params: any) => {
      const input = validateLabResultParams(params);
      const result: LabResult = {
        id: generateId(),
        resultedAt: toIsoDateTime(input.resultedAt),
        labName: input.labName,
        panels: input.panels,
        notes: input.notes,
      };
      await appendArrayItem(ctx, DATA_KEYS.LAB_RESULTS, result);
      await auditSensitiveAction(ctx, {
        action: ACTION_KEYS.ADD_LAB_RESULT,
        category: "bloodwork",
        detail: `Stored lab result from ${result.labName} with ${result.panels.length} panels.`,
        sensitivity: "high",
        success: true,
      });
      return { success: true, labResult: result };
    });

    ctx.actions.register(ACTION_KEYS.PREVIEW_LAB_IMPORT, async (params: any) => {
      const input = validateLabImportParams(params);
      return {
        success: true,
        preview: previewLabImport({
          rawData: input.rawData,
          fileName: input.fileName,
          defaultPanelName: input.defaultPanelName,
        }),
      };
    });

    ctx.actions.register(ACTION_KEYS.IMPORT_LAB_RESULT, async (params: any) => {
      const input = validateLabImportParams(params);
      const { preview, labResult } = buildImportedLabResult({
        labName: input.labName ?? "Imported Lab Result",
        rawData: input.rawData,
        fileName: input.fileName,
        resultedAt: input.resultedAt,
        defaultPanelName: input.defaultPanelName,
        notes: input.notes,
      });
      if (preview.matchedRows === 0 || !preview.panels.length) {
        await auditSensitiveAction(ctx, {
          action: ACTION_KEYS.IMPORT_LAB_RESULT,
          category: "bloodwork",
          detail: `Rejected lab import from ${input.fileName ?? input.labName ?? "inline payload"} because no biomarker rows matched the local catalogue.`,
          sensitivity: "high",
          success: false,
        });
        return {
          success: false,
          error: "Lab import did not match any supported biomarkers, so nothing was stored.",
          preview,
        };
      }
      await appendArrayItem(ctx, DATA_KEYS.LAB_RESULTS, labResult);
      await auditSensitiveAction(ctx, {
        action: ACTION_KEYS.IMPORT_LAB_RESULT,
        category: "bloodwork",
        detail: `Imported lab result from ${labResult.labName} with ${preview.matchedRows} matched biomarker rows.`,
        sensitivity: "high",
        success: true,
      });
      return {
        success: true,
        labResult,
        preview,
      };
    });

    ctx.actions.register(ACTION_KEYS.GET_LAB_RESULTS, async () => ({
      labResults: await getArrayState<LabResult>(ctx, DATA_KEYS.LAB_RESULTS),
    }));

    ctx.actions.register(ACTION_KEYS.REVIEW_LAB_TRENDS, async () => ({
      trends: computeLabTrendSummary(await getArrayState<LabResult>(ctx, DATA_KEYS.LAB_RESULTS)),
      bloodworkTrends: getBloodworkTrends(await getArrayState<LabResult>(ctx, DATA_KEYS.LAB_RESULTS)),
    }));

    ctx.actions.register(ACTION_KEYS.GET_BLOODWORK_TRENDS, async () => ({
      trends: getBloodworkTrends(await getArrayState<LabResult>(ctx, DATA_KEYS.LAB_RESULTS)),
    }));

    ctx.actions.register(ACTION_KEYS.GET_BLOODWORK_BIOMARKERS, async (params: any) => ({
      biomarkers: getBloodworkBiomarkers({
        category: params?.category,
        query: params?.query,
      }),
    }));

    ctx.actions.register(ACTION_KEYS.GET_BLOODWORK_BIOMARKER, async (params: any) => ({
      biomarker: params?.id ? getBloodworkBiomarker(params.id) : getBloodworkBiomarker(params?.query ?? ""),
    }));

    ctx.actions.register(ACTION_KEYS.GET_BLOODWORK_CLOCKS, async () => ({
      clocks: getBloodworkClockDescriptors(),
    }));

    ctx.actions.register(ACTION_KEYS.ANALYZE_BLOODWORK, async (params: any) => {
      const input = validateBloodworkAnalysisInput(params);
      const results = await getArrayState<LabResult>(ctx, DATA_KEYS.LAB_RESULTS);
      const result = results.find((entry) => entry.id === input.labResultId) ?? results.at(-1);
      if (!result) {
        return { success: false, error: "No lab result available to analyze." };
      }

      await auditSensitiveAction(ctx, {
        action: ACTION_KEYS.ANALYZE_BLOODWORK,
        category: "bloodwork",
        detail: `Analyzed bloodwork result ${result.id}.`,
        sensitivity: "high",
        success: true,
      });
      return {
        success: true,
        analysis: analyzeBloodwork(result, {
          age: input.age,
          chronologicalAge: input.chronologicalAge,
          sex: input.sex,
          clockMethod: input.clockMethod,
        }),
      };
    });

    ctx.actions.register(ACTION_KEYS.GET_BLOODWORK_CATEGORY_SCORES, async (params: any) => {
      const input = validateBloodworkAnalysisInput(params);
      const results = await getArrayState<LabResult>(ctx, DATA_KEYS.LAB_RESULTS);
      const result = results.find((entry) => entry.id === input.labResultId) ?? results.at(-1);
      if (!result) {
        return { success: false, error: "No lab result available to score." };
      }

      return {
        success: true,
        categoryScores: getBloodworkCategoryScores(result, {
          age: input.age,
          chronologicalAge: input.chronologicalAge,
          sex: input.sex,
        }),
      };
    });

    ctx.actions.register(ACTION_KEYS.CALCULATE_BIOLOGICAL_AGE, async (params: any) => {
      const input = validateBloodworkAnalysisInput(params);
      const results = await getArrayState<LabResult>(ctx, DATA_KEYS.LAB_RESULTS);
      const result = results.find((entry) => entry.id === input.labResultId) ?? results.at(-1);
      if (!result) {
        return { success: false, error: "No lab result available for biological-age calculation." };
      }

      return {
        success: true,
        biologicalAge: calculateBiologicalAge(result, {
          age: input.age,
          chronologicalAge: input.chronologicalAge,
          sex: input.sex,
          clockMethod: input.clockMethod,
        }),
      };
    });

    ctx.actions.register(ACTION_KEYS.GET_BLOODWORK_ACTION_PLAN, async (params: any) => {
      const input = validateBloodworkAnalysisInput(params);
      const results = await getArrayState<LabResult>(ctx, DATA_KEYS.LAB_RESULTS);
      const result = results.find((entry) => entry.id === input.labResultId) ?? results.at(-1);
      if (!result) {
        return { success: false, error: "No lab result available for action-plan generation." };
      }

      return {
        success: true,
        actionPlan: buildBloodworkActionPlan(result, {
          age: input.age,
          chronologicalAge: input.chronologicalAge,
          sex: input.sex,
        }),
      };
    });

    ctx.actions.register(ACTION_KEYS.ADD_HABIT, async (params: any) => {
      const habit: Habit = {
        id: generateId(),
        name: params.name,
        description: params.description,
        frequency: params.frequency ?? "daily",
        targetDays: params.targetDays,
        targetCount: params.targetCount ?? 1,
        currentStreak: 0,
      };
      await appendArrayItem(ctx, DATA_KEYS.HABITS, habit);
      return { success: true, habit };
    });

    ctx.actions.register(ACTION_KEYS.COMPLETE_HABIT, async (params: any) => {
      const completion: HabitCompletion = {
        id: generateId(),
        habitId: params.habitId,
        completedAt: toIsoDateTime(params.completedAt),
        notes: params.notes,
      };
      await appendArrayItem(ctx, DATA_KEYS.HABIT_COMPLETIONS, completion);
      const habits = await getArrayState<Habit>(ctx, DATA_KEYS.HABITS);
      const streaks = computeHabitStreaks(habits, await getArrayState<HabitCompletion>(ctx, DATA_KEYS.HABIT_COMPLETIONS));
      const updatedHabit = streaks.find((entry) => entry.habitId === params.habitId);
      if (updatedHabit) {
        await replaceById<Habit>(ctx, DATA_KEYS.HABITS, params.habitId, (habit) => ({ ...habit, currentStreak: updatedHabit.currentStreak }));
      }
      return { success: true, completion, streak: updatedHabit?.currentStreak ?? 0 };
    });

    ctx.actions.register(ACTION_KEYS.GET_HABITS, async () => ({
      habits: await getArrayState<Habit>(ctx, DATA_KEYS.HABITS),
    }));

    ctx.actions.register(ACTION_KEYS.GET_HABITS_STREAKS, async () => {
      const habits = await getArrayState<Habit>(ctx, DATA_KEYS.HABITS);
      const completions = await getArrayState<HabitCompletion>(ctx, DATA_KEYS.HABIT_COMPLETIONS);
      return { streaks: computeHabitStreaks(habits, completions) };
    });

    ctx.actions.register(ACTION_KEYS.LOG_RECOVERY, async (params: any) => {
      const status: RecoveryStatus = {
        date: toIsoDate(params.date),
        score: params.score ?? 50,
        overall: params.overall ?? (params.score >= 75 ? "green" : params.score >= 45 ? "yellow" : "red"),
        recommendation: params.recommendation,
        source: params.source ?? "manual",
      };
      await appendArrayItem(ctx, DATA_KEYS.RECOVERY_STATUS, status);
      return { success: true, recovery: status };
    });

    ctx.actions.register(ACTION_KEYS.GET_RECOVERY, async (params: any) => {
      const range = parseRangeWindow(params ?? { days: 7 });
      const recovery = await getArrayState<RecoveryStatus>(ctx, DATA_KEYS.RECOVERY_STATUS);
      return { recovery: recovery.filter((entry) => withinRange(`${entry.date}T00:00:00Z`, range)) };
    });

    ctx.actions.register(ACTION_KEYS.GET_RECOVERY_RECOMMENDATION, async () => {
      const recovery = await getArrayState<RecoveryStatus>(ctx, DATA_KEYS.RECOVERY_STATUS);
      const workouts = await getArrayState<WorkoutLog>(ctx, DATA_KEYS.WORKOUT_LOGS);
      return computeRecoveryRecommendation(recovery, workouts);
    });

    ctx.actions.register(ACTION_KEYS.ADD_SUPPLEMENT, async (params: any) => {
      const supplement: Supplement = {
        id: generateId(),
        name: params.name,
        dosage: params.dosage ?? "",
        frequency: params.frequency ?? "daily",
        times: params.times ?? [],
        purpose: params.purpose,
        active: params.active ?? true,
      };
      await appendArrayItem(ctx, DATA_KEYS.SUPPLEMENTS, supplement);
      return { success: true, supplement };
    });

    ctx.actions.register(ACTION_KEYS.LOG_SUPPLEMENT, async (params: any) => {
      const log: SupplementLog = {
        id: generateId(),
        supplementId: params.supplementId,
        takenAt: toIsoDateTime(params.takenAt),
        taken: params.taken ?? true,
        notes: params.notes,
      };
      await appendArrayItem(ctx, DATA_KEYS.SUPPLEMENT_LOGS, log);
      return { success: true, supplementLog: log };
    });

    ctx.actions.register(ACTION_KEYS.GET_SUPPLEMENTS, async () => ({
      supplements: await getArrayState<Supplement>(ctx, DATA_KEYS.SUPPLEMENTS),
      supplementLogs: await getArrayState<SupplementLog>(ctx, DATA_KEYS.SUPPLEMENT_LOGS),
    }));

    ctx.actions.register(ACTION_KEYS.PREVIEW_DNA_IMPORT, async (params: any) => {
      if (!(await ensureGeneticsEnabled(ctx))) {
        return geneticsDisabledResult({ preview: null });
      }
      const input = validateDnaImportParams(params);
      return {
        success: true,
        preview: presentDnaReport(createDnaReport({
          rawData: input.rawData,
          fileName: input.fileName,
          notes: input.notes,
          privacyMode: input.privacyMode ?? (await getDnaSettings(ctx)).privacyMode,
          allowAncestryInference: (await getHealthPolicy(ctx)).allowAncestryInference,
          retainVariantLevelData: (await getHealthPolicy(ctx)).retainVariantLevelData,
        })),
      };
    });

    ctx.actions.register(ACTION_KEYS.ADD_DNA_REPORT, async (params: any) => {
      if (!(await ensureGeneticsEnabled(ctx))) {
        return geneticsDisabledResult({ dnaReport: null });
      }
      const input = validateDnaImportParams(params);
      const settings = await getDnaSettings(ctx);
      const policy = await getHealthPolicy(ctx);
      const report = createDnaReport({
        rawData: input.rawData,
        fileName: input.fileName,
        notes: input.notes,
        source: params.source,
        variants: params.variants,
        healthInsights: params.healthInsights,
        ancestryComposition: params.ancestryComposition,
        rawSnpsImported: params.rawSnpsImported,
        snpsMatchedToKnowledgeBase: params.snpsMatchedToKnowledgeBase,
        privacyMode: input.privacyMode ?? settings.privacyMode,
        allowAncestryInference: policy.allowAncestryInference,
        retainVariantLevelData: policy.retainVariantLevelData && (input.privacyMode ?? settings.privacyMode) !== "privacy",
      });
      const existingReports = await getArrayState<DnaReport>(ctx, DATA_KEYS.DNA_REPORTS);
      const duplicate = findDuplicateDnaReport(existingReports, report);
      if (duplicate) {
        return {
          success: true,
          dnaReport: presentDnaReport(duplicate),
          duplicate: true,
          settings: await getDnaSettings(ctx),
          policy,
          reportSummary: duplicate.isPrivacyRestricted ? null : summarizeReport(duplicate),
        };
      }
      await appendArrayItem(ctx, DATA_KEYS.DNA_REPORTS, report);
      const updatedSettings = await setDnaSettings(ctx, {
        lastImport: report.uploadDate,
        preferredReportSource: "genetichealth",
        privacyMode: report.privacyMode ?? DEFAULT_DNA_SETTINGS.privacyMode,
      });
      await setHealthPolicy(ctx, derivePolicy(updatedSettings));
      await auditSensitiveAction(ctx, {
        action: ACTION_KEYS.ADD_DNA_REPORT,
        category: "dna",
        detail: report.isPrivacyRestricted
          ? `Stored privacy-restricted DNA report ${report.id}.`
          : `Stored DNA report ${report.id} with ${report.snpsMatchedToKnowledgeBase} curated matches.`,
        sensitivity: "high",
        success: true,
      });
      return {
        success: true,
        dnaReport: presentDnaReport(report),
        settings: updatedSettings,
        policy: await getHealthPolicy(ctx),
        reportSummary: report.isPrivacyRestricted ? null : summarizeReport(report),
      };
    });

    ctx.actions.register(ACTION_KEYS.GET_DNA_REPORTS, async (params: any) => {
      if (!(await ensureGeneticsEnabled(ctx))) {
        return geneticsDisabledResult({ dnaReports: [] });
      }
      const reports = await getArrayState<DnaReport>(ctx, DATA_KEYS.DNA_REPORTS);
      const hasRestricted = reports.some((report) => report.isPrivacyRestricted);
      if (hasRestricted && params?.confirmSensitive) {
        await auditSensitiveAction(ctx, {
          action: ACTION_KEYS.GET_DNA_REPORTS,
          category: "dna",
          detail: "Confirmed access to privacy-restricted DNA report summaries.",
          sensitivity: "high",
          success: true,
        });
        await recordConsent(ctx, {
          action: ACTION_KEYS.GET_DNA_REPORTS,
          scope: "dna-access",
          detail: "Confirmed access to privacy-restricted DNA report summaries.",
          reason: params?.reason,
        });
      }
      return {
        dnaReports: reports.map((report) => presentDnaReport(report, {
          includeSensitiveDerived: Boolean(params?.confirmSensitive),
        })),
        settings: await getDnaSettings(ctx),
        policy: await getHealthPolicy(ctx),
        ...(hasRestricted && !params?.confirmSensitive
          ? { warning: "Privacy-restricted DNA reports were redacted. Pass confirmSensitive=true to include derived genetics findings." }
          : {}),
      };
    });

    ctx.actions.register(ACTION_KEYS.GET_DNA_KNOWLEDGE_BASE_STATUS, async () => ({
      success: true,
      status: getDnaKnowledgeBaseStatus(),
    }));

    ctx.actions.register(ACTION_KEYS.GET_DNA_INSIGHTS, async (params: any) => {
      if (!(await ensureGeneticsEnabled(ctx))) {
        return geneticsDisabledResult({ dnaInsights: [] });
      }
      const reports = await getArrayState<DnaReport>(ctx, DATA_KEYS.DNA_REPORTS);
      if (params?.reportId) {
        const report = reports.find((entry) => entry.id === params.reportId);
        const access = await confirmRestrictedDnaSummaryAccess(ctx, {
          action: ACTION_KEYS.GET_DNA_INSIGHTS,
          params,
          report,
          detail: report ? `Confirmed privacy-restricted DNA insight access for ${report.id}.` : "Confirmed privacy-restricted DNA insight access.",
          error: "DNA insights require explicit confirmation in privacy mode.",
        });
        if (!access.allowed) {
          return { dnaInsights: [], error: access.error };
        }
        return { dnaInsights: report?.healthInsights ?? [] };
      }
      const restrictedReports = reports.filter((report) => report.isPrivacyRestricted);
      if (restrictedReports.length && params?.confirmSensitive) {
        await auditSensitiveAction(ctx, {
          action: ACTION_KEYS.GET_DNA_INSIGHTS,
          category: "dna",
          detail: "Confirmed aggregated DNA insight access including privacy-restricted reports.",
          sensitivity: "high",
          success: true,
        });
        await recordConsent(ctx, {
          action: ACTION_KEYS.GET_DNA_INSIGHTS,
          scope: "dna-access",
          detail: "Confirmed aggregated DNA insight access including privacy-restricted reports.",
          reason: params?.reason,
        });
      }
      const visibleReports = restrictedReports.length && !params?.confirmSensitive
        ? reports.filter((report) => !report.isPrivacyRestricted)
        : reports;
      return {
        dnaInsights: visibleReports.flatMap((report) => report.healthInsights),
        ...(restrictedReports.length && !params?.confirmSensitive
          ? { warning: "Privacy-restricted reports were omitted. Pass confirmSensitive=true to include them." }
          : {}),
      };
    });

    ctx.actions.register(ACTION_KEYS.GET_DNA_INSIGHTS_BY_CATEGORY, async (params: any) => {
      if (!(await ensureGeneticsEnabled(ctx))) {
        return geneticsDisabledResult({ dnaInsights: [] });
      }
      const reports = await getArrayState<DnaReport>(ctx, DATA_KEYS.DNA_REPORTS);
      const restrictedReports = reports.filter((report) => report.isPrivacyRestricted);
      if (restrictedReports.length && params?.confirmSensitive) {
        await auditSensitiveAction(ctx, {
          action: ACTION_KEYS.GET_DNA_INSIGHTS_BY_CATEGORY,
          category: "dna",
          detail: `Confirmed category-filtered DNA insight access for ${params.category} including privacy-restricted reports.`,
          sensitivity: "high",
          success: true,
        });
        await recordConsent(ctx, {
          action: ACTION_KEYS.GET_DNA_INSIGHTS_BY_CATEGORY,
          scope: "dna-access",
          detail: `Confirmed category-filtered DNA insight access for ${params.category} including privacy-restricted reports.`,
          reason: params?.reason,
        });
      }
      const visibleReports = restrictedReports.length && !params?.confirmSensitive
        ? reports.filter((report) => !report.isPrivacyRestricted)
        : reports;
      const insights = visibleReports.flatMap((report) => report.healthInsights).filter((insight) => insight.category === params.category);
      return {
        dnaInsights: insights,
        ...(restrictedReports.length && !params?.confirmSensitive
          ? { warning: "Privacy-restricted reports were omitted. Pass confirmSensitive=true to include them." }
          : {}),
      };
    });

    ctx.actions.register(ACTION_KEYS.GET_DNA_VARIANTS, async (params: any) => {
      if (!(await ensureGeneticsEnabled(ctx))) {
        return geneticsDisabledResult({ dnaVariants: [] });
      }
      const reports = await getArrayState<DnaReport>(ctx, DATA_KEYS.DNA_REPORTS);
      const report = reports.find((entry) => entry.id === params.reportId) ?? reports.at(-1);
      const policy = await getHealthPolicy(ctx);
      if (report?.isPrivacyRestricted && !canAccessSensitiveDna({ report, policy, confirmed: params?.confirmSensitive })) {
        return { dnaVariants: [], error: "Variant-level DNA access requires explicit confirmation in privacy mode." };
      }
      if (report?.isPrivacyRestricted) {
        await auditSensitiveAction(ctx, {
          action: ACTION_KEYS.GET_DNA_VARIANTS,
          category: "dna",
          detail: `Accessed privacy-restricted variants for ${report.id}.`,
          sensitivity: "high",
          success: true,
        });
        await recordConsent(ctx, {
          action: ACTION_KEYS.GET_DNA_VARIANTS,
          scope: "dna-access",
          detail: `Confirmed privacy-restricted variant access for ${report.id}.`,
          reportId: report.id,
          reason: params?.reason,
        });
      }
      return { dnaVariants: report?.variants ?? [] };
    });

    ctx.actions.register(ACTION_KEYS.GET_DNA_VARIANT_DETAIL, async (params: any) => {
      if (!(await ensureGeneticsEnabled(ctx))) {
        return geneticsDisabledResult({ detail: null });
      }
      const reports = await getArrayState<DnaReport>(ctx, DATA_KEYS.DNA_REPORTS);
      const report = reports.find((entry) => entry.id === params.reportId) ?? reports.at(-1);
      const policy = await getHealthPolicy(ctx);
      if (report?.isPrivacyRestricted && !canAccessSensitiveDna({ report, policy, confirmed: params?.confirmSensitive })) {
        return { detail: null, error: "Variant detail requires explicit confirmation in privacy mode." };
      }
      if (report?.isPrivacyRestricted) {
        await auditSensitiveAction(ctx, {
          action: ACTION_KEYS.GET_DNA_VARIANT_DETAIL,
          category: "dna",
          detail: `Accessed variant detail ${params.rsId} for privacy-restricted report ${report.id}.`,
          sensitivity: "high",
          success: true,
        });
        await recordConsent(ctx, {
          action: ACTION_KEYS.GET_DNA_VARIANT_DETAIL,
          scope: "dna-access",
          detail: `Confirmed privacy-restricted variant detail access for ${report.id}.`,
          reportId: report.id,
          reason: params?.reason,
        });
      }
      return { detail: report ? findVariantDetail(report, params.rsId) : null };
    });

    ctx.actions.register(ACTION_KEYS.LOOKUP_RSID, async (params: any) => {
      if (!(await ensureGeneticsEnabled(ctx))) {
        return geneticsDisabledResult({ matches: [] });
      }
      const reports = await getArrayState<DnaReport>(ctx, DATA_KEYS.DNA_REPORTS);
      const policy = await getHealthPolicy(ctx);
      const matches = lookupRsidAcrossReports(reports, params.rsId).filter((entry) => {
        const report = reports.find((item) => item.id === entry.reportId);
        return !report?.isPrivacyRestricted || canAccessSensitiveDna({ report, policy, confirmed: params?.confirmSensitive });
      });
      return { matches };
    });

    ctx.actions.register(ACTION_KEYS.ANNOTATE_VARIANT, async (params: any) => {
      if (!(await ensureGeneticsEnabled(ctx))) {
        return geneticsDisabledResult({ dnaReport: null });
      }
      const reports = await getArrayState<DnaReport>(ctx, DATA_KEYS.DNA_REPORTS);
      const report = reports.find((entry) => entry.id === params.reportId) ?? null;
      const access = await confirmRestrictedDnaSummaryAccess(ctx, {
        action: ACTION_KEYS.ANNOTATE_VARIANT,
        params,
        report,
        detail: report ? `Confirmed privacy-restricted variant annotation update for ${report.id}.` : "Confirmed privacy-restricted variant annotation update.",
        error: "Variant annotation updates require explicit confirmation in privacy mode.",
      });
      if (!access.allowed) {
        return { success: false, dnaReport: null, error: access.error };
      }
      const updated = await replaceById<DnaReport>(ctx, DATA_KEYS.DNA_REPORTS, params.reportId, (existing) => annotateVariant(existing, params.rsId, params.note));
      await auditSensitiveAction(ctx, {
        action: ACTION_KEYS.ANNOTATE_VARIANT,
        category: "dna",
        detail: updated ? `Annotated variant ${params.rsId} on DNA report ${updated.id}.` : `Attempted variant annotation for missing DNA report ${params.reportId}.`,
        sensitivity: "high",
        success: Boolean(updated),
      });
      return { success: Boolean(updated), dnaReport: presentDnaReport(updated, { includeSensitiveDerived: Boolean(params?.confirmSensitive) }) };
    });

    ctx.actions.register(ACTION_KEYS.COMPARE_DNA_REPORTS, async (params: any) => {
      if (!(await ensureGeneticsEnabled(ctx))) {
        return geneticsDisabledResult({ comparison: null });
      }
      const reports = await getArrayState<DnaReport>(ctx, DATA_KEYS.DNA_REPORTS);
      const left = reports.find((report) => report.id === params.leftReportId);
      const right = reports.find((report) => report.id === params.rightReportId);
      if (!left || !right) {
        return { success: false, error: "Both reports must exist to compare them." };
      }
      const restrictedReport = [left, right].find((report) => report.isPrivacyRestricted) ?? null;
      const access = await confirmRestrictedDnaSummaryAccess(ctx, {
        action: ACTION_KEYS.COMPARE_DNA_REPORTS,
        params,
        report: restrictedReport,
        detail: `Confirmed privacy-restricted DNA comparison between ${left.id} and ${right.id}.`,
        error: "Comparing privacy-restricted DNA reports requires explicit confirmation.",
      });
      if (!access.allowed) {
        return { success: false, comparison: null, error: access.error };
      }
      await auditSensitiveAction(ctx, {
        action: ACTION_KEYS.COMPARE_DNA_REPORTS,
        category: "dna",
        detail: `Compared DNA reports ${left.id} and ${right.id}.`,
        sensitivity: restrictedReport ? "high" : "moderate",
        success: true,
      });
      return { success: true, comparison: compareDnaReports(left, right) };
    });

    ctx.actions.register(ACTION_KEYS.GET_DNA_PRIORITY_FINDINGS, async (params: any) => {
      if (!(await ensureGeneticsEnabled(ctx))) {
        return geneticsDisabledResult({ priorityFindings: [] });
      }
      const reports = await getArrayState<DnaReport>(ctx, DATA_KEYS.DNA_REPORTS);
      const report = reports.find((entry) => entry.id === params?.reportId) ?? reports.at(-1);
      const access = await confirmRestrictedDnaSummaryAccess(ctx, {
        action: ACTION_KEYS.GET_DNA_PRIORITY_FINDINGS,
        params,
        report,
        detail: report ? `Confirmed privacy-restricted priority findings access for ${report.id}.` : "Confirmed privacy-restricted priority findings access.",
        error: "Priority genetics findings require explicit confirmation in privacy mode.",
      });
      if (!access.allowed) {
        return { priorityFindings: [], error: access.error };
      }
      return { priorityFindings: report ? getPriorityFindings(report) : [] };
    });

    ctx.actions.register(ACTION_KEYS.GET_DNA_DISEASE_RISKS, async (params: any) => {
      if (!(await ensureGeneticsEnabled(ctx))) {
        return geneticsDisabledResult({ diseaseRisks: [] });
      }
      const reports = await getArrayState<DnaReport>(ctx, DATA_KEYS.DNA_REPORTS);
      const report = reports.find((entry) => entry.id === params?.reportId) ?? reports.at(-1);
      const access = await confirmRestrictedDnaSummaryAccess(ctx, {
        action: ACTION_KEYS.GET_DNA_DISEASE_RISKS,
        params,
        report,
        detail: report ? `Confirmed privacy-restricted disease-risk access for ${report.id}.` : "Confirmed privacy-restricted disease-risk access.",
        error: "Disease-risk summaries require explicit confirmation in privacy mode.",
      });
      if (!access.allowed) {
        return { diseaseRisks: [], error: access.error };
      }
      return { diseaseRisks: report ? summarizeDiseaseRisks(report) : [] };
    });

    ctx.actions.register(ACTION_KEYS.GET_DNA_PHARMACOGENOMICS, async (params: any) => {
      if (!(await ensureGeneticsEnabled(ctx))) {
        return geneticsDisabledResult({ pharmacogenomics: [] });
      }
      const reports = await getArrayState<DnaReport>(ctx, DATA_KEYS.DNA_REPORTS);
      const report = reports.find((entry) => entry.id === params?.reportId) ?? reports.at(-1);
      const access = await confirmRestrictedDnaSummaryAccess(ctx, {
        action: ACTION_KEYS.GET_DNA_PHARMACOGENOMICS,
        params,
        report,
        detail: report ? `Confirmed privacy-restricted pharmacogenomic access for ${report.id}.` : "Confirmed privacy-restricted pharmacogenomic access.",
        error: "Pharmacogenomic summaries require explicit confirmation in privacy mode.",
      });
      if (!access.allowed) {
        return { pharmacogenomics: [], error: access.error };
      }
      return { pharmacogenomics: report ? summarizePharmacogenomics(report) : [] };
    });

    ctx.actions.register(ACTION_KEYS.GET_DNA_PATHWAYS, async (params: any) => {
      if (!(await ensureGeneticsEnabled(ctx))) {
        return geneticsDisabledResult({ pathways: [] });
      }
      const reports = await getArrayState<DnaReport>(ctx, DATA_KEYS.DNA_REPORTS);
      const report = reports.find((entry) => entry.id === params?.reportId) ?? reports.at(-1);
      const access = await confirmRestrictedDnaSummaryAccess(ctx, {
        action: ACTION_KEYS.GET_DNA_PATHWAYS,
        params,
        report,
        detail: report ? `Confirmed privacy-restricted pathway access for ${report.id}.` : "Confirmed privacy-restricted pathway access.",
        error: "Pathway summaries require explicit confirmation in privacy mode.",
      });
      if (!access.allowed) {
        return { pathways: [], error: access.error };
      }
      return { pathways: report ? summarizeGeneticPathways(report) : [] };
    });

    ctx.actions.register(ACTION_KEYS.GET_DNA_TRAITS, async (params: any) => {
      if (!(await ensureGeneticsEnabled(ctx))) {
        return geneticsDisabledResult({ traits: [] });
      }
      const reports = await getArrayState<DnaReport>(ctx, DATA_KEYS.DNA_REPORTS);
      const report = reports.find((entry) => entry.id === params?.reportId) ?? reports.at(-1);
      const access = await confirmRestrictedDnaSummaryAccess(ctx, {
        action: ACTION_KEYS.GET_DNA_TRAITS,
        params,
        report,
        detail: report ? `Confirmed privacy-restricted trait access for ${report.id}.` : "Confirmed privacy-restricted trait access.",
        error: "Trait summaries require explicit confirmation in privacy mode.",
      });
      if (!access.allowed) {
        return { traits: [], error: access.error };
      }
      return { traits: report ? summarizeTraits(report) : [] };
    });

    ctx.actions.register(ACTION_KEYS.GET_DNA_CARRIER_STATUS, async (params: any) => {
      if (!(await ensureGeneticsEnabled(ctx))) {
        return geneticsDisabledResult({ carrierStatus: [] });
      }
      const reports = await getArrayState<DnaReport>(ctx, DATA_KEYS.DNA_REPORTS);
      const report = reports.find((entry) => entry.id === params?.reportId) ?? reports.at(-1);
      const access = await confirmRestrictedDnaSummaryAccess(ctx, {
        action: ACTION_KEYS.GET_DNA_CARRIER_STATUS,
        params,
        report,
        detail: report ? `Confirmed carrier-status access for ${report.id}.` : "Confirmed carrier-status access.",
        error: "Carrier-level detail requires explicit confirmation in privacy mode.",
      });
      if (!access.allowed) {
        return { carrierStatus: [], error: access.error };
      }
      return { carrierStatus: report ? getCarrierStatus(report) : [] };
    });

    ctx.actions.register(ACTION_KEYS.GET_DNA_PROTECTIVE_VARIANTS, async (params: any) => {
      if (!(await ensureGeneticsEnabled(ctx))) {
        return geneticsDisabledResult({ protectiveVariants: [] });
      }
      const reports = await getArrayState<DnaReport>(ctx, DATA_KEYS.DNA_REPORTS);
      const report = reports.find((entry) => entry.id === params?.reportId) ?? reports.at(-1);
      const access = await confirmRestrictedDnaSummaryAccess(ctx, {
        action: ACTION_KEYS.GET_DNA_PROTECTIVE_VARIANTS,
        params,
        report,
        detail: report ? `Confirmed privacy-restricted protective-variant access for ${report.id}.` : "Confirmed privacy-restricted protective-variant access.",
        error: "Protective genetics findings require explicit confirmation in privacy mode.",
      });
      if (!access.allowed) {
        return { protectiveVariants: [], error: access.error };
      }
      return { protectiveVariants: report ? getProtectiveVariants(report) : [] };
    });

    ctx.actions.register(ACTION_KEYS.GET_DNA_MONITORING_PLAN, async (params: any) => {
      if (!(await ensureGeneticsEnabled(ctx))) {
        return geneticsDisabledResult({ monitoringPlan: [] });
      }
      const reports = await getArrayState<DnaReport>(ctx, DATA_KEYS.DNA_REPORTS);
      const report = reports.find((entry) => entry.id === params?.reportId) ?? reports.at(-1);
      const access = await confirmRestrictedDnaSummaryAccess(ctx, {
        action: ACTION_KEYS.GET_DNA_MONITORING_PLAN,
        params,
        report,
        detail: report ? `Confirmed privacy-restricted monitoring-plan access for ${report.id}.` : "Confirmed privacy-restricted monitoring-plan access.",
        error: "Monitoring-plan access requires explicit confirmation in privacy mode.",
      });
      if (!access.allowed) {
        return { monitoringPlan: [], error: access.error };
      }
      return { monitoringPlan: report ? getMonitoringPlan(report) : [] };
    });

    ctx.actions.register(ACTION_KEYS.GET_DNA_SUPPLEMENT_RECOMMENDATIONS, async (params: any) => {
      if (!(await ensureGeneticsEnabled(ctx))) {
        return geneticsDisabledResult({ supplementRecommendations: [] });
      }
      const reports = await getArrayState<DnaReport>(ctx, DATA_KEYS.DNA_REPORTS);
      const report = reports.find((entry) => entry.id === params?.reportId) ?? reports.at(-1);
      const access = await confirmRestrictedDnaSummaryAccess(ctx, {
        action: ACTION_KEYS.GET_DNA_SUPPLEMENT_RECOMMENDATIONS,
        params,
        report,
        detail: report ? `Confirmed privacy-restricted supplement recommendation access for ${report.id}.` : "Confirmed privacy-restricted supplement recommendation access.",
        error: "Supplement recommendations require explicit confirmation in privacy mode.",
      });
      if (!access.allowed) {
        return { supplementRecommendations: [], error: access.error };
      }
      return { supplementRecommendations: report ? getSupplementRecommendations(report) : [] };
    });

    ctx.actions.register(ACTION_KEYS.GET_DNA_BLOODWORK_CORRELATIONS, async (params: any) => {
      if (!(await ensureGeneticsEnabled(ctx))) {
        return geneticsDisabledResult({ correlations: [] });
      }
      const reports = await getArrayState<DnaReport>(ctx, DATA_KEYS.DNA_REPORTS);
      const report = reports.find((entry) => entry.id === params?.reportId) ?? reports.at(-1);
      const results = await getArrayState<LabResult>(ctx, DATA_KEYS.LAB_RESULTS);
      const result = results.find((entry) => entry.id === params?.labResultId) ?? results.at(-1);
      if (!report || !result) {
        return { correlations: [], error: "A DNA report and lab result are both required for cross-analysis." };
      }
      const access = await confirmRestrictedDnaSummaryAccess(ctx, {
        action: ACTION_KEYS.GET_DNA_BLOODWORK_CORRELATIONS,
        params,
        report,
        detail: `Confirmed privacy-restricted DNA-to-bloodwork correlation access for ${report.id}.`,
        error: "DNA-to-bloodwork correlations require explicit confirmation in privacy mode.",
      });
      if (!access.allowed) {
        return { correlations: [], error: access.error };
      }
      return { correlations: correlateDnaWithBloodwork(report, result) };
    });

    ctx.actions.register(ACTION_KEYS.EXPORT_DNA_INSIGHTS, async (params: any) => {
      if (!(await ensureGeneticsEnabled(ctx))) {
        return geneticsDisabledResult({ markdown: "" });
      }
      const reports = await getArrayState<DnaReport>(ctx, DATA_KEYS.DNA_REPORTS);
      const report = reports.find((entry) => entry.id === params.reportId) ?? reports.at(-1);
      const policy = await getHealthPolicy(ctx);
      const includeSensitive = params?.includeSensitive === true;
      if (includeSensitive) {
        validateSensitiveConfirmation(params?.confirmSensitive);
      }
      if (includeSensitive && !canExportSensitiveDna({ report, policy, includeSensitive, confirmed: params?.confirmSensitive })) {
        return { markdown: "Sensitive DNA export is disabled until privacy settings explicitly allow it.", error: "Sensitive export disabled." };
      }
      const markdown = report ? exportDnaInsightsMarkdown(report, { includeSensitive }) : "No DNA report available.";
      if (report) {
        await auditSensitiveAction(ctx, {
          action: ACTION_KEYS.EXPORT_DNA_INSIGHTS,
          category: "export",
          detail: includeSensitive ? `Exported sensitive DNA insights for ${report.id}.` : `Exported privacy-safe DNA summary for ${report.id}.`,
          sensitivity: includeSensitive ? "high" : "moderate",
          success: true,
        });
        if (includeSensitive) {
          await recordConsent(ctx, {
            action: ACTION_KEYS.EXPORT_DNA_INSIGHTS,
            scope: "dna-export",
            detail: `Confirmed sensitive DNA insights export for ${report.id}.`,
            reportId: report.id,
            reason: params?.reason,
          });
        }
      }
      return { markdown };
    });

    ctx.actions.register(ACTION_KEYS.EXPORT_DNA_COMPREHENSIVE_REPORT, async (params: any) => {
      if (!(await ensureGeneticsEnabled(ctx))) {
        return geneticsDisabledResult({ markdown: "" });
      }
      const reports = await getArrayState<DnaReport>(ctx, DATA_KEYS.DNA_REPORTS);
      const report = reports.find((entry) => entry.id === params.reportId) ?? reports.at(-1);
      const policy = await getHealthPolicy(ctx);
      const includeSensitive = params?.includeSensitive === true;
      if (includeSensitive) {
        validateSensitiveConfirmation(params?.confirmSensitive);
      }
      if (includeSensitive && !canExportSensitiveDna({ report, policy, includeSensitive, confirmed: params?.confirmSensitive })) {
        return { markdown: "Sensitive DNA export is disabled until privacy settings explicitly allow it.", error: "Sensitive export disabled." };
      }
      const markdown = report ? exportComprehensiveDnaMarkdown(report, { includeSensitive }) : "No DNA report available.";
      if (report) {
        await auditSensitiveAction(ctx, {
          action: ACTION_KEYS.EXPORT_DNA_COMPREHENSIVE_REPORT,
          category: "export",
          detail: includeSensitive ? `Exported sensitive comprehensive DNA report for ${report.id}.` : `Exported privacy-safe comprehensive DNA report for ${report.id}.`,
          sensitivity: includeSensitive ? "high" : "moderate",
          success: true,
        });
        if (includeSensitive) {
          await recordConsent(ctx, {
            action: ACTION_KEYS.EXPORT_DNA_COMPREHENSIVE_REPORT,
            scope: "dna-export",
            detail: `Confirmed sensitive comprehensive DNA export for ${report.id}.`,
            reportId: report.id,
            reason: params?.reason,
          });
        }
      }
      return { markdown };
    });

    ctx.actions.register(ACTION_KEYS.REANALYZE_DNA_REPORT, async (params: any) => {
      if (!(await ensureGeneticsEnabled(ctx))) {
        return geneticsDisabledResult({ diff: null, dnaReport: null });
      }
      validateSensitiveConfirmation(params?.confirmSensitive);
      const reports = await getArrayState<DnaReport>(ctx, DATA_KEYS.DNA_REPORTS);
      const report = reports.find((entry) => entry.id === params?.reportId) ?? reports.at(-1);
      if (!report) {
        return { success: false, error: "No DNA report available to reanalyze." };
      }
      if (!(report.retainedGenotypes?.length || report.variants.length)) {
        return { success: false, error: "This DNA report does not retain variant-level data, so it cannot be reanalyzed without reimporting." };
      }
      const { reanalyzedReport, diff } = reanalyzeDnaReport(report);
      const updated = await replaceById<DnaReport>(ctx, DATA_KEYS.DNA_REPORTS, report.id, () => reanalyzedReport);
      await recordConsent(ctx, {
        action: ACTION_KEYS.REANALYZE_DNA_REPORT,
        scope: "dna-reanalysis",
        detail: `Confirmed DNA reanalysis for ${report.id}.`,
        reportId: report.id,
        reason: params?.reason,
      });
      await auditSensitiveAction(ctx, {
        action: ACTION_KEYS.REANALYZE_DNA_REPORT,
        category: "dna",
        detail: `Reanalyzed DNA report ${report.id} against ${diff.currentKnowledgeBaseVersion}.`,
        sensitivity: "high",
        success: true,
      });
      return { success: Boolean(updated), dnaReport: presentDnaReport(updated), diff };
    });

    ctx.actions.register(ACTION_KEYS.MINIMIZE_DNA_REPORT, async (params: any) => {
      if (!(await ensureGeneticsEnabled(ctx))) {
        return geneticsDisabledResult({ dnaReport: null });
      }
      validateSensitiveConfirmation(params?.confirmSensitive);
      const updated = await replaceById<DnaReport>(ctx, DATA_KEYS.DNA_REPORTS, params.reportId, (report) => minimizeDnaReport(report));
      if (updated) {
        await recordConsent(ctx, {
          action: ACTION_KEYS.MINIMIZE_DNA_REPORT,
          scope: "privacy-change",
          detail: `Confirmed destructive DNA minimization for ${updated.id}.`,
          reportId: updated.id,
          reason: params?.reason,
        });
      }
      await auditSensitiveAction(ctx, {
        action: ACTION_KEYS.MINIMIZE_DNA_REPORT,
        category: "privacy",
        detail: updated ? `Minimized stored DNA report ${updated.id}.` : `Attempted minimization for missing DNA report ${params.reportId}.`,
        sensitivity: "high",
        success: Boolean(updated),
      });
      return { success: Boolean(updated), dnaReport: presentDnaReport(updated) };
    });

    ctx.actions.register(ACTION_KEYS.DELETE_DNA_REPORT, async (params: any) => {
      if (!(await ensureGeneticsEnabled(ctx))) {
        return geneticsDisabledResult({ dnaReport: null });
      }
      const removed = await removeById<DnaReport>(ctx, DATA_KEYS.DNA_REPORTS, params.id);
      await auditSensitiveAction(ctx, {
        action: ACTION_KEYS.DELETE_DNA_REPORT,
        category: "dna",
        detail: removed ? `Deleted DNA report ${removed.id}.` : `Attempted delete for missing DNA report ${params.id}.`,
        sensitivity: "high",
        success: Boolean(removed),
      });
      return { success: Boolean(removed), dnaReport: removed };
    });

    ctx.actions.register(ACTION_KEYS.UPDATE_PRIVACY_SETTINGS, async (params: any) => {
      const next = validatePrivacySettingsUpdate(params);
      const settings = await setDnaSettings(ctx, next);
      const policy = await setHealthPolicy(ctx, derivePolicy(settings));
      await auditSensitiveAction(ctx, {
        action: ACTION_KEYS.UPDATE_PRIVACY_SETTINGS,
        category: "privacy",
        detail: `Updated privacy settings to ${policy.privacyMode} mode.`,
        sensitivity: "moderate",
        success: true,
      });
      return summarizePrivacyStatus(settings, policy);
    });

    ctx.actions.register(ACTION_KEYS.GET_PRIVACY_STATUS, async () => summarizePrivacyStatus(
      await getDnaSettings(ctx),
      await getHealthPolicy(ctx),
    ));

    ctx.actions.register(ACTION_KEYS.GET_HEALTH_AUDIT_LOG, async (params: any) => {
      const policy = await getHealthPolicy(ctx);
      validateSensitiveConfirmation(params?.confirmSensitive);
      await auditSensitiveAction(ctx, {
        action: ACTION_KEYS.GET_HEALTH_AUDIT_LOG,
        category: "privacy",
        detail: "Confirmed access to sensitive health audit log.",
        sensitivity: "high",
        success: true,
      });
      await recordConsent(ctx, {
        action: ACTION_KEYS.GET_HEALTH_AUDIT_LOG,
        scope: "audit-log-access",
        detail: "Confirmed access to sensitive health audit log.",
        reason: params?.reason,
      });
      const entries = pruneAuditLog(await getArrayState<HealthAuditEntry>(ctx, DATA_KEYS.HEALTH_AUDIT_LOG), policy.auditRetentionDays);
      return { auditLog: entries };
    });

    ctx.actions.register(ACTION_KEYS.RECORD_SENSITIVE_CONSENT, async (params: any) => {
      validateSensitiveConfirmation(params?.confirmSensitive);
      const input = validateRecordConsentParams(params);
      await recordConsent(ctx, {
        action: ACTION_KEYS.RECORD_SENSITIVE_CONSENT,
        scope: input.scope,
        detail: `Manually recorded consent note: ${input.detail}`,
        reportId: input.reportId,
        reason: input.reason,
      });
      await auditSensitiveAction(ctx, {
        action: ACTION_KEYS.RECORD_SENSITIVE_CONSENT,
        category: "privacy",
        detail: `Manually recorded a sensitive consent note for scope ${input.scope}.`,
        sensitivity: "moderate",
        success: true,
      });
      return { success: true, consent: (await getHealthConsents(ctx)).at(-1) ?? null };
    });

    ctx.actions.register(ACTION_KEYS.GET_SENSITIVE_CONSENTS, async (params: any) => {
      validateSensitiveConfirmation(params?.confirmSensitive);
      await auditSensitiveAction(ctx, {
        action: ACTION_KEYS.GET_SENSITIVE_CONSENTS,
        category: "privacy",
        detail: "Confirmed access to sensitive consent history.",
        sensitivity: "high",
        success: true,
      });
      await recordConsent(ctx, {
        action: ACTION_KEYS.GET_SENSITIVE_CONSENTS,
        scope: "consent-log-access",
        detail: "Confirmed access to sensitive consent history.",
        reason: params?.reason,
      });
      return {
        consents: await getHealthConsents(ctx),
      };
    });

    ctx.actions.register(ACTION_KEYS.PURGE_HEALTH_AUDIT_LOG, async (params: any) => {
      validateSensitiveConfirmation(params?.confirmSensitive);
      await setArrayState(ctx, DATA_KEYS.HEALTH_AUDIT_LOG, []);
      await auditSensitiveAction(ctx, {
        action: ACTION_KEYS.PURGE_HEALTH_AUDIT_LOG,
        category: "privacy",
        detail: "Purged health audit log.",
        sensitivity: "moderate",
        success: true,
      });
      return { success: true };
    });

    ctx.actions.register(ACTION_KEYS.PURGE_SENSITIVE_CONSENTS, async (params: any) => {
      validateSensitiveConfirmation(params?.confirmSensitive);
      await setArrayState(ctx, DATA_KEYS.HEALTH_CONSENTS, []);
      await auditSensitiveAction(ctx, {
        action: ACTION_KEYS.PURGE_SENSITIVE_CONSENTS,
        category: "privacy",
        detail: "Purged sensitive consent history.",
        sensitivity: "moderate",
        success: true,
      });
      return { success: true };
    });

    ctx.actions.register(ACTION_KEYS.GET_DAILY_SUMMARY, async (params: any) => {
      const date = toIsoDate(params?.date);
      const medicationLogs = (await getArrayState<MedicationLog>(ctx, DATA_KEYS.MEDICATION_LOGS)).filter((entry) => entry.takenAt.startsWith(date));
      const workouts = (await getArrayState<WorkoutLog>(ctx, DATA_KEYS.WORKOUT_LOGS)).filter((entry) => entry.performedAt.startsWith(date));
      const sleep = (await getArrayState<SleepEntry>(ctx, DATA_KEYS.SLEEP_ENTRIES)).find((entry) => entry.date === date) ?? null;
      const habits = (await getArrayState<HabitCompletion>(ctx, DATA_KEYS.HABIT_COMPLETIONS)).filter((entry) => entry.completedAt.startsWith(date));
      const recovery = (await getArrayState<RecoveryStatus>(ctx, DATA_KEYS.RECOVERY_STATUS)).find((entry) => entry.date === date) ?? null;
      const meals = (await getArrayState<MealLog>(ctx, DATA_KEYS.MEAL_LOGS)).filter((entry) => entry.date === date);
      const calorieTarget = await getStateValue<number>(ctx, DATA_KEYS.DAILY_CALORIE_TARGET, 0);
      const macros = computeMealMacros(meals.flatMap((meal) => meal.foods)) ?? undefined;
      const hydration = await getHydrationLogForDate(ctx, date);
      const goalMl = await getStateValue<number>(ctx, DATA_KEYS.DAILY_HYDRATION_GOAL_ML, DEFAULT_HYDRATION_GOAL_ML);
      const summary: DailyHealthSummary = {
        date,
        medications: medicationLogs,
        workouts,
        sleep,
        habits,
        recovery,
        nutrition: {
          caloriesConsumed: meals.reduce((acc, meal) => acc + meal.totalCalories, 0),
          calorieTarget,
          macros,
        },
        hydration: {
          totalMl: computeHydrationTotal(hydration),
          goalMl,
        },
      };
      return summary;
    });

    ctx.actions.register(ACTION_KEYS.SEND_HYDRATION_NUDGE, async (params: any) => {
      const date = toIsoDate(params?.date);
      const hydration = await getHydrationLogForDate(ctx, date);
      const goalMl = await getStateValue<number>(ctx, DATA_KEYS.DAILY_HYDRATION_GOAL_ML, DEFAULT_HYDRATION_GOAL_ML);
      const totalMl = computeHydrationTotal(hydration);
      return {
        message: totalMl >= goalMl
          ? `Hydration goal hit: ${totalMl}ml logged today.`
          : `Hydration check: ${totalMl}ml of ${goalMl}ml logged. Another ${(goalMl - totalMl)}ml would close the gap.`,
      };
    });

    ctx.actions.register(ACTION_KEYS.SEND_MEDICATION_REMINDER, async () => {
      const today = toIsoDate();
      const meds = await getArrayState<Medication>(ctx, DATA_KEYS.MEDICATIONS);
      const logs = await getArrayState<MedicationLog>(ctx, DATA_KEYS.MEDICATION_LOGS);
      const due = meds.filter((medication) => medication.active && !logs.some((log) => log.medicationId === medication.id && log.takenAt.startsWith(today)));
      return {
        dueCount: due.length,
        message: due.length
          ? `Medication reminder: ${due.map((med) => med.name).join(", ")} still have no logged dose today.`
          : "All active medications have a logged dose today.",
      };
    });

    ctx.actions.register(ACTION_KEYS.SEND_APPOINTMENT_REMINDER, async () => {
      const appointments = await getArrayState<Appointment>(ctx, DATA_KEYS.APPOINTMENTS);
      const upcoming = appointments
        .filter((appointment) => !appointment.cancelledAt && new Date(appointment.scheduledAt).getTime() >= Date.now())
        .sort((left, right) => new Date(left.scheduledAt).getTime() - new Date(right.scheduledAt).getTime())[0];
      return {
        appointment: upcoming ?? null,
        message: upcoming
          ? `${upcoming.type} with ${upcoming.provider} is next on ${new Date(upcoming.scheduledAt).toISOString()}.`
          : "No upcoming appointments on the books.",
      };
    });

    ctx.logger.info("Personal Health plugin initialized", {
      actions: Object.keys(ACTION_KEYS).length,
      dnaAnnotations: getAnnotationIndex().length,
    });
  },
});

export default plugin;
runWorker(plugin, import.meta.url);
