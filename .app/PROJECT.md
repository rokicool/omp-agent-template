# PROJECT — Release Operation

## Request
Execute a release pipeline: check git status → bump version → update references → push to origin → verify pipelines green → create PR → **ask user to approve** → merge → create tag → create release.

## Classification
Operational release workflow — multi-phase, with a built-in human approval gate (before merge).
Routed to LeadDev (integration/operational execution).

## Phases
- [x] **REQUEST** — received; this file created.
- [x] **RECON** — LeadDev surveyed repo. Summary below.
- [ ] **GATE-1 (version)** — Elon presents plan; user confirms proposed version. → **PA-1 pending**
- [ ] **EXECUTE** — bump + update references + CHANGELOG + commit on branch + push branch.
- [ ] **VERIFY** — CI green on branch; confirm branch/tag protection (B3).
- [ ] **PR** — create PR `release/vX.Y.Z` → `main`.
- [ ] **GATE-2 (merge approval)** — Elon asks user to approve the PR (explicitly requested gate).
- [ ] **MERGE** — merge PR.
- [ ] **TAG** — push `vX.Y.Z` tag (release.yml asserts tag == v + package.json#version; B6 hard constraint).
- [ ] **RELEASE** — auto-created by release.yml on tag push (both plugins + SHA256SUMS + auto release notes).
- [ ] **DONE**

## RECON Summary (LeadDev)
- Current version: **2.1.1** everywhere (lockstep). Sources: package.json:3, package-lock.json:3/9, .omp-plugin/marketplace.json:7/16, elon_ko.sh:14/45/103, README.md:57/95, .DEVREADME.md:21/241/244/250/306, CHANGELOG.md.
- Scheme: SemVer + Keep a Changelog. Manual bump; NO release automation (tag-triggered publish only).
- 6 commits since v2.1.1; only 2 touch shipped code: aa6181c (bug fix: Option+S toggle → Fixed) + 9b2119 (NEW capability: scoped irc tool for orchestrator gate → Added).
- Last tag: v2.1.1 (2026-06-27), format v<major>.<minor>.<patch>.
- CI: ci.yml = typecheck + validate-plugins.sh + omp install smoke + installer smoke (merge gate). release.yml = on v* tag, asserts tag==version, builds both plugins, publishes GitHub Release (generate_release_notes:true). prerelease.yml = per-branch pr-* pre-releases.
- Working tree dirty: M .app/PROJECT.md, M .app/RESEARCH.md (stale 2.1.0 refs :19-21/:270-271 — pre-existing), ?? .omp/ (local, unshipped). None ship in either plugin; release.yml checks out the tag snapshot. Hygiene-only (B2).
- Recommended: **v2.2.0 (MINOR)**. Alternative: v2.1.2 (PATCH).

## Blockers
- **B1** [decision]: bump magnitude — v2.2.0 (MINOR) vs v2.1.2 (PATCH). → GATE-1.
- **B2** [hygiene]: dirty tree; clean before release commit (commit .app artifacts; .omp/ unshipped).
- **B3** [network, execution-phase]: branch/tag protection on main — LeadDev verifies via gh.
- **B4** [network, execution-phase]: CI green on target commit — LeadDev verifies.
- **B5** [pre-tag]: run typecheck + test + validate-plugins.sh before tagging.
- **B6** [hard]: tag MUST == v + package.json#version; all 5 lockstep fields must agree.

## Pending Asks
- [PA-1] 2026-06-28T00:00:00Z origin=elon status=pending | "Approve release plan + version: v2.2.0 (MINOR, recommended) or v2.1.2 (PATCH)?"

## Log
- 2026-06-28 REQUEST received; PROJECT.md created; RECON routed to LeadDev.
- 2026-06-28 RECON complete (v2.1.1 → recommended v2.2.0). GATE-1 raised as PA-1.
