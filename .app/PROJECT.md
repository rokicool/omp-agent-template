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
**DONE.** Validator PASS (14/14 ACs MET, 0 issues, no regression, all §4 invariants
hold; 42/42 + 97/97 + strict tsc exit 0). DEVELOP ⇄ VALIDATE closed at cycle 2.

## Final deliverable (all committed)
**Protocol artifacts (Elon `[PROTO]`):** GRILL `dc2fbb5`, RESEARCH `c27854b`,
PA-1 `39724f9`, SPEC `9e4b0e1`, DEVELOP-status `1cbd127`, VALIDATE-status `fd93e0f`.
**Implementation (LeadDev/MidDev):** `990794e` (module+tests+pkg), `508b2bd`
(customType fix + cmd tests), `66fe5c1` (`<idea_storage>` SKILL block),
`789382e` (append-system companion), `c748b6b` ([FIX] AC13(b) diagnostic).

### Files
- `src/idea-storage.ts` (NEW) — `before_agent_start` reminder hook; `idea`/`ideas`
  commands; pure `parseIdeas`/`matchIdeas`/`remindersEnabled`/`buildIdeaInjection`;
  `import {optedIn}`; `node:fs` read-only; zero deps.
- `src/idea-storage.test.ts` (NEW) — 42 cases.
- `package.json` — 5th `omp.extensions` entry; 0 runtime deps.
- `plugins/agents/skills/elon/SKILL.md` — `<idea_storage>` advisory block.
- `src/append-system.default.md` — companion paragraph.
- `.app/IDEAS.md` — runtime-only (DocWorm-created on first capture).

### Behavior
- **Capture:** `/idea <text>` or NL phrase → Elon acks → DocWorm appends a `parked`
  block to `.app/IDEAS.md` → confirms `IDEA-NNN`. Agents emit `idea-suggest` blocks;
  Elon vetoes/accepts.
- **Remind:** turn-start hook injects ≤2 `parked` ideas sharing ≥1 token with the
  request (keyword/tag overlap); Elon surfaces a one-line pointer if relevant.
- **List:** `/ideas` (non-terminal); `/ideas all` (audit incl. terminal).
- **Promote:** `/idea promote IDEA-NNN` → `status=promoted` (block kept) → seeds a
  fresh `.app/REQ.md` (Pending-Ask gate if a workflow is active — no clobber).
- **Opt-out:** `.omp/elon.json` `{"ideas":{"reminders":false}}` or `OMP_IDEA_REMINDERS=0`.

### DocWorm assessment
SKIPPED — user-facing docs are intrinsic (skill `<idea_storage>` block + append-system
companion), already landed and Validator-confirmed. No external/README surface missing.

## Phase Log
- 2026-06-27 REQUEST → GRILL (dc2fbb5) → RESEARCH (c27854b) → PA-1 (39724f9) → SPEC (9e4b0e1).
- 2026-06-27 DEVELOP — implemented (990794e, 508b2bd, 66fe5c1, 789382e); status (1cbd127).
- 2026-06-27 VALIDATE c1 — FAIL (FAIL-1 only); status (fd93e0f).
- 2026-06-27 RESOLVE c1 — AC13(b) fixed (c748b6b).
- 2026-06-27 VALIDATE c2 — PASS (14/14 ACs). DONE.

## Pending Asks
- [PA-1] 2026-06-27 origin=elon status=agreed | "Accept §6 assumptions + proceed to SPEC." (accepted)
