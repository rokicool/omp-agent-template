# PROJECT — Release the `wrapper` agent hire

## Status: DONE ✅
All releases shipped & pushed (v2.2.0, v2.2.1, v2.3.0, v2.3.1). Local `main` in sync with
`origin/main` @ `4b9157d` — **zero divergence**. `[PROTO]` artifacts preserved on `main` AND
`origin/main` (`25df16f`, `d726c39`). No outstanding work.

## Request (original — DONE)
Dogfood `wrapper` to release the wrapper hire + registration fix.

## Outcome — COMPLETE
- **v2.2.0** (`wrapper-release`): wrapper hire + gate allowlist fix. PR #18→`740f645`; tag v2.2.0.
- **v2.2.1** (`wrapper-promote-release`/F2): wrapper published in elon-ko-agents; validate-plugins.sh
  GREEN (8 agents). PR #19→`db656f5`; tag v2.2.1.
- **F1** (`WorkingRoadrunner`/leaddev): installed-gate pin `#74abbba`→`#v2.2.1` (durable).
- **PA-6 installer fix** (`AboveRoadrunner`/wrapper): PR #20 MERGED→`11f09fc`. CI green (validate-plugins
  + installer smoke). No release (main-HEAD-fetched; v2.2.1 artifacts already correct).
- **v2.3.0** — `elon_ko.sh` **uninstall** mode (one-pass cleanup of both plugins + marketplace under
  current and pre-v2.0.0 names; also carries the PA-6 stable-install force-refresh fix into the
  changelog). Commit `792eca2`. Shipped & pushed.
- **v2.3.1** — installer ensures the **`unzip`** prerequisite before extracting bun (clear actionable
  failure on a minimal box; macOS unaffected). Commit `8138b47`. Shipped & pushed.
- **Docs** — `CHANGELOG.md` reordered newest-first (`[Unreleased]`/v2.3.x to top). Commit `4b9157d`
  (current HEAD of `main` and `origin/main`).

## PA-6 — installer bug (DIAGNOSED + FIXED)
- **Root cause** (`elon_ko.sh:117-118`): stable-mode `marketplace remove`+`add` reuses omp's stale
  cached GitHub clone → catalog frozen at first-added version (v2.1.2, no wrapper). Gate (Plugin A)
  git-pinned `#v2.2.1` admits wrapper → wrapper allowed-but-undefined → "not available."
  (Prime suspect — build excludes wrapper — RULED OUT: v2.2.1 artifacts verifiably contain wrapper;
  `release.yml:67-70` is a directory tar.)
- **Fix**: force `omp plugin marketplace update` in stable mode after `marketplace add` (pre-release
  path unchanged). leaddev `4948c9e` (pre-squash local) → cherry-picked to a clean branch from
  `origin/main`, PR #20, CI green, squash-merged as `11f09fc`. (`4948c9e` was later dropped during the
  main-sync rebase — its `elon_ko.sh` hunk is fully contained in the squash `11f09fc`.)
- **User workaround (broken machine):** `omp plugin marketplace update elon-ko && omp plugin
  install elon-ko-agents@elon-ko --force`

## Decision Log (condensed)
- 2026-06-28 — wrapper hired; BLOCKER #1/#2/#3 (gate rejected wrapper; root cause = stale installed
  plugin copy pinned `#74abbba`; leaddev hand-patched installed copy).
- 2026-06-29 — PA-4 activate via restart → 5th spawn admitted. BLOCKER #3 RESOLVED.
- 2026-06-29 — `wrapper-release` v2.2.0 shipped & verified.
- 2026-06-29 — PA-5 (F1 fix-install + F2 promote). `wrapper-promote-release` v2.2.1 shipped & verified.
- 2026-06-29 — F1 (`WorkingRoadrunner`): gate pin `#74abbba`→`#v2.2.1` (durable).
- 2026-06-29 — PA-6: wrapper missing on fresh install. leaddev (`OrthodoxTakin`) diagnosed installer
  bug (stale marketplace cache); fix `4948c9e`. wrapper (`AboveRoadrunner`) shipped via PR #20→`11f09fc`.
- 2026-06-29 — ALL v2.2.x WORK COMPLETE. DONE.
- 2026-06-30 — v2.3.0 shipped & pushed: `elon_ko.sh` uninstall mode (`792eca2`).
- 2026-06-30 — v2.3.1 shipped & pushed: installer ensures `unzip` prerequisite (`8138b47`).
- 2026-06-30 — main/origin divergence RESOLVED: local `main` synced to `origin/main` @ `4b9157d`;
  `[PROTO]` rebased onto origin as `25df16f`/`d726c39`; pre-squash `4948c9e` dropped
  (content contained-in-`11f09fc`).

## Repo state
Local `main` == `origin/main` @ `4b9157d` (no divergence). `[PROTO]` protocol artifacts
(`25df16f`, `d726c39`) are present on `main` and `origin/main`.

## Pending Asks
- None. [PA-1..PA-6] all resolved. DONE.
