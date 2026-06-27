# SPEC — Inline Subagent Observability Extension (`subagent-panel`)

> **Status:** SPEC (design only — implementation deferred to MidDev after Elon approval).
> **Author:** LeadDev (`SpecInlineObs`). **Date:** 2026-06-26.
> **Scope locus:** a new **extension module** in Plugin A (`omp-agent-gate`) of this repo.
> **Locked decisions honored:** BUILD the inline extension (option a); COMPLEMENT (do not
> replace) the built-in `subagentContainer` HUD / `statusLine` / Agent Hub; stats limited to
> what is available LIVE with no core PR; the live model-name + contextUsage question is
> **VERIFIED PRESENT** (see §0) and therefore INCLUDED.

---

## 0. Live-Field Verification (the gating unknown — RESOLVED)

The locked decision made inclusion of live **model name** and **contextUsage %** contingent on
verifying they ride the live `AgentProgress` event / registry. **They do.**

### Verdict: ✅ VERIFIED PRESENT (no core plumbing required)

Authoritative evidence (harness source IS on disk at
`node_modules/@oh-my-pi/pi-coding-agent/`):

| Claim | File : line | Evidence |
|---|---|---|
| Three live bus channels exist | `…/src/task/types.ts:29-36` | `TASK_SUBAGENT_EVENT_CHANNEL = "task:subagent:event"`, `TASK_SUBAGENT_PROGRESS_CHANNEL = "task:subagent:progress"`, `TASK_SUBAGENT_LIFECYCLE_CHANNEL = "task:subagent:lifecycle"` |
| Progress payload embeds `AgentProgress` | `…/src/task/types.ts:38-50` | `SubagentProgressPayload { index, agent, agentSource, task, …, progress: AgentProgress, sessionFile?, detached? }` |
| `AgentProgress` carries the live fields | `…/src/task/types.ts:258-327` | `resolvedModel?`, `contextTokens?`, `contextWindow?`, `tokens`, `cost`, `toolCount`, `requests`, `recentOutput[]`, `currentTool?`, `currentToolArgs?`, `recentTools[]`, `durationMs`, `retryState?`, `retryFailure?`, `inflightTaskDetails?` |
| Those fields are populated **live**, incrementally | `…/src/task/executor.ts:1232-1233` | `progress.contextTokens = perTurnTotal` (from `message_end` usage) |
| `contextWindow` + `resolvedModel` set live | `…/src/task/executor.ts:1922-1926` | `progress.contextWindow = model.contextWindow`; `progress.resolvedModel = …` (provider/id, +thinkingLevel suffix) |
| A renderer already consumes them live | `…/src/task/render.ts:79-114` | `appendAgentStats()` renders `${toolCount} 🔧`, `${requests} req`, `formatContextUsage((contextTokens/contextWindow)*100, window)` → e.g. `5.1%/1M`, `$cost`, `resolvedModel` |
| `<pct>%/<window>` format spec | `…/src/modes/components/status-line/context-thresholds.ts:59-63` | `formatContextUsage(pct, window)` → `"<percent>%/<window>"` |

**Consequence:** the extension gets, FOR FREE and live on every `task:subagent:progress` frame:
resolved model name, per-turn context % and gauge, cumulative tokens, cost, request count,
**native `toolCount`** (so manual event-counting is superseded — see §3.3), the in-flight work
tail (`recentOutput`), current tool, retry/rate-limit state, and even nested-subagent progress
(`inflightTaskDetails`). The only field that is **not** carried by the progress payload is the
human-friendly role-derived `displayName` / `parent` / `unread` (those live in the IRC registry,
not on the event) — see §6/Open-Item Q6.

> The research report (`agent://ObserveResearch`) marked these fields UNVERIFIED because it ran
> in a cwd without the installed package. Here the package is installed, so the source-level
> check DrPe recommended is complete and affirmative.

---

## 1. Situation

The oh-my-pi harness already renders subagents in three places: a terse inline
**`subagentContainer` HUD**, a one-line **`statusLine` count**, and the full **Agent Hub** table
(opened on demand). The user's pain is that the *persistent inline* surface is too static — a
single status line — and does not show per-subagent statistics while they work (tokens, context
%, model, cost, tool count, a live work tail). The web dashboard and Agent Hub are rich but not
"always-on inline."

This extension adds a **persistent, always-on inline panel** (≤10 lines, via `setWidget`) that
streams live per-subagent stats, plus a **hotkey floating full table** (`custom({overlay:true})`)
for when many agents run. It uses **only documented, stable extension APIs** and the verified
live event bus — no core changes, no second process. It complements (does not touch) the built-in
HUD/statusLine/Hub.

---

## 2. Architecture Overview

