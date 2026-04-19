# PRD: paperclip-personal-health

## 1. Product Intent

Personal health management plugin for Paperclip — a privacy-aware life operating system layer for physical and mental wellbeing. Replaces scattered apps (medication reminders, symptom trackers, fitness logs, nutrition planners, bloodwork readers, DNA reports) with one unified plugin that can be queried and automated by your personal AI. The product favors conservative medical framing, explicit privacy controls, and auditable summaries over overconfident advice.

## 2. Problem

Health data is fragmented across pharmacy portals, wearable apps, clinic portals, lab reports, DNA services, and paper notes. People miss medication doses, forget appointment prep, lose track of symptoms, have no unified nutrition view, and their DNA data sits in a zip file nobody reads. Safer health software also needs to show where a summary came from, what was redacted, and when a sensitive action was taken. This plugin is the single pane of glass and the audit layer.

## 3. Target Users

Single user (Ola) managing personal health across: medications, symptoms, **workouts**, **nutrition**, **DNA**, sleep, lab results, bloodwork trends, habits, recovery, supplements, wearables, and privacy settings.

---

## 4. Features

### 4.1 Workouts & Wearable Sync

#### What
Log all physical activity — from a 5k run to a heavy squat session — and ingest local/exported wearable data from Apple Health, Garmin, Oura, or WHOOP without over-claiming live vendor sync. Keep a persistent history, see weekly/monthly summaries, and track periodization.

#### Why
Wearables capture data but you never look at it holistically. A run in Garmin, a lift in Strong, a hike logged in Apple Health — all siloed. This unifies everything and lets the AI surface patterns ("you've had 3 hard workouts in a row, consider recovery").

#### Data Model

```typescript
interface WorkoutPlan {
  id: string;
  name: string;                        // "Upper Body A", "5K Training Week 8"
  type: WorkoutType;                    // running | cycling | swimming | strength | hiit | yoga | walking | other
  phase: "base" | "build" | "peak" | "deload" | "recovery";
  targetDurationMinutes: number;
  targetDaysPerWeek: number;
  notes?: string;
  active: boolean;
}

type WorkoutType =
  | "running" | "cycling" | "swimming"
  | "strength" | "hiit" | "crossfit"
  | "yoga" | "walking" | "hiking"
  | "tennis" | "football" | "skiing"
  | "other";

interface WorkoutLog {
  id: string;
  type: WorkoutType;
  name: string;                        // "Morning run", "Leg day"
  performedAt: string;                 // ISO 8601
  durationMinutes: number;

  // Performance
  rpe?: number;                        // 1–10 Rate of Perceived Exertion
  caloriesBurned?: number;

  // Cardio-specific
  distanceKm?: number;
  avgPaceMinPerKm?: number;
  avgHeartRate?: number;
  maxHeartRate?: number;
  elevationGainM?: number;
  stravaActivityId?: string;

  // Strength-specific
  exercises?: ExerciseLog[];          // name, sets, reps, weight, rpe

  // Swimming
  laps?: number;
  strokeTypes?: string[];

  // Source
  source: "manual" | "apple-health" | "garmin" | "oura" | "whoop" | "strava";
  wearableLogId?: string;              // original ID from the wearable API
  rawData?: Record<string, unknown>;  // for full fidelity from API

  notes?: string;
}

interface ExerciseLog {
  name: string;                       // "Squat", "Bench Press"
  sets: number;
  reps?: number;                      // null for timed exercises
  weightKg?: number;
  rpe?: number;
  notes?: string;
}
```

#### State Namespaces
- `health.workoutPlans` → `WorkoutPlan[]`
- `health.workoutLogs` → `WorkoutLog[]`

#### Actions

| Action | Description |
|---|---|
| `health.add-workout-plan` | Create a workout plan (name, type, phase, duration, frequency) |
| `health.get-workout-plans` | List all plans, optionally filter by `active=true` |
| `health.update-workout-plan` | Update plan details or mark inactive |
| `health.log-workout` | Log a workout manually |
| `health.get-workout-logs` | Get logs, optionally by date range, type, or source |
| `health.plan-weekly-workouts` | AI generates a weekly training plan for a given phase and available hours |
| `health.sync-wearable` | Update wearable connection state and optionally ingest local/exported workout, sleep, and recovery payloads with dedupe |
| `health.get-wearable-status` | Show connected wearables, last sync time, connection health |
| `health.get-workout-summary` | Weekly/monthly stats: total volume, frequency, calories, favorite types |
| `health.delete-workout-log` | Remove a log entry |

