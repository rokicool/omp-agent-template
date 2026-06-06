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

## Phases

```
REQUEST → GRILL → SPEC → DEVELOP ⇄ VALIDATE → DONE
                         ↑___________|
                        (iterate until PASS)
```


---

## Phase 1: REQUEST

| Actor | Action |
|-------|--------|
| User  | Submits a feature or software request. |
| Elon  | Creates `.app/PROJECT.md` — Project Definition & Status (name, purpose, scope, initial status). |
| Elon  | Receives the request. Routes it to **ReqGuru** for requirements gathering. |
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
| Elon | Reviews. If gaps remain, re-enters the grill loop at 2a. Otherwise, routes to **LeadDev** for spec creation. |

**Commit rule:** `.app/REQ.md` is committed before entering Phase 3.
---

## Phase 3: SPEC (Specification)

| Actor | Action |
|-------|--------|
| LeadDev | Translates the Requirements Document into a formal **Spec** — technical design, interfaces, data models, behavior contracts, acceptance tests. |
| Elon | Reviews the Spec. Routes to **DrPe** for research if technical unknowns exist. |
| Elon | Signs off and routes Spec to **LeadDev** for development. |

**Commit rule:** The Spec file is committed to `.app/` before development begins.

**Gate:** Spec is complete enough that an independent agent can validate against it.

---

## Phase 4: DEVELOP & VALIDATE (Loop)

This phase repeats until the Validator is satisfied.

### 4a. DEVELOP

| Actor | Action |
|-------|--------|
| LeadDev | Implements the software according to the Spec. Hires specialist developers via **HR** if domain expertise is needed. |
| LeadDev | Commits every significant change: each logical unit of work, each interface addition, each behavioral change. Commit messages reference the Spec section. |

**Commit rule:** No significant code change goes uncommitted. Trivial formatting-only changes may be batched.

### 4b. VALIDATE

| Actor | Action |
|-------|--------|
| Elon  | Hands the Spec and the implementation to **Validator**. |
| Validator | Audits the implementation against the Spec exhaustively. Produces a **Validation Report**: |
|          | - **PASS** — every requirement is met. |
|          | - **FAIL** — lists every deviation, omission, or violation with file:line references. |

### 4c. RESOLVE (if FAIL)

| Actor | Action |
|-------|--------|
| Elon    | Routes the Validation Report to **LeadDev**. |
| LeadDev | Resolves every listed issue. Commits each fix. |
| Elon    | Routes back to **Validator** for re-validation. |

**Loop:** DEVELOP → VALIDATE → RESOLVE → VALIDATE → … until Validator returns PASS.

---

## Phase 5: DONE

| Actor | Action |
|-------|--------|
| Validator | Final PASS verdict. |
| Elon    | Marks the request complete. Archives `.app/REQ.md`, the Spec, and the final Validation Report within `.app/archive/`. Updates `.app/PROJECT.md` to reflect completion. |

---

## Agent-to-Phase Map

| Agent    | Phase(s)               | Artifacts Owned       | Responsibility |
|----------|------------------------|-----------------------|----------------|
| Elon     | All                    | `.app/PROJECT.md`     | Orchestration, routing, gates |
| ReqGuru  | GRILL                  | `.app/REQ.md`         | Requirements gathering |
| DrPe     | SPEC (on demand)       | —                     | Technical research |
| LeadDev  | SPEC, DEVELOP, RESOLVE | Spec file (in `.app/`)| Design, implementation, fixes |
| Validator| VALIDATE               | —                     | Compliance auditing |
| HR       | DEVELOP (on demand)    | —                     | Hiring specialist developers |

---

## Commit Convention

- Format: `[SPEC §section] description`
- Example: `[SPEC §3.2] Implement user authentication middleware`
- Every significant change — interface additions, behavioral changes, bug fixes — gets its own commit.
- Protocol artifacts (`.app/REQ.md`, Spec, `.app/PROJECT.md`) are committed at their respective phase gates.
