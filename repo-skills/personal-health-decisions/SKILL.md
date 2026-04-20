---
name: personal-health-decisions
description: Use for personal-health product and operations work involving meds, workouts, nutrition, labs, DNA-informed insights, appointments, recovery, or health summaries where the system must stay helpful, privacy-aware, and explicitly non-diagnostic.
---

# Personal Health Decisions

Use this skill for the Personal Health operating layer.

## Read First

Read these files in order:

1. `README.md`
2. `PRD.md`
3. `src/manifest.ts`
4. `src/worker.ts`

Then inspect the relevant surface:

- UI and projections: `src/ui/`
- tests: `tests/`
- assets and product framing: `assets/`

## What This Repo Owns

This repo owns the decision-support health layer for:

- meds and supplements
- workouts and recovery
- meals and hydration
- labs and appointments
- DNA-informed, privacy-aware summaries

## Working Rules

- Keep the system useful without pretending to be a clinician.
- Favor conservative summaries over overconfident medical interpretation.
- Privacy mode and consent controls are first-class product behavior.
- Make trends, reminders, and prep clearer; do not manufacture certainty.

## Non-Negotiable Guardrails

- No diagnosis or treatment instructions presented as authoritative medical advice.
- Sensitive genetics and health data must stay privacy-aware and auditable.
- Derived views should remain explainable from source records.

## Default Workflow

1. Identify whether the task is logging, summary, reminder, trend analysis, or privacy/control work.
2. Check the read-model and source-record implications before editing.
3. Preserve the explainability of any derived output.
4. Verify that privacy and consent behavior still matches the task’s sensitivity.

## Expected Outcomes

Good work in this repo should improve:

- follow-through
- trend clarity
- privacy posture
- health-summary usefulness
- trust in what the system is and is not claiming
