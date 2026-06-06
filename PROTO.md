# PROTO.md — Software Development Protocol

## Overview

Every feature or software request flows through five gated phases. No phase begins before the previous one is signed off. Every agent operates strictly within its role.

---


## Artifacts

The `.app/` directory holds the canonical protocol artifacts:

| File | Owner | Phase Created | Description |
|------|-------|---------------|-------------|
| `.app/PROJECT.md` | Elon | 1 (REQUEST) | Project Definition & Status. Defines the project name, purpose, scope, and tracks its current phase/status. Created at the start of Phase 1. Updated as the project progresses through phases. |
| `.app/REQ.md` | ReqGuru | 2b (GRILL) | Requirements Document. Synthesized from the GRILL interview. A complete, unambiguous description of what must be built. Replaces the old `REQUIREMENTS.md`. |
| `.app/RESEARCH.md` | DrPe | 3 (RESEARCH) | Research Report. Survey of best frameworks, libraries, methods, languages, and notations for the task. Includes recommendations and an impact assessment: does anything found contradict or materially expand the requirements? |

## Phases

```
REQUEST → GRILL → RESEARCH → SPEC → DEVELOP ⇄ VALIDATE → DONE
                    ↑   ↓                  ↑___________|
                    └───┘              (iterate until PASS)
               (re-grill if
                research demands it)
```


---

## Phase 1: REQUEST

| Actor | Action |
|-------|--------|
| User  | Submits a feature or software request. |
| Elon  | Creates `.app/PROJECT.md` — Project Definition & Status (name, purpose, scope, initial status). |
| Elon  | Receives the request. Spawns **ReqGuru** for requirements gathering. |
**Gate:** Elon verifies the request is scoped enough to begin grilling. If not, he asks the user to narrow.

---

## Phase 2: GRILL (Requirements)

This is an **adaptive round-based interview** mediated by Elon. ReqGuru cannot talk to the user directly — Elon is the relay.

### 2a. GRILL LOOP

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
| 1..N | Elon | Spawns ReqGuru with the request and all accumulated Q&A context. |
| 1..N | ReqGuru | Analyzes prior answers. Identifies gaps, contradictions, unresolved branches. Produces the next question batch with rationale. If every branch is resolved, declares the grill **complete** and proceeds to 2b. |
| 1..N | Elon | Extracts the question batch. Calls the `ask` tool to present questions to the user. Elon MUST NOT answer, interpret, or filter — he is a pure relay. |
| 1..N | Elon | Passes the user's answers to ReqGuru in the next spawn. |

**Gate:** ReqGuru declares every decision branch resolved. Elon signs off.

### 2b. REQUIREMENTS DOCUMENT

| Actor | Action |
|-------|--------|
| ReqGuru | Synthesizes the complete Q&A into a **Requirements Document** — a complete, unambiguous description of what must be built. Writes it to `.app/REQ.md`. |
| Elon | Reviews. If gaps remain, re-enters the grill loop at 2a. Otherwise, spawns **LeadDev** for spec creation. |
**Commit rule:** `.app/REQ.md` is committed before entering Phase 3 (RESEARCH).
---

## Phase 3: RESEARCH

Before technical specification begins, Elon MUST commission a technology landscape survey to ensure the project is built with the best available tools and to surface any requirement-level implications of technology choices.

| Actor | Action |
|-------|--------|
| Elon  | Spawns **DrPe** with `.app/REQ.md` and a research brief. |
| DrPe  | Surveys the ecosystem: best frameworks, libraries, methods, languages, notations, and architectural patterns for the task. Sources MUST include primary references (official docs, published papers, versioned specs). |
| DrPe  | Produces `.app/RESEARCH.md` — a Research Report containing: (a) findings per dimension surveyed, (b) concrete recommendations with rationale, and (c) an **impact assessment** that answers: "Do any findings contradict, invalidate, or materially expand the requirements in REQ.md?" |
| Elon  | Reviews the Research Report. |

### 3a. GATE — Re-Grill or Proceed

| Finding | Elon's Action |
|---------|---------------|
| Research surfaces new technology, constraint, or capability that contradicts or materially expands the requirements. | **LOOP BACK** to Phase 2 (GRILL). Elon spawns ReqGuru with the Research Report as additional context. The grill resumes with the new information. |
| Research confirms existing requirements or surfaces only implementation-level recommendations (library choices, code patterns) that do not change WHAT is built. | **PROCEED** to Phase 4 (SPEC). Elon spawns LeadDev with both `.app/REQ.md` and `.app/RESEARCH.md`. |