```
                    ┌─────────────────────────────────────────────┐
                    │            Parent omp session                │
                    │   (interactive TUI; extension lives here)    │
                    │                                             │
   task tool ──emit──►  shared EventBus (pi.events)               │
   spawns subagent     │   ├─ task:subagent:lifecycle  ─┐         │
                       │   ├─ task:subagent:progress    ├─►  ┌───┴──────────┐
                       │   └─ task:subagent:event       ─┘   │ subagent-    │
                       │                                  ◄──┤ panel.ts     │
                       │   1s elapsed-tick (component-        │  (this ext)  │
                       │   scoped; no transcript walk)        │  ┌─────────┐ │
                       │                                     ─► │  Aggr.   │ │
                       │   TUI render scheduler                 │  state   │ │
                       │   (requestComponentRender = cheap)     │  Map<id, │ │
                       │                                       │  Row>    │ │
                       │                                       └──┬───┬──┘ │
                       │                                          │   │    │
                       │    ┌─────────────────────────────────────┘   │    │
                       │    ▼                                         ▼    │
                       │  setWidget({placement:"aboveEditor"})   custom  │
                       │   ≤10-line persistent panel            ({overlay:true})
                       │   (per-agent row + tail)               full table
                       │                                         on Alt+S │
                       └─────────────────────────────────────────────────┘
                                        (built-in subagentContainer HUD &
                                         statusLine are NOT touched)
```

**Data flow:** the extension subscribes to the three verified channels on `pi.events`, folds each
frame into a `Map<id, SubagentRow>` (the aggregation core), and renders two surfaces from that
map: a persistent `setWidget` panel (compact) and an on-demand `custom({overlay:true})` table
(full). A 1-second elapsed-time tick refreshes durations using **component-scoped**
`requestComponentRender` so the transcript is never re-walked.

**Component graph:** `subagent-panel.ts` (single module) = event subscriptions + aggregation
core + two render factories (panel renderer, overlay renderer) + lifecycle/cleanup.

---

## 3. Module Breakdown

