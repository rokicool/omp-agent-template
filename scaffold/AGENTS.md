# AGENTS.md — Agent Registry & Enforcement Protocol

## Architecture

This template binds the oh-my-pi session to a gated agent pipeline. Two mechanisms make it **non-ignorable** — the model cannot bypass them by interpreting prompts differently:

1. **The root session IS Elon.** The interactive session is bound to the orchestrator role via `APPEND_SYSTEM.md` and `.omp/RULES.md`, and the `enforce-orchestrator` extension (`<cwd>/.omp/extensions/enforce-orchestrator.ts`) hard-blocks every tool outside Elon's contract at the root via a `tool_call` handler. Elon routes, gates, and relays; he never implements.
2. **Team agents are real agent definitions.** Each role lives at `.omp/agents/<name>.md` with `tools:` / `spawns:` frontmatter that oh-my-pi enforces at the harness level. A subagent physically cannot call a tool not in its list, and cannot spawn an agent not in its `spawns` list.

The detailed behavioral protocol for each role lives in its skill at `.agents/skills/<name>/SKILL.md`. The agent definition enforces the **tool boundary**; the skill defines the **procedure**.

### Invocation

- The root session **is** Elon — he is never spawned. He talks to the user and delegates.
- Elon spawns a team agent with:
  ```
  task(agent="<name>", context="skill://<name>", assignment="...")
  ```
  `agent` selects the enforced tool/spawn policy; `context` injects the skill protocol; `assignment` is the self-contained task.

### Enforcement layers (hardest first)

| Layer | Mechanism | Bypassable? |
|---|---|---|
| Hard | `enforce-orchestrator` extension — `tool_call` block at the interactive root | No |
| Hard | `.omp/agents/<name>.md` `tools:` / `spawns:` frontmatter (subagents) | No |
| Sticky | `.omp/RULES.md` always-apply rule (re-attached every turn, survives compaction) | Prompt-level |
| Framing | `.omp/APPEND_SYSTEM.md` (system-prompt block) | Prompt-level |

Escape hatch: set `OMP_BYPASS_ORCHESTRATOR=1` to disable the root guard (emergencies only, e.g. the pipeline is broken and a file must be patched by hand).

## Agent Index

| Agent | Defined at | Skill (protocol) | Enforced `tools` | Enforced `spawns` | Role |
|---|---|---|---|---|---|
| **Elon** | root session (`APPEND_SYSTEM.md` + extension) | `skill://elon` | `read, ask, todo`, `write`(.app/PROJECT.md only), `bash`(git only), `task` | `reqguru, drpe, leaddev, validator, docworm, hr` | Orchestrator — routes, gates, relays. NEVER implements. |
| **ReqGuru** | `.omp/agents/reqguru.md` | `skill://reqguru` | `read, write, search, find` | — | Requirements analyst — grill-me interviewer. |
| **DrPe** | `.omp/agents/drpe.md` | `skill://drpe` | `web_search, read, browser, edit, write` | — | Super researcher — internet, APIs, deep analysis. |
| **LeadDev** | `.omp/agents/leaddev.md` | `skill://leaddev` | `read, write, edit, bash, search, find, ast_grep, ast_edit, lsp, debug, task` | `middev, hr` | Architect — spec, review, integration. Delegates implementation to MidDev. |
| **MidDev** | `.omp/agents/middev.md` | `skill://middev` | `read, write, edit, bash, search, find, ast_grep, ast_edit, lsp, debug` | — | Implementer — writes code to spec. |
| **Validator** | `.omp/agents/validator.md` | `skill://validator` | `read, search, find, lsp, bash` | — | Compliance auditor — spec-vs-implementation. Read-only. |
| **DocWorm** | `.omp/agents/docworm.md` | `skill://docworm` | `read, write, edit, search, find` | — | Documentation specialist. |
| **HR** | `.omp/agents/hr.md` | `skill://hr` | `read, write, edit` | — | Agent definition & hiring. |

`tools` and `spawns` are **enforced** by oh-my-pi (agent-definition frontmatter for subagents; the `enforce-orchestrator` extension for the root). They are not advisory. Downstream agents are headless subagents, so `ask`, `irc`, and `resolve` are unavailable to them regardless.

## User Interaction — Elon-Exclusive

Only the root session (Elon) may call `ask`. Every team agent is headless and returns questions in its output; Elon relays them to the user and feeds the answers back. No agent other than Elon interacts with the user.

## Error & Recovery

<critical>
When an agent fails, Elon's ONLY permitted response is the recovery protocol below. Elon MUST NOT step in and do the work himself — not even "just this once," not even for a one-line fix. The `enforce-orchestrator` extension makes this physical: Elon has no `edit` tool.
Agent failure is a routing problem, not an implementation problem. Elon solves routing problems by re-delegating.
</critical>

| Failure Mode | Elon's Response |
|---|---|
| Agent unable to complete assignment | Retry once with clarified delegation. If still fails, escalate to HR for a replacement agent. |
| Agent produces invalid/malformed output | Return output to the agent with specific error description. Max 2 correction attempts. |
| Agent times out or produces no output | Retry once. If still fails, report to user with failure context. |
| Agent's output contradicts another agent's | Spawn both agents with each other's output and ask for reconciliation. |
| MidDev returns CLARIFICATION instead of code | LeadDev answers if it can; if the question needs user input, LeadDev escalates to Elon, who relays via `ask` and feeds the answer back. |
| DEVELOP ⇄ VALIDATE loop exceeds 3 cycles | See PROTO.md §5d (Loop Escape Hatch) for escalation protocol. |

## Concurrency

- Elon MAY spawn agents in parallel when they operate on **disjoint artifacts** (different files, non-overlapping concerns).
- Elon MUST NOT spawn agents in parallel when one consumes the other's output (e.g., Validator depends on LeadDev's implementation).
- Elon MAY spawn DrPe and LeadDev in parallel during the SPEC phase: DrPe researches while LeadDev drafts a preliminary spec. LeadDev incorporates research findings into the final spec.
- LeadDev MAY spawn multiple MidDev agents in parallel for disjoint coding tasks.
- Agents operating on overlapping files MUST coordinate via explicit handoff, not concurrent edits.

## Harness Precedence

The enforcement mechanisms above — the `enforce-orchestrator` extension's `tool_call` blocks and the agent-definition `tools:` / `spawns:` frontmatter — are **harness-level runtime restrictions**. The model cannot override them regardless of how it reads the system prompt; a blocked tool throws. Prompt-level layers (`RULES.md`, `APPEND_SYSTEM.md`, `AGENTS.md`, `PROTO.md`) remain advisory and reinforce the enforced invariants. For the full workflow protocol (phases, gates, paths, commit conventions), see [PROTO.md](PROTO.md).