#### Wearable Sync Strategy

Each wearable is a future integration. Sync strategy per device:

**Apple Health (HealthKit)**
- Auth: OAuth 2.0 via HealthKit on iOS/macOS
- Poll: fetch `HKWorkout` objects since last sync timestamp
- Map: `HKWorkout.workoutType` → `WorkoutType`, extract `totalDistance`, `totalEnergyBurned`, `duration`
- Store: `wearableLogId = HKWorkout.uuid`

**Garmin (Garmin Connect API)**
- Auth: OAuth 2.0 with Garmin SSO
- Poll: `GET /users/{userId}/activities` with `startDate` filter
- Map: activity type → `WorkoutType`, extract `distance`, `duration`, `averageSpeed`, `calories`
- Garmin-specific: `TrainingLoad`, `Recovery Time` fields → map to `RecoveryStatus`

**Oura (Oura Ring — Cloud API v2)**
- Auth: personal access token
- Poll: `GET /v2/usercollection/daily_sessions` (workouts) + `GET /v2/usercollection/activities`
- Oura-specific: `score_stay`, `score_move`, `score_ready` → surface in recovery

**WHOOP (Developer API)**
- Auth: OAuth 2.0
- Poll: `GET /v1/activity` for workouts, `GET /v1/recovery` for recovery
- WHOOP-specific: `strain`, `kilojoules`, `recovery.recovery_score` → map to `RecoveryStatus`

**Strava (OAuth API)**
- Auth: OAuth 2.0
- Poll: `GET /api/v3/athlete/activities` since last sync
- Map: `type` → `WorkoutType`, extract distance, moving time, average heart rate, elev gain
- Bi-directional: log a workout here → push to Strava

#### Ambient Nudges (on `agent.run.finished`)
- If 0 workouts logged in 3 days: "No workouts logged recently — want to log something?"
- If 3+ hard (RPE ≥ 8) consecutive days: "You've had 3 high-intensity days. Consider a recovery session."
- If workout scheduled today but not logged: "You planned [workout type] today — how did it go?"

---

### 4.2 Nutrition

#### What
Track meals, hydration, and macro/micro intake. Log food manually or import from a food database (Nutritionix). Set calorie and macro targets. Get nudges when hydration falls behind or meals are skipped.

#### Why
Nutrition is the most tedious health behavior to track. A frictionless "log breakfast" action that remembers your common meals, tracks macros against a target, and reminds you to drink water — that's the goal. Not another calorie counting app. A personal AI nutrition assistant.

#### Data Model

```typescript
interface MealPlan {
  id: string;
  name: string;                        // "Cutting Phase", "High Protein Day"
  dailyCalorieTarget?: number;
  macroTargets?: MacroTargets;        // grams per day
  mealTemplates?: MealTemplate[];     // optional structured meals
  active: boolean;
}

interface MacroTargets {
  proteinGrams: number;
  carbGrams: number;
  fatGrams: number;
  fiberGrams?: number;
}

interface MealTemplate {
  name: string;                       // "Post-workout shake", "Lunch"
  targetCalories?: number;
  targetMacros?: MacroTargets;
  typicalFoods?: string[];            // for AI to suggest quickly
}

interface MealLog {
  id: string;
  date: string;                       // YYYY-MM-DD
  mealName: string;                  // breakfast | lunch | dinner | snack | pre-workout | post-workout
  foods: FoodItem[];                  // what was eaten
  totalCalories: number;
  totalMacros?: MacroTargets;
  source: "manual" | "nutritionix" | "apple-health";
  notes?: string;
}

interface FoodItem {
  name: string;                       // "Greek yogurt with honey"
  portion?: string;                   // "200g", "1 cup"
  calories: number;
  proteinGrams?: number;
  carbGrams?: number;
  fatGrams?: number;
  fiberGrams?: number;
  sugarGrams?: number;
  sodiumMg?: number;
  source?: string;                    // "Nutritionix", "USDA", "manual"
  sourceId?: string;                  // Nutritionix food item ID for future lookup
}

interface HydrationLog {
  id: string;
  date: string;                       // YYYY-MM-DD
  entries: HydrationEntry[];          // individual glasses/bottles logged
  totalMl: number;                    // computed sum
  goalMl: number;                     // daily goal (from config)
  source: "manual" | "apple-health";
}

interface HydrationEntry {
  id: string;
  amountMl: number;                   // e.g. 250ml (one glass), 500ml (bottle)
  loggedAt: string;                    // ISO timestamp
  source: "manual" | "apple-health";
}
```

