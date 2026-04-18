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
export type DnaInsightCategory =
  | "nutrition"
  | "fitness"
  | "cardiovascular"
  | "metabolic"
  | "pharmacogenomics"
  | "sleep"
  | "risk"
  | "inflammation"
  | "detoxification"
  | "autoimmune"
  | "respiratory"
  | "skin"
  | "sensory"
  | "psychiatric"
  | "cognition"
  | "longevity"
  | "pain"
  | "traits"
  | "carrier"
  | "protective"
  | "bloodtype"
  | "hormonal";
export type DnaDiploidType = "heterozygous" | "homozygousdominant" | "homozygousrecessive";
export type DnaEvidenceTier = 1 | 2 | 3 | 4;

export interface AlleleEffect {
  allele: string;
  effect: string;
  summary: string;
  impact?: "positive" | "neutral" | "risk";
}

export interface DnaVariantAnnotation {
  rsId: string;
  gene: string;
  title: string;
  description: string;
  impact: "positive" | "neutral" | "risk";
  category: DnaInsightCategory;
  alleleEffects?: AlleleEffect[];
  evidenceTier?: DnaEvidenceTier;
  reportGroup?: "lifestyle" | "trait" | "disease" | "drug" | "carrier" | "protective";
  confidence?: DnaConfidence;
  pathways?: string[];
  tags?: string[];
  medications?: string[];
  monitoring?: string[];
  relatedConditions?: string[];
  traitLabel?: string;
  traitSummary?: string;
  supplementRecommendations?: Array<{
    supplement: string;
    dose?: string;
    rationale: string;
  }>;
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
  knowledgeBaseVersion?: string;
  parseWarnings?: string[];
  isPrivacyRestricted?: boolean;
  notes?: string;
  privacyMode?: "living" | "privacy";
}

export interface DnaSettings {
  preferredReportSource: "23andme" | "promethease" | "genetichealth";
  lastImport?: string;
  privacyMode: "living" | "privacy";
  researchOptIn: boolean;
  allowAncestryInference?: boolean;
  allowSensitiveExports?: boolean;
  retainVariantLevelData?: boolean;
  ambientDetailLevel?: "generic" | "detailed";
}

export type DnaConfidence = "low" | "medium" | "high";

export interface DnaPriorityFinding {
  gene: string;
  title: string;
  category: DnaInsightCategory;
  impact: "positive" | "neutral" | "risk";
  evidenceLabel?: string;
  actionableRecommendation?: string;
  relevantVariants: string[];
  priorityScore: number;
}

export interface DnaDiseaseRisk {
  domain: string;
  level: "low" | "moderate" | "high";
  rationale: string;
  genes: string[];
  supportingInsights: string[];
  monitoringSuggestions: string[];
}

export interface DnaPharmacogenomicInteraction {
  gene: string;
  medications: string[];
  summary: string;
  evidenceLabel?: string;
  relevantVariants: string[];
}

export interface DnaPathwaySummary {
  pathway: string;
  categories: DnaInsightCategory[];
  genes: string[];
  highlights: string[];
}

export interface DnaTraitSummary {
  key: string;
  title: string;
  summary: string;
  category: DnaInsightCategory;
  confidence?: DnaConfidence;
  relevantVariants: string[];
}

export interface DnaCarrierFinding {
  gene: string;
  title: string;
  summary: string;
  confidence?: DnaConfidence;
  relatedConditions: string[];
  followUp: string[];
  relevantVariants: string[];
}

export interface DnaProtectiveFinding {
  gene: string;
  title: string;
  summary: string;
  relevantVariants: string[];
}

export interface DnaMonitoringItem {
  focus: string;
  reason: string;
  cadence?: string;
  relatedCategories: DnaInsightCategory[];
  relevantVariants: string[];
}

export interface DnaSupplementRecommendation {
  supplement: string;
  dose?: string;
  rationale: string;
  evidenceLabel?: string;
  relevantVariants: string[];
}

