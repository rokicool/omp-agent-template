# PROJECT — elon-ko plugin fixes

## Status: ALL TRACKS DONE (T1–T3 committed; T4 resolved as operational)
- Updated: 2026-06-28

## Resolved tracks — DONE, committed
- `aa6181c` [TRIVIAL] opt-s panel fix (src/subagent-panel.ts)
- `9b21189` [TRIVIAL] scoped irc grant (behavioral) + job
- `4a11d9e` [TRIVIAL] doc-enumeration consistency
- `0ef063d` [PROTO] PROJECT.md DONE

## T4 — opt-s not live in a new omp instance  ✅ RESOLVED (operational, no code change)
- Owner: LeadDev (`DiagnoseOptSNotLive`)
- Root cause: **restart semantics**, not a build/load defect. omp loads plugin extensions once per PROCESS at startup and does not hot-reload TS source. The user's running process (PID 4231, started Jun 27 22:09:43) predates the fix (aa6181c, committed Jun 27 22:33:22) by 24 min, so it runs the pre-fix in-memory code. A new chat/tab inside that process is not a reload.
- Ruled out with evidence: no build step (noEmit, no dist; omp.extensions → raw src); gate live-symlinked to dev repo; fix present through the symlink omp loads; API + Bun loader confirmed working; tests pass.
- Fix applied in repo: none — repo is correct.
- User action required: fully QUIT all omp processes (kill stale PID 4231 / pkill -x omp), relaunch, verify process start time is today, then Option+S.

## Pending Asks
- [PA-1] 2026-06-28T00:00:00Z origin=elon status=agreed | "Grant Elon `irc`: scoped grant" — resolved.
