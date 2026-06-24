# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project aims to adhere to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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
