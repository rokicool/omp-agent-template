# PROJECT — Release the `wrapper` agent hire

## Status: RELEASE PENDING — awaiting FULL session restart to enable `wrapper` spawn

## Request
Dogfood the newly-hired `wrapper` release-engineering agent to commit, push, and
cut a release of the current changes (the `wrapper` agent hire + its registration fix).

## Classification
FULL (release-engineering close-out) → terminal agent: `wrapper`.

## Decision Log
- 2026-06-28 — wrapper hire COMPLETED by HR (definition `.omp/agents/wrapper.md` +
  skill `.agents/skills/wrapper/SKILL.md`, 106 lines / 7 sections).
- 2026-06-28 — [PROTO] commit `7e37295` landed `.app/PROJECT.md` (hire status=DONE).
- 2026-06-28 — BLOCKER #1: `enforce-orchestrator` gate rejected `task(agent="wrapper")`;
  enforced allowlist was {reqguru, drpe, leaddev, validator, docworm, hr}. `wrapper`
  was defined but absent from the enforced spawn set — a registration gap in the hire.
- 2026-06-28 — User chose "Register wrapper first" (over the leaddev fallback).
- 2026-06-28 — HR closed the gap: edited `src/enforce-orchestrator.ts`, added
  `"wrapper"` to the `TEAM` const array (now 7 entries). Re-read verified; no tests
  broken. Advisory `scaffold/AGENTS.md` spawns list left unedited (advisory, not enforcement).
- 2026-06-28 — CONFIRMED by HR: `TEAM` is a module-level const evaluated once at
  extension load; the change takes effect ONLY after a reload. Elon CANNOT spawn
  `wrapper` in a pre-reload session.
- 2026-06-28 — [PROTO] commits `7c74e45` → `2bf9434` recorded registration + PA-1 + PA-2.
- 2026-06-28 — PA-1 RESOLVED: user chose "Reload, then wrapper."
- 2026-06-28 — BLOCKER #2 (post-"reload"): `task(agent="wrapper")` STILL rejected; the
  deny message listed exactly 6 agents (no `wrapper`). Since the deny string at line 169
  is `TEAM.join(", ")` (auto-includes edited members), a reloaded extension would print 7.
  It printed 6 → `omp reload` did NOT re-evaluate the extension's module-level const.
  CONCLUSION: a FULL session restart is required, not `omp reload`.
- 2026-06-28 — PA-2 remains the agreed trigger: user chose "Full restart, then wrapper."

## Uncommitted changes to release (working tree)
- `.omp/agents/wrapper.md` (untracked) — wrapper agent definition
- `.agents/skills/wrapper/SKILL.md` (untracked) — wrapper skill
- `src/enforce-orchestrator.ts` (modified) — `wrapper` added to enforced `TEAM` allowlist
- Branch is ahead of `origin/main` (the `[PROTO]` commits + prior local commits) — push pending.

## Release plan (via `wrapper`, on the first post-RESTART turn)
1. `wrapper` commits the three deliverable/fix files (descriptive, conventional messages;
   suggest `[SPEC] Add wrapper release-engineering agent (definition + skill)` for the
   agent deliverable and `[FIX] Register wrapper in orchestrator spawn allowlist` for
   `src/enforce-orchestrator.ts`).
2. Version bump per Conventional Commits → semver (new agent = feat → minor, unless the
   repo's version history indicates otherwise); doc-version verification.
3. Push all pending commits; auto-detect platform via `git remote` (gh + glab).
4. Release branch + CI; PR/MR (minor → auto-merge per the PA-2 hire decision); tag + release;
   local-main sync.
5. Escalate to Elon for anything outside release-engineering scope.

## Next action (post-RESTART) — for the new Elon session
A FULL session restart re-evaluates `TEAM`, so `wrapper` will be spawnable. On the first
post-restart turn, spawn `wrapper` (context=`skill://wrapper`) with the release plan above.
PA-2 is the agreed trigger — a `.` reply agrees to it; do NOT re-ask. Then mark PA-2 agreed
and proceed. Do NOT fall back to leaddev (user declined it twice).

## Pending Asks
- [PA-1] 2026-06-28T00:00:00Z origin=elon status=agreed | "Reload to dogfood `wrapper`, or
  fall back to `leaddev`?" → RESOLVED: reload path chosen.
- [PA-2] 2026-06-28T00:00:00Z origin=elon status=pending | "Spawn `wrapper` now (post-restart) to execute the full release plan — commit the 3 files, push, version bump, tag, release?"
