import { definePlugin, runWorker } from "@paperclipai/plugin-sdk";
import { ACTION_KEYS, DATA_KEYS } from "./constants.js";
import {
  annotateVariant,
  compareDnaReports,
  createDnaReport,
  exportDnaInsightsMarkdown,
  findFoodMatches,
  getFoodDetail,
  findVariantDetail,
  getAnnotationIndex,
  getPriorityFindings,
  lookupRsidAcrossReports,
  summarizeDiseaseRisks,
  summarizeGeneticPathways,
  summarizePharmacogenomics,
  summarizeReport,
} from "./dna.js";
import {
  analyzeBloodwork,
  buildBloodworkActionPlan,
  calculateBiologicalAge,
  getBloodworkBiomarker,
  getBloodworkBiomarkers,
  getBloodworkCategoryScores,
} from "./bloodwork.js";
import type {
  Appointment,
  DailyHealthSummary,
  DnaReport,
  DnaSettings,
  Habit,
  HabitCompletion,
  HealthNudge,
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

const DEFAULT_HYDRATION_GOAL_ML = 2500;
const DEFAULT_DNA_SETTINGS: DnaSettings = {
  preferredReportSource: "genetichealth",
  privacyMode: "living",
  researchOptIn: true,
};

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

async function getDnaSettings(ctx: any) {
  return getStateValue<DnaSettings>(ctx, DATA_KEYS.DNA_SETTINGS, DEFAULT_DNA_SETTINGS);
}

async function setDnaSettings(ctx: any, next: Partial<DnaSettings>) {
  const current = await getDnaSettings(ctx);
  const merged = { ...current, ...next };
  await setStateValue(ctx, DATA_KEYS.DNA_SETTINGS, merged);
  return merged;
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
  if (latestReport?.healthInsights.length) {
    const highlight = latestReport.healthInsights.find((insight) => insight.actionableRecommendation);
    if (highlight) {
      nudges.push({ key: `dna-${latestReport.id}`, category: "dna", severity: "success", message: `DNA highlight: ${highlight.title} — ${highlight.actionableRecommendation}` });
    }
  }

  return nudges;
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

    ctx.data.register("health.overview", async () => {
      const workouts = await getArrayState<WorkoutLog>(ctx, DATA_KEYS.WORKOUT_LOGS);
      const meals = await getArrayState<MealLog>(ctx, DATA_KEYS.MEAL_LOGS);
      const reports = await getArrayState<DnaReport>(ctx, DATA_KEYS.DNA_REPORTS);
      const labResults = await getArrayState<LabResult>(ctx, DATA_KEYS.LAB_RESULTS);
      return {
        workoutSummary: computeWorkoutSummary(workouts),
        mealsLogged: meals.length,
        dna: reports.at(-1) ? summarizeReport(reports.at(-1)!) : null,
        bloodwork: labResults.at(-1) ? analyzeBloodwork(labResults.at(-1)!, {}).overallSummary : null,
      };
    });

    ctx.actions.register(ACTION_KEYS.ADD_MEDICATION, async (params: any) => {
      const medication: Medication = {
        id: generateId(),
        name: params.name,
        dose: params.dose ?? "",
        frequency: params.frequency ?? "daily",
        times: params.times ?? [],
        active: params.active ?? true,
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
      const workout: WorkoutLog = {
        id: generateId(),
        type: params.type ?? "other",
        name: params.name ?? "Workout",
        performedAt: toIsoDateTime(params.performedAt),
        durationMinutes: params.durationMinutes ?? 0,
        rpe: params.rpe,
        caloriesBurned: params.caloriesBurned,
        distanceKm: params.distanceKm,
        avgPaceMinPerKm: params.avgPaceMinPerKm,
        avgHeartRate: params.avgHeartRate,
        maxHeartRate: params.maxHeartRate,
        elevationGainM: params.elevationGainM,
        stravaActivityId: params.stravaActivityId,
        exercises: params.exercises,
        laps: params.laps,
        strokeTypes: params.strokeTypes,
        source: params.source ?? "manual",
        wearableLogId: params.wearableLogId,
        rawData: params.rawData,
        notes: params.notes,
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
      return {
        success: true,
        wearable: nextStatus,
        importedSessions: params.importedSessions ?? 0,
        note: "Wearable sync scaffold updated local connection status. API polling remains a future integration boundary.",
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
      const template = plans.flatMap((plan) => plan.mealTemplates ?? []).find((entry) => entry.name.toLowerCase() === String(params.name ?? params.mealName ?? "").toLowerCase());
      const foods = (template?.typicalFoods ?? []).map((name) => ({ name, calories: Math.round((template?.targetCalories ?? 450) / Math.max((template?.typicalFoods?.length ?? 1), 1)) }));
      const meal: MealLog = {
        id: generateId(),
        date: toIsoDate(params.date),
        mealName: params.mealName ?? template?.name ?? params.name ?? "quick-meal",
        foods,
        totalCalories: params.totalCalories ?? template?.targetCalories ?? computeMealCalories(foods),
        totalMacros: params.totalMacros ?? template?.targetMacros,
        source: "manual",
        notes: params.notes ?? `Quick meal from ${template?.name ?? "recent template"}`,
      };
      await appendArrayItem(ctx, DATA_KEYS.MEAL_LOGS, meal);
      return { success: true, meal, templateFound: Boolean(template) };
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
      const dnaReports = await getArrayState<DnaReport>(ctx, DATA_KEYS.DNA_REPORTS);
      const dnaHints = dnaReports.at(-1)?.healthInsights.filter((insight) => insight.category === "nutrition" || insight.category === "metabolic").slice(0, 2).map((insight) => insight.actionableRecommendation ?? insight.title) ?? [];
      return { foods: matches, dnaHints };
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
      const appointment: Appointment = {
        id: generateId(),
        type: params.type ?? "general",
        provider: params.provider ?? "",
        scheduledAt: toIsoDateTime(params.scheduledAt),
        durationMinutes: params.durationMinutes ?? 30,
        notes: params.notes,
        prepNotes: params.prepNotes,
      };
      await appendArrayItem(ctx, DATA_KEYS.APPOINTMENTS, appointment);
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
      const result: LabResult = {
        id: generateId(),
        resultedAt: toIsoDateTime(params.resultedAt),
        labName: params.labName,
        panels: params.panels ?? [],
        notes: params.notes,
      };
      await appendArrayItem(ctx, DATA_KEYS.LAB_RESULTS, result);
      return { success: true, labResult: result };
    });

    ctx.actions.register(ACTION_KEYS.GET_LAB_RESULTS, async () => ({
      labResults: await getArrayState<LabResult>(ctx, DATA_KEYS.LAB_RESULTS),
    }));

    ctx.actions.register(ACTION_KEYS.REVIEW_LAB_TRENDS, async () => ({
      trends: computeLabTrendSummary(await getArrayState<LabResult>(ctx, DATA_KEYS.LAB_RESULTS)),
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

    ctx.actions.register(ACTION_KEYS.ANALYZE_BLOODWORK, async (params: any) => {
      const results = await getArrayState<LabResult>(ctx, DATA_KEYS.LAB_RESULTS);
      const result = results.find((entry) => entry.id === params?.labResultId) ?? results.at(-1);
      if (!result) {
        return { success: false, error: "No lab result available to analyze." };
      }

      return {
        success: true,
        analysis: analyzeBloodwork(result, {
          age: params?.age,
          chronologicalAge: params?.chronologicalAge,
          sex: params?.sex,
        }),
      };
    });

    ctx.actions.register(ACTION_KEYS.GET_BLOODWORK_CATEGORY_SCORES, async (params: any) => {
      const results = await getArrayState<LabResult>(ctx, DATA_KEYS.LAB_RESULTS);
      const result = results.find((entry) => entry.id === params?.labResultId) ?? results.at(-1);
      if (!result) {
        return { success: false, error: "No lab result available to score." };
      }

      return {
        success: true,
        categoryScores: getBloodworkCategoryScores(result, {
          age: params?.age,
          chronologicalAge: params?.chronologicalAge,
          sex: params?.sex,
        }),
      };
    });

    ctx.actions.register(ACTION_KEYS.CALCULATE_BIOLOGICAL_AGE, async (params: any) => {
      const results = await getArrayState<LabResult>(ctx, DATA_KEYS.LAB_RESULTS);
      const result = results.find((entry) => entry.id === params?.labResultId) ?? results.at(-1);
      if (!result) {
        return { success: false, error: "No lab result available for biological-age calculation." };
      }

      return {
        success: true,
        biologicalAge: calculateBiologicalAge(result, {
          age: params?.age,
          chronologicalAge: params?.chronologicalAge,
          sex: params?.sex,
        }),
      };
    });

    ctx.actions.register(ACTION_KEYS.GET_BLOODWORK_ACTION_PLAN, async (params: any) => {
      const results = await getArrayState<LabResult>(ctx, DATA_KEYS.LAB_RESULTS);
      const result = results.find((entry) => entry.id === params?.labResultId) ?? results.at(-1);
      if (!result) {
        return { success: false, error: "No lab result available for action-plan generation." };
      }

      return {
        success: true,
        actionPlan: buildBloodworkActionPlan(result, {
          age: params?.age,
          chronologicalAge: params?.chronologicalAge,
          sex: params?.sex,
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

    ctx.actions.register(ACTION_KEYS.ADD_DNA_REPORT, async (params: any) => {
      const report = createDnaReport({
        rawData: params.rawData ?? params.rawFileContent,
        fileName: params.fileName,
        notes: params.notes,
        source: params.source,
        variants: params.variants,
        healthInsights: params.healthInsights,
        ancestryComposition: params.ancestryComposition,
        rawSnpsImported: params.rawSnpsImported,
        snpsMatchedToKnowledgeBase: params.snpsMatchedToKnowledgeBase,
        privacyMode: params.privacyMode,
      });
      await appendArrayItem(ctx, DATA_KEYS.DNA_REPORTS, report);
      const settings = await setDnaSettings(ctx, {
        lastImport: report.uploadDate,
        preferredReportSource: "genetichealth",
        privacyMode: report.privacyMode ?? DEFAULT_DNA_SETTINGS.privacyMode,
      });
      return {
        success: true,
        dnaReport: report,
        settings,
        reportSummary: summarizeReport(report),
      };
    });

    ctx.actions.register(ACTION_KEYS.GET_DNA_REPORTS, async () => {
      const reports = await getArrayState<DnaReport>(ctx, DATA_KEYS.DNA_REPORTS);
      return { dnaReports: reports, settings: await getDnaSettings(ctx) };
    });

    ctx.actions.register(ACTION_KEYS.GET_DNA_INSIGHTS, async (params: any) => {
      const reports = await getArrayState<DnaReport>(ctx, DATA_KEYS.DNA_REPORTS);
      if (params?.reportId) {
        const report = reports.find((entry) => entry.id === params.reportId);
        return { dnaInsights: report?.healthInsights ?? [] };
      }
      return { dnaInsights: reports.flatMap((report) => report.healthInsights) };
    });

    ctx.actions.register(ACTION_KEYS.GET_DNA_INSIGHTS_BY_CATEGORY, async (params: any) => {
      const reports = await getArrayState<DnaReport>(ctx, DATA_KEYS.DNA_REPORTS);
      const insights = reports.flatMap((report) => report.healthInsights).filter((insight) => insight.category === params.category);
      return { dnaInsights: insights };
    });

    ctx.actions.register(ACTION_KEYS.GET_DNA_VARIANTS, async (params: any) => {
      const reports = await getArrayState<DnaReport>(ctx, DATA_KEYS.DNA_REPORTS);
      const report = reports.find((entry) => entry.id === params.reportId) ?? reports.at(-1);
      return { dnaVariants: report?.variants ?? [] };
    });

    ctx.actions.register(ACTION_KEYS.GET_DNA_VARIANT_DETAIL, async (params: any) => {
      const reports = await getArrayState<DnaReport>(ctx, DATA_KEYS.DNA_REPORTS);
      const report = reports.find((entry) => entry.id === params.reportId) ?? reports.at(-1);
      return { detail: report ? findVariantDetail(report, params.rsId) : null };
    });

    ctx.actions.register(ACTION_KEYS.LOOKUP_RSID, async (params: any) => ({
      matches: lookupRsidAcrossReports(await getArrayState<DnaReport>(ctx, DATA_KEYS.DNA_REPORTS), params.rsId),
    }));

    ctx.actions.register(ACTION_KEYS.ANNOTATE_VARIANT, async (params: any) => {
      const updated = await replaceById<DnaReport>(ctx, DATA_KEYS.DNA_REPORTS, params.reportId, (report) => annotateVariant(report, params.rsId, params.note));
      return { success: Boolean(updated), dnaReport: updated };
    });

    ctx.actions.register(ACTION_KEYS.COMPARE_DNA_REPORTS, async (params: any) => {
      const reports = await getArrayState<DnaReport>(ctx, DATA_KEYS.DNA_REPORTS);
      const left = reports.find((report) => report.id === params.leftReportId);
      const right = reports.find((report) => report.id === params.rightReportId);
      if (!left || !right) {
        return { success: false, error: "Both reports must exist to compare them." };
      }
      return { success: true, comparison: compareDnaReports(left, right) };
    });

    ctx.actions.register(ACTION_KEYS.GET_DNA_PRIORITY_FINDINGS, async (params: any) => {
      const reports = await getArrayState<DnaReport>(ctx, DATA_KEYS.DNA_REPORTS);
      const report = reports.find((entry) => entry.id === params?.reportId) ?? reports.at(-1);
      return { priorityFindings: report ? getPriorityFindings(report) : [] };
    });

    ctx.actions.register(ACTION_KEYS.GET_DNA_DISEASE_RISKS, async (params: any) => {
      const reports = await getArrayState<DnaReport>(ctx, DATA_KEYS.DNA_REPORTS);
      const report = reports.find((entry) => entry.id === params?.reportId) ?? reports.at(-1);
      return { diseaseRisks: report ? summarizeDiseaseRisks(report) : [] };
    });

    ctx.actions.register(ACTION_KEYS.GET_DNA_PHARMACOGENOMICS, async (params: any) => {
      const reports = await getArrayState<DnaReport>(ctx, DATA_KEYS.DNA_REPORTS);
      const report = reports.find((entry) => entry.id === params?.reportId) ?? reports.at(-1);
      return { pharmacogenomics: report ? summarizePharmacogenomics(report) : [] };
    });

    ctx.actions.register(ACTION_KEYS.GET_DNA_PATHWAYS, async (params: any) => {
      const reports = await getArrayState<DnaReport>(ctx, DATA_KEYS.DNA_REPORTS);
      const report = reports.find((entry) => entry.id === params?.reportId) ?? reports.at(-1);
      return { pathways: report ? summarizeGeneticPathways(report) : [] };
    });

    ctx.actions.register(ACTION_KEYS.EXPORT_DNA_INSIGHTS, async (params: any) => {
      const reports = await getArrayState<DnaReport>(ctx, DATA_KEYS.DNA_REPORTS);
      const report = reports.find((entry) => entry.id === params.reportId) ?? reports.at(-1);
      return { markdown: report ? exportDnaInsightsMarkdown(report) : "No DNA report available." };
    });

    ctx.actions.register(ACTION_KEYS.DELETE_DNA_REPORT, async (params: any) => {
      const removed = await removeById<DnaReport>(ctx, DATA_KEYS.DNA_REPORTS, params.id);
      return { success: Boolean(removed), dnaReport: removed };
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
