# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project aims to adhere to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- **`subagent-tabs` reworked to a tmux engine + single Ghostty viewer.** The
  Supaterm/`sp` backend is removed entirely; the surface is now one shared tmux
  session (default `omp-subagents`) holding one tmux window per subagent — those
  windows are the tabs. On the first subagent to start, **one** Ghostty window is
  opened (once, if Ghostty is present and no client is already attached) attached
  to the session, so every subagent appears as a tab inside that single viewer.
  Trigger and titling are unchanged: tabs open on `task:subagent:lifecycle`
  status `started`, are titled `<agentId> · <role>`, and are never auto-closed on
  agent end (closed on `session_shutdown`).

- **New config knobs.** `OMP_SUBAGENT_TABS_FOCUS` (default off; a truthy value
  selects each new tmux window and best-effort raises the viewer) and
  `OMP_SUBAGENT_TABS_TMUX_SESSION` (default `omp-subagents`; the shared session
  name). `OMP_SUBAGENT_TABS` remains the master on/off; `OMP_SUBAGENT_TABS_RENDER`
  and `OMP_SUBAGENT_TABS_QUIET_MS` are unchanged.

### Changed

- **Streaming is event-push, not `pipe-pane`/`capture-pane`.** The
  `task:subagent:event` channel renders each event and writes it verbatim via
  `tmux send-keys -t <target> -l`; an explicit `rewind()` replays any unsent
  bytes from the agent's jsonl transcript.

- **Invisible fallback when tmux is absent.** With no tmux the extension logs
  `subagent-tabs: no tmux; invisible` and registers nothing; the subagent still
  runs. tmux is now a hard dependency for the live-tabs feature.

### Removed

- **Supaterm/`sp` backend, `SUPATERM_CLI_PATH`, and the socket→tmux fallback
  chain are gone** — there is no Supaterm code path and no `sp`/`sp-primary`
  detection. **Breaking:** `OMP_SUBAGENT_TABS_HOLDER` (a no-echo holder process
  from the Supaterm era) is no longer read and has no effect — it is safe to drop
  from your environment. The visual model also changes from per-agent native tabs
  to tmux windows inside a single Ghostty viewer window.

- By design there is exactly one Ghostty viewer window (not one per subagent):
  Ghostty has no tab IPC on any platform and no window IPC on macOS (see
  `.app/RESEARCH.md`), so separate per-subagent windows are not possible.

## [v1.4.0] - 2026-06-26

### Added

- **New `dot-agreement` extension: a `.` agreement token for the root orchestrator.** Elon accepts a lone `.` as explicit agreement with the most-recent **pending ask** recorded in `.app/PROJECT.md`. The token fires only when the trimmed reply is exactly `.` — whitespace-padded forms (`. `, ` .`) count, while embedded/repeated dots (`v1.2`, `ok.`, `3.14`, `..`) are literal text and affirmatives (`yes`, `ok`, `y`) are ordinary input, **not** the token. On agreement the ask is marked `status=agreed`; if none is pending, Elon asks what you are agreeing to. Like the gate, it is dormant unless the project opts in.

- **New `mess-transport` extension: cross-instance messaging for agents running in separate `omp` processes.** When team agents run in separate `omp` processes that share the same `.app/` directory on disk, messages addressed to a remote agent are written to `.app/mess/` and picked up by the receiver (turn-start scan + idle poll); co-located agents keep using normal in-app delivery. Exposes `mess-send` and `mess-fail` tools on team agents. Configurable via `OMP_MESS_POLL_MS`, `OMP_MESS_CLAIM_STALE_MS`, `OMP_INSTANCE_ID`, and `.app/instances.json`. Dormant unless opted in.

### Changed

- Registered both extensions in `package.json#omp.extensions` and documented them across the orchestrator skills, the team-agent tool frontmatter (`mess-send`/`mess-fail`), and the user/developer guides.

### Validation

- `tsc --noEmit` clean; **63/63** unit tests pass; `scripts/validate-plugins.sh` reports ALL CHECKS PASSED.

## [v1.3.1] - 2026-06-25

### Changed