#### State Namespaces
- `health.mealPlans` → `MealPlan[]`
- `health.mealLogs` → `MealLog[]`
- `health.hydrationLogs` → `HydrationLog[]`
- `health.dailyHydrationGoalMl` → `number` (default: 2500ml)
- `health.dailyCalorieTarget` → `number`
- `health.macroTargets` → `MacroTargets`

#### Actions

| Action | Description |
|---|---|
| `health.add-meal-plan` | Create a meal plan with calorie/macro targets |
| `health.get-meal-plans` | List meal plans |
| `health.update-meal-plan` | Update targets or mark inactive |
| `health.log-meal` | Log a meal with food items |
| `health.log-quick-meal` | Log a meal from a preset/favorite (one action, no food items needed) |
| `health.get-meal-logs` | Get logs by date range or meal name |
| `health.get-nutrition-summary` | Daily/weekly macro totals vs targets |
| `health.search-foods` | Search food database (Nutritionix) for a food name |
| `health.get-food-details` | Get nutritional details for a specific food item |
| `health.log-hydration` | Log a water intake entry |
| `health.get-hydration` | Get today's hydration vs goal |
| `health.set-hydration-goal` | Update daily water intake goal |
| `health.set-calorie-target` | Set daily calorie target |
| `health.set-macro-targets` | Set daily macro targets (protein, carbs, fat) |
| `health.delete-meal-log` | Remove a meal entry |
| `health.delete-hydration-entry` | Remove a hydration entry |

#### Nutritionix Integration
- Auth: API key (free tier: 3 queries/min, 2500 queries/day)
- Search: `POST /v2/search` with `{ query: string, detailed: true }` → returns food items with full macros
- Food items: match Nutritionix `foods[].food_name` → `FoodItem.name`
- Store `sourceId` so re-logging common foods is instant (no re-search)
- Fallback: if Nutritionix unavailable, allow manual entry with just name + calories

#### Ambient Nudges (on `agent.run.finished`)
- If no meals logged today by 10am: "No breakfast logged yet — want to track what you ate?"
- If hydration < 50% of goal by 2pm: "You're at [X]ml of [Y]ml water today. Drink up."
- If 3+ days no food logs: "I notice no meals have been logged recently. Want to start tracking again?"

---

### 4.3 DNA

#### What
Import raw genetic data from 23andMe or AncestryDNA, parse health-relevant variants, and track health insights over time. DNA here is a decision-support input, not a diagnosis. Surface variants that are relevant to nutrition (e.g., MTHFR, COMT), fitness (e.g., ACTN3), pharmacogenomics, and health risks when there is enough context to make them useful.

#### Why
23andMe gives you a zip file of 600,000+ SNPs. You open it once, see some scary headlines, and never look again. The data is useful when it is tied back to labs, symptoms, training load, and medication context: MTHFR may matter if homocysteine is elevated, ACTN3 may matter when training goals are specific, and pharmacogenomic markers may matter when medication metabolism is in play. This plugin makes those relationships actionable without overstating certainty.

#### Data Model

