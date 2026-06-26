# PROJECT — Elon Protocol Modification — COMPLETE

## Objective (delivered)
1. **C1 — Dot agreement token.** A lone `.` reply = agree with the most-recent pending proposal (any origin) and proceed.
2. **C2 — Cross-instance file messaging.** In-app (`irc`) primary when co-located; file transport in `.app/mess/` (→ `arc/`) only when the receiver runs in a different omp instance.

## Workflow Path: FULL — ALL PHASES ✅
| Phase | Status | Artifact / Commits |
|---|---|---|
| REQUEST | ✅ | `.app/PROJECT.md` |
| GRILL | ✅ `2034c6f` | `.app/REQ.md` |
| RESEARCH | ✅ | `.app/RESEARCH.md` |
| SPEC | ✅ `a2ef82e` | `.app/SPEC.md` |
| DEVELOP | ✅ build CLEAN, 63/63 tests | `99fcef3` `47b2f6c` `6c3cbf1` `f357888` `b346eab` |
| VALIDATE | ✅ **PASS** (all R1.1–R6.4 ACs) | — |
| DONE | ✅ DocWorm doc pass | docs commit (this gate) |

## Final verification
- `npm run typecheck` → CLEAN; `npm test` → 63/63 pass.
- Validator PASS: every AC met with file:line evidence + passing unit tests.
- Elon/Main NOT granted `mess-send` (no gate bypass); read-only agents' writes constrained to `.app/mess/`.
- Docs consistent; `. ` wording resolved; cross-instance setup guide added to README.

## Delivered (new code)
- `src/dot-agreement.ts` (+test) — `before_agent_start` hook: `.` → inject most-recent pending ask.
- `src/mess-transport.ts` (+test) — `mess-send`/`mess-fail` tools: transport selection, `.app/mess/` store, turn-scan+2s-poll detection, mkdir-claim, PENDING→CLAIMED→PROCESSED|FAILED lifecycle.
- Registered in `package.json` omp.extensions; agent frontmatter + skill docs updated.

## How to use
- **Opt in** (same as the gate) to activate both extensions.
- **Dot token:** reply `.` to agree with the most-recent pending proposal.
- **Cross-instance:** set `OMP_INSTANCE_ID` (or let it auto-uuid into `.app/instances.json#self`); map agents→instances in `.app/instances.json#agents` (absent ⇒ co-located). Same machine, shared `.app/` filesystem.

## Non-blocking follow-ups (optional)
- 2 internal code comments in `src/mess-transport.ts` (~L651, L724) still use `mess-done` shorthand (zero behavior impact).
- Behavioral/integration tests (two-process detection latency) are Elon-phase checks per SPEC §10, not unit tests.
