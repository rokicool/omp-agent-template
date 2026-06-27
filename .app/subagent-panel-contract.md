# Verified Implementation Contract — `src/subagent-panel.ts`

All facts below are VERIFIED against the installed package
(`node_modules/@oh-my-pi/pi-coding-agent@^16`, `@oh-my-pi/pi-tui`, `@oh-my-pi/pi-utils`).
Implement EXACTLY against these signatures; do not re-derive or guess.

## 1. Module shape (copy `src/enforce-orchestrator.ts` idiom)
- `import type { ExtensionAPI } from "@oh-my-pi/pi-coding-agent";`
- `export default function subagentPanel(pi: ExtensionAPI): void { ... }`
- Read env config ONCE at module top-level (before the default export), like
  `enforce-orchestrator.ts` reads `OMP_*` consts.
- `import type` is erased at runtime → fine under omp.

## 2. Verified imports
```ts
import type { ExtensionAPI } from "@oh-my-pi/pi-coding-agent";
import {
  TASK_SUBAGENT_LIFECYCLE_CHANNEL,
  TASK_SUBAGENT_PROGRESS_CHANNEL,
  TASK_SUBAGENT_EVENT_CHANNEL,
} from "@oh-my-pi/pi-coding-agent/task";
import type {
  AgentProgress,
  SubagentProgressPayload,
  SubagentLifecyclePayload,
  SubagentEventPayload,
} from "@oh-my-pi/pi-coding-agent/task";
import { truncateToWidth, replaceTabs, visibleWidth, matchesKey } from "@oh-my-pi/pi-tui";
import type { Component, KeyId, TUI } from "@oh-my-pi/pi-tui";
import { formatNumber } from "@oh-my-pi/pi-utils";
```
- DO NOT import `AgentSource` (not re-exported from `/task`). Type `agentSource` as
  `AgentProgress["agentSource"]` (= `"bundled" | "user" | "project`").
- DO NOT import `Theme` (factory params are contextually typed; you don't need the name).

## 3. EventBus (pi.events) — VERIFIED
```ts
// node_modules/@oh-my-pi/pi-coding-agent/src/utils/event-bus.ts
class EventBus {
  emit(channel: string, data: unknown): void;
  on(channel: string, handler: (data: unknown) => void): () => void; // RETURNS UNSUBSCRIBE fn
  clear(): void;
}
```
- There is NO `.off`. Keep the 3 unsubscribe functions returned by `on(...)` in an array;
  call each on teardown. Subscribe on `pi.events` (NOT on `ctx`).

## 4. Payloads — VERIFIED field locations (critical nuance)
```ts
// SubagentLifecyclePayload  — HAS .id
{ id: string; agent: string; agentSource; description?: string;
  status: "started" | "completed" | "failed" | "aborted";
  sessionFile?: string; parentToolCallId?: string; index: number; detached?: boolean; }

// SubagentProgressPayload  — NO top-level .id; id lives on .progress.id
{ index: number; agent: string; agentSource; task: string; parentToolCallId?: string;
  assignment?: string; progress: AgentProgress; sessionFile?: string; detached?: boolean; }

// SubagentEventPayload  — HAS .id
{ id: string; event: AgentSessionEvent; }   // only .id is needed (noteEvent)

// AgentProgress  (VERIFIED, task/types.ts:258-327)
{ index; id: string; agent; agentSource; status: "pending"|"running"|"completed"|"failed"|"aborted";
  task; assignment?; description?; lastIntent?; currentTool?; currentToolArgs?;
  currentToolStartMs?; recentTools: Array<{tool;args;endMs}>; recentOutput: string[];
  toolCount: number; requests: number; tokens: number; contextTokens?: number;
  contextWindow?: number; cost: number; durationMs: number; modelOverride?; resolvedModel?;
  extractedToolData?; retryState?: {attempt;maxAttempts;delayMs;errorMessage;startedAtMs};
  retryFailure?: {attempt;errorMessage}; inflightTaskDetails?; }
```
- id accessor: lifecycle → `p.id`; progress → `p.progress.id`; event → `p.id`.

## 5. ExtensionContext (`ctx`, 2nd arg of handlers) — VERIFIED
```ts
interface ExtensionContext {
  hasUI: boolean;
  cwd: string;
  ui: {
    setWidget(key: string,
              content: string[] | ((tui: TUI, theme: unknown) => Component & { dispose?(): void }) | undefined,
              options?: { placement?: "aboveEditor" | "belowEditor" }): void;
    custom<T>(factory: (tui: TUI, theme: unknown, keybindings: unknown,
                        done: (result: T) => void)
                        => (Component & { dispose?(): void }) | Promise<Component & { dispose?(): void }>,
              options?: { overlay?: boolean }): Promise<T>;
    setStatus(key: string, text: string | undefined): void;
    // ... more, unused
  };
  // ... more, unused
}
```
- `setWidget` takes a KEY string first. To clear: `ctx.ui.setWidget(KEY, undefined)`.
- The widget content factory `(tui, theme) => component` gives you the `tui` reference —
  CAPTURE it (needed for `requestComponentRender`). Also capture the returned component.

## 6. pi methods — VERIFIED
```ts
pi.setLabel(label: string): void;
pi.on("session_start",  (event, ctx) => void | Promise<void>): void;
pi.on("session_shutdown",(event, ctx) => void | Promise<void>): void;
pi.registerShortcut(shortcut: KeyId,
                    options: { description?: string; handler: (ctx) => void | Promise<void> }): void;
pi.events: EventBus;   // see §3
```
- `registerShortcut` has NO actionId / keybindings.yml param. (Q7 verdict: env override is primary.)

## 7. TUI + Component + primitives — VERIFIED (all from `@oh-my-pi/pi-tui`)
```ts
interface Component {
  render(width: number): readonly string[];   // MUST return string[] (assignable to readonly)
  handleInput?(data: string): void;           // optional
  dispose?(): void;                           // optional, must be idempotent
}
class TUI {
  terminal: { rows: number; columns: number; ... };
  requestComponentRender(component: Component): void;  // CALL ONLY THIS
  requestRender(force?: boolean, options?: unknown): void; // NEVER CALL (AC-5)
}
truncateToWidth(text: string, maxWidth: number, ellipsisKind?: unknown, pad?: boolean | null): string;
replaceTabs(text: string, file?: string): string;
visibleWidth(str: string): number;   // terminal columns, ANSI-stripped, tab+wide aware
matchesKey(data: string, keyId: KeyId): boolean;  // raw input vs "escape"|"up"|"down"|"pageUp"|"pageDown"|"home"|"end"|"q"|"alt+s" ...
type KeyId = string; // template union; cast env string `as KeyId` when calling registerShortcut/matchesKey
```
- After a focused component's `handleInput`, the TUI auto-renders — you do NOT call render yourself
  inside `handleInput`.

## 8. Q6 verdict (VERIFIED): NO in-process IRC/agent-registry accessor is exposed on
ExtensionAPI or ExtensionContext (only `memory?`, `sessionManager`, `modelRegistry`, `models`).
→ Keep SPEC default: derive identity from payloads; OMIT irc-only fields (displayName/parent/unread).
Do not attempt any registry lookup.

## 9. Stat-line format to mirror (task/render.ts:79-114 + formatContextUsage)
- Per-agent row: `<icon> <agent> · <task…>   <toolCount>🔧  <N> req  <pct>%/<window>  $<cost>  <model?>`
- context gauge = `${(contextTokens/contextWindow*100).toFixed(1)}%/${formatNumber(contextWindow)}`
  — OMIT entirely when contextTokens/contextWindow missing or <=0 (never NaN/Infinity/undefined).
- Use `formatNumber` from pi-utils for tokens/window compaction (1K/1.5M/200K/1M…).
