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
**VALIDATE cycle 1 → RESOLVE.** Validator verdict: **FAIL (single issue FAIL-1)**.
AC1–AC12, AC14, all §4 invariants, U1–U9, and all 4 residual concerns = MET/ACCEPT.
AC13 PARTIAL only on the located-error diagnostic half (safety-critical behavior met).
41/41 + 96/96 + strict tsc PASS. RESOLVE = add `pi.logger` located-error on
corrupt/non-empty-yielding IDEAS.md (~4 lines + 1 test), then re-validate.

## DEVELOP — landed (commits 990794e/508b2bd/66fe5c1/789382e)
`src/idea-storage.ts`, `src/idea-storage.test.ts` (41 cases), `package.json`
(5th `omp.extensions`), `plugins/agents/skills/elon/SKILL.md` (`<idea_storage>`),
`src/append-system.default.md` (companion). `.app/IDEAS.md` deliberately absent.

## VALIDATE cycle 1 — FAIL-1 (only failure)
- **AC13(b) located-error diagnostic missing.** On a corrupt/non-empty-yielding
  `.app/IDEAS.md`, `parseIdeas` returns `[]` silently (src/idea-storage.ts:138-154)
  and the hook returns silently (src/idea-storage.ts:466-478) — no `pi.logger` line.
  SPEC §5.4 + §15 AC13(b) require it. `pi.logger` available at types.ts:945-946.
- **Fix:** emit `pi.logger.warn(...)` when the file EXISTS, is NON-EMPTY, and yields
  0 records, before returning `[]`. + one test (stub captures `pi.logger.warn`).
- Severity: LOW (observability only; inject-nothing/never-crash already met + tested).

## Phase Log
- 2026-06-27 REQUEST → GRILL (dc2fbb5) → RESEARCH (c27854b) → PA-1 (39724f9) → SPEC (9e4b0e1).
- 2026-06-27 DEVELOP — implemented (990794e, 508b2bd, 66fe5c1, 789382e); PROJECT.md (1cbd127).
- 2026-06-27 VALIDATE c1 — Validator FAIL (FAIL-1 only); RESOLVE delegated to LeadDev.

## Pending Asks
- [PA-1] 2026-06-27 origin=elon status=agreed | "Accept §6 assumptions + proceed to SPEC." (accepted)
