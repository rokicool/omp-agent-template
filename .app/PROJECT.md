# PROJECT — Elon Protocol Modification

## Objective
Two changes to the orchestrator plugin suite shipped from THIS repo (`omp-agent-gate` = Plugin A, gate at `src/enforce-orchestrator.ts`; `orchestrator-agents` = Plugin B at `./plugins`):

1. **C1 — Dot agreement token.** A lone `.` reply = agree with the most-recent pending proposal (any origin) and proceed.
2. **C2 — File-based inter-agent messaging, as cross-instance IPC.** In-app (`task()`/`irc`) stays primary when agents are co-located; file transport in `.app/mess/` (archived to `.app/mess/arc/`) is used **only** when the receiver runs in a different omp instance.

## Key Facts (verified)
- This repo IS the source of both plugins — gate, `APPEND_SYSTEM`, agent `tools:`/`spawns:` frontmatter, and `skill://elon` are all editable source here. Nothing immutable.
- `skill://elon` = `plugins/agents/skills/elon/SKILL.md`. Agent defs = `plugins/agents/agents/*.md`.
- The one absent capability: an async file-delivery / detection mechanism — must be built for C2.
- **P2 RESOLVED (user): same machine / shared filesystem** → R6.1 validated; file-transport viable as specified; network-sync out of scope.

## Workflow Path: FULL
| Phase | Status | Owner | Artifact |
|---|---|---|---|
| REQUEST | ✅ done | Elon | `.app/PROJECT.md` |
| GRILL | ✅ done | ReqGuru | `.app/REQ.md` |
| RESEARCH | ⏳ in progress | DrPe (F1–F4) | `.app/RESEARCH.md` (pending) |
| SPEC | pending | LeadDev | `.app/SPEC.md` (pending) |
| DEVELOP ⇄ VALIDATE | pending | LeadDev / Validator | — |
| DONE | pending | — | — |

## Resolved Decisions (summary — full detail in `.app/REQ.md`)
- **C1:** `.` = any pending proposal (origin-agnostic); multi-pending → most-recent wins; exact-match only; no-pending → clarify ask; `.`-only (no `yes`/`ok` mapping).
- **C2-core:** file transport is additional, instance-gated; all agents incl. MidDev, user excluded; `<sender>-<receiver>-<datetime>.md` (ISO-8601 UTC + `-NN` collision suffix); YAML frontmatter + body; processed = action done → atomic rename to `arc/`; failure = retry×3 then `arc/` with annotation; indefinite retention.
- **C2 cross-instance:** instance model (R3), transport-selection rule in-app↔file (R4), remote message detection contract [mechanism FOR-SPEC] (R5), identity/addressing/concurrency (R6).

## Open Items (non-blocking; defaults baked into REQ)
- **PRODUCT (user, confirm anytime):** P1 instance-declaration mechanism; P3 instance-id provenance; P4 detection-latency window; P5 cross-instance peer-messaging scope.
- **FEASIBILITY (DrPe, in flight):** F1 existing instance-id; F2 in-app unreachable return shape; F3 APFS/network atomic-rename guarantees; F4 existing shared-state primitives.
