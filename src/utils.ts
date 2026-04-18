import type {
  Habit,
  HabitCompletion,
  HydrationLog,
  LabResult,
  MacroTargets,
  MealLog,
  RecoveryStatus,
  WorkoutLog,
  WorkoutPlan,
} from "./types.js";

export const INSTANCE_SCOPE = { scopeKind: "instance" as const };

export function generateId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

export async function getStateValue<T>(ctx: any, key: string, fallback: T): Promise<T> {
  const value = await ctx.state.get({ ...INSTANCE_SCOPE, stateKey: key });
  return (value ?? fallback) as T;
}

export async function setStateValue<T>(ctx: any, key: string, value: T): Promise<void> {
  await ctx.state.set({ ...INSTANCE_SCOPE, stateKey: key }, value);
}

export async function getArrayState<T>(ctx: any, key: string): Promise<T[]> {
  const value = await ctx.state.get({ ...INSTANCE_SCOPE, stateKey: key });
  return Array.isArray(value) ? (value as T[]) : [];
}

export async function setArrayState<T>(ctx: any, key: string, value: T[]): Promise<void> {
  await ctx.state.set({ ...INSTANCE_SCOPE, stateKey: key }, value);
}

export async function appendArrayItem<T>(ctx: any, key: string, item: T): Promise<T[]> {
  const items = await getArrayState<T>(ctx, key);
  items.push(item);
  await setArrayState(ctx, key, items);
  return items;
}

export async function replaceById<T extends { id: string }>(
  ctx: any,
  key: string,
  id: string,
  updater: (existing: T) => T,
): Promise<T | null> {
  const items = await getArrayState<T>(ctx, key);
  const index = items.findIndex((item) => item.id === id);
  if (index === -1) {
    return null;
  }

  const updated = updater(items[index]);
  items[index] = updated;
  await setArrayState(ctx, key, items);
  return updated;
}

export async function removeById<T extends { id: string }>(ctx: any, key: string, id: string): Promise<T | null> {
  const items = await getArrayState<T>(ctx, key);
  const index = items.findIndex((item) => item.id === id);
  if (index === -1) {
    return null;
  }

  const [removed] = items.splice(index, 1);
  await setArrayState(ctx, key, items);
  return removed;
}

export function toIsoDate(input?: string): string {
  if (!input) {
    return new Date().toISOString().slice(0, 10);
  }

  if (/^\d{4}-\d{2}-\d{2}$/.test(input)) {
    return input;
  }

  return new Date(input).toISOString().slice(0, 10);
}

export function toIsoDateTime(input?: string): string {
  return input ? new Date(input).toISOString() : new Date().toISOString();
}

export function parseRangeWindow(params: { days?: number; startDate?: string; endDate?: string }) {
  const end = params.endDate ? new Date(params.endDate) : new Date();
  end.setHours(23, 59, 59, 999);

  const start = params.startDate ? new Date(params.startDate) : new Date(end.getTime() - ((params.days ?? 30) - 1) * 86_400_000);
  start.setHours(0, 0, 0, 0);

  return { start, end };
}

export function withinRange(input: string | undefined, range: { start: Date; end: Date }): boolean {
  if (!input) {
    return false;
  }
  const value = new Date(input).getTime();
  return value >= range.start.getTime() && value <= range.end.getTime();
}

export function sum(values: Array<number | undefined>): number {
  return values.reduce<number>((acc, value) => acc + (value ?? 0), 0);
}

export function round(value: number, digits = 2): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

export function mergeMacroTargets(entries: Array<MacroTargets | undefined>): MacroTargets {
  return entries.reduce<MacroTargets>((acc, entry) => ({
    proteinGrams: acc.proteinGrams + (entry?.proteinGrams ?? 0),
    carbGrams: acc.carbGrams + (entry?.carbGrams ?? 0),
    fatGrams: acc.fatGrams + (entry?.fatGrams ?? 0),
    fiberGrams: (acc.fiberGrams ?? 0) + (entry?.fiberGrams ?? 0),
  }), {
    proteinGrams: 0,
    carbGrams: 0,
    fatGrams: 0,
    fiberGrams: 0,
  });
}

export function average(values: number[]): number {
  if (!values.length) {
    return 0;
  }

  return round(values.reduce((acc, value) => acc + value, 0) / values.length, 2);
}

export function computeWorkoutSummary(logs: WorkoutLog[]) {
  const totalDurationMinutes = sum(logs.map((log) => log.durationMinutes));
  const totalCaloriesBurned = sum(logs.map((log) => log.caloriesBurned));
  const totalDistanceKm = round(sum(logs.map((log) => log.distanceKm)));
  const averageRpe = average(logs.map((log) => log.rpe).filter((value): value is number => typeof value === "number"));

  const byType = logs.reduce<Record<string, { sessions: number; durationMinutes: number; distanceKm: number }>>((acc, log) => {
    const bucket = acc[log.type] ?? { sessions: 0, durationMinutes: 0, distanceKm: 0 };
    bucket.sessions += 1;
    bucket.durationMinutes += log.durationMinutes;
    bucket.distanceKm += log.distanceKm ?? 0;
    acc[log.type] = bucket;
    return acc;
  }, {});

  return {
    totalSessions: logs.length,
    totalDurationMinutes,
    totalCaloriesBurned,
    totalDistanceKm,
    averageRpe,
    byType,
  };
}

