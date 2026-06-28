# PROJECT — elon-ko `opt-s` binding fix

## Summary
`opt-s` (Option+S / Alt+S — toggles the subagent-panel overlay) fails on ghostty 1.3.1. Root cause
(High): ghostty 1.3.0 #9406 (modifyOtherKeys no longer encodes option as alt, unreverted in 1.3.1)
defeats the v2.1.2 `data==='ß'` fallback. Fix: encoding-agnostic `matchesOptionToggle` matcher.
Diagnosis: `.app/RESEARCH.md`. Design: `.app/SPEC.md`. Impl: commit `74abbba`.

## Workflow
- REQUEST: done
- RESEARCH: done (`.app/RESEARCH.md`)
- SPEC: done (approved) — `.app/SPEC.md`
- DEVELOP ⇄ VALIDATE: **cycle 1 PASSED** ✅ (1/3 used)
  - DEVELOP c1: `74abbba` — matcher + fallback swap; §5.4 omitted (TC-6, omp-source-verified).
  - VALIDATE c1: PASS — all §5 sections conformant (file:line); gate re-run clean (tsc 0, bun 8/0).
  - Non-blocking nit: vacuous TC-6 dispatch assertion (definitively resolved by user real-key confirm).
- **DONE: deployment COMPLETE ✅ (leaddev); awaiting USER restart + real-key confirm**

## Scope (user-selected)
1. **Permanent plugin fix** — validated + DEPLOYED to `~/.omp/plugins/` (pinned to `74abbba`).
2. **Clean up stale legacy plugins** — DONE (both stale plugins removed).

## DONE checklist
- [x] validator PASS
- [x] determine build/install mechanism for omp plugins — omp consumes plugins DIRECTLY FROM GIT;
      `omp plugin install github:owner/repo#<ref>` → dep in `~/.omp/plugins/package.json` → `bun install`
      → `~/.omp/plugins/node_modules/<plugin>/`. No build step; git ref IS the pin.
- [x] confirm which plugin gates the LIVE session — `elon-ko-gate@2.1.2` (the FUNCTIONAL gate; the
      stale `omp-agent-gate` registered NO subagent-panel binding). Dual-load confirmed by the
      double-injected Elon preamble (SPEC §2.3 signature).
- [x] install fixed build (74abbba) into `~/.omp/plugins/` — in-place dep re-pin (never disabled the
      gate); `bun install` resolved elon-ko-gate to 74abbba (sha512 integrity). VERIFIED: deployed
      `subagent-panel.ts:140 matchesOptionToggle` + `:848` call site present. `omp plugin doctor: 4 ok`.
- [x] remove stale `omp-agent-gate@1.6.0` + `orchestrator-agents@1.7.0` — both uninstalled;
      lock + installed_plugins.json + node_modules + cache all clean (only the 2 current plugins).
- [ ] restart omp (user action — REQUIRED; this session still runs old in-memory code)
- [ ] real-key confirm: user presses Option+S on ghostty 1.3.1 → overlay toggles (definitive)
- [ ] optional: tighten TC-6 assertion — SUPERSEDED by real-key confirm (drop)
Safety rule: honored — elon-ko-gate was never disabled/uninstalled during the deploy; the gate kept
enforcing through the on-disk mutation (empirical proof omp does NOT hot-reload plugins mid-session).

## Verified facts
- omp runtime 16.2.2; `ctx.ui.onTerminalInput` EXISTS → refutes DrPe #2.
- Build/install: `omp plugin install|uninstall|list|doctor|marketplace`; bun is the Plugin-A resolver.
- TOOLING HAZARD: `omp plugin uninstall --dry-run` does NOT honor `--dry-run` (it actually uninstalls).
  Never use it for a no-op preview. (`install --dry-run` is correct.)
- Version-hygiene note: omp still LABELS the gate 2.1.2 because 74abbba did not bump package.json#version;
  the CONTENT is the fixed build (proven by matcher grep). For a permanent semver pin → cut tag v2.1.3.

## Follow-ups (optional, parked)
- Cut tag `v2.1.3` (bump package.json 2.1.2→2.1.3, CHANGELOG entry per SPEC §9.5 draft, commit, tag,
  push → release.yml publishes GH Release); then re-pin `~/.omp/plugins/package.json` to `#v2.1.3`.
- After user real-key confirm passes, remove `macos-option-as-alt = true` from ghostty config (the
  plugin fix is encoding-agnostic; workaround no longer required).

## Workaround (relayed; remove after real-key confirm passes)
`macos-option-as-alt = true` in `~/.config/ghostty/config` → reload.
