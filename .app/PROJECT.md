# PROJECT — Release Operation

## Request
Execute a release pipeline: check git status → bump version → update references → push to origin → verify pipelines green → create PR → **ask user to approve** → merge → create tag → create release.

## Classification
Operational release workflow — multi-phase, with a built-in human approval gate (before merge).
Routed to LeadDev (integration/operational execution).

## Target Version: **v2.1.2 (PATCH)** — user-approved (PA-1 agreed).

## Phases
- [x] **REQUEST** — received; this file created.
- [x] **RECON** — LeadDev surveyed repo.
- [x] **GATE-1 (version)** — user selected **v2.1.2 (PATCH)** (PA-1 agreed).
- [ ] **EXECUTE** — bump 2.1.1→2.1.2 across lockstep set + installer pin + docs + CHANGELOG; commit on branch release/v2.1.2; push branch.
- [ ] **VERIFY** — CI green on branch; confirm branch/tag protection (B3).
- [ ] **PR** — create PR `release/v2.1.2` → `main`.
- [ ] **GATE-2 (merge approval)** — Elon asks user to approve the PR (explicitly requested gate).
- [ ] **MERGE** — merge PR.
- [ ] **TAG** — push `v2.1.2` tag (release.yml asserts tag == v + package.json#version; B6 hard constraint).
- [ ] **RELEASE** — auto-created by release.yml on tag push.
- [ ] **DONE**

## RECON Summary (LeadDev)
- Current version: **2.1.1** everywhere (lockstep).
- Scheme: SemVer + Keep a Changelog. Manual bump; tag-triggered publish only (release.yml).
- 6 commits since v2.1.1; only 2 touch shipped code: aa6181c (bug fix: Option+S toggle) + 9b21189 (scoped irc tool for orchestrator gate).
- User judged the irc grant an internal/config change → PATCH (v2.1.2), not a public feature.
- CI: ci.yml (typecheck + validate-plugins.sh + omp install smoke + installer smoke) = merge gate. release.yml = on v* tag, asserts tag==version, builds both plugins, publishes GitHub Release.
- Full exhaustive old→new file list: see recon artifact `agent://ReconRelease` → B_release_plan.files_to_modify_old_to_new (substitute 2.1.2 for 2.2.0).

## Blockers
- **B1** [decision]: RESOLVED — v2.1.2 (PATCH).
- **B2** [hygiene]: dirty tree (.app/RESEARCH.md stale refs, ?? .omp/). Release commit should stage ONLY version-bump files + CHANGELOG; leave unshipped dirty paths alone.
- **B3** [network, execution-phase]: branch/tag protection on main — LeadDev verifies via gh.
- **B4** [network, execution-phase]: CI green on target commit — LeadDev verifies.
- **B5** [pre-tag]: run typecheck + test + validate-plugins.sh before tagging.
- **B6** [hard]: tag MUST == v + package.json#version; all 5 lockstep fields must agree.

## Pending Asks
- [PA-1] 2026-06-28T00:00:00Z origin=elon status=agreed | "Approve release plan + version: v2.2.0 (MINOR) or v2.1.2 (PATCH)?" → **user selected v2.1.2 (PATCH)**.

## Log
- 2026-06-28 REQUEST received; PROJECT.md created; RECON routed to LeadDev.
- 2026-06-28 RECON complete (recommended v2.2.0). GATE-1 raised as PA-1. Committed [PROTO] d06d621.
- 2026-06-28 GATE-1: user selected v2.1.2 (PATCH). PA-1 → agreed. Routing EXECUTE→VERIFY→PR to LeadDev.
