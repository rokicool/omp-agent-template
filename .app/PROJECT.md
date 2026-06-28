# PROJECT — elon-ko `opt-s` binding fix

## Summary
`opt-s` (Option+S / Alt+S — toggles the subagent-panel overlay) fails on ghostty 1.3.1.
Install is correct: `elon-ko-gate@2.1.2` is installed and its `ß`-fix is present. Root cause
(High): ghostty 1.3.0 #9406 ("modifyOtherKeys state 2 no longer encodes option as alt on macOS",
unreverted in 1.3.1) — Option+S no longer arrives as the literal `ß` the v2.1.2 fix matches, nor
as `Alt+S` that omp's `registerShortcut` recognizes. Diagnosis: `.app/RESEARCH.md`. Design: `.app/SPEC.md`.

## Workflow
- REQUEST: done
- RESEARCH: done (`.app/RESEARCH.md`) — verdict EXPAND; no GRILL
- SPEC: **done (approved 2026-06-28)** — `.app/SPEC.md`. Encoding-agnostic family matcher
  `matchesOptionToggle` (F1 ß / F2 codepoint-223 structured / F3 ESC+s / F4 codepoint-115+alt),
  collision-free, `registerShortcut` untouched, minimal backward-compatible diff.
- DEVELOP ⇄ VALIDATE: **in progress — cycle 1** (leaddev → middev implements, then validator)
  — 3-cycle limit enforced
- DONE: pending

## Scope (user-selected)
1. **Permanent plugin fix** — in DEVELOP.
2. **Clean up stale legacy plugins** (`omp-agent-gate@1.6.0`, `orchestrator-agents@1.7.0`) —
   sequenced into DONE/integration (SPEC §9.3): remove ONLY after confirming the live session is
   gated by `elon-ko-gate`, then restart omp so the panel reloads. SPEC §2.3 confirmed the stale
   `omp-agent-gate@1.6.0` registers NO Alt+S — no direct collision; it is hygiene + load-risk only.

## Verified facts (from SPEC §2)
- omp runtime 16.2.2; `ctx.ui.onTerminalInput` EXISTS with assumed signature → refutes DrPe #2.
- Dual install confirmed in `omp-plugins.lock.json` (both pairs enabled).
- Existing test `subagent-panel.test.ts:44-50` pins `parseKey("ß")===null` (root cause).

## Open questions (resolved in DEVELOP via tests, NOT design forks)
- OQ-1: exact ghostty-1.3.1 byte → confirmed by TC-2e (`\x1b[27;1;223~`) + real-key check at DONE.
- OQ-2: does omp dispatch raw input to extension listeners while overlay focused → TC-6 decides
  whether §5.4 defensive close-path is added.

## Workaround (relayed to user)
`macos-option-as-alt = true` in `~/.config/ghostty/config` → reload. Doubles as confirmation test.