export interface DnaBloodworkCorrelation {
  id: string;
  title: string;
  priority: "high" | "medium" | "low";
  genes: string[];
  biomarkers: string[];
  summary: string;
  clinicianDiscussion: string[];
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

export type BiologicalSex = "male" | "female" | "all";

export type HealthspanCategory =
  | "Heart Health"
  | "Hormone Balance"
  | "Sleep"
  | "Inflammation"
  | "Metabolism"
  | "Recovery"
  | "Cognition"
  | "Endurance"
  | "Fitness"
  | "Gut Health";

export interface BiomarkerOptimalRange {
  sex: BiologicalSex;
  ageMin: number;
  ageMax: number;
  low: number;
  high: number;
  source?: string;
}

export interface ClinicalReferenceRange {
  low?: number;
  high?: number;
  unit: string;
}

export interface BiomarkerOutcome {
  outcome: string;
  direction: string;
  evidence?: string;
}

export interface BiomarkerIntervention {
  intervention: string;
  effect: string;
  evidenceLevel?: string;
}

export interface BiomarkerSupplement {
  supplement: string;
  effect: string;
  dosage?: string;
  evidenceLevel?: string;
}

export interface BiomarkerInteraction {
  interactsWith: string;
  relationship?: string;
}

export interface BloodworkBiomarkerDefinition {
  id: string;
  name: string;
  abbreviation: string;
  aliases?: string[];
  category: HealthspanCategory;
  secondaryCategories?: HealthspanCategory[];
  unit: string;
  specimenType?: string;
  nhanesVariableCode?: string;
  optimalRanges: BiomarkerOptimalRange[];
  clinicalReferenceRanges?: Record<string, ClinicalReferenceRange>;
  physiologicalRole?: string;
  associatedHealthOutcomes?: BiomarkerOutcome[];
  dietaryInterventions?: BiomarkerIntervention[];
  supplementConsiderations?: BiomarkerSupplement[];
  biomarkerInteractions?: BiomarkerInteraction[];
  keyActions: string[];
}

export interface EvaluatedLabBiomarker {
  id: string;
  name: string;
  abbreviation: string;
  category: HealthspanCategory;
  value: number;
  unit: string;
  status: "low" | "optimal" | "high" | "unknown";
  optimalRange?: BiomarkerOptimalRange;
  clinicalRange?: ClinicalReferenceRange;
  deviation?: number;
  physiologicalRole?: string;
  evidenceSummary?: string;
  source?: string;
  interactionHighlights?: string[];
  supportingActions: string[];
}

export interface BloodworkCategoryScore {
  category: HealthspanCategory;
  score: number;
  optimalCount: number;
  biomarkersConsidered: number;
  flaggedBiomarkers: string[];
}

export interface BloodworkComboSignal {
  name: string;
  status: "low-risk" | "watch" | "needs-attention";
  biomarkers: string[];
  summary: string;
}

export interface BloodworkBiologicalAge {
  method: "kdm-style-clinical-clock";
  status: "available" | "insufficient-data";
  biologicalAge: number | null;
  chronologicalAge?: number;
  ageDelta?: number | null;
  imputedBiomarkers: string[];
  coverage: number;
  confidence: "low" | "medium" | "high";
  minimumCoverage: number;
  comboSignals: BloodworkComboSignal[];
  notes: string[];
}

export interface BloodworkActionPlanItem {
  biomarkerId: string;
  biomarkerName: string;
  category: HealthspanCategory;
  priority: "high" | "medium" | "low";
  issue: string;
  nutrition: string[];
  supplements: string[];
  lifestyle: string[];
  rationale?: string;
  evidenceLevel?: string;
  clinicianDiscussion?: string[];
}

export interface BloodworkAnalysis {
  resultId: string;
  evaluatedBiomarkers: EvaluatedLabBiomarker[];
  categoryScores: BloodworkCategoryScore[];
  actionPlan: BloodworkActionPlanItem[];
  biologicalAge?: BloodworkBiologicalAge;
  educationalUseOnly: boolean;
  coverageSummary: string;
  overallSummary: string;
}

export interface BloodworkTrendPoint {
  resultedAt: string;
  value: number;
  unit: string;
}

export interface BloodworkTrend {
  biomarkerId: string;
  biomarkerName: string;
  latest: number;
  previous?: number;
  delta?: number;
  direction: "improving" | "worsening" | "stable" | "insufficient-data";
  unit: string;
  points: BloodworkTrendPoint[];
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

export interface HealthPrivacyPolicy {
  privacyMode: "living" | "privacy";
  allowSensitiveExports: boolean;
  allowAncestryInference: boolean;
  retainVariantLevelData: boolean;
  requireSensitiveConfirmation: boolean;
  geneticsEnabled: boolean;
  ambientDetailLevel: "generic" | "detailed";
  auditRetentionDays: number;
}

export interface HealthAuditEntry {
  id: string;
  createdAt: string;
  action: string;
  category: "dna" | "bloodwork" | "medication" | "appointment" | "privacy" | "export" | "system";
  detail: string;
  sensitivity: "high" | "moderate" | "low";
  success: boolean;
}
