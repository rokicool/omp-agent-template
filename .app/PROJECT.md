# PROJECT — Elon Protocol Modification

## Objective
Two changes to the orchestrator plugin suite shipped from THIS repo (`omp-agent-gate` = Plugin A; `orchestrator-agents` = Plugin B):

1. **C1 — Dot agreement token.** A lone `.` reply = agree with the most-recent pending proposal (any origin) and proceed.
2. **C2 — File-based inter-agent messaging, as cross-instance IPC.** In-app (`irc`) primary when co-located; file transport in `.app/mess/` (→ `arc/`) only when the receiver runs in a different omp instance.

## Workflow Path: FULL
| Phase | Status | Artifact / Commits |
|---|---|---|
| REQUEST | ✅ | `.app/PROJECT.md` |
| GRILL | ✅ `2034c6f` | `.app/REQ.md` |
| RESEARCH | ✅ | `.app/RESEARCH.md` |
| SPEC | ✅ `a2ef82e` | `.app/SPEC.md` |
| DEVELOP | ✅ build CLEAN, 63/63 tests | `99fcef3` `47b2f6c` `6c3cbf1` `f357888` `b346eab` |
| VALIDATE | ✅ **PASS** (cycle 1; all R1.1–R6.4 ACs met) | — |
| **DONE** | ⏳ DocWorm documentation pass (conditional) | — |

## VALIDATE result (PASS)
- All C1 (R1.1–R1.6) + C2 (R2.1–R2.8, R3.2–3.3, R4.1–4.3, R5.1–5.4, R6.2–6.4) ACs verified by code trace + passing unit tests.
- Elon/Main NOT granted `mess-send` → no gate bypass. Read-only agents' writes constrained to `.app/mess/`.
- Non-blocking notes: `. ` doc wording inconsistency (REQ R1.4 AC / SPEC §3.1 vs trim-based code); Q7.1 read-only sign-off flag.

## Accepted decisions
Q7.1 constrained `.app/mess/` writes for read-only agents; P4 2000ms poll / 300000ms claim-stale; C1 = advisory text + best-effort `before_agent_start` hook; P2 = same-machine shared local filesystem; D1 async `resolveAgentId`; I3 completion via `mess-send`+`inReplyTo`.

## Key facts
Repo IS source of both plugins (gate/frontmatter/`skill://elon` all editable). No runtime deps. Fallback trigger = `irc` `{outcome:"failed"}`; instance id SUPPLIED (env▸manifest▸uuid); `IrcBus.send` id-exact → `resolveAgentId`.
