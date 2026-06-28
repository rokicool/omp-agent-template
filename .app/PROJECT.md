# PROJECT — Release the `wrapper` agent hire

## Status: RELEASE PENDING — reload path chosen; awaiting extension reload to enable `wrapper` spawn

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
  broken. Advisory `scaffold/AGENTS.md` spawns list left unedited (advisory, not enforcement).
- 2026-06-28 — CONFIRMED by HR: `TEAM` is a module-level const evaluated once at
  extension load (line ~68); the change takes effect ONLY after a reload
  (session restart / `omp reload` / plugin re-link). Elon CANNOT spawn `wrapper`
  in the pre-reload running session.
- 2026-06-28 — [PROTO] commit `7c74e45` recorded registration + release-pending state.
- 2026-06-28 — PA-1 RESOLVED: user chose "Reload, then wrapper" (true dogfood over the
  leaddev fallback).
- 2026-06-28 — [PROTO] commit `d1401b0` recorded PA-1 resolution.
- 2026-06-28 — PA-2 raised (pending): "Spawn `wrapper` now to execute the release plan?"
  (the post-reload trigger; a `.` reply on the next turn agrees and launches the release).

## Uncommitted changes to release (working tree)
- `.omp/agents/wrapper.md` (untracked) — wrapper agent definition
- `.agents/skills/wrapper/SKILL.md` (untracked) — wrapper skill
- `src/enforce-orchestrator.ts` (modified) — `wrapper` added to enforced `TEAM` allowlist
- Branch is ahead of `origin/main` (the three [PROTO] commits + prior local commits) — push pending.

## Release plan (via `wrapper`, on the first post-reload turn)
1. `wrapper` commits the three deliverable/fix files (descriptive, conventional messages).
2. Version bump per Conventional Commits → semver (new agent = feat → minor, unless the
   repo's version history indicates otherwise); doc-version verification.
3. Push all pending commits; auto-detect platform via `git remote` (gh + glab).
4. Release branch + CI; PR/MR (minor → auto-merge per the PA-2 hire decision); tag + release;
   local-main sync.
5. Escalate to Elon for anything outside release-engineering scope.

## Next action (post-reload)
On the first post-reload turn, Elon spawns `wrapper` (now permitted — `TEAM` includes
`wrapper` after reload) with the release plan above. A `.` reply agrees to PA-2 and launches it.

## Pending Asks
- [PA-1] 2026-06-28T00:00:00Z origin=elon status=agreed | "Reload to dogfood `wrapper`, or
  fall back to `leaddev`?" → RESOLVED: reload path chosen.
- [PA-2] 2026-06-28T00:00:00Z origin=elon status=pending | "Spawn `wrapper` now (post-reload) to execute the full release plan — commit the 3 files, push, version bump, tag, release?"
