# PROJECT — Release the `wrapper` agent hire

## Status: RELEASE PENDING — registration done; release blocked on session reload

## Request
Dogfood the newly-hired `wrapper` release-engineering agent to commit, push, and
cut a release of the current changes (the `wrapper` agent hire + its registration fix).

## Classification
FULL (release-engineering close-out) → terminal agent: `wrapper`.

## Decision Log
- 2026-06-28 — wrapper hire COMPLETED by HR (definition `.omp/agents/wrapper.md` +
  skill `.agents/skills/wrapper/SKILL.md`, 106 lines / 7 sections).
- 2026-06-28 — [PROTO] commit `7e37295` landed `.app/PROJECT.md` (hire status=DONE).
- 2026-06-28 — BLOCKER: `enforce-orchestrator` gate rejected `task(agent="wrapper")`;
  enforced allowlist was {reqguru, drpe, leaddev, validator, docworm, hr}. `wrapper`
  was defined but absent from the enforced spawn set — a registration gap in the hire.
- 2026-06-28 — User chose "Register wrapper first" (over the leaddev fallback).
- 2026-06-28 — HR closed the gap: edited `src/enforce-orchestrator.ts`, added
  `"wrapper"` to the `TEAM` const array (now 7 entries). Re-read verified; no tests
  broken (test file asserts no TEAM-membership). Advisory `scaffold/AGENTS.md` spawns
  list left unedited (advisory template, not enforcement — out of scope).
- 2026-06-28 — CONFIRMED by HR: `TEAM` is a module-level const evaluated once at
  extension load (line ~68); the change takes effect ONLY after a reload
  (session restart / `omp reload` / plugin re-link). Elon CANNOT spawn `wrapper`
  in the current running session. The per-spawn check (line ~166) reads array content
  frozen at load.

## Uncommitted changes to release (working tree)
- `.omp/agents/wrapper.md` (untracked) — wrapper agent definition
- `.agents/skills/wrapper/SKILL.md` (untracked) — wrapper skill
- `src/enforce-orchestrator.ts` (modified) — `wrapper` added to enforced `TEAM` allowlist
- Branch is ahead of `origin/main` (the [PROTO] commit + prior local commits) — push pending.

## Release plan (via `wrapper`, after reload)
1. `wrapper` commits the three deliverable/fix files (descriptive, conventional messages).
2. Version bump per Conventional Commits → semver (new agent = feat → minor, unless the
   repo's version history indicates otherwise); doc-version verification.
3. Push all pending commits; auto-detect platform via `git remote` (gh + glab).
4. Release branch + CI; PR/MR (minor → auto-merge per the PA-2 decision); tag + release;
   local-main sync.
5. Escalate to Elon for anything outside release-engineering scope.

## Next action
User decision required (PA-1): reload to enable `wrapper` spawn (true dogfood), or fall
back to `leaddev` for the release now (no reload, but not dogfooding `wrapper`).

## Pending Asks
- [PA-1] 2026-06-28T00:00:00Z origin=elon status=pending | "Reload the session/plugin to enable `wrapper` spawn (then Elon runs the release through wrapper), or fall back to `leaddev` to do the release now without a reload?"
