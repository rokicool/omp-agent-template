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
**DEVELOP** — LeadDev implementing per `.app/SPEC.md` (delegates coding to
MidDev). SPEC gate committed; all U1–U9 resolved, AC1–AC14 mapped.

## Resolved Requirements (GRILL round 1 — user-confirmed)
- **A. Capture:** BOTH — user (NL/`/idea`) + agents (guarded proactive parking). Immediate ack.
- **B. Storage:** single `.app/IDEAS.md`, append-style; writes owned by DocWorm (no frontmatter change — F5.2).
- **C. Reminder:** proactive one-line pointer (keyword/tag overlap, capped 1–2) + `/ideas`; opt-out.
- **D. Enforcement:** advisory prose in `skill://elon` + turn-start hard hook (`before_agent_start` `{message}`).
- **E. Lifecycle:** Ideas distinct from Pending Asks; promotable into a fresh `REQ.md` (`status=promoted`, kept for audit).

## SPEC — key design decisions (locked)
- Module: **`src/idea-storage.ts`** (Plugin A); `import {optedIn}`; dormancy parity; type/runtime split (F1.2); zero deps.
- customTypes: `elon-ko-gate:idea-reminder`, `elon-ko-gate:idea-capture`.
- Hook: `before_agent_start` (user turns only) → inject ≤2 parked-idea matches as hidden advisory framing.
- Grammar: fenced `idea` blocks under `## Ideas`; tolerant `parseIdeas` mirrors `mostRecentPendingAsk`.
- Opt-out: `.omp/elon.json` `{ideas:{reminders:false}}` + `OMP_IDEA_REMINDERS=0` (§6.8 refined).
- Capture: `/idea` command handler steers Elon (no fs write); Elon acks → delegates DocWorm append.
- File change set: `src/idea-storage.ts`, `src/idea-storage.test.ts`, `package.json` (omp.extensions), `plugins/agents/skills/elon/SKILL.md` (`<idea_storage>` block), `src/append-system.default.md` (companion), `.app/IDEAS.md` (runtime by DocWorm).
- Residual risks for DEVELOP: **R-U4** (verify omp `write` atomicity; fail-safe parser is backstop), **R-U8** (confirm `sendMessage` from command handler fires continuation turn; fallback = NL-only `/idea`).

## Phase Log
- 2026-06-27 REQUEST — classified FULL, created PROJECT.md, routed to ReqGuru.
- 2026-06-27 GRILL r1 — 5-fork batch relayed; user resolved all five.
- 2026-06-27 GRILL gate — `.app/REQ.md` committed `[PROTO]` (dc2fbb5).
- 2026-06-27 RESEARCH gate — `.app/RESEARCH.md` committed `[PROTO]` (c27854b).
- 2026-06-27 PA-1 — agreed (assumptions as SPEC input) `[PROTO]` (39724f9).
- 2026-06-27 SPEC gate — `.app/SPEC.md` written by LeadDev; committed `[PROTO]`.
- 2026-06-27 DEVELOP — LeadDev delegated to implement per SPEC (→ MidDev).

## Pending Asks
- [PA-1] 2026-06-27 origin=elon status=agreed | "Accept §6 assumptions + proceed to SPEC." (accepted; §6.8 refined per RESEARCH)
