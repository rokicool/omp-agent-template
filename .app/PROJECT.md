# PROJECT.md — Idea/Suggestion Storage Extension

## Brief
Analyze the agent-communication protocol (`skill://elon`) and design an extension
for **ideas/suggestions storage** under `.app/`: capture worthwhile-but-out-of-
scope work, persist it, let Elon remind the user about relevant stored ideas, and
allow promotion of an idea into the FULL workflow.

## Classification
**FULL** — new orchestrator-protocol extension (Plugin A code + advisory prose).

## Workflow Path
FULL: REQUEST → GRILL → RESEARCH → SPEC → DEVELOP ⇄ VALIDATE → DONE

## Current Phase
**SPEC** — LeadDev producing `.app/SPEC.md` from REQ.md + RESEARCH.md. (PA-1
accepted: §6 assumptions stand as input, §6.8 refined to `.omp/elon.json`.)

## Resolved Requirements (GRILL round 1 — user-confirmed)
- **A. Capture:** BOTH — user (NL phrase or `/idea`) + agents (guarded proactive parking). Immediate ack.
- **B. Storage:** single `.app/IDEAS.md`, append-style; writes owned by DocWorm. *(Verified: no agent-definition edit needed — DocWorm frontmatter already permits write, RESEARCH F5.2.)*
- **C. Reminder:** proactive one-line pointer on relatedness (keyword/tag overlap, capped 1–2) + on-demand `/ideas`; opt-out.
- **D. Enforcement:** advisory prose in `skill://elon` + turn-start hard hook = `before_agent_start` `{message}` injection (RESEARCH F2.2/R2). Advisory layer is protocol prose only (U7).
- **E. Lifecycle:** Ideas distinct from Pending Asks; promotable into a fresh `REQ.md` (`status=promoted`, kept for audit). Separate file/parser/customType (F3.3).

## §6 assumptions — ACCEPTED as SPEC input (PA-1 agreed)
§6.1–§6.7, §6.9–§6.10 as written in `.app/REQ.md`. **§6.8 refined:** opt-out lives
in `.omp/elon.json` (`ideas.reminders:false`) + env `OMP_IDEA_REMINDERS=0` (RESEARCH R4).

## RESEARCH — key facts (for SPEC)
New `src/*.ts` in `package.json#omp.extensions` + `import {optedIn}` (F1.x); reminder hook `before_agent_start`→`{message:{customType:"elon-ko-gate:idea-reminder",…}}` (F2.2); `.app/IDEAS.md` auto-tracked (F3.1); parser mirrors `mostRecentPendingAsk` (F3.3); DocWorm writes / extension reads via `fs` / Elon `[PROTO]`-commits (F5.x); zero deps (U3/U9); atomic temp+`fs.rename` (U4). SPEC resolves U1 (grammar), U2 (opt-out key), U5 (cadence mid-workflow), U6 (customType), U8 (`/idea` write routing).

## Phase Log
- 2026-06-27 REQUEST — classified FULL, created PROJECT.md, routed to ReqGuru.
- 2026-06-27 GRILL r1 — 5-fork batch relayed; user resolved all five.
- 2026-06-27 GRILL gate — `.app/REQ.md` written + committed `[PROTO]` (dc2fbb5).
- 2026-06-27 RESEARCH gate — `.app/RESEARCH.md` written + committed `[PROTO]` (c27854b); forks feasible.
- 2026-06-27 SPEC — PA-1 accepted (assumptions as input); LeadDev delegated to produce `.app/SPEC.md`.

## Pending Asks
- [PA-1] 2026-06-27 origin=elon status=agreed | "Accept §6 assumptions + proceed to SPEC." (accepted via continue-directive; §6.8 refined per RESEARCH)