```typescript
interface DnaReport {
  id: string;
  uploadDate: string;                 // ISO date
  source: "23andme" | "ancestrydna" | "livedna" | "other";
  fileName?: string;                   // original filename
  fileHash?: string;                  // SHA-256 of uploaded file (detect re-uploads)

  // Parsed summary (human-readable)
  ancestryComposition?: AncestryComposition;
  healthInsights: DnaHealthInsight[];
  variants: DnaVariant[];             // full variant list (filtered to relevant)

  // Raw import tracking
  rawSnpsImported: number;            // how many SNPs were in the file
  snpsMatchedToKnowledgeBase: number; // how many were annotated

  notes?: string;
}

interface AncestryComposition {
  overall: string;                   // "European", "South Asian", etc.
  detail: Record<string, number>;    // "Northern European": 0.45, etc.
}

interface DnaHealthInsight {
  id: string;
  category: DnaInsightCategory;      // nutrition | fitness | cardiovascular | metabolic | pharmacogenomics | risk
  title: string;                      // "MTHFR C677T Variant"
  description: string;               // what this variant means
  impact: "positive" | "neutral" | "risk"; // how it affects you
  relevantVariants: string[];         // rsIDs that inform this insight
  actionableRecommendation?: string;  // what to do about it
  source?: string;                    // "23andMe", "SNPedia", "Promethease"
}

type DnaInsightCategory =
  | "nutrition"      // MTHFR, COMT, VDR, FTO, etc.
  | "fitness"        // ACTN3, ACE, PPARGC1A, etc.
  | "cardiovascular" // APOE, 9p21, etc.
  | "metabolic"     // TCF7L2, KCNJ11, etc.
  | "pharmacogenomics" // CYP450 variants for drug metabolism
  | "sleep"          // DEC2, PER3, etc.
  | "risk";         // general disease risk variants

interface DnaVariant {
  rsId: string;                      // rs1234567
  chromosome: string;                // "chr1"
  position: number;
  allele1: string;                    // e.g. "A"
  allele2: string;                    // e.g. "G"
  genotype: string;                  // e.g. "AA", "AG", "GG"
  diploidType: "heterozygous" | "homozygousdominant" | "homozygousrecessive";
  clinicalSignificance?: string;     // "benign", "pathogenic", "uncertain"
  annotations?: Record<string, string>; // key-value from SNPedia/knowledge base
}

interface DnaVariantAnnotation {
  rsId: string;
  gene: string;
  title: string;
  description: string;
  impact: "positive" | "neutral" | "risk";
  category: DnaInsightCategory;
  alleleEffects?: AlleleEffect[];
}

interface AlleleEffect {
  allele: string;                    // "A", "G", etc.
  effect: string;                    // what this allele does
  summary: string;                   // one-line summary
}
```

#### State Namespaces
- `health.dnaReports` → `DnaReport[]`
- `health.dnaVariantAnnotations` → `DnaVariantAnnotation[]` (local knowledge base)
- `health.dnaSettings` → `{ preferredReportSource: "23andme" | "promethease", lastImport?: string, privacyMode: "living" | "privacy" }`

#### Actions

| Action | Description |
|---|---|
| `health.preview-dna-import` | Parse a DNA file into a preview before storing it |
| `health.add-dna-report` | Upload a 23andMe, AncestryDNA, LivingDNA-style, or VCF file for parsing and storage |
| `health.get-dna-reports` | List all imported DNA reports |
| `health.get-dna-knowledge-base-status` | Show current local genetics knowledge-base version and supported formats |
| `health.get-dna-insights` | Return all health insights from all reports |
| `health.get-dna-insights-by-category` | Filter insights by category (nutrition, fitness, etc.) |
| `health.get-dna-variants` | Get full variant list for a report |
| `health.get-dna-variant-detail` | Get detailed annotation for a specific rsId |
| `health.lookup-rsid` | Quick lookup: what does this rsId mean for me? |
| `health.annotate-variant` | Add a personal annotation/note to a variant |
| `health.compare-dna-reports` | Compare two reports (detect changes, updated data) |
| `health.reanalyze-dna-report` | Recompute insights for a stored report against the current local knowledge base |
| `health.minimize-dna-report` | Strip retained variant/ancestry detail from a stored report after explicit confirmation |
| `health.export-dna-insights` | Export insights as markdown (for sharing with doctor) |
| `health.get-dna-bloodwork-correlations` | Cross-analyze DNA signals with bloodwork context |
| `health.get-dna-monitoring-plan` | Generate a conservative follow-up monitoring plan |
| `health.get-dna-supplement-recommendations` | Suggest supplements only when the evidence and context justify it |
| `health.delete-dna-report` | Remove a report and its variants |

#### Import Pipeline

