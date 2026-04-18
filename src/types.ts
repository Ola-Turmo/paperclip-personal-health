// Personal Health Plugin — stub types
// Full interfaces to be implemented per feature area

export interface Medication {
  id: string;
  name: string;
  dose: string;
  frequency: string;
  times: string[];
  active: boolean;
}

export interface SymptomEntry {
  id: string;
  symptom: string;
  severity: string;
  notes: string;
  startedAt: string;
}

export interface WorkoutLog {
  id: string;
  type: string;
  name: string;
  durationMinutes: number;
  performedAt: string;
}

export interface SleepEntry {
  id: string;
  date: string;
  totalMinutes: number;
  sleepScore?: number;
}

export interface MealPlan {
  id: string;
  name: string;
  meals: unknown[];
}

export interface HydrationLog {
  id: string;
  date: string;
  totalMl: number;
}

export interface Appointment {
  id: string;
  type: string;
  provider: string;
  scheduledAt: string;
  durationMinutes?: number;
  notes?: string;
}

export interface LabResult {
  id: string;
  resultedAt: string;
  labName: string;
  panels: unknown[];
  notes?: string;
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

export interface RecoveryStatus {
  date: string;
  score: number;
  overall: "red" | "yellow" | "green";
  recommendation?: string;
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

export interface DnaReport {
  id: string;
  uploadDate: string;
  source: string;
  healthInsights: unknown[];
}

export interface WearableSyncStatus {
  device: string;
  lastSyncAt: string;
  connected: boolean;
}

export interface DailyHealthSummary {
  date: string;
  medications: unknown[];
  workouts: unknown[];
  sleep: SleepEntry | null;
  habits: unknown[];
  recovery: RecoveryStatus | null;
}
