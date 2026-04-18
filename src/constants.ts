export const PLUGIN_ID = "personal-health";

// ── Namespaced store keys ───────────────────────────────────────────────────
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
  DAILY_HYDRATION_GOAL_ML: "health.dailyHydrationGoalMl",
  DAILY_CALORIE_TARGET: "health.dailyCalorieTarget",
  MACRO_TARGETS: "health.macroTargets",

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
  DNA_VARIANT_ANNOTATIONS: "health.dnaVariantAnnotations",
  DNA_SETTINGS: "health.dnaSettings",
  NUDGE_HISTORY: "health.nudgeHistory",

  // Wearables
  WEARABLE_STATUS: "health.wearableStatus",

  // Config
  NOTIFICATION_CHANNEL: "health.notificationChannel",
} as const;

// ── Action keys ─────────────────────────────────────────────────────────────
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
  UPDATE_WORKOUT_PLAN: "health.update-workout-plan",
  GET_WORKOUT_PLANS: "health.get-workout-plans",
  LOG_WORKOUT: "health.log-workout",
  GET_WORKOUT_LOGS: "health.get-workout-logs",
  GET_WORKOUT_SUMMARY: "health.get-workout-summary",
  PLAN_WEEKLY_WORKOUTS: "health.plan-weekly-workouts",
  DELETE_WORKOUT_LOG: "health.delete-workout-log",

  // Sleep
  LOG_SLEEP: "health.log-sleep",
  GET_SLEEP: "health.get-sleep",
  GET_SLEEP_SUMMARY: "health.get-sleep-summary",

  // Nutrition
  ADD_MEAL_PLAN: "health.add-meal-plan",
  UPDATE_MEAL_PLAN: "health.update-meal-plan",
  GET_MEAL_PLANS: "health.get-meal-plans",
  LOG_MEAL: "health.log-meal",
  LOG_QUICK_MEAL: "health.log-quick-meal",
  GET_MEAL_LOGS: "health.get-meal-logs",
  GET_NUTRITION_SUMMARY: "health.get-nutrition-summary",
  SEARCH_FOODS: "health.search-foods",
  GET_FOOD_DETAILS: "health.get-food-details",
  SET_CALORIE_TARGET: "health.set-calorie-target",
  SET_MACRO_TARGETS: "health.set-macro-targets",
  DELETE_MEAL_LOG: "health.delete-meal-log",

  // Hydration
  LOG_HYDRATION: "health.log-hydration",
  GET_HYDRATION: "health.get-hydration",
  SET_HYDRATION_GOAL: "health.set-hydration-goal",
  DELETE_HYDRATION_ENTRY: "health.delete-hydration-entry",

  // Appointments
  ADD_APPOINTMENT: "health.add-appointment",
  GET_APPOINTMENTS: "health.get-appointments",
  PREP_APPOINTMENT: "health.prep-appointment",
  CANCEL_APPOINTMENT: "health.cancel-appointment",

  // Labs
  ADD_LAB_RESULT: "health.add-lab-result",
  GET_LAB_RESULTS: "health.get-lab-results",
  REVIEW_LAB_TRENDS: "health.review-lab-trends",
  GET_BLOODWORK_BIOMARKERS: "health.get-bloodwork-biomarkers",
  GET_BLOODWORK_BIOMARKER: "health.get-bloodwork-biomarker",
  ANALYZE_BLOODWORK: "health.analyze-bloodwork",
  GET_BLOODWORK_CATEGORY_SCORES: "health.get-bloodwork-category-scores",
  CALCULATE_BIOLOGICAL_AGE: "health.calculate-biological-age",
  GET_BLOODWORK_ACTION_PLAN: "health.get-bloodwork-action-plan",

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
  GET_DNA_REPORTS: "health.get-dna-reports",
  GET_DNA_INSIGHTS: "health.get-dna-insights",
  GET_DNA_INSIGHTS_BY_CATEGORY: "health.get-dna-insights-by-category",
  GET_DNA_VARIANTS: "health.get-dna-variants",
  GET_DNA_VARIANT_DETAIL: "health.get-dna-variant-detail",
  LOOKUP_RSID: "health.lookup-rsid",
  ANNOTATE_VARIANT: "health.annotate-variant",
  COMPARE_DNA_REPORTS: "health.compare-dna-reports",
  GET_DNA_PRIORITY_FINDINGS: "health.get-dna-priority-findings",
  GET_DNA_DISEASE_RISKS: "health.get-dna-disease-risks",
  GET_DNA_PHARMACOGENOMICS: "health.get-dna-pharmacogenomics",
  GET_DNA_PATHWAYS: "health.get-dna-pathways",
  EXPORT_DNA_INSIGHTS: "health.export-dna-insights",
  DELETE_DNA_REPORT: "health.delete-dna-report",

  // Wearables
  SYNC_WEARABLE: "health.sync-wearable",
  GET_WEARABLE_STATUS: "health.get-wearable-status",

  // Daily summary
  GET_DAILY_SUMMARY: "health.get-daily-summary",
  SEND_HYDRATION_NUDGE: "health.send-hydration-nudge",
  SEND_MEDICATION_REMINDER: "health.send-medication-reminder",
  SEND_APPOINTMENT_REMINDER: "health.send-appointment-reminder",
} as const;
