// Personal Health Plugin — full type definitions

export type WorkoutType =
  | "running" | "cycling" | "swimming"
  | "strength" | "hiit" | "crossfit"
  | "yoga" | "walking" | "hiking"
  | "tennis" | "football" | "skiing"
  | "other";

export interface WorkoutPlan {
  id: string;
  name: string;
  type: WorkoutType;
  phase: "base" | "build" | "peak" | "deload" | "recovery";
  targetDurationMinutes: number;
  targetDaysPerWeek: number;
  notes?: string;
  active: boolean;
}

export interface ExerciseLog {
  name: string;
  sets: number;
  reps?: number;
  weightKg?: number;
  rpe?: number;
  notes?: string;
}

export type WorkoutSource = "manual" | "apple-health" | "garmin" | "oura" | "whoop" | "strava";

export interface WorkoutLog {
  id: string;
  type: WorkoutType;
  name: string;
  performedAt: string;
  durationMinutes: number;
  rpe?: number;
  caloriesBurned?: number;
  distanceKm?: number;
  avgPaceMinPerKm?: number;
  avgHeartRate?: number;
  maxHeartRate?: number;
  elevationGainM?: number;
  stravaActivityId?: string;
  exercises?: ExerciseLog[];
  laps?: number;
  strokeTypes?: string[];
  source: WorkoutSource;
  wearableLogId?: string;
  rawData?: Record<string, unknown>;
  notes?: string;
}

export interface MacroTargets {
  proteinGrams: number;
  carbGrams: number;
  fatGrams: number;
  fiberGrams?: number;
}

export interface MealTemplate {
  name: string;
  targetCalories?: number;
  targetMacros?: MacroTargets;
  typicalFoods?: string[];
}

export interface MealPlan {
  id: string;
  name: string;
  dailyCalorieTarget?: number;
  macroTargets?: MacroTargets;
  mealTemplates?: MealTemplate[];
  active: boolean;
}

export interface FoodItem {
  name: string;
  portion?: string;
  calories: number;
  proteinGrams?: number;
  carbGrams?: number;
  fatGrams?: number;
  fiberGrams?: number;
  sugarGrams?: number;
  sodiumMg?: number;
  source?: string;
  sourceId?: string;
}

export interface MealLog {
  id: string;
  date: string;
  mealName: string;
  foods: FoodItem[];
  totalCalories: number;
  totalMacros?: MacroTargets;
  source: "manual" | "nutritionix" | "apple-health";
  notes?: string;
}

export interface HydrationEntry {
  id: string;
  amountMl: number;
  loggedAt: string;
  source: "manual" | "apple-health";
}

export interface HydrationLog {
  id: string;
  date: string;
  entries: HydrationEntry[];
  totalMl: number;
  goalMl: number;
  source: "manual" | "apple-health";
}

export type DnaSource = "23andme" | "ancestrydna" | "livedna" | "other";
export type DnaInsightCategory = "nutrition" | "fitness" | "cardiovascular" | "metabolic" | "pharmacogenomics" | "sleep" | "risk";
export type DnaDiploidType = "heterozygous" | "homozygousdominant" | "homozygousrecessive";
export type DnaEvidenceTier = 1 | 2 | 3 | 4;

export interface AlleleEffect {
  allele: string;
  effect: string;
  summary: string;
}

export interface DnaVariantAnnotation {
  rsId: string;
  gene: string;
  title: string;
  description: string;
  impact: "positive" | "neutral" | "risk";
  category: DnaInsightCategory;
  alleleEffects?: AlleleEffect[];
}

export interface DnaVariant {
  rsId: string;
  chromosome: string;
  position: number;
  allele1: string;
  allele2: string;
  genotype: string;
  diploidType: DnaDiploidType;
  clinicalSignificance?: string;
  annotations?: Record<string, string>;
}

