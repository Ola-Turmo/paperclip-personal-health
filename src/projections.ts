import {
  computeHydrationTotal,
  computeNutritionSummary,
  computeSleepSummary,
  computeWorkoutSummary,
  toIsoDate,
} from "./utils.js";
import type {
  Appointment,
  DnaReport,
  DnaSettings,
  HabitCompletion,
  HealthNudge,
  HydrationLog,
  LabResult,
  MacroTargets,
  MealLog,
  MedicationLog,
  RecoveryStatus,
  SleepEntry,
  WorkoutLog,
} from "./types.js";
import { analyzeBloodwork } from "./bloodwork.js";
import { summarizePrivacyStatus } from "./policy.js";
import { summarizeReport } from "./dna.js";
import type { HealthPrivacyPolicy } from "./types.js";

export function buildWorkoutOverview(workouts: WorkoutLog[]) {
  return {
    totalWorkouts: workouts.length,
    summary: computeWorkoutSummary(workouts),
    lastWorkoutAt: workouts.at(-1)?.performedAt ?? null,
  };
}

export function buildNutritionOverview(meals: MealLog[], calorieTarget: number, macroTarget?: MacroTargets) {
  return {
    mealsLogged: meals.length,
    summary: computeNutritionSummary(meals, calorieTarget, macroTarget),
  };
}

export function buildLatestLabProjection(labResults: LabResult[]) {
  const latest = labResults.at(-1);
  return latest
    ? {
        latestResult: latest,
        analysis: analyzeBloodwork(latest, {}),
      }
    : {
        latestResult: null,
        analysis: null,
      };
}

export function buildLatestDnaProjection(reports: DnaReport[]) {
  const latest = reports.at(-1);
  return latest
    ? {
        latestReport: latest,
        summary: summarizeReport(latest),
      }
    : {
        latestReport: null,
        summary: null,
      };
}

export function buildPendingReminderProjection(input: {
  today?: string;
  medications: MedicationLog[];
  workouts: WorkoutLog[];
  meals: MealLog[];
  hydrationLog: HydrationLog | null;
  hydrationGoal: number;
  appointments: Appointment[];
  sleepEntries: SleepEntry[];
  habits: HabitCompletion[];
  recoveryEntries: RecoveryStatus[];
  nudges: HealthNudge[];
}) {
  const today = input.today ?? toIsoDate();
  return {
    date: today,
    pendingHydrationMl: Math.max(input.hydrationGoal - computeHydrationTotal(input.hydrationLog), 0),
    mealsLogged: input.meals.filter((entry) => entry.date === today).length,
    medicationsLoggedToday: input.medications.filter((entry) => entry.takenAt.startsWith(today)).length,
    workoutsLoggedToday: input.workouts.filter((entry) => entry.performedAt.startsWith(today)).length,
    sleepSummary: computeSleepSummary(
      input.sleepEntries.filter((entry) => entry.date === today || entry.date === new Date(Date.now() - 86_400_000).toISOString().slice(0, 10)),
    ),
    habitsCompletedToday: input.habits.filter((entry) => entry.completedAt.startsWith(today)).length,
    upcomingAppointments: input.appointments.filter((entry) => !entry.cancelledAt && new Date(entry.scheduledAt).getTime() >= Date.now()).slice(0, 3),
    latestRecovery: input.recoveryEntries.at(-1) ?? null,
    nudges: input.nudges,
  };
}

export function buildPrivacyProjection(settings: DnaSettings, policy: HealthPrivacyPolicy, reports: DnaReport[]) {
  return {
    ...summarizePrivacyStatus(settings, policy),
    dnaReportsStored: reports.length,
    privacyRestrictedReports: reports.filter((report) => report.isPrivacyRestricted).length,
  };
}