export function computeWorkoutPlanForWeek(plans: WorkoutPlan[], input: { availableHours?: number; weekStart?: string; phase?: WorkoutPlan["phase"] }) {
  const activePlans = plans.filter((plan) => plan.active && (!input.phase || plan.phase === input.phase));
  const start = new Date(input.weekStart ? `${input.weekStart}T00:00:00Z` : `${toIsoDate()}T00:00:00Z`);
  const availableMinutes = Math.max((input.availableHours ?? 6) * 60, activePlans.reduce((acc, plan) => acc + plan.targetDurationMinutes, 0));
  const totalTarget = Math.max(activePlans.reduce((acc, plan) => acc + plan.targetDurationMinutes * Math.max(plan.targetDaysPerWeek, 1), 0), 1);

  let cursor = 0;
  const sessions = activePlans.flatMap((plan) => {
    const days = Math.max(plan.targetDaysPerWeek, 1);
    return Array.from({ length: days }).map((_, idx) => {
      const offset = (cursor + idx * Math.max(Math.floor(7 / days), 1)) % 7;
      const scheduledAt = new Date(start.getTime() + offset * 86_400_000);
      const duration = Math.max(20, Math.round((plan.targetDurationMinutes / totalTarget) * availableMinutes));
      return {
        day: scheduledAt.toISOString().slice(0, 10),
        workoutPlanId: plan.id,
        planName: plan.name,
        type: plan.type,
        phase: plan.phase,
        targetDurationMinutes: duration,
        notes: plan.notes,
      };
    });
  });

  cursor += 1;

  return {
    weekStart: start.toISOString().slice(0, 10),
    availableHours: input.availableHours ?? 6,
    sessions: sessions.sort((left, right) => left.day.localeCompare(right.day)),
  };
}

export function computeHydrationTotal(log: HydrationLog | null | undefined) {
  return log?.entries.reduce((acc, entry) => acc + entry.amountMl, 0) ?? 0;
}

export function computeNutritionSummary(logs: MealLog[], calorieTarget: number, macroTarget?: MacroTargets) {
  const totalCalories = sum(logs.map((log) => log.totalCalories));
  const totalMacros = mergeMacroTargets(logs.map((log) => log.totalMacros));

  return {
    totalMeals: logs.length,
    totalCalories,
    calorieTarget,
    remainingCalories: calorieTarget ? calorieTarget - totalCalories : undefined,
    totalMacros,
    macroTarget,
  };
}

export function computeSleepSummary(entries: Array<{ totalMinutes: number; sleepScore?: number }>) {
  return {
    averageSleepMinutes: average(entries.map((entry) => entry.totalMinutes)),
    averageSleepScore: average(entries.map((entry) => entry.sleepScore).filter((value): value is number => typeof value === "number")),
    totalEntries: entries.length,
  };
}

export function computeHabitStreaks(habits: Habit[], completions: HabitCompletion[]) {
  return habits.map((habit) => {
    const dates = completions
      .filter((completion) => completion.habitId === habit.id)
      .map((completion) => completion.completedAt.slice(0, 10))
      .sort()
      .reverse();

    let streak = 0;
    let cursor = new Date(`${toIsoDate()}T00:00:00Z`);
    const seen = new Set(dates);

    while (seen.has(cursor.toISOString().slice(0, 10))) {
      streak += 1;
      cursor = new Date(cursor.getTime() - 86_400_000);
    }

    return {
      habitId: habit.id,
      habitName: habit.name,
      currentStreak: streak,
      completionCount: dates.length,
    };
  });
}

export function computeLabTrendSummary(results: LabResult[]) {
  const metrics: Record<string, number[]> = {};

  for (const result of results) {
    for (const panel of result.panels) {
      for (const biomarker of panel.biomarkers) {
        if (typeof biomarker.value !== "number") {
          continue;
        }
        const key = `${panel.name}:${biomarker.name}`;
        metrics[key] ??= [];
        metrics[key].push(biomarker.value);
      }
    }
  }

  return Object.entries(metrics).map(([metric, values]) => ({
    metric,
    latest: values.at(-1) ?? null,
    average: average(values),
    samples: values.length,
  }));
}

export function computeRecoveryRecommendation(recovery: RecoveryStatus[], workouts: WorkoutLog[]) {
  const latest = recovery.at(-1);
  if (!latest) {
    return {
      recommendation: "No recovery data logged yet. Record a recovery score to personalize guidance.",
      status: "unknown",
    };
  }

  const recentHardWorkouts = workouts.filter((workout) => {
    const performedAt = new Date(workout.performedAt).getTime();
    return performedAt >= Date.now() - 3 * 86_400_000 && (workout.rpe ?? 0) >= 8;
  });

  if (latest.overall === "red" || latest.score < 40 || recentHardWorkouts.length >= 3) {
    return {
      recommendation: "Recovery is trending low. Favor a rest day, gentle mobility, hydration, and sleep prioritization.",
      status: "rest",
    };
  }

  if (latest.overall === "yellow" || latest.score < 70) {
    return {
      recommendation: "Recovery is moderate. Keep intensity submaximal and prioritize technique or zone-2 work.",
      status: "steady",
    };
  }

  return {
    recommendation: "Recovery looks strong. A quality training session is reasonable today if other signals agree.",
    status: "green",
  };
}
