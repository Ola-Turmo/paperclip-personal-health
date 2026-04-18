# PRD: paperclip-personal-health

## 1. Product Intent

Personal health management plugin for Paperclip — a life operating system layer for physical and mental wellbeing. Replaces scattered apps (medication reminders, symptom trackers, fitness logs, nutrition planners) with one unified plugin that can be queried and automated by your personal AI.

## 2. Problem

Health data is fragmented across pharmacy portals, wearable apps, clinic portals, and paper notes. People miss medication doses, forget appointment prep, lose track of symptoms, and have no unified view of their health.

## 3. Target Users

Single user (Ola) managing personal health across: medications, symptoms, workouts, sleep, nutrition, lab results, habits, recovery, supplements, DNA data, and wearables.

## 4. Features (MVP Scope)

### Now
- **Medication tracking** — log doses taken/skipped, track refills, reminder scheduling
- **Symptom journal** — log symptoms with severity, triggers, and relief measures
- **Workout logging** — track workouts by type, duration, source (manual or wearable)
- **Sleep logging** — bedtime, wake time, quality score, stages, wearable sync
- **Hydration nudges** — log water intake, daily goal tracking
- **Appointment management** — schedule with provider, prep notes, cancellation window
- **Lab result storage** — upload/parse panels, track biomarker trends over time
- **Habit tracking** — build habits with streaks, completion logging
- **Daily health summary** — unified view of all health data for any given day

### Next
- **Supplement scheduling** — daily/supplement routines with reminders
- **Recovery monitoring** — WHOOP/Garmin/Oura recovery scores and recommendations
- **Meal planning** — calorie/macro targets, meal templates
- **DNA integration** — 23andMe/Live data import, health insights tracker
- **Wearable sync** — Apple Health, Garmin, Oura, WHOOP status and data pull
- **Symptom pattern review** — AI review of symptom correlations with medications, diet, sleep
- **Appointment prep** — auto-generate prep notes before appointments

## 5. Architecture

```
Personal Health Plugin
├── State: instance-scoped (per-plugin persistent storage)
├── Actions: one per feature (add, get, log, review patterns)
├── Events: subscribes to agent.run.finished for ambient nudges
└── Integrations (future): wearables API, pharmacy portals, lab APIs, nutrition APIs
```

## 6. State Schema

All state is instance-scoped JSON stored via `ctx.state`. Key namespaces:

| Namespace | Content |
|---|---|
| `health.medications` | Medication[] |
| `health.medicationLogs` | MedicationLog[] |
| `health.symptoms` | SymptomEntry[] |
| `health.workoutLogs` | WorkoutLog[] |
| `health.sleepEntries` | SleepEntry[] |
| `health.mealLogs` | MealLog[] |
| `health.hydrationLogs` | HydrationLog[] |
| `health.appointments` | Appointment[] |
| `health.labResults` | LabResult[] |
| `health.habits` | Habit[] |
| `health.habitCompletions` | HabitCompletion[] |
| `health.recoveryStatus` | RecoveryStatus[] |
| `health.supplements` | Supplement[] |
| `health.supplementLogs` | SupplementLog[] |
| `health.dnaReports` | DnaReport[] |
| `health.wearableStatus` | WearableSyncStatus[] |

## 7. Non-Goals

- Medical diagnosis (not a doctor, consult healthcare providers)
- Prescription management or pharmacy ordering (read-only tracking)
- Sharing health data with third parties
- Replacing wearable native apps

## 8. Integrations (Future)

| Source | Data |
|---|---|
| Apple Health | workouts, sleep, HRV, steps |
| Garmin | recovery, workouts, sleep |
| Oura | sleep stages, readiness, activity |
| WHOOP | recovery score, strain, HRV |
| Norwegian pharmacy portals | prescription refills |
| Norwegian clinic portals | lab results, appointments |
| 23andMe / AncestryDNA | genetic variants, health insights |
| Nutritionix | food logging |

## 9. Definition of Done

- Plugin builds, typechecks, and passes tests
- Manifest declares all actions
- Each action reads/writes correct state namespace
- PRD is current and reflects what was built
