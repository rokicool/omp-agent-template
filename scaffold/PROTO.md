# PROTO.md — Software Development Protocol

## Overview

Every feature or software request flows through gated phases. Each agent operates strictly within its role, **enforced at the harness level** (see [AGENTS.md](AGENTS.md) §Enforcement layers). Team agents ship from **Plugin B (`orchestrator-agents`)** as definitions under `plugins/agents/agents/<name>.md` with enforced `tools:` / `spawns:` frontmatter; their behavioral protocol lives in their skill at `.agents/skills/<name>/SKILL.md`. When the protocol says "Elon spawns X," it means `task(agent="<name>", context="skill://<name>", assignment="...")` — `agent` enforces the tool boundary, `context` injects the skill protocol, and each agent runs in its own isolated context window. The root session **is** Elon; he is never spawned.

**Enforcement note:** the root session's tool set is hard-restricted by the `enforce-orchestrator` gate shipped by **Plugin A** (`src/enforce-orchestrator.ts`), and each team agent's tools/spawns are hard-restricted by its Plugin B agent-definition frontmatter (`plugins/agents/agents/<name>.md`). These are runtime blocks the model cannot override. For agent definitions, tool policies, error recovery, and concurrency rules, see [AGENTS.md](AGENTS.md). Escape hatch: `OMP_BYPASS_ORCHESTRATOR=1`.

---

## Artifacts

The `.app/` directory holds the canonical protocol artifacts:

| File | Owner | Phase Created | Description |
|------|-------|---------------|-------------|
| `.app/PROJECT.md` | Elon | REQUEST | Project Definition & Status. Name, purpose, scope, current phase/status. |
| `.app/REQ.md` | ReqGuru | GRILL | Requirements Document. Complete, unambiguous description of what must be built. |
| `.app/RESEARCH.md` | DrPe | RESEARCH | Research Report. Technology landscape survey with impact assessment. |
| `.app/SPEC.md` | LeadDev | SPEC | Technical Specification. Architecture, interfaces, data models, acceptance criteria. |

---

## Path Selection

Every request enters at REQUEST. Elon classifies the request and selects one of two paths:

### Classification Criteria

| Signal | Path |
|--------|------|
| Bugfix, typo, config tweak, doc-only change, test addition | **TRIVIAL** |
| Internal refactor with no behavioral change | **TRIVIAL** |
| New feature, new module, new API surface | **FULL** |
| Cross-cutting change affecting multiple modules | **FULL** |
| Technology choice or architectural decision required | **FULL** |
| Uncertain → default to FULL | |

```
REQUEST ─→ classify ─┬─ TRIVIAL ─→ LEADDEV → VALIDATE ─→ DONE
                      │
                      └─ FULL ─→ GRILL ─→ [RESEARCH] ─→ SPEC ─→ DEVELOP ⇄ VALIDATE ─→ DONE
```

---

## Full Path Phases

### Phase 1: REQUEST

| Actor | Action |
|-------|--------|
| User | Submits a feature or software request. |
| Elon | Creates `.app/PROJECT.md` — Project Definition & Status. |
| Elon | Classifies the request as TRIVIAL or FULL. If FULL, spawns **ReqGuru**. |

**Gate:** Elon verifies the request is scoped enough to begin. If not, asks the user to narrow.

---

### Phase 2: GRILL (Requirements)

Adaptive round-based interview mediated by Elon. ReqGuru cannot talk to the user directly.

#### 2a. GRILL LOOP

```
ELON spawns ReqGuru ──→ ReqGuru returns question batch
    ↓
ELON calls ask() ──→ User answers
    ↓
ELON spawns ReqGuru ──→ ReqGuru analyzes answers,
    ↑                       returns next batch or declares DONE
    └──── repeat ────┘
```

| Round | Actor | Action |
|-------|-------|--------|
| 1..N | Elon | Spawns ReqGuru with the request and accumulated context. **Context optimization:** pass only the original brief, the last question batch, the user's answers, and a summary of all previously resolved branches — not the full conversation history. |
| 1..N | ReqGuru | Analyzes prior answers. Identifies gaps, contradictions, unresolved branches. Produces the next question batch. If every branch is resolved, declares **complete** and proceeds to 2b. |
| 1..N | Elon | Extracts the question batch. Calls `ask` to present to the user. Elon is a pure relay — no filtering, no interpretation. |
| 1..N | Elon | Passes the user's answers to ReqGuru in the next spawn. |

**Gate:** ReqGuru declares every decision branch resolved.

#### 2b. REQUIREMENTS DOCUMENT

| Actor | Action |
|-------|--------|
| ReqGuru | Synthesizes the complete Q&A into `.app/REQ.md`. |
| Elon | Reviews. If gaps remain, re-enters the grill loop. Otherwise, proceeds. |