**23andMe format:**
```
# This data file generated by 23andMe at: Mon Jan 15 12:34:56 2024
#
# Below is a text version of your data file generated at the above date.
#
rsid	chromosome	position	genotype
rs3094315	1	752566	AA
rs3131972	1	752721	AG
...
```

**AncestryDNA format:** tab-separated, slightly different column names (`# Chromosome`, `Position`, `Allele 1`, `Allele 2`)

**LivingDNA-style delimited format:** delimited rows with recognizable `rsid`, `chromosome`, `position`, and `result` / `genotype` / `call` columns

**VCF format:** single-sample VCF rows with standard headers and rsID-based records

**Parsing steps:**
1. Validate file header/shape (detect 23andMe vs AncestryDNA vs LivingDNA-style vs VCF)
2. Stream-parse line by line (large files: 600K+ lines)
3. For each SNP: look up rsId in local annotation knowledge base
4. Match variant alleles → determine genotype (homozygous dominant, heterozygous, homozygous recessive)
5. In living mode, retain a compact genotype rematch set so future knowledge-base updates can discover newly annotated rsIDs without preserving full raw files
5. Compute `diploidType` based on whether alleles are same/different
6. Group annotated variants into `DnaHealthInsight` by gene/category
7. Compute ancestry composition from ancestry-informative markers (AIMs)
8. Store full variant list (for future lookups) + curated insights list (for user-facing)

#### Variant Annotation Knowledge Base
A local JSON file (`src/dna/annotations.json`) maps rsIds to annotations:

```json
{
  "rs4686302": {
    "gene": "MTHFR",
    "title": "MTHFR C677T",
    "description": "A1298C variant affecting folate metabolism",
    "category": "nutrition",
    "impact": "risk",
    "alleleEffects": [
      { "allele": "A", "effect": "Normal enzyme activity", "summary": "No impact" },
      { "allele": "C", "effect": "Reduced enzyme activity (~30%)", "summary": "Consider methylfolate over folic acid" }
    ]
  }
}
```

Initial knowledge base: top 200 clinically relevant SNPs (MTHFR, COMT, VDR, ACTN3, APOE, 9p21, CYP2C9, CYP2D6, TCF7L2, FTO, etc.). Expandable via community contributions.

#### Ambient Nudges (on `agent.run.finished`)
- On new DNA report import: summarize top 5 actionable insights
- If nutrition insight present (e.g., MTHFR variant): "Your MTHFR variant suggests methylfolate may work better than folic acid for you — worth noting for your next doctor visit."
- Never surface disease risk variants unprompted — user must explicitly ask

#### Cross-analysis rules
- DNA and bloodwork correlations are hypothesis-generating, not diagnostic.
- Use medication lists, symptoms, diet, and training load before suggesting any supplement or protocol change.
- Prefer conservative language: "worth discussing with a clinician" over "you should do this."

#### Non-Goals
- No medical diagnosis — always "consult a healthcare provider"
- No sharing of raw genetic data with third parties
- No treatment decisions based on genetics or a single bloodwork result

### 4.4 Labs & Bloodwork

#### What
Import lab panels, analyze biomarker trends against clinical and optimal ranges, compute category scores and biological age estimates, and generate conservative action plans. Interpret each result with fasting status, acute illness, training load, hydration, medication context, and prior results in mind.

#### Why
A single lab value is easy to misread. This plugin should prefer trends, context, and repeat testing over one-off alarms. Bloodwork can inform conversations about nutrition, recovery, medications, and follow-up timing, but only when the summary is transparent about what it used.

#### State Namespaces
- `health.labResults` → `LabResult[]`

#### Actions

| Action | Description |
|---|---|
| `health.add-lab-result` | Store a lab panel or biomarker result |
| `health.preview-lab-import` | Preview CSV / TSV / line-based bloodwork imports with normalization notes before storing |
| `health.import-lab-result` | Import a normalized lab result from raw text/delimited input |
| `health.get-lab-results` | List stored lab results |
| `health.review-lab-trends` | Review longitudinal changes across panels |
| `health.get-bloodwork-trends` | Generate biomarker trend summaries |
| `health.get-bloodwork-biomarkers` | List the biomarker catalog |
| `health.get-bloodwork-biomarker` | Look up a specific biomarker definition |
| `health.get-bloodwork-clocks` | Show available biological-age clock methods and coverage requirements |
| `health.analyze-bloodwork` | Produce the latest bloodwork analysis |
| `health.get-bloodwork-category-scores` | Summarize healthspan category scores |
| `health.calculate-biological-age` | Estimate biological age from lab patterns |
| `health.get-bloodwork-action-plan` | Generate a conservative follow-up plan |
| `health.get-dna-bloodwork-correlations` | Cross-analyze genetics and bloodwork |