One new module. (Implementation is MidDev's job after approval; this section is the contract.)

### 3.1 Module: `src/subagent-panel.ts`

**Responsibility:** activate an always-on inline subagent-stat panel + a hotkey overlay; aggregate
live subagent state from the bus; render two TUI surfaces; clean up on dispose.

**Public API surface:** the extension default export only.

```ts
import type { ExtensionAPI } from "@oh-my-pi/pi-coding-agent";

export default function subagentPanel(pi: ExtensionAPI): void;
```

Nothing else is exported (no shared internals). The harness calls the factory at load; the factory
registers a `session_start` handler that wires subscriptions + widgets when `ctx.hasUI === true`.

**Dependencies (all documented / verified):**
- `pi.events` — shared `EventBus`; `pi.events.on(channel, fn)` / `pi.events.off(...)`.
- `pi.on("session_start", handler)` / `pi.on("session_shutdown", handler)` — activation/teardown.
- `pi.registerShortcut(chord, { description, handler })` — hotkey. Signature verified at
  `node_modules/@oh-my-pi/pi-coding-agent/dist/types/extensibility/extensions/types.d.ts:658-662`.
- `ctx.ui.setWidget(lines, { placement })` — persistent panel (`placement: "aboveEditor" | "belowEditor"`, ≤10 lines). `omp://extensions.md`, `omp://tui.md`.
- `ctx.ui.custom(factory, { overlay: true })` — floating focusable full table.
- `requestComponentRender(component)` — component-scoped cheap redraw. `omp://tui-runtime-internals.md`.
- `ctx.hasUI` — guard (false in headless/subagent/print → no-op).
- Render primitives from `@oh-my-pi/pi-tui`: `truncateToWidth`, `replaceTabs`, `visibleWidth`, `SelectList`, `matchesKey`.
- Types from `@oh-my-pi/pi-coding-agent`: `AgentProgress`, `SubagentProgressPayload`, `SubagentLifecyclePayload`, `SubagentEventPayload`, and the channel constants `TASK_SUBAGENT_PROGRESS_CHANNEL`, `TASK_SUBAGENT_LIFECYCLE_CHANNEL`, `TASK_SUBAGENT_EVENT_CHANNEL`.

**Rationale (why one module):** the existing extensions in this repo (`enforce-orchestrator.ts`,
`mess-transport.ts`, `dot-agreement.ts`) are each a single self-contained module exporting a
default factory. The surface here is small enough (subscriptions + two renderers) to match that
pattern; splitting would create intra-module coupling without a boundary benefit.

### 3.2 Internal structure (within the module, for MidDev)

| Unit | Owns | Depends on |
|---|---|---|
| `SubagentRow` + `SubagentStore` | the aggregated `Map<id, SubagentRow>`; merge functions for each payload type; TTL eviction of finished rows | the three payload types |
| event wiring | subscribes/unsubscribes the three channels on `pi.events`; lazy-seeds rows from first frame seen | `SubagentStore` |
| `PanelRenderer` | builds the ≤10-line `setWidget` string array from the store | store + render primitives |
| `OverlayTable` (a `Component`) | `render(width)` full table; `handleInput` for scroll/pgup/pgdown + close | store + `SelectList`/primitives |
| tick loop | 1s interval; `requestComponentRender(panelComponent)` only | store + renderer |
| lifecycle | `session_start` activate; `session_shutdown` dispose; `ctx.hasUI` guard | all of the above |

---

## 4. REPO PLACEMENT (decision + pattern)

### 4.1 What this repo is

`~/github/omp-agent-template` publishes **two oh-my-pi plugins from one tree**
(`.DEVREADME.md` §"What this repo is"):

| Plugin | Mechanism | Discovery | Provides |
|---|---|---|---|
| **`omp-agent-gate`** (A) | extension-package | `package.json#omp.extensions` | TS extensions + rules |
| **`orchestrator-agents`** (B) | marketplace | `.omp-plugin/marketplace.json` (`pluginRoot: ./plugins`) | 7 agent defs + 8 skills |

A subagent-observability **extension** is a TypeScript module → it belongs in **Plugin A**.

### 4.2 Where extensions live & how they are discovered

Plugin A extensions are plain `.ts` modules in **`src/`**, each `export default (pi: ExtensionAPI) => void`,
listed in `package.json`:

```jsonc
"omp": {
  "extensions": [
    "./src/enforce-orchestrator.ts",
    "./src/mess-transport.ts",
    "./src/dot-agreement.ts"
  ]
}
```

At startup the harness discovers plugin extension entries via `getAllPluginExtensionPaths(cwd)`
and imports each through the extension loader (`omp://extension-loading.md` §"Installed plugin
extension entries"; loader resolves the package's `omp.extensions`/`pi.extensions` manifest, then
`import type` is erased at runtime so it runs under omp regardless of standalone resolvability).
`package.json#files: ["src","rules"]` controls what `npm pack` ships — keep in sync if a runtime
asset is added.

### 4.3 Decision

**New file: `src/subagent-panel.ts`**, registered by appending it to `package.json#omp.extensions`:

```jsonc
"omp": {
  "extensions": [
    "./src/enforce-orchestrator.ts",
    "./src/mess-transport.ts",
    "./src/dot-agreement.ts",
    "./src/subagent-panel.ts"
  ]
}
```

**Pattern followed (cited, real files):**
- Module shape & opt-in/`import type` idiom — patterned on **`src/enforce-orchestrator.ts`** (default export `(pi: ExtensionAPI) => void`; `import type { ExtensionAPI }`; guard with `ctx.hasUI`).
- Manifest registration + `files` sync — patterned on **`package.json`** + the `.DEVREADME.md` §"Extending: add an extension" recipe.
- Extension API usage (`pi.on`, `pi.registerShortcut`, `ctx.ui.setWidget`/`custom`) — per **`omp://extensions.md`** and the verified signature at `dist/types/extensibility/extensions/types.d.ts:658-662`.

No other files change. No new package, no marketplace entry (this is an extension, not an agent).

---

## 5. DATA MODEL

### 5.1 `SubagentRow` — per-subagent aggregated state

```ts
import type {
  AgentProgress,
  AgentSource,
  SubagentLifecyclePayload,
} from "@oh-my-pi/pi-coding-agent";

/** Terminal lifecycle status, widened with the IRC-only 'parked'/'idle' states for cross-check. */
type RowStatus =
  | "started" | "running" | "completed" | "failed" | "aborted" // from lifecycle + AgentProgress.status
  | "parked" | "idle";                                          // from irc registry enrichment (optional)

export interface SubagentRow {
  // ---- identity (from lifecycle/progress payloads) ----
  id: string;                 // stable subagent id (payload.id)
  index: number;              // spawn order (payload.index)
  agent: string;              // agent type, e.g. "middev" (payload.agent)
  agentSource?: AgentSource;  // "bundled"|"user"|"project"
  task: string;               // one-line task label (payload.task), truncated for display
  assignment?: string;        // payload.assignment (optional)
  description?: string;       // progress.description (best-available human label)
  parentToolCallId?: string;  // payload.parentToolCallId
  detached: boolean;          // payload.detached — drives default HUD-style visibility
  sessionFile?: string;       // payload.sessionFile (for transcript link)

  // ---- live stats (from AgentProgress on task:subagent:progress) ----
  status: RowStatus;
  toolCount: number;          // NATIVE live field (AgentProgress.toolCount)
  requests: number;
  tokens: number;             // cumulative in+out+cacheWrite
  contextTokens?: number;     // per-turn context size
  contextWindow?: number;     // model context window
  contextPct?: number;        // DERIVED: contextTokens/contextWindow*100 (null-safe)
  cost: number;               // USD
  durationMs: number;         // AgentProgress.durationMs (updated live)
  resolvedModel?: string;     // "<provider>/<id>[:thinkingLevel]"
  currentTool?: string;       // in-flight tool name
  currentToolArgs?: string;
  recentOutput: string[];     // in-flight work tail (last ~8 non-empty lines)
  recentTools?: Array<{ tool: string; args: string; endMs: number }>;
  retryState?: AgentProgress["retryState"];   // rate-limit/sleep awareness
  retryFailure?: AgentProgress["retryFailure"];

  // ---- bookkeeping (derived by the extension) ----
  startedAtMs: number;        // first lifecycle 'started' or first frame seen (Date.now())
  lastEventAtMs: number;      // updated on ANY frame for this id
  finishedAtMs?: number;      // set on terminal lifecycle status
  finishedTtlMs?: number;     // how long to keep the frozen row after finish (default 30_000)
  // optional IRC-registry enrichment (only if in-process accessor exists — see Open Q6)
  displayName?: string;       // role-derived display name (irc registry)
  parent?: string;            // parent agent id (irc registry)
  unread?: number;            // irc unread count
}
```

**Invariants:**
- `contextPct` is derived and kept null-safe: `undefined` when `contextTokens`/`contextWindow` are missing or ≤0 (renderers must treat absence as "no gauge", never `NaN`/`Infinity`).
- `toolCount`/`tokens`/`cost`/`requests`/`durationMs` are **monotonically non-decreasing** while a row is running (they come from cumulative counters); the store never decrements them.
- `status` transitions only forward except via explicit terminal→retained re-render; once `finishedAtMs` is set the live stat fields are **frozen** (no further merges) until TTL eviction.
- `recentOutput` is capped (store keeps last N≤8 non-empty lines) and each line is sanitized through `replaceTabs` before storage.

### 5.2 `SubagentStore` — aggregation core

```ts
class SubagentStore {
  private rows = new Map<string, SubagentRow>();
  /** merge a lifecycle frame; create/transition rows */
  mergeLifecycle(p: SubagentLifecyclePayload, now: number): void;
  /** merge a progress frame; create-if-missing (lazy seed) + overlay live AgentProgress fields */
  mergeProgress(p: SubagentProgressPayload, now: number): void;
  /** bump lastEventAtMs (+ optional tool histogram) from a raw event frame */
  noteEvent(id: string, now: number): void;
  /** ordered snapshot: running-first, then by lastEventAtMs desc */
  snapshot(opts: { includeSync?: boolean }): SubagentRow[];
  /** drop finished rows past their TTL */
  sweep(now: number): boolean;            // true if anything changed
  dispose(): void;
}
```

### 5.3 Populate from `pi.events` — channel → field map

| Channel (const @ `task/types.ts:29-36`) | Payload type | Store action | Fields populated |
|---|---|---|---|
| `TASK_SUBAGENT_LIFECYCLE_CHANNEL` (`:36`) | `SubagentLifecyclePayload` (`:58-75`) | `mergeLifecycle` | `started` → create row (`id, agent, agentSource, status, detached, index, parentToolCallId, startedAtMs`); `completed/failed/aborted` → set `status`, `finishedAtMs`, freeze |
| `TASK_SUBAGENT_PROGRESS_CHANNEL` (`:33`) | `SubagentProgressPayload` (`:38-50`) → `.progress: AgentProgress` (`:258-327`) | `mergeProgress` (lazy-seed if unseen) | ALL live fields: `status, toolCount, requests, tokens, contextTokens, contextWindow, cost, durationMs, resolvedModel, currentTool, currentToolArgs, recentOutput, recentTools, retryState, retryFailure`; derive `contextPct` |
| `TASK_SUBAGENT_EVENT_CHANNEL` (`:30`) | `SubagentEventPayload { id, event: AgentSessionEvent }` (`:52-56`) | `noteEvent` | bump `lastEventAtMs`; (optional) per-tool histogram / `currentTool` freshness |

**Key design point (improvement on the original plan):** because `AgentProgress.toolCount` is a
**native live field**, the tool-call counter is read directly from the progress payload — it is
**not** derived by counting `task:subagent:event` frames. The event channel is still subscribed,
but only for freshness/histogram, not for the headline count. This is strictly more accurate than
manual counting and avoids double-counting edge cases.

### 5.4 Seeding initial state

- **Normal case (agents spawned during the session):** the `started` lifecycle frame creates the
  row with full identity. No external lookup needed.
- **Edge case (extension activates with detached agents already running):** rows are
  **lazy-seeded** from the **first `task:subagent:progress` frame** observed for an unseen `id`
  (progress frames carry `id, agent, agentSource, task, index, detached, …progress` — enough to
  seed). The verified 150 ms progress-coalesce cadence means a running agent appears within one
  frame of activation.
- **NOT used for seeding:** the `irc`/`job` tools — those are model-facing tools the extension
  cannot call directly. Their fields (`displayName`, `parent`, `unread`, `last-activity`) are
  **optional enrichment** gated on an in-process registry accessor that is **unverified**
  (Open Q6). Default: derive identity from the payloads; omit irc-only fields.

---

## 6. RENDERING

Two surfaces render from the same `SubagentStore` snapshot.

### 6.1 (a) Persistent panel — `ctx.ui.setWidget(lines, { placement })`

- **Placement decision: `aboveEditor` (default),** configurable to `belowEditor` via
  `OMP_SUBAGENT_PANEL_PLACEMENT`. Justification: the above-editor lane
  (`hookWidgetContainerAbove`) is the documented, purpose-built persistent-widget zone
  (`omp://tui-runtime-internals.md` component tree); it puts the live panel in the user's
  peripheral vision next to the input and the existing status footer. It complements (does not
  replace) the built-in `subagentContainer` HUD by showing stats the HUD lacks
  (tokens/context %/model/cost/toolCount). Tradeoff noted: it stacks near the HUD — mitigated by
  a compact summary row + the placement toggle (Open Q5).
- **Budget:** ≤10 lines total (hard `setWidget` cap). Layout when agents present:
  - Line 1: aggregate header — `Subagents: N active · M done (tail)` + aggregate tokens/cost.
  - Lines 2..K: one compact row per agent (running first), sorted by `lastEventAtMs` desc.
  - Last 1–2 lines: in-flight work tail of the **most-recently-active** agent (its `recentOutput`).
  - Overflow line (if truncated): `… +R more (Alt+S for all)`.
- **Stat-line format** mirrors the verified existing renderer
  (`task/render.ts:79-114`, `formatContextUsage` → `<pct>%/<window>`):
  `<status icon> <agent> · <task…>   <toolCount>🔧  <N> req  <pct>%/<window>  $<cost>  <model?>`

**ASCII mock — persistent panel (8 agents running, 2 overflow), width ~96:**
```
┤ Subagents: 8 active · 1 done │ Σ 1.42M tok · $3.17
│ ▸ AuthLoader   · wire JWT flow into session middleware   42🔧  18 req  61.3%/200K  $1.04  zai/glm-5.2
│ ▸ IndexRebuild · reindex corpus under new shard schema   29🔧  11 req  12.7%/1M    $0.38  anthropic/claude…
│ ▸ TestGen      · generate edge-case suite for parser     17🔧   7 req   4.1%/1M    $0.09  zai/glm-5.2
│ ⏸ RateWatch    · retry-after 429                          3🔧   1 req   0.9%/200K  $0.02  zai/glm-5.2 (retry 2/5)
│ ✓ LintSweep    · remove dead exports                     88🔧  40 req  88.0%/200K  $1.20  (done 4s)
│   ↳ AuthLoader: writing src/auth/session.ts …
│   ↳ AuthLoader:   - validate expiry before refresh
│ … +2 more (Alt+S for full table)
```

**ASCII mock — zero-agent (always-on idle) state:**
```
┤ Subagents: idle (0 active) · Alt+S to open table
```

### 6.2 (b) Floating full table — `ctx.ui.custom(factory, { overlay: true })` on hotkey

- Opens on **`Alt+S`** (default; see §6.3). Mounted as a bottom-centered, full-width, focusable
  overlay via `TUI.showOverlay` (`omp://tui.md`); closed by `done()` on the same hotkey or
  `Escape`/`app.interrupt`.
- A real `Component` (`render(width)`, `handleInput`, `dispose`) showing **all** live (detached)
  agents in a paginated/scrollable table — no 10-line cap (overlay has full terminal height).
- Columns: status · agent · task · parent · toolCount · req · tokens · `ctx%` · cost · model ·
  duration · last-activity. PgUp/PgDn/↑/↓ scroll; `Enter` could (future) open transcript.

**ASCII mock — overlay table (12 agents, scrolled to top), width ~104:**
```
┌─ Subagents (12 live · 1 done) ───────── ↑↓ scroll · Esc close ──────────────┐
│ ST AGENT         TASK                              PARENT    🔧 REQ  CTX%   $ MODEL       DUR  AGE │
│ ▸  AuthLoader    wire JWT flow into session mid   Main      42  18  61.3% 1.04 glm-5.2    4m12 2s │
│ ▸  IndexRebuild  reindex corpus under new shard   Main      29  11  12.7% 0.38 claude…    3m04 1s │
│ ▸  TestGen       generate edge-case suite parser  LeadDev   17   7   4.1% 0.09 glm-5.2    1m48 0s │
│ ⏸  RateWatch     retry-after 429                  Main       3   1   0.9% 0.02 glm-5.2    0m22 —  │
│ ▸  DocSync       refresh API docs for new routes  DocWorm   11   4   8.0% 0.06 glm-5.2    2m30 3s │
│ ✓  LintSweep     remove dead exports              LeadDev   88  40  88.0% 1.20 glm-5.2    done 4s │
│ ▸  … (+6 more)                                                                         │
└────────────────────────────────────────────────────────────────────────────────┘
```

### 6.3 Hotkey / keybinding registration

- **Mechanism:** `pi.registerShortcut(chord, { description, handler })`. Verified signature:
  `dist/types/extensibility/extensions/types.d.ts:658-662`. The handler opens/closes the overlay
  via `ctx.ui.custom(factory, { overlay: true })`; the overlay `Component.handleInput` closes on
  `Escape` / the same chord / `app.interrupt` (`keybindings.matches(data, "app.interrupt")`).
- **Default chord: `Alt+S`** (mnemonic: Subagents). Chosen because **Alt+S is free** — it is not in
  the reserved list (`ctrl+c/d/z/k/p/l/o/t/g/q`, `alt+m`, `shift+tab`, `shift+ctrl+p`, `alt+enter`,
  `escape`, `enter`; `omp://extensions.md` §Constraints) nor in the default keymap
  (`omp://keybindings.md`). Alt-chords also avoid readline/editor-editing collisions (the editor
  intercepts and forwards "extension custom keys").
- **Configurability:** override via env `OMP_SUBAGENT_PANEL_KEY` (a chord string). If the harness
  exposes the shortcut as a remappable action id in `~/.omp/agent/keybindings.yml` (e.g.
  `app.subagents.toggle`), document that; otherwise the env var is the override (Open Q7).

### 6.4 Redraw cadence (no transcript re-walk)

- **Event-driven:** each `mergeProgress`/`mergeLifecycle` marks the store dirty and requests a
  render. Renders are coalesced by the TUI scheduler; the extension additionally **throttles** its
  own panel re-render to a minimum interval (**`PANEL_MIN_RENDER_MS = 200`**) to avoid repaint
  storms under the 150 ms progress-coalesce burst.
- **Elapsed-time tick:** a **1 s** interval bumps `durationMs`-derived displays (and re-sorts
  running-first). It calls **`requestComponentRender(panelComponent)` only** — a component-scoped
  redraw that, per `omp://tui-runtime-internals.md`, repaints just the requesting root subtree and
  reuses every other row without re-walking the transcript. It **MUST NOT** call
  `requestRender(true)` (forced full repaint).
- **Invariant:** no render path touches the session transcript / `sessionManager.getBranch()` /
  `history://` / `artifact://` for live updates. Those are read-once (if ever) for optional
  enrichment, never on tick.

---

## 7. LIFECYCLE & CLEANUP

- **Activation (`pi.on("session_start")`):** if `ctx.hasUI === false` → **no-op** (headless /
  subagent / print / ACP-stubbed paths; `omp://extensions.md` §"Print/headless/subagent paths",
  `omp://tui.md` mode table). Otherwise:
  1. `new SubagentStore()`.
  2. Subscribe the three channels on `pi.events`, keeping the **unsubscribe handles**.
  3. Mount the persistent panel via `ctx.ui.setWidget(...)` and keep a reference to the panel
     `Component` (for `requestComponentRender`).
  4. Start the 1 s tick interval; keep its `Timeout` handle.
  5. `pi.registerShortcut("Alt+S", { handler: toggleOverlay })`.
  6. Render an initial frame (zero-agent idle line, then live rows as frames arrive).
- **Teardown (`pi.on("session_shutdown")` + module `dispose()`):**
  1. Call every stored `pi.events.off` handle (unsubscribe all three channels).
  2. `clearTimeout`/`clearInterval` the tick.
  3. `store.dispose()`.
  4. Clear the widget (`ctx.ui.setWidget([])` or the documented clear) and close any open overlay.
- **Guarantee:** after dispose, **zero** listeners remain on `pi.events`, **zero** timers are
  pending, and no overlay is mounted. (AC-9.)
- **Scope:** all UI hooks are **interactive-TUI only**. RPC mode: `custom()` is unsupported and
  returns `undefined as never` (`omp://tui.md`); the extension guards with `ctx.hasUI` and degrades
  to a no-op (it never depends on interactive UI in RPC/headless handlers).

---

## 8. EDGE CASES

| Case | Policy |
|---|---|
| **Many concurrent agents > 10-line cap (persistent panel)** | Show top-K running rows (sorted running-first then `lastEventAtMs` desc) that fit in the ≤10-line budget; reserve the final line for `… +R more (Alt+S for all)`. The **overlay** has no cap — it paginates/scrolls the full list (PgUp/PgDn). |
| **Overflow in overlay** | Overlay uses a virtualized/scrollable list (e.g. `SelectList`-style) with a scroll cursor; never truncates data, only the viewport. |
| **Parked / idle agents** | Render with a dim `⏸`/idle icon; keep in the store; do not evict (they can be revived). Sorted after running agents. |
| **Agents that finish** | On terminal lifecycle status (`completed`/`failed`/`aborted`): **freeze** the final stat snapshot (`finishedAtMs`, no further merges), mark with `✓`/`✗`/`⊘` icon, retain for `finishedTtlMs` (default **30 000 ms**), then `sweep()` evicts. TTL configurable via `OMP_SUBAGENT_PANEL_DONE_TTL_MS`. |
| **Terminal-width safety** | Every emitted line passes through `truncateToWidth(replaceTabs(line), width)`; column widths are computed from `width` via `visibleWidth`; below a minimum width (e.g. < 60 cols) the panel collapses to fewer columns (status · agent · toolCount · ctx%). No line may exceed `width`. Validated at 80/120/200 cols. |
| **Zero agents running** | Always-on but unobtrusive: render the single idle line `┤ Subagents: idle (0 active) …` (§6.1 mock). Configurable to hide-when-empty via `OMP_SUBAGENT_PANEL_HIDE_EMPTY=1` (Open Q2). Overlay shows `No active subagents`. |
| **Live fields undefined (agent just started, pre-first-turn)** | Render gracefully: omit the `ctx%` gauge and `model` when `contextTokens`/`resolvedModel` are undefined — never print `NaN`/`undefined`/`Infinity`. (AC-10.) |
| **Rate-limited child** | Surface `retryState`/`retryFailure` inline (`⏸ retry 2/5` / `✗ rate-limited`) so the panel never looks "stuck in progress" — matches the payload's intent (`task/types.ts:295-318`). |
| **Sync vs detached spawns** | Default **detached-only** visibility, matching the built-in HUD ("surfaces like the subagent HUD only list detached spawns", `task/types.ts:68-74`). Include sync spawns with `OMP_SUBAGENT_PANEL_SHOW_SYNC=1` (Open Q3). |
| **Hotkey pressed while overlay open** | Toggle: same chord / `Esc` closes via `done()`. Editor typing is unaffected (the overlay is focused only while open). |
| **Re-entry / multiple `setWidget` extensions** | If another extension also uses `setWidget(aboveEditor)` it may contend for the same hook-widget container. Document as a known constraint; the placement toggle (`belowEditor`) is the workaround. |

---

## 9. ACCEPTANCE CRITERIA (testable; for Validator)

Each AC names the verifiable signal. (Implementation-time tests are MidDev's; these are the
contract the Validator audits.)

1. **Spawn → row appears fast.** On a `task:subagent:lifecycle` (`status:"started"`) frame, a new
   row for that `id` is present in the next coalesced render (≤ `PANEL_MIN_RENDER_MS + 1 frame`
   ≈ 250 ms). *Signal:* the rendered `setWidget` array contains a line beginning with the agent's
   status icon + agent name.
2. **Live stats mirror the payload.** After a `task:subagent:progress` frame, the row's
   `toolCount`, `tokens`, `contextTokens`, `contextWindow`, `cost`, `durationMs`, `resolvedModel`,
   `recentOutput` equal the corresponding `AgentProgress` fields. *Signal:* store snapshot equals
   payload-derived expectation within one render.
3. **Tool-count is native & monotonic.** The displayed tool-call count equals
   `AgentProgress.toolCount` (NOT a manual event count) and is non-decreasing while running.
   *Signal:* counter matches payload; an injected extra `task:subagent:event` with no progress
   frame does NOT bump the displayed count (it is not the source of truth).
4. **Overlay opens on hotkey, lists all.** `Alt+S` opens `ctx.ui.custom({overlay:true})`; the
   overlay lists **every** live (detached) agent in the store (no 10-line truncation); closing it
   (`Alt+S`/`Esc`) returns focus to the editor without error. *Signal:* overlay `Component.render`
   emits one row per store row; `done()` resolves.
5. **No full-transcript re-walk on tick.** The 1 s elapsed-time tick calls only
   `requestComponentRender(panelComponent)` and **never** `requestRender(true)`; no render path
   reads `sessionManager.getBranch()`/`history://`/`artifact://` for live updates. *Signal:* tick
   fires with the transcript untouched; a spy on forced render shows zero tick-driven forced
   repaints.
6. **10-line cap honored.** With >K running agents, the persistent `setWidget` array length is
   ≤10 and ends with an overflow line naming the remaining count; the overlay is not capped.
   *Signal:* `setWidget` arg length ≤10 for any agent count.
7. **Width-safe rendering.** For `width ∈ {80,120,200}`, every line in both surfaces satisfies
   `visibleWidth(line) ≤ width`; no raw tabs; no line exceeds width. *Signal:* render-output
   assertion across the three widths.
8. **Zero-agent state.** With an empty store, the panel renders ≤1 idle line (or hides per
   `OMP_SUBAGENT_PANEL_HIDE_EMPTY`); the overlay renders `No active subagents`. *Signal:* no crash;
   ≤1 panel line; defined empty string.
9. **Clean dispose / no leak.** After `session_shutdown`/`dispose`: all three channel subscriptions
   are removed from `pi.events`, the tick timer is cleared, the widget is cleared, and any overlay
   is closed. *Signal:* listener-count delta = 0 across activate→dispose; no pending timers.
10. **Graceful field absence.** When `contextTokens`/`contextWindow`/`resolvedModel` are undefined
    (pre-first-turn agent), no `NaN`/`undefined`/`Infinity` appears in the output; the gauge and
    model are omitted. *Signal:* rendered string contains none of those tokens.
11. **Headless no-op.** When `ctx.hasUI === false`, activation subscribes nothing, mounts nothing,
    registers no shortcut, starts no timer. *Signal:* zero side effects on `pi.events`/timers/widget.
12. **Complements, does not replace.** No code path calls any API that replaces the built-in
    `subagentContainer`/`statusLine` renderers (no such API is used); the extension only ever calls
    `setWidget`, `custom({overlay:true})`, `setStatus` (optional), and `requestComponentRender`.
    *Signal:* static review — only the additive APIs appear.
13. **Final snapshot + TTL.** On terminal lifecycle status, the row freezes its stats and is removed
    `finishedTtlMs` later; re-render after eviction no longer lists it. *Signal:* row absent after
    TTL; stats unchanged between terminal frame and eviction.

---

## 10. RISKS & OPEN QUESTIONS

### 10.1 Risks (blocking-ness noted)

- **R1 — Above-editor widget contention (LOW).** `setWidget({aboveEditor})` shares the
  `hookWidgetContainerAbove` lane; another extension using it, or visual stacking with the built-in
  `subagentContainer` HUD, may look busy. *Mitigation:* compact summary row + `belowEditor` toggle.
- **R2 — Render-storm under progress burst (LOW).** 150 ms progress-coalesce can fire rapidly with
  many agents. *Mitigation:* `PANEL_MIN_RENDER_MS=200` throttle + component-scoped
  `requestComponentRender` (never forced repaint).
- **R3 — `registerShortcut` remap semantics (LOW).** The signature is verified, but whether the
  harness exposes the extension shortcut as a `keybindings.yml`-remappable action id is unverified.
  *Mitigation:* `OMP_SUBAGENT_PANEL_KEY` env override is the guaranteed path; document action-id
  remap if present. (Open Q7.)
- **R4 — Live-field population depends on child emitting `message_end` (LOW).** `contextTokens`/
  `resolvedModel` are undefined until the child's first provider turn. *Mitigation:* graceful
  absence (AC-10); not a correctness risk.
- **R5 — In-process IRC-registry accessor unverified (LOW).** `displayName`/`parent`/`unread`
  enrichment needs an accessor the extension API may not expose. *Mitigation:* default omits those;
  identity derived from payloads. (Open Q6.)

### 10.2 Open questions for Elon (non-blocking; defaults assumed)

> Each has a reasoned default marked **[assumption]**; the spec does not block on any.

- **Q1 — Default hotkey.** I assumed **`Alt+S`** (free in the reserved list and default keymap;
  Alt-chords avoid editor collisions). Confirm or choose another.
  *[assumption: `Alt+S`; override via `OMP_SUBAGENT_PANEL_KEY`.]*
- **Q2 — Empty-state behavior.** "Always-on" interpreted as a persistent 1-line idle indicator
  when zero agents run. Alternative: hide when empty. *[assumption: 1-line dim idle; hide via
  `OMP_SUBAGENT_PANEL_HIDE_EMPTY=1`.]*
- **Q3 — Sync vs detached scope.** Default **detached-only** (matches built-in HUD semantics).
  Include synchronous spawns too? *[assumption: detached-only; sync via
  `OMP_SUBAGENT_PANEL_SHOW_SYNC=1`.]*
- **Q4 — Finished-row retention TTL.** *[assumption: keep frozen row 30 s, then evict; via
  `OMP_SUBAGENT_PANEL_DONE_TTL_MS`.]*
- **Q5 — Panel placement.** *[assumption: `aboveEditor`; toggle to `belowEditor` via
  `OMP_SUBAGENT_PANEL_PLACEMENT`.]*
- **Q6 — In-process registry accessor for irc fields (displayName/parent/unread).** Does the
  extension API expose the live IRC/agent registry for direct read? *[assumption: not exposed;
  derive identity from event payloads; omit irc-only fields until/unless an accessor is found.]* —
  a small follow-up DrPe check could confirm.
- **Q7 — Shortcut remappability.** Does `pi.registerShortcut` also register a `keybindings.yml`
  action id (e.g. `app.subagents.toggle`)? *[assumption: env override is primary; action-id remap
  documented if the harness exposes it.]*

---

## 11. Environment variables (config surface summary)

| Var | Default | Effect |
|---|---|---|
| `OMP_SUBAGENT_PANEL_KEY` | `Alt+S` | Overlay toggle chord |
| `OMP_SUBAGENT_PANEL_PLACEMENT` | `aboveEditor` | `aboveEditor` \| `belowEditor` |
| `OMP_SUBAGENT_PANEL_HIDE_EMPTY` | unset | `1` hides panel when zero agents |
| `OMP_SUBAGENT_PANEL_SHOW_SYNC` | unset | `1` includes synchronous spawns |
| `OMP_SUBAGENT_PANEL_DONE_TTL_MS` | `30000` | Frozen finished-row retention |
| `OMP_SUBAGENT_PANEL_MIN_RENDER_MS` | `200` | Panel re-render throttle |

---

## 12. Implementation hand-off note (for MidDev, post-approval)

- **Single new file:** `src/subagent-panel.ts`; append to `package.json#omp.extensions` (§4.3).
- **Pattern to copy:** `src/enforce-orchestrator.ts` (default export, `import type { ExtensionAPI }`,
  `ctx.hasUI` guard, env-driven config read once at module load).
- **Verified API refs:** `pi.events.on/off`, `pi.on("session_start"|"session_shutdown")`,
  `pi.registerShortcut` (`dist/types/extensibility/extensions/types.d.ts:658-662`),
  `ctx.ui.setWidget(lines,{placement})`, `ctx.ui.custom(factory,{overlay:true})`,
  `requestComponentRender(component)`, render primitives from `@oh-my-pi/pi-tui`.
- **Verified type refs:** `AgentProgress` (`task/types.ts:258-327`), `SubagentProgressPayload`
  (`:38-50`), `SubagentLifecyclePayload` (`:58-75`), `SubagentEventPayload` (`:52-56`), channel
  constants (`:29-36`).
- **Stat-line format to mirror:** `task/render.ts:79-114` + `formatContextUsage`
  (`modes/components/status-line/context-thresholds.ts:59-63`).
- **Non-goals (do NOT touch):** the built-in `subagentContainer` HUD, `statusLine`, Agent Hub,
  `collab-web`, any harness core file under `node_modules/`. This extension is purely additive.