**Commit rule:** Elon commits `.app/REQ.md` before entering Phase 3. (ReqGuru has no shell access; Elon owns protocol artifact commits.)

---

### Phase 3: RESEARCH (Conditional)

RESEARCH is **not mandatory**. Elon evaluates whether it is needed:

| Condition | Action |
|-----------|--------|
| Technology choices to make (framework, library, language, architecture pattern) | **Spawn DrPe** |
| Domain unknowns flagged by ReqGuru during GRILL | **Spawn DrPe** |
| Tech stack already determined by the project; no unknowns | **Skip to SPEC** |
| Small feature using established project patterns | **Skip to SPEC** |

If spawned:

| Actor | Action |
|-------|--------|
| Elon | Spawns **DrPe** with `.app/REQ.md` and a research brief. |
| DrPe | Surveys the ecosystem. Sources MUST include primary references. |
| DrPe | Produces `.app/RESEARCH.md` with findings, recommendations, and an **impact assessment**. |
| Elon | Reviews the Research Report. |

#### 3a. GATE — Re-Grill or Proceed

| Finding | Elon's Action |
|---------|---------------|
| Research surfaces contradictions or material expansions to requirements | **LOOP BACK** to Phase 2. Spawn ReqGuru with the Research Report as context. |
| Research confirms requirements or surfaces only implementation-level recommendations | **PROCEED** to Phase 4. |

**Commit rule:** Elon commits `.app/RESEARCH.md` before entering Phase 4. (DrPe has no shell access; Elon owns protocol artifact commits.)

---

### Phase 4: SPEC (Specification)

| Actor | Action |
|-------|--------|
| LeadDev | Translates REQ.md (and RESEARCH.md if available) into `.app/SPEC.md` — architecture, interfaces, data models, behavior contracts, acceptance criteria. |
| Elon | Reviews and signs off on the Spec. |

**Optional parallel path:** If RESEARCH was spawned, LeadDev MAY begin preliminary spec design while DrPe researches. LeadDev incorporates research findings into the final spec. This requires Elon to spawn both in parallel and merge the outputs.

**Commit rule:** `.app/SPEC.md` is committed before development begins. (LeadDev writes the Spec; Elon commits protocol artifacts at phase gates.)

**Gate:** Spec is complete enough that an independent agent can validate against it.

---

### Phase 5: DEVELOP & VALIDATE (Loop)

Elon MUST NOT write implementation code, fix validation failures, or perform any LeadDev or Validator role. Elon's role is exclusively spawning agents, gatekeeping, and routing results.

#### 5a. DEVELOP

| Actor | Action |
|-------|--------|
| Elon | Spawns **LeadDev** with the signed Spec and a complete delegation. |
| LeadDev | Implements per the Spec. May delegate to MidDev for implementation tasks. May spawn **HR** directly for specialist developers (LeadDev has `task` tool access). |
| LeadDev | Commits every significant change. Commit messages reference the Spec section. |

#### 5b. VALIDATE

| Actor | Action |
|-------|--------|
| Elon | Spawns **Validator** with the Spec, implementation description, and list of changed files/modules. |
| Validator | Audits implementation against the Spec. Changed files are prioritized; unchanged modules are spot-checked. Produces a Validation Report: PASS or FAIL. |

#### 5c. RESOLVE (if FAIL)

| Actor | Action |
|-------|--------|
| Elon | Spawns **LeadDev** with the Validation Report. |
| LeadDev | Resolves every listed issue. Commits each fix. |
| Elon | Spawns **Validator** for re-validation with the updated implementation. |

#### 5d. LOOP ESCAPE HATCH

The DEVELOP ⇄ VALIDATE loop has a **maximum of 3 cycles**. If Validator returns FAIL for the 3rd consecutive time:

| Condition | Elon's Action |
|-----------|---------------|
| Remaining failures are spec ambiguities or contradictions | **Re-enter SPEC phase.** The spec is the problem, not the code. |
| Remaining failures are implementation bugs in well-specified areas | **Escalate to user.** Present the remaining failures with context. Ask whether to continue, simplify requirements, or accept partial completion. |
| Remaining failures stem from unrealistic or conflicting requirements | **Re-enter GRILL phase.** Spawn ReqGuru with the failure context. |

**Loop:** DEVELOP → VALIDATE → RESOLVE → VALIDATE → … (max 3 cycles before escalation).

---

### Phase 6: DONE

| Actor | Action |
|-------|--------|
| Validator | Final PASS verdict. |
| Elon | Evaluates whether DocWorm is needed (see below). |
| Elon | Marks the request complete. Archives artifacts. Updates `.app/PROJECT.md`. |

