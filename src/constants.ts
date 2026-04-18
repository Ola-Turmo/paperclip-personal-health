export const PLUGIN_ID = "personal-health";

// Namespaced store keys
export const DATA_KEYS = {
  // Medications
  MEDICATIONS: "health.medications",
  MEDICATION_LOGS: "health.medicationLogs",
  REFILLS: "health.refills",

  // Symptoms
  SYMPTOMS: "health.symptoms",

  // Workouts
  WORKOUT_PLANS: "health.workoutPlans",
  WORKOUT_LOGS: "health.workoutLogs",

  // Sleep
  SLEEP_ENTRIES: "health.sleepEntries",

  // Nutrition
  MEAL_PLANS: "health.mealPlans",
  MEAL_LOGS: "health.mealLogs",
  HYDRATION_LOGS: "health.hydrationLogs",

  // Appointments
  APPOINTMENTS: "health.appointments",

  // Labs
  LAB_RESULTS: "health.labResults",

  // Habits
  HABITS: "health.habits",
  HABIT_COMPLETIONS: "health.habitCompletions",

  // Recovery
  RECOVERY_STATUS: "health.recoveryStatus",

  // Supplements
  SUPPLEMENTS: "health.supplements",
  SUPPLEMENT_LOGS: "health.supplementLogs",

  // DNA
  DNA_REPORTS: "health.dnaReports",

  // Wearables
  WEARABLE_STATUS: "health.wearableStatus",

  // Config
  DAILY_HYDRATION_GOAL_ML: "health.dailyHydrationGoalMl",
  DAILY_SLEEP_GOAL_HOURS: "health.dailySleepGoalHours",
  NOTIFICATION_CHANNEL: "health.notificationChannel",
} as const;

// Action keys
export const ACTION_KEYS = {
  // Medications
  ADD_MEDICATION: "health.add-medication",
  LOG_MEDICATION: "health.log-medication",
  GET_MEDICATIONS: "health.get-medications",
  GET_MEDICATION_LOGS: "health.get-medication-logs",
  REFILL_MEDICATION: "health.refill-medication",

  // Symptoms
  LOG_SYMPTOM: "health.log-symptom",
  GET_SYMPTOMS: "health.get-symptoms",
  REVIEW_SYMPTOMS: "health.review-symptoms",

  // Workouts
  ADD_WORKOUT_PLAN: "health.add-workout-plan",
  LOG_WORKOUT: "health.log-workout",
  GET_WORKOUT_PLANS: "health.get-workout-plans",
  GET_WORKOUT_LOGS: "health.get-workout-logs",
  PLAN_WEEKLY_WORKOUTS: "health.plan-weekly-workouts",

  // Sleep
  LOG_SLEEP: "health.log-sleep",
  GET_SLEEP: "health.get-sleep",
  GET_SLEEP_SUMMARY: "health.get-sleep-summary",

  // Nutrition
  ADD_MEAL_PLAN: "health.add-meal-plan",
  LOG_MEAL: "health.log-meal",
  LOG_HYDRATION: "health.log-hydration",
  GET_MEAL_PLANS: "health.get-meal-plans",
  GET_HYDRATION: "health.get-hydration",

  // Appointments
  ADD_APPOINTMENT: "health.add-appointment",
  GET_APPOINTMENTS: "health.get-appointments",
  PREP_APPOINTMENT: "health.prep-appointment",
  CANCEL_APPOINTMENT: "health.cancel-appointment",

  // Labs
  ADD_LAB_RESULT: "health.add-lab-result",
  GET_LAB_RESULTS: "health.get-lab-results",
  REVIEW_LAB_TRENDS: "health.review-lab-trends",

  // Habits
  ADD_HABIT: "health.add-habit",
  COMPLETE_HABIT: "health.complete-habit",
  GET_HABITS: "health.get-habits",
  GET_HABITS_STREAKS: "health.get-habit-streaks",

  // Recovery
  LOG_RECOVERY: "health.log-recovery",
  GET_RECOVERY: "health.get-recovery",
  GET_RECOVERY_RECOMMENDATION: "health.get-recovery-recommendation",

  // Supplements
  ADD_SUPPLEMENT: "health.add-supplement",
  LOG_SUPPLEMENT: "health.log-supplement",
  GET_SUPPLEMENTS: "health.get-supplements",

  // DNA
  ADD_DNA_REPORT: "health.add-dna-report",
  GET_DNA_INSIGHTS: "health.get-dna-insights",

  // Wearables
  SYNC_WEARABLE: "health.sync-wearable",
  GET_WEARABLE_STATUS: "health.get-wearable-status",

  // Daily summary
  GET_DAILY_SUMMARY: "health.get-daily-summary",
  SEND_HYDRATION_NUDGE: "health.send-hydration-nudge",
  SEND_MEDICATION_REMINDER: "health.send-medication-reminder",
  SEND_APPOINTMENT_REMINDER: "health.send-appointment-reminder",
} as const;