- **Opt-in marker renamed: `.omp/orchestrator.json` → `.omp/elon.json`.** The
  per-project gate is now enabled with:

  ```bash
  echo '{"enabled": true}' > .omp/elon.json
  ```

  This aligns the marker filename with the orchestrator's "Elon" identity. The
  env opt-in (`OMP_ENABLE_ORCHESTRATOR=1`) and escape hatch
  (`OMP_BYPASS_ORCHESTRATOR=1`) are unchanged. **Migration:** existing opted-in
  projects must rename their marker
  (`mv .omp/orchestrator.json .omp/elon.json`); otherwise the gate reverts to
  dormant (the safe, unrestricted default).

### Fixed

- **Plugin B marketplace version no longer reports `1.2.1`.** Both
  `metadata.version` and `plugins[].version` in `.omp-plugin/marketplace.json`
  are now kept in lockstep with `package.json#version` (now `1.3.1`). The stale
  `1.2.1` — shown as `Installed orchestrator-agents … (1.2.1)` during install —
  was drift left over from the `v1.3.0` release.

## [v1.3.0] - 2026-06-25

### Added

- **New `subagent-tabs` omp extension: per-agent live activity in supaterm.**
  When a subagent starts, a supaterm tab opens labeled `<agentId> · <role>` and
  streams live, colored activity — tool calls (✓/✗), notices, and irc messages.
  Tabs survive the subagent's end for review (they never auto-close); a canceled
  subagent shows `[ABORTED]`. If the supaterm socket is unreachable, the
  extension falls back to a tmux bridge automatically.

- **Configurable via environment knobs.** `OMP_SUBAGENT_TABS` toggles the
  feature (default on); `OMP_SUBAGENT_TABS_RENDER` selects `rich` (default,
  ANSI-colored) or `plain` rendering; `OMP_SUBAGENT_TABS_QUIET_MS` and
  `OMP_SUBAGENT_TABS_HOLDER` tune idle/quiet behavior and the holder display.

- **How to use:** restart your omp session (on by default) and spawn subagents
  with supaterm open.

### Validation

- 8/8 unit tests pass (`npm test`), `tsc --noEmit` is clean; registry
  invariants and the corrected omp API are verified. The live supaterm socket
  path and tmux fallback were exercised end-to-end. (AC1/AC2/AC4 require a live
  omp subagent session.)

### Known non-blocking gaps

- No mid-session socket→tmux failover (fallback is chosen at startup); no
  `isolated` label (omp API gap); no `job cancel` hint in the tab label;
  `rewind()` is built and tested but not yet wired into the controller.

## [v1.2.2] - 2026-06-24

### Fixed

- **The one-line installer no longer fails with a `DependencyLoop` on machines that
  already had `omp-agent-gate` installed.** Running
  `curl .../elon_ko.sh | bash` aborted with a `bun` `DependencyLoop` whenever a
  different version or ref of `omp-agent-gate` was already locked into
  `~/.omp/plugins/` — a prior release, a floating ref, or `main` HEAD instead of
  the pinned tag. `omp` resolves this dependency under its package name, so once a
  mismatched ref is locked in, a plain re-install (even with `--force`) cannot
  clear it and `bun install` bails out. This was drift-only: a machine with no
  previous install was never affected.

  `elon_ko.sh` now uninstalls `omp-agent-gate` before the pinned install. On a
  clean machine the uninstall is a harmless no-op; on a drifted install it removes
  the stale resolution so the pinned ref resolves cleanly on every run and
  upgrade.

- **Installer-only change; plugin code is unchanged.** This release fixes only the
  installer (`elon_ko.sh`) and its documented install steps. Plugin A's gate and
  rule code are unchanged, and Plugin B (`orchestrator-agents`) is entirely
  unaffected — no behavior, configuration, or skill changes.

- If you previously installed `omp-agent-gate` from a bare or manually pinned ref
  and hit `DependencyLoop`, reinstall pinned and uninstall first:

  ```bash
  omp plugin uninstall omp-agent-gate \
    && omp plugin install github:<owner>/omp-agent-template#v1.2.2
  ```