#### DocWorm (Conditional)

DocWorm is **not mandatory** for every PASS. Elon evaluates:

| Condition | Action |
|-----------|--------|
| Change affects public API, CLI interface, config keys, or user-facing behavior | **DocWorm MUST run.** |
| Change is internal-only (refactor, bugfix, test addition, performance optimization) | **DocWorm MAY be skipped.** Elon notes the reason in the completion report. |
| Documentation files were changed as part of the implementation | **DocWorm MUST run** to verify accuracy. |

If spawned:

| Actor | Action |
|-------|--------|
| DocWorm | Updates README, guides, API references to reflect the implementation. |

---

## Trivial Path Phases

For bugfixes, typos, config tweaks, doc-only changes, test additions, and internal refactors:

### Phase T1: IMPLEMENT

| Actor | Action |
|-------|--------|
| Elon | Spawns **LeadDev** with the request, affected files, and explicit note that this is a TRIVIAL path. |
| LeadDev | Implements the change directly. For changes under 20 lines, LeadDev MAY write the code directly without delegating to MidDev. For larger changes, delegates to MidDev as usual. |
| LeadDev | Commits the change. |

### Phase T2: VALIDATE (Scoped)

| Actor | Action |
|-------|--------|
| Elon | Spawns **Validator** with the original request, the changed files only, and the TRIVIAL path flag. |
| Validator | Validates ONLY the changed files and their direct dependencies. Does not audit the full codebase. Returns PASS or FAIL. |

### Phase T3: DONE

Same as the Full Path Phase 6, with the same conditional DocWorm rules.

---

## Agent-to-Phase Map

| Agent | Phase(s) | Artifacts Owned | Responsibility |
|-------|----------|-----------------|----------------|
| Elon | All (gates every phase) | `.app/PROJECT.md` | Orchestration, routing, gates, and protocol artifact management. Never implements or validates. Creates and commits `.app/PROJECT.md` at REQUEST phase; commits protocol artifacts (REQ.md, RESEARCH.md, SPEC.md) at their phase gates. |
| ReqGuru | GRILL | `.app/REQ.md` | Requirements gathering — grill-me interview, synthesizes requirements. |
| DrPe | RESEARCH (conditional) | `.app/RESEARCH.md` | Technology landscape survey. Impact assessment. |
| LeadDev | SPEC, DEVELOP, RESOLVE, T1 | `.app/SPEC.md` | Architecture, spec, implementation delegation, review, integration, commits, validation fixes. |
| MidDev | DEVELOP (via LeadDev) | — | Implementation — writes code to spec. May return CLARIFICATION requests. |
| Validator | VALIDATE, T2 | — | Compliance auditing — spec-vs-implementation verification. |
| DocWorm | DONE (conditional) | `README.md` | Documentation — creates/updates docs when needed. |
| HR | DEVELOP (on demand) | — | Agent definition — creates new skill files for specialist expertise. |

---

## Commit Convention

### Formats

| Context | Format | Example |
|---------|--------|---------|
| Feature implementation | `[SPEC §N] description` | `[SPEC §3.2] Implement user authentication middleware` |
| Validation fix | `[FIX] description` | `[FIX] Handle null user in auth middleware` |
| Trivial change | `[TRIVIAL] description` | `[TRIVIAL] Fix typo in error message` |
| Protocol artifacts | `[PROTO] description` | `[PROTO] Update REQ.md with PIM requirements` |

### Rules

- Every significant change gets its own commit. One logical unit per commit.
- Protocol artifacts (`.app/REQ.md`, `.app/RESEARCH.md`, `.app/SPEC.md`, `.app/PROJECT.md`) are committed by Elon at their respective phase gates as a single owner for traceability. (Elon's `bash` access is scoped to these phase-gate commits; implementation commits remain LeadDev's responsibility.)
- Fixup commits during RESOLVE are NOT squashed unless the user explicitly requests it. Each fix is traceable.
- Merge strategy: squash-merge feature branches into main. Trivial fixes may be committed directly to main.
- Conflict resolution: LeadDev's responsibility during integration. If conflicts arise between parallel MidDev tasks, LeadDev resolves before committing.

---

## Harness Precedence

The enforcement mechanisms in [AGENTS.md](AGENTS.md) (the `enforce-orchestrator` extension and agent-definition `tools:` / `spawns:` frontmatter) are harness-level runtime restrictions — a blocked tool throws, and the model cannot override that by reading the system prompt differently. Prompt-level layers (`RULES.md`, `APPEND_SYSTEM.md`, `AGENTS.md`, this file) are advisory and reinforce the enforced invariants.