export interface DnaHealthInsight {
  id: string;
  category: DnaInsightCategory;
  title: string;
  description: string;
  impact: "positive" | "neutral" | "risk";
  relevantVariants: string[];
  actionableRecommendation?: string;
  source?: string;
  evidenceTier?: DnaEvidenceTier;
  evidenceLabel?: string;
}

export interface AncestryComposition {
  overall: string;
  detail: Record<string, number>;
}

export interface DnaReport {
  id: string;
  uploadDate: string;
  source: DnaSource;
  fileName?: string;
  fileHash?: string;
  ancestryComposition?: AncestryComposition;
  healthInsights: DnaHealthInsight[];
  variants: DnaVariant[];
  rawSnpsImported: number;
  snpsMatchedToKnowledgeBase: number;
  notes?: string;
  privacyMode?: "living" | "privacy";
}

export interface DnaSettings {
  preferredReportSource: "23andme" | "promethease" | "genetichealth";
  lastImport?: string;
  privacyMode: "living" | "privacy";
  researchOptIn: boolean;
}

export interface Medication {
  id: string;
  name: string;
  dose: string;
  frequency: string;
  times: string[];
  active: boolean;
}

export interface MedicationLog {
  id: string;
  medicationId: string;
  takenAt: string;
  taken: boolean;
  notes?: string;
}

export interface RefillLog {
  id: string;
  medicationId: string;
  filledAt: string;
  pillsRemaining?: number;
}

export interface SymptomEntry {
  id: string;
  symptom: string;
  severity: "mild" | "moderate" | "severe";
  notes: string;
  startedAt: string;
}

export interface SleepEntry {
  id: string;
  date: string;
  totalMinutes: number;
  sleepScore?: number;
  deepMinutes?: number;
  remMinutes?: number;
  wakeCount?: number;
  source?: "manual" | "apple-health" | "garmin" | "oura" | "whoop";
}

export interface Appointment {
  id: string;
  type: string;
  provider: string;
  scheduledAt: string;
  durationMinutes?: number;
  notes?: string;
  prepNotes?: string;
  cancelledAt?: string;
}

export interface LabResult {
  id: string;
  resultedAt: string;
  labName: string;
  panels: LabPanel[];
  notes?: string;
}

export interface LabPanel {
  name: string;
  biomarkers: LabBiomarker[];
}

export interface LabBiomarker {
  name: string;
  value: string | number;
  unit: string;
  referenceRangeLow?: number;
  referenceRangeHigh?: number;
  outOfRange?: boolean;
}

export interface Habit {
  id: string;
  name: string;
  description?: string;
  frequency: string;
  targetDays?: number[];
  targetCount: number;
  currentStreak: number;
}

export interface HabitCompletion {
  id: string;
  habitId: string;
  completedAt: string;
  notes?: string;
}

export interface RecoveryStatus {
  date: string;
  score: number;
  overall: "red" | "yellow" | "green";
  recommendation?: string;
  source?: "manual" | "garmin" | "oura" | "whoop";
}

export interface Supplement {
  id: string;
  name: string;
  dosage: string;
  frequency: string;
  times?: string[];
  purpose?: string;
  active: boolean;
}

export interface SupplementLog {
  id: string;
  supplementId: string;
  takenAt: string;
  taken: boolean;
  notes?: string;
}

export interface WearableSyncStatus {
  device: string;
  lastSyncAt: string;
  connected: boolean;
  deviceId?: string;
  error?: string;
}

export interface DailyHealthSummary {
  date: string;
  medications: MedicationLog[];
  workouts: WorkoutLog[];
  sleep: SleepEntry | null;
  habits: HabitCompletion[];
  recovery: RecoveryStatus | null;
  nutrition?: {
    caloriesConsumed: number;
    calorieTarget: number;
    macros?: MacroTargets;
  };
  hydration?: {
    totalMl: number;
    goalMl: number;
  };
}

export interface HealthNudge {
  key: string;
  message: string;
  severity: "info" | "warning" | "success";
  category: "workout" | "nutrition" | "hydration" | "medication" | "appointment" | "dna";
}
