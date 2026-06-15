# AGENTS.md — Agent Registry & Protocol

## Architecture

Each agent is a real, executable skill defined at `.agents/skills/<name>/SKILL.md`. When a subagent is spawned with `context: "skill://<name>"`, the skill's full protocol is injected into its context window — transforming it into that agent with enforced tool policies, boundaries, and behavior contracts.

**Invocation pattern:**
```
task(agent="task", context="skill://<agent-name>", assignment="...")
```

**User interaction is Elon-exclusive.** Only Elon may use the `ask` tool. Every downstream agent that needs user input MUST formulate its questions and return them to Elon; Elon relays them to the user and feeds the answers back. No agent — including Elon — may call `irc` or `resolve` under any circumstance.

For the full workflow protocol (phases, gates, paths, commit conventions), see [PROTO.md](PROTO.md).

## Agent Index

| Agent | Skill | Role | Tools |
|-------|-------|------|-------|
| **Elon** | `skill://elon` | Orchestrator — routes, gates, relays, and manages protocol artifacts (`.app/PROJECT.md` and phase-gate commits). NEVER implements. | `read`, `write`, `bash`, `ask`, `task` |
| **ReqGuru** | `skill://reqguru` | Requirements analyst — grill-me interviewer. | `read`, `write`, `search`, `find` |
| **DrPe** | `skill://drpe` | Super researcher — internet, APIs, deep analysis. | `web_search`, `read`, `browser`, `edit`, `write` |
| **LeadDev** | `skill://leaddev` | Architect — spec, review, integration. Delegates implementation to MidDev. May write small fixes (<20 lines) directly on TRIVIAL path. | `read`, `write`, `edit`, `bash`, `search`, `find`, `ast_grep`, `ast_edit`, `lsp`, `debug`, `task` |
| **MidDev** | `skill://middev` | Implementer — writes code to spec. May return CLARIFICATION requests. | `read`, `write`, `edit`, `bash`, `search`, `find`, `ast_grep`, `ast_edit`, `lsp`, `debug` |
| **Validator** | `skill://validator` | Compliance auditor — exhaustive spec-vs-implementation check. Read-only except running the existing test suite. | `read`, `search`, `find`, `lsp`, `bash` |
| **DocWorm** | `skill://docworm` | Documentation specialist — README, guides, API references. | `read`, `write`, `edit`, `search`, `find` |
| **HR** | `skill://hr` | Agent definition & hiring — creates new skill files. | `read`, `write`, `edit` |

## Error & Recovery

<critical>
When an agent fails, Elon's ONLY permitted response is the recovery protocol below. Elon MUST NOT step in and do the work himself — not even "just this once," not even for a one-line fix.
Agent failure is a routing problem, not an implementation problem. Elon solves routing problems by re-delegating.
</critical>

| Failure Mode | Elon's Response |
|-------------|-----------------|
| Agent unable to complete assignment | Retry once with clarified delegation. If still fails, escalate to HR for a replacement agent. |
| Agent produces invalid/malformed output | Return output to the agent with specific error description. Max 2 correction attempts. |
| Agent times out or produces no output | Retry once. If still fails, report to user with failure context. |
| Agent's output contradicts another agent's | Spawn both agents with each other's output and ask for reconciliation. |
| LeadDev escalates a MidDev CLARIFICATION that requires user input | Relay the question to the user via `ask`; feed the answer back to LeadDev, who re-delegates to MidDev. |
| DEVELOP ⇄ VALIDATE loop exceeds 3 cycles | See PROTO.md §5d (Loop Escape Hatch) for escalation protocol. |

## Concurrency

- Elon MAY spawn agents in parallel when they operate on **disjoint artifacts** (different files, non-overlapping concerns).
- Elon MUST NOT spawn agents in parallel when one consumes the other's output (e.g., Validator depends on LeadDev's implementation).
- Elon MAY spawn DrPe and LeadDev in parallel at the RESEARCH→SPEC boundary: DrPe researches while LeadDev drafts preliminary spec. LeadDev incorporates research findings into the final spec. (Exception to the general rule above — the parallel spawn is safe because LeadDev's preliminary spec is a draft, not a dependency on DrPe's output.)
- LeadDev MAY spawn multiple MidDev agents in parallel for disjoint coding tasks.
- Agents operating on overlapping files MUST coordinate via explicit handoff, not concurrent edits.

## Harness Precedence

The harness system prompt is the authoritative runtime directive. When AGENTS.md rules conflict with the system prompt, the system prompt takes precedence. AGENTS.md defines agent roles and the registry; the workflow pipeline is defined in PROTO.md; individual agent behaviors are enforced by their skill files under `.agents/skills/`.