#### Non-Goals
- No diagnosis from a single panel or biomarker
- No supplement escalation without context
- No replacing clinician interpretation or repeat testing when uncertainty is high

### 4.5 Privacy, Auditability, and Projections

#### What
Maintain a first-class privacy policy, an append-only audit trail, and derived read models that present safe summaries without exposing raw state unnecessarily. Derived views include the health overview, latest lab projection, latest DNA projection, pending reminder projection, and privacy projection.

#### Why
Safer health software should explain its outputs. The plugin needs to know whether it is in living or privacy mode, what was redacted, and which source records informed a summary. Read models keep the UI explainable while source records remain the source of truth.

#### State Namespaces
- `health.privacyPolicy` → `HealthPrivacyPolicy`
- `health.auditLog` → `HealthAuditEntry[]`
- `health.sensitiveConsents` → `HealthConsentEntry[]`
- `health.nudgeHistory` → `HealthNudge[]`

#### Read Models / Projections
- `health.overview` → daily cross-domain summary
- `health.workouts.overview` → training overview
- `health.nutrition.overview` → nutrition overview
- `health.labs.latest` → latest lab projection and analysis
- `health.dna.latest` → latest DNA projection and summary
- `health.reminders.pending` → pending reminders and nudges
- `health.privacy.status` → privacy summary and exposure posture
- `health.dna.kb-status` → knowledge-base status and supported import formats
- `health.audit.summary` → audit / consent summary counts and latest entries

#### Actions

| Action | Description |
|---|---|
| `health.update-privacy-settings` | Update privacy mode and export policy |
| `health.get-privacy-status` | Summarize the current privacy posture |
| `health.record-sensitive-consent` | Manually record an explicit consent event for a sensitive workflow |
| `health.get-sensitive-consents` | Review consent history for sensitive workflows |
| `health.purge-sensitive-consents` | Purge retained consent history after explicit confirmation |
| `health.get-health-audit-log` | Read the sensitive-action audit trail |
| `health.purge-health-audit-log` | Remove old audit entries according to retention rules |

#### Auditability rules
- Sensitive actions should write an audit entry with category, detail, success state, and sensitivity level.
- Sensitive DNA exports, reanalysis, consent-history writes/reads/purges, and audit-log reads/purges should require explicit confirmation.
- High-sensitivity DNA access/export and confirmed audit/consent-log access should also be visible through the consent history surface.
- Privacy settings updates, sensitive exports, and purge operations should be discoverable from the audit log.
- Consent history should inherit retention pruning and offer an explicit purge path, not just append forever.
- Derived views should stay derived; source records remain the canonical storage.

---

## 5. Architecture

```
Personal Health Plugin
├── State: instance-scoped (per-plugin persistent storage)
├── Actions: one per feature (add, get, log, review patterns)
├── Projections: overview, latest-lab, latest-DNA, privacy, reminder views
├── Events: subscribes to agent.run.finished for ambient nudges
└── Integrations (future): wearables API, pharmacy portals, lab APIs,
    nutritionix, strava, 23andMe
```

## 6. State Schema — Complete