**Gate:** Elon determines whether the impact assessment demands re-grilling. Elon MUST NOT proceed to SPEC if any requirement-level ambiguity or contradiction was surfaced by the research.

**Commit rule:** `.app/RESEARCH.md` is committed before entering Phase 4.

## Phase 4: SPEC (Specification)

| Actor | Action |
|-------|--------|
| LeadDev | Translates the Requirements Document (and Research Report if available) into a formal **Spec** — technical design, interfaces, data models, behavior contracts, acceptance tests. |
| Elon | Reviews the Spec. |
| Elon | Reviews and signs off on the Spec. |
| Elon | Spawns **LeadDev** with the signed Spec and delegates implementation. |

**Commit rule:** The Spec file is committed to `.app/` before development begins.

**Gate A:** Spec is complete enough that an independent agent can validate against it.
**Gate B:** Elon has spawned LeadDev with a complete delegation referencing the Spec. Elon MUST NOT proceed to Phase 5 without spawning LeadDev.

---

## Phase 5: DEVELOP & VALIDATE (Loop)

This phase repeats until the Validator is satisfied.

**Elon MUST NOT write implementation code, fix validation failures, or perform any LeadDev or Validator role during this phase. Elon's role in Phase 5 is exclusively spawning agents, gatekeeping, and routing results.**

### 4a. DEVELOP

| Actor | Action |
|-------|--------|
| Elon  | Spawns **LeadDev** with the signed Spec and a complete delegation (per AGENTS.md Delegation Schema). |
| LeadDev | Implements the software according to the Spec. May request **HR** to hire specialist developers if domain expertise is needed. |
| LeadDev | Commits every significant change: each logical unit of work, each interface addition, each behavioral change. Commit messages reference the Spec section. |


### 4b. VALIDATE

| Actor | Action |
|-------|--------|
| Elon  | Spawns **Validator** with the Spec and the implementation. |
| Validator | Audits the implementation against the Spec exhaustively. Produces a **Validation Report**: |
|          | - **PASS** — every requirement is met. |
|          | - **FAIL** — lists every deviation, omission, or violation with file:line references. |

### 4c. RESOLVE (if FAIL)

| Actor | Action |
|-------|--------|
| Elon    | Spawns **LeadDev** with the Validation Report. Elon MUST NOT resolve validation failures himself — all fixes go through LeadDev. |
| LeadDev | Resolves every listed issue. Commits each fix. |
| Elon    | Spawns **Validator** for re-validation with the updated implementation. |

**Loop:** DEVELOP → VALIDATE → RESOLVE → VALIDATE → … until Validator returns PASS.

---

## Phase 6: DONE

| Actor | Action |
|-------|--------|
| Validator | Final PASS verdict. |
| Elon    | Marks the request complete. Archives `.app/REQ.md`, `.app/RESEARCH.md`, the Spec, and the final Validation Report within `.app/archive/`. Updates `.app/PROJECT.md` to reflect completion. |

---

## Agent-to-Phase Map

| Agent    | Phase(s)                    | Artifacts Owned       | Responsibility |
|----------|-----------------------------|-----------------------|----------------|
| Elon     | 1, 2, 3, 4, 6 (gates all)   | `.app/PROJECT.md`     | Orchestration, routing, gates. Present in every phase solely for gatekeeping and routing — never for implementation, validation, or artifact authoring. |
| ReqGuru  | GRILL                       | `.app/REQ.md`         | Requirements gathering |
| DrPe     | RESEARCH                    | `.app/RESEARCH.md`    | Technology landscape survey. Researches best frameworks, libraries, methods, languages, notations. Produces impact assessment — re-grill if requirements affected. |
| LeadDev  | SPEC, DEVELOP, RESOLVE      | Spec file (in `.app/`)| Design, implementation, fixes |
| Validator| VALIDATE                    | —                     | Compliance auditing |
| HR       | DEVELOP (on demand)         | —                     | Hiring specialist developers |

---

## Commit Convention

- Format: `[SPEC §section] description`
- Example: `[SPEC §3.2] Implement user authentication middleware`
- Every significant change — interface additions, behavioral changes, bug fixes — gets its own commit.
- Protocol artifacts (`.app/REQ.md`, `.app/RESEARCH.md`, Spec, `.app/PROJECT.md`) are committed at their respective phase gates.