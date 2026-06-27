# PROJECT — Inline Subagent Observability Panel — COMPLETE

## Objective (delivered)
A live, always-on inline "small window" replacing the static one-line subagent
status, showing per-subagent statistics while they work: status, role/task,
elapsed time, native tool-call count, tokens, context %, cost, resolved model,
rate-limit state, and an in-flight work tail — plus an Alt+S floating full table.

## Workflow Path: FULL — ALL PHASES ✅
| Phase | Status | Artifact / Agent |
|---|---|---|
| REQUEST | ✅ | `.app/PROJECT.md` |
| RESEARCH | ✅ | drpe `ObserveResearch` (report: agent://ObserveResearch) |
| SPEC | ✅ approved | `.app/SPEC.md` (leaddev) |
| DEVELOP | ✅ c1 + c2 (tsc clean) | leaddev→middev `DevSubagentPanel` / `DevCycle2Hardening` |
| VALIDATE | ✅ **PASS** (c1 PASS-WITH-MINOR → c2 PASS) | validator `ValidateSubagentPanel` / `ValidateCycle2` |
| DONE | ✅ this record | Elon |

## Final verification (independent, validator)
- `npx tsc --noEmit` → EXIT 0 (run twice by validator, clean).
- 13/13 ACs satisfied (12 PASS + AC-1 PARTIAL = static-only spawn latency, accepted).
- Additive-only confirmed: only `setWidget`/`custom({overlay})`/`requestComponentRender`/`pi.events.on`/`pi.on`/`pi.registerShortcut`; never `requestRender(true)`/`getBranch`/`history://`/`artifact://`; does NOT touch built-in HUD/statusLine/Hub.
- 3 minor hardening fixes folded in c2 (teardown dispose, overlayScroll clamp, payload guards); fix4 skipped (verified non-defect).

## Key research finding (flipped the problem)
The harness already ships an Agent Hub + event bus + collab-web. The real ask was
enriching the persistent INLINE view. Bonus: `AgentProgress` carries
`resolvedModel` + `contextTokens/contextWindow` LIVE (verified at
node_modules/@oh-my-pi/pi-coding-agent/src/task/{types.ts:258-327, executor.ts}) —
so model-name + context-% show for free, no core PR.

## Delivered (new code)
- `src/subagent-panel.ts` (758 lines) — `(pi: ExtensionAPI) => void` extension: SubagentStore aggregation fed by `task:subagent:{lifecycle,progress,event}`; persistent `setWidget` panel (≤10 lines, stat rows + work tail); `Alt+S` `custom({overlay})` full table; 1s component-scoped tick; full lifecycle/cleanup.
- `package.json` — appended as 4th entry in `omp.extensions`.

## How to use (user-facing)
- Loads wherever Plugin A (`omp-agent-gate`) is installed; NOT gated by the orchestrator opt-in.
- **Persistent panel:** always-on above the editor — per-agent stats + live tail.
- **Full table:** press `Alt+S` (scroll ↑↓, Esc/q to close).
- Env tunables: `OMP_SUBAGENT_PANEL_KEY`, `_PLACEMENT` (aboveEditor|belowEditor),
  `_HIDE_EMPTY`, `_SHOW_SYNC`, `_DONE_TTL_MS` (30000), `_MIN_RENDER_MS` (200).

## Non-blocking follow-ups (optional)
- AC-1 spawn→row latency: static-only; a runtime latency test would move it PASS.
- displayName/parent/unread (irc-registry fields): API exposes no accessor (Q6);
  identity is derived from payloads. Add if a registry accessor is ever exposed.
- registerShortcut has no keybindings.yml action-id (Q7); env var is the override.
- Usage doc: not written (offer pending); this repo maintains docs per convention.