| Namespace | Type | Description |
|---|---|---|
| `health.medications` | `Medication[]` | Active medications |
| `health.medicationLogs` | `MedicationLog[]` | Dose taken/skipped logs |
| `health.refills` | `RefillLog[]` | Refill tracking |
| `health.symptoms` | `SymptomEntry[]` | Symptom journal |
| `health.workoutPlans` | `WorkoutPlan[]` | Training templates |
| `health.workoutLogs` | `WorkoutLog[]` | All workout sessions |
| `health.sleepEntries` | `SleepEntry[]` | Sleep records |
| `health.mealPlans` | `MealPlan[]` | Nutrition templates |
| `health.mealLogs` | `MealLog[]` | Food intake logs |
| `health.hydrationLogs` | `HydrationLog[]` | Water intake logs |
| `health.dailyHydrationGoalMl` | `number` | Daily water goal (default: 2500) |
| `health.dailyCalorieTarget` | `number` | Daily calorie target |
| `health.macroTargets` | `MacroTargets` | Daily protein/carbs/fat targets |
| `health.appointments` | `Appointment[]` | Medical appointments |
| `health.labResults` | `LabResult[]` | Lab panels |
| `health.habits` | `Habit[]` | Habit definitions |
| `health.habitCompletions` | `HabitCompletion[]` | Habit check-ins |
| `health.recoveryStatus` | `RecoveryStatus[]` | Recovery scores |
| `health.supplements` | `Supplement[]` | Daily supplements |
| `health.supplementLogs` | `SupplementLog[]` | Supplement taken logs |
| `health.dnaReports` | `DnaReport[]` | DNA imports |
| `health.dnaVariantAnnotations` | `DnaVariantAnnotation[]` | Local variant knowledge base |
| `health.dnaSettings` | `DnaSettings` | Import preferences |
| `health.privacyPolicy` | `HealthPrivacyPolicy` | Privacy and export policy |
| `health.auditLog` | `HealthAuditEntry[]` | Append-only sensitive-action log |
| `health.nudgeHistory` | `HealthNudge[]` | Prior nudges and reminder history |
| `health.wearableStatus` | `WearableSyncStatus[]` | Device connection state |

## 7. Wearable Integration Map (Future)

| Source | Data Imported | Auth | Sync Frequency |
|---|---|---|---|
| Apple Health | workouts, HRV, steps, calories | OAuth 2.0 / HealthKit | Real-time push (if possible) or 15min poll |
| Garmin Connect | workouts, recovery load, sleep | OAuth 2.0 | 30min poll |
| Oura Ring | sleep stages, readiness, activity | Personal Access Token | 1h poll |
| WHOOP | strain, recovery score, HRV | OAuth 2.0 | 5min poll |
| Strava | runs, rides, swims | OAuth 2.0 | Manual trigger or daily sync |

## 8. Integration APIs (Future)

| Source | Purpose |
|---|---|
| Norwegian pharmacy portals | Read-only prescription refill data |
| Norwegian clinic portals | Lab results, appointments |
| 23andMe | Raw SNP data import |
| Live | Raw SNP data import |
| Promethease | SNP annotations |
| Nutritionix | Food database search |
| Strava | Activity sync (run/ride/swim) |
| Apple Health | Wearable data aggregation |

## 9. Non-Goals

- Medical diagnosis (not a doctor — consult healthcare providers)
- Prescription management or pharmacy ordering (read-only)
- Sharing health data with third parties without explicit consent
- Replacing wearable native apps (integrate, not replicate)
- Making one-off lab results or SNPs into treatment decisions
- Using ancestry inference as the primary product value proposition

## 10. Definition of Done

- Plugin builds, typechecks, and passes tests
- Manifest declares all actions
- Each action reads/writes the correct state namespace
- Types fully specify all fields (no `unknown` in stored data)
- PRD is current and reflects what was built

## 11. Implementation Uplift (2026-04)

To align the plugin with the richer `genetic.health` product direction, the implementation now also supports:

- raw 23andMe / AncestryDNA import parsing inside the plugin worker,
- evidence-labeled DNA insight summaries,
- bloodwork analysis with biomarker trends, category scores, biological age, and action plans,
- DNA ↔ bloodwork correlation summaries,
- markdown exports that include an actionable health protocol,
- living-mode vs privacy-mode DNA settings,
- append-only audit logging for sensitive actions,
- derived projections/read models for overview, privacy, reminder, DNA, and lab views,
- ambient nudges triggered after `agent.run.finished`,
- documentation and packaging oriented around a unified “health operating layer” value proposition.

These changes stay inside the plugin’s educational / non-diagnostic boundary and are intentionally framed as decision support rather than clinical advice. No output should imply that a single lab result, SNP, or summary is sufficient to start or stop treatment without clinician review.
