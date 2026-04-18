import { definePlugin, runWorker } from "@paperclipai/plugin-sdk";
import { ACTION_KEYS, DATA_KEYS } from "./constants.js";
import type { Medication, SymptomEntry, WorkoutLog, SleepEntry, Appointment, Habit, Supplement, LabResult, DnaReport, RecoveryStatus } from "./types.js";

function generateId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

const INSTANCE = { scopeKind: "instance" as const };

async function getArr<T>(ctx: any, key: string): Promise<T[]> {
  const val = await ctx.state.get({ ...INSTANCE, stateKey: key });
  return (Array.isArray(val) ? val : []) as T[];
}

async function setArr<T>(ctx: any, key: string, val: T[]): Promise<void> {
  await ctx.state.set({ ...INSTANCE, stateKey: key }, val);
}

const plugin = definePlugin({
  async setup(ctx) {

    // ── Medications ────────────────────────────────────────────
    ctx.actions.register(ACTION_KEYS.ADD_MEDICATION, async (params: any) => {
      const med: Medication = { id: generateId(), name: params.name, dose: params.dose ?? "", frequency: params.frequency ?? "daily", times: params.times ?? [], active: true };
      const meds = await getArr<Medication>(ctx, DATA_KEYS.MEDICATIONS);
      meds.push(med);
      await setArr(ctx, DATA_KEYS.MEDICATIONS, meds);
      return { success: true, id: med.id };
    });

    ctx.actions.register(ACTION_KEYS.GET_MEDICATIONS, async (_params: any) => {
      return { medications: await getArr<Medication>(ctx, DATA_KEYS.MEDICATIONS) };
    });

    ctx.actions.register(ACTION_KEYS.LOG_MEDICATION, async (params: any) => {
      const log = { id: generateId(), medicationId: params.medicationId, takenAt: new Date().toISOString(), taken: params.taken ?? true, notes: params.notes ?? "" };
      const logs = await getArr<any>(ctx, DATA_KEYS.MEDICATION_LOGS);
      logs.push(log);
      await setArr(ctx, DATA_KEYS.MEDICATION_LOGS, logs);
      return { success: true, id: log.id };
    });

    // ── Symptoms ────────────────────────────────────────────────
    ctx.actions.register(ACTION_KEYS.LOG_SYMPTOM, async (params: any) => {
      const entry: SymptomEntry = { id: generateId(), symptom: params.symptom, severity: params.severity ?? "mild", notes: params.notes ?? "", startedAt: new Date().toISOString() };
      const entries = await getArr<SymptomEntry>(ctx, DATA_KEYS.SYMPTOMS);
      entries.push(entry);
      await setArr(ctx, DATA_KEYS.SYMPTOMS, entries);
      return { success: true, id: entry.id };
    });

    ctx.actions.register(ACTION_KEYS.GET_SYMPTOMS, async (params: any) => {
      const days = params.days ?? 30;
      const cutoff = new Date(Date.now() - days * 86400000).toISOString();
      const entries = await getArr<SymptomEntry>(ctx, DATA_KEYS.SYMPTOMS);
      return { symptoms: entries.filter(e => e.startedAt >= cutoff) };
    });

    // ── Workouts ────────────────────────────────────────────────
    ctx.actions.register(ACTION_KEYS.LOG_WORKOUT, async (params: any) => {
      const log: WorkoutLog = { id: generateId(), type: params.type ?? "other", name: params.name ?? "Workout", durationMinutes: params.durationMinutes ?? 0, performedAt: new Date().toISOString() };
      const logs = await getArr<WorkoutLog>(ctx, DATA_KEYS.WORKOUT_LOGS);
      logs.push(log);
      await setArr(ctx, DATA_KEYS.WORKOUT_LOGS, logs);
      return { success: true, id: log.id };
    });

    ctx.actions.register(ACTION_KEYS.GET_WORKOUT_LOGS, async (params: any) => {
      const days = params.days ?? 30;
      const cutoff = new Date(Date.now() - days * 86400000).toISOString();
      const logs = await getArr<WorkoutLog>(ctx, DATA_KEYS.WORKOUT_LOGS);
      return { workouts: logs.filter(w => w.performedAt >= cutoff) };
    });

    // ── Sleep ───────────────────────────────────────────────────
    ctx.actions.register(ACTION_KEYS.LOG_SLEEP, async (params: any) => {
      const entry: SleepEntry = { id: generateId(), date: params.date, totalMinutes: params.totalMinutes ?? 0, sleepScore: params.sleepScore };
      const entries = await getArr<SleepEntry>(ctx, DATA_KEYS.SLEEP_ENTRIES);
      entries.push(entry);
      await setArr(ctx, DATA_KEYS.SLEEP_ENTRIES, entries);
      return { success: true, id: entry.id };
    });

    ctx.actions.register(ACTION_KEYS.GET_SLEEP, async (params: any) => {
      const days = params.days ?? 7;
      const cutoff = new Date(Date.now() - days * 86400000).toISOString();
      const entries = await getArr<SleepEntry>(ctx, DATA_KEYS.SLEEP_ENTRIES);
      return { sleep: entries.filter(s => s.date >= cutoff) };
    });

    // ── Nutrition ───────────────────────────────────────────────
    ctx.actions.register(ACTION_KEYS.LOG_MEAL, async (params: any) => {
      const log = { id: generateId(), date: params.date, mealName: params.mealName, foods: params.foods ?? [], totalCalories: params.totalCalories, notes: params.notes ?? "" };
      const logs = await getArr<any>(ctx, DATA_KEYS.MEAL_LOGS);
      logs.push(log);
      await setArr(ctx, DATA_KEYS.MEAL_LOGS, logs);
      return { success: true, id: log.id };
    });

    ctx.actions.register(ACTION_KEYS.LOG_HYDRATION, async (params: any) => {
      const log = { id: generateId(), date: params.date, amountMl: params.amountMl, loggedAt: new Date().toISOString() };
      const logs = await getArr<any>(ctx, DATA_KEYS.HYDRATION_LOGS);
      logs.push(log);
      await setArr(ctx, DATA_KEYS.HYDRATION_LOGS, logs);
      return { success: true, id: log.id };
    });

    // ── Appointments ────────────────────────────────────────────
    ctx.actions.register(ACTION_KEYS.ADD_APPOINTMENT, async (params: any) => {
      const appt: Appointment = { id: generateId(), type: params.type ?? "other", provider: params.provider ?? "", scheduledAt: params.scheduledAt, durationMinutes: params.durationMinutes ?? 30, notes: params.notes ?? "" };
      const appts = await getArr<Appointment>(ctx, DATA_KEYS.APPOINTMENTS);
      appts.push(appt);
      await setArr(ctx, DATA_KEYS.APPOINTMENTS, appts);
      return { success: true, id: appt.id };
    });

    ctx.actions.register(ACTION_KEYS.GET_APPOINTMENTS, async (_params: any) => {
      return { appointments: await getArr<Appointment>(ctx, DATA_KEYS.APPOINTMENTS) };
    });

    // ── Labs ────────────────────────────────────────────────────
    ctx.actions.register(ACTION_KEYS.ADD_LAB_RESULT, async (params: any) => {
      const result: LabResult = { id: generateId(), resultedAt: params.resultedAt, labName: params.labName ?? "", panels: params.panels ?? [], notes: params.notes ?? "" };
      const results = await getArr<LabResult>(ctx, DATA_KEYS.LAB_RESULTS);
      results.push(result);
      await setArr(ctx, DATA_KEYS.LAB_RESULTS, results);
      return { success: true, id: result.id };
    });

    ctx.actions.register(ACTION_KEYS.GET_LAB_RESULTS, async (_params: any) => {
      return { labResults: await getArr<LabResult>(ctx, DATA_KEYS.LAB_RESULTS) };
    });

    // ── Habits ──────────────────────────────────────────────────
    ctx.actions.register(ACTION_KEYS.ADD_HABIT, async (params: any) => {
      const habit: Habit = { id: generateId(), name: params.name, description: params.description ?? "", frequency: params.frequency ?? "daily", targetDays: params.targetDays, targetCount: params.targetCount ?? 1, currentStreak: 0 };
      const habits = await getArr<Habit>(ctx, DATA_KEYS.HABITS);
      habits.push(habit);
      await setArr(ctx, DATA_KEYS.HABITS, habits);
      return { success: true, id: habit.id };
    });

    ctx.actions.register(ACTION_KEYS.COMPLETE_HABIT, async (params: any) => {
      const completion = { id: generateId(), habitId: params.habitId, completedAt: new Date().toISOString(), notes: params.notes ?? "" };
      const completions = await getArr<any>(ctx, DATA_KEYS.HABIT_COMPLETIONS);
      completions.push(completion);
      await setArr(ctx, DATA_KEYS.HABIT_COMPLETIONS, completions);
      return { success: true, id: completion.id };
    });

    ctx.actions.register(ACTION_KEYS.GET_HABITS, async (_params: any) => {
      return { habits: await getArr<Habit>(ctx, DATA_KEYS.HABITS) };
    });

    // ── Recovery ────────────────────────────────────────────────
    ctx.actions.register(ACTION_KEYS.LOG_RECOVERY, async (params: any) => {
      const status: RecoveryStatus = { date: params.date, score: params.score ?? 50, overall: params.overall ?? "yellow", recommendation: params.recommendation };
      const statuses = await getArr<RecoveryStatus>(ctx, DATA_KEYS.RECOVERY_STATUS);
      statuses.push(status);
      await setArr(ctx, DATA_KEYS.RECOVERY_STATUS, statuses);
      return { success: true };
    });

    ctx.actions.register(ACTION_KEYS.GET_RECOVERY, async (params: any) => {
      const days = params.days ?? 7;
      const cutoff = new Date(Date.now() - days * 86400000).toISOString();
      const statuses = await getArr<RecoveryStatus>(ctx, DATA_KEYS.RECOVERY_STATUS);
      return { recovery: statuses.filter(r => r.date >= cutoff) };
    });

    // ── Supplements ─────────────────────────────────────────────
    ctx.actions.register(ACTION_KEYS.ADD_SUPPLEMENT, async (params: any) => {
      const supp: Supplement = { id: generateId(), name: params.name, dosage: params.dosage ?? "", frequency: params.frequency ?? "daily", times: params.times ?? [], active: true };
      const supps = await getArr<Supplement>(ctx, DATA_KEYS.SUPPLEMENTS);
      supps.push(supp);
      await setArr(ctx, DATA_KEYS.SUPPLEMENTS, supps);
      return { success: true, id: supp.id };
    });

    ctx.actions.register(ACTION_KEYS.GET_SUPPLEMENTS, async (_params: any) => {
      return { supplements: await getArr<Supplement>(ctx, DATA_KEYS.SUPPLEMENTS) };
    });

    // ── DNA ─────────────────────────────────────────────────────
    ctx.actions.register(ACTION_KEYS.ADD_DNA_REPORT, async (params: any) => {
      const report: DnaReport = { id: generateId(), uploadDate: new Date().toISOString(), source: params.source ?? "other", healthInsights: params.healthInsights ?? [] };
      const reports = await getArr<DnaReport>(ctx, DATA_KEYS.DNA_REPORTS);
      reports.push(report);
      await setArr(ctx, DATA_KEYS.DNA_REPORTS, reports);
      return { success: true, id: report.id };
    });

    ctx.actions.register(ACTION_KEYS.GET_DNA_INSIGHTS, async (_params: any) => {
      return { dnaReports: await getArr<DnaReport>(ctx, DATA_KEYS.DNA_REPORTS) };
    });

    // ── Wearables ───────────────────────────────────────────────
    ctx.actions.register(ACTION_KEYS.GET_WEARABLE_STATUS, async (_params: any) => {
      return { wearables: await getArr<any>(ctx, DATA_KEYS.WEARABLE_STATUS) };
    });

    // ── Daily Summary ───────────────────────────────────────────
    ctx.actions.register(ACTION_KEYS.GET_DAILY_SUMMARY, async (params: any) => {
      const d = params.date ?? new Date().toISOString().split("T")[0];
      const medLogs = await getArr<any>(ctx, DATA_KEYS.MEDICATION_LOGS);
      const workoutLogs = await getArr<WorkoutLog>(ctx, DATA_KEYS.WORKOUT_LOGS);
      const sleepEntries = await getArr<SleepEntry>(ctx, DATA_KEYS.SLEEP_ENTRIES);
      const recoveryEntries = await getArr<RecoveryStatus>(ctx, DATA_KEYS.RECOVERY_STATUS);
      const habitCompletions = await getArr<any>(ctx, DATA_KEYS.HABIT_COMPLETIONS);
      return {
        date: d,
        medications: medLogs.filter((m: any) => m.takenAt?.startsWith(d)),
        workouts: workoutLogs.filter((w: any) => w.performedAt?.startsWith(d)),
        sleep: sleepEntries.find(s => s.date === d) ?? null,
        recovery: recoveryEntries.find(r => r.date === d) ?? null,
        habits: habitCompletions.filter((h: any) => h.completedAt?.startsWith(d)),
      };
    });

    ctx.logger.info("Personal Health plugin initialized");
  },
});

runWorker(plugin, import.meta.url);
