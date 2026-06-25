# SPEC — Subagent Execution Visibility (Native supaterm Tabs)

> **Author:** LeadDev (Visibility architect) · **Date:** 2026-06-24
> **Status:** DESIGN — specification / proposal only. **No implementation code, manifest, or
> harness file is produced or modified by this document.** DEVELOP is explicitly gated on the
> operator approving this proposal (see §15 "Single decision to confirm").
> **Phase:** SPEC (input to the operator approval gate, then DEVELOP ⇄ VALIDATE → DONE).
>
> **Sources.** `.app/REQ.md` (LOCKED) is authoritative for WHAT; `.app/RESEARCH.md` (DrPe) is
> authoritative for feasibility/mechanism. Citation conventions:
> - **[REQ §X]** — a section/item of `.app/REQ.md` (e.g. `[REQ FR-1]`, `[REQ INV-2]`, `[REQ AC4]`).
> - **[RESEARCH F1.3]** — a numbered finding in `.app/RESEARCH.md`.
> - **[omp://X]** — a primary oh-my-pi harness doc read during SPEC verification.
> - **[SUP how-socket]** / **[SUP coding-agents]** — supaterm primary docs (raw GitHub).
> - **[INFERENCE]** — a claim grounded by reasoning rather than a directly-verified source; all
>   such claims are re-listed in §14 (Open items / verification notes) with a confidence level.

---

## 0. Binding inputs (what this SPEC is authored to)

REQ is LOCKED. The design posture below is **not re-opened** here — it is the frame the design
satisfies. Every row traces to a REQ invariant or locked decision.

| # | Locked posture (from REQ) | Where realized in this SPEC |
|---|---|---|
| L1 | **Relay, not capture** (INV-1). omp already produces a live per-subagent transcript; the feature consumes an *existing* surface, adds no new capture backend. | §3, §4 (source = EventBus + `<id>.jsonl`), §12 (AC9) |
| L2 | **Key on `agentId`, never PID** (INV-2). Subagents are in-process `AgentSession`s; "one tab per agent" is the correct unit. | §5 (TabRegistry keyed on agentId), §7 (lifecycle), §12 (AC7) |
| L3 | **No core fork; harness-integrated** (INV-3, FR-7). Delivered by EXTENDING the shipped `pi-notify-supaterm` extension (already maps agent↔surface + forwards Pi events). | §3, §6 (module = extension), §12 (AC6) |
| L4 | **supaterm-native primary** (INV-4, FR-1). Native terminal tabs across the top, one per agent, labeled with agent id/role — NOT tiling panes. tmux bridge = SHOULD fallback (FR-10). | §4 (primary), §8 (tmux fallback) |
| L5 | **Live AND rewindable review** (Temporal+Retention MUST); tab survives agent end (FR-5, T1 resolved). | §7 (lifecycle: survive-end), §15 (cleanup policy = the one decision to confirm) |
| L6 | **Read-only + stop/cancel** (FR-6). Stop/cancel reuses the existing job-cancel mechanism → agent `aborted`; tab reflects it. No free-text injection in v1. | §9 (interactivity), §11.3 (E3) |

---

## 1. Situation

When the oh-my-pi (omp) orchestrator fans work out to subagents via `task`, those subagents run as
**in-process child `AgentSession`s** — each with its own `agentId`, lifecycle, and a live
transcript that omp **already produces** on disk (`<id>.jsonl` appended live, `<id>.md` final) and
on the parent `EventBus` (`task:subagent:event/progress/lifecycle`) [RESEARCH F3.1–F3.6,
omp://tools/task.md]. The operator gets a *summary* when a subagent yields, and can dig into
`history://<id>` / `agent://<id>` **inside** the omp process — but there is no live, at-a-glance
per-agent view that survives the agent's lifetime, and the operator cannot watch 2–4 agents work in
parallel without losing the main thread.

supaterm (libghostty + a Unix-socket `sp` IPC CLI) is the operator's terminal and already ships an
omp extension, `pi-notify-supaterm`, that maps an omp session to a supaterm surface and forwards Pi
lifecycle events into *tab activity / notifications* (running/idle/needs-input + desktop pings)
[RESEARCH F1.5, F4.2, SUP coding-agents]. What is missing is wiring the **full per-subagent
transcript into a dedicated, labeled native tab per agent** — streaming live and staying open for
review after the agent ends — using primitives supaterm already exposes (`new_tab`, `rename_tab`,
`send_text`, `close_tab`, `notify`) [SUP how-socket].

**This SPEC proposes extending `pi-notify-supaterm` from notification-only to a full per-subagent
tab relay**, with a tmux bridge as the documented portable fallback. It consumes output omp already
produces (relay, not capture), keys every mapping on `agentId` (not PID), and modifies no omp core
file. The deliverable of this round is the **design**; implementation is gated on operator approval.

---

## 2. The five gaps — resolution table

REQ handed five verification gaps (G1–G5) for SPEC to resolve or carry forward. All five are
resolved below; confidence and the primary source are stated for each.

| Gap | Question | Resolution | Confidence | Source / note |
|---|---|---|---|---|
| **G1** | Does `sp new_tab` set an explicit tab **title**? (affects the MUST label w/ agent id/role) | **RESOLVED — yes, via a distinct method.** `terminal.new_tab` returns a typed `tabID` (creation commands "return typed IDs: `spaceID`, `tabID`, and `paneID`"); `terminal.rename_tab` is a listed method family that sets the title. **Labeling = `new_tab` → capture `tabID` → `rename_tab(tabID, "<agentId> · <role>")`.** No extra notify step required. | **High** | [SUP how-socket] "Method Families" lists `terminal.new_tab`, `terminal.rename_tab`; "Terminal Topology" → "Creation commands return typed IDs". [RESEARCH F1.3] |
| **G2** | RPC subagent frame payload schemas (`set_subagent_subscription` / `get_subagent_messages{fromByte}` / `subagent_*` frames) | **PARTIALLY RESOLVED (sufficient for design).** Exact command/seek schemas confirmed: `set_subagent_subscription{level:"off"\|"progress"\|"events"}`, `get_subagent_messages{subagentId?,sessionFile?,fromByte?}` (pass `fromByte`, advance per poll → seekable tail), and `subagent_lifecycle`/`subagent_progress`/`subagent_event` are subscription-gated push frames. **The per-frame *field* payloads are NOT documented** (rpc.md lists frame types, not bodies). **Design consequence:** pushed frames are treated as *wake-signals* (lifecycle/progress); the authoritative *content* is the seekable `get_subagent_messages{fromByte}`. This removes the Medium-confidence payload dependency entirely. | **High** on command/seek contract; **Medium** on frame bodies (no longer load-bearing) | [omp://rpc.md] "Command Schema: State", "Outbound frame category 10". [RESEARCH F3.5] |
| **G3** | macOS TCC permission surface per mechanism (socket IPC vs AppleScript vs tmux) — pick the non-prompting path for the primary | **RESOLVED — socket IPC is non-prompting.** supaterm socket IPC is a same-user Unix-domain socket spoken by the bundled `sp` CLI; it is **not** AppleScript Automation and triggers **no TCC Automation prompt**. Strong evidence: the shipping `pi-notify-supaterm` extension already calls `sp` from inside omp today with no permission grant. tmux likewise needs **no** TCC prompt [RESEARCH F2.1]. Only Ghostty's *AppleScript* path prompts (TCC Automation) [RESEARCH F2.3]. **→ Primary (supaterm socket) and fallback (tmux) are both non-prompting (FR-12 met).** | **High** (socket/tmux non-prompting, evidenced by the shipping extension) | [SUP coding-agents] (extension calls `sp` today); [RESEARCH F2.1, F2.3]; `[INFERENCE]` flagged in §14 |
| **G4** | Prior-art confidence is Medium (DrPe `web_search` quota error) | **CARRIED FORWARD — informational only.** Not load-bearing for this design: the relay pattern is grounded in omp's own Agent Hub/Collab (first-party, High) [RESEARCH F4.1] and supaterm's shipping agent-pane model (High) [RESEARCH F4.2]. Third-party breadth stays Medium; does not block any AC. | Medium (informational) | [RESEARCH F4.3, "Could not verify"] |
| **G5** | Ghostty read-back / CLI limits → justify tmux as recommended fallback | **RESOLVED — tmux is the fallback, Ghostty is not.** Ghostty (1.3.0+) is AppleScript-only (paste-style `input text`), has **no socket CLI and no pane read-back/capture**, and triggers a TCC Automation prompt [RESEARCH F2.3, G5]. It therefore fails live-streaming + non-prompting + review. **tmux** (`pipe-pane -I`, `send-keys -l`, `pane_dead*` lifecycle, no TCC) is the documented portable fallback (FR-10). Ghostty is listed in §13 only as a non-recommended option. | **High** | [RESEARCH F2.1, F2.3, G5] |

---

## 3. Architecture overview

### 3.1 Component graph

```
                     oh-my-pi PARENT process  (interactive TUI session; runs inside a supaterm pane)
 ┌──────────────────────────────────────────────────────────────────────────────────────────────┐
 │  TaskTool / executor                                                                         │
 │   ├─ in-process child AgentSession(s)  ── keyed on agentId, bounded by Semaphore(maxConc) ──┐ │
 │   ├─ AgentRegistry:  running | idle | parked | aborted   (isolated = parked w/o reviver)    │ │
 │   ├─ EventBus ──► task:subagent:{ lifecycle · progress · event }  ──────────────────────┐  │ │
 │   └─ artifacts dir:  <ts>_<sessionId>/  →  <agentId>.jsonl (LIVE, appended) · <agentId>.md│  │ │
 │                                                                                          ▼  ▼ │
 │  ┌────────────────────────────────────────────────────────────────────────────────────────┐ │
 │  │  pi-notify-supaterm   (EXTENDED  +  SubagentTabRelay)                                   │ │
 │  │                                                                                         │ │
 │  │   pi.events.on("task:subagent:*")  ──►  TabController                                    │ │
 │  │       lifecycle  → create tab · rename · mark state · (survive end | close on cleanup)  │ │
 │  │       event      → render rich text (reuse omp renderer) · stream delta                 │ │
 │  │       progress   → status badge / progress line                                         │ │
 │  │                                                                                         │ │
 │  │   TabRegistry :  agentId ──► { tabId, paneId, status, fromByte, sessionId, startedAt }   │ │
 │  │                                                                                         │ │
 │  │   SurfaceBackend (strategy):                                                            │ │
 │  │      ┌─ SupatermBackend  (primary)  ── pi.exec("sp ...")                                │ │
 │  │      └─ TmuxBackend      (fallback) ── pi.exec("tmux ...")   (when sp socket unreachable)│ │
 │  └──────────────────────────────────────┬──────────────────────────────┬───────────────────┘ │
 └─────────────────────────────────────────┼──────────────────────────────┼─────────────────────┘
                                           ▼                              ▼
                 supaterm app (Unix-socket `sp` CLI)            tmux server (detached session)
                 space 1 ─► TAB 1/2 ─► pane                      session omp-agents ─► window per agentId
                 new_tab · rename_tab · send_text                new-window -n <agentId> · send-keys -l
                 close_tab · notify · capture_pane               pipe-pane -I · kill-window · pane_dead*
```

### 3.2 Data flow (one agent, end to end)

1. **Spawn.** A `task` batch registers one async job per spawn; jobs sit `queued:true` until the
   session `Semaphore` (`task.maxConcurrency`) admits them [omp://tools/task.md Flow]. The relay
   does **nothing** for queued jobs (FR-8 / AC8: no phantom tabs).
2. **Admitted → `running`.** When a job body actually starts the child session, the executor emits
   `task:subagent:lifecycle` (start, carrying `agentId`, `role`, `sessionId`). The extended
   extension's `TabController` receives it.
3. **Tab create + label.** `TabController` picks the active `SurfaceBackend` (supaterm primary;
   tmux if `sp` is unreachable / env absent) and calls `createTab(agentId, role)` → backend issues
   `sp tab new --in <space> --cwd <artifactDir> -- <holder>` (or tmux `new-window -n`), captures the
   returned `tabID` (+ its first `paneID`), then `rename_tab(tabID, "<agentId> · <role>")`. It
   records `agentId → TabRecord` in `TabRegistry`.
4. **Stream.** On each `task:subagent:event` (text/tool deltas) the controller renders the delta to
   **rich text reusing omp's existing renderer** (color, status, progress, section markers) and
   appends it to the tab via `sp pane send` (supaterm) / `tmux send-keys -l` (tmux). Bytes are pushed
   in event order, unbatched, near-real-time (NFR-1). ANSI escapes are interpreted by the pane →
   color; the holder is a no-echo stdin-echo process so bytes render verbatim, not as commands.
5. **Idle / park / revive.** Lifecycle transitions update the tab label suffix / a status line
   (`running` → `idle` → `parked`), stop the heartbeat, but **keep the tab open** (FR-5). On revive
   (irc/Hub), the existing `agentId → tabId` mapping is reused (no duplicate tab) (FR-4 / AC7).
6. **End / abort / isolated.** On `agent_end` the tab receives a final marker line
   (`[ended · idle]` / `[ended · parked]` / `[ended · isolated — not revivable]`) and **survives**.
   On cancel, the executor lands the agent `aborted`; `task:subagent:lifecycle` reflects it; the
   tab is relabeled `[ABORTED] <agentId> · <role>` and streaming stops, transcript left for review
   (FR-6 / AC4). An *isolated* run is non-revivable; its tab stays readable (FR-9 / E4).
7. **Review / rewind.** The tab's accumulated scrollback **is** the review buffer after end (AC3).
   For true rewind (e.g., the tab was closed/supaterm restarted), the durable source is the
   persisted `<agentId>.jsonl` / `<agentId>.md`; the controller can replay it into a fresh tab from
   `fromByte=0`. The relay never re-captures — it reads what omp already wrote (INV-1 / AC9).
8. **Cleanup.** Explicit: the operator closes a tab (`close_tab` / `kill-window`); the relay drops
   the `TabRegistry` entry on a `close` signal or on parent-session teardown. **No auto-close on
   agent end** (T1 resolved). An optional TTL is the one operator decision (§15).

### 3.3 agentId ↔ tab mapping (INV-2)

Every mapping is keyed on `agentId`. There is no PID/process key anywhere: subagents are in-process
sessions [RESEARCH F3.1], so "one tab per agent" is literally "one `TabRecord` per `agentId`." The
mapping is held in `TabRegistry` (in-process `Map`) for the parent session's lifetime. This is what
makes idle→park→revive reuse the correct tab with zero PID assumption (AC7).

---

## 4. Mechanism choice with rationale (which live surface feeds the tab)

REQ [INV-1] enumerates three existing live surfaces and **defers selection to SPEC**. Decision:

### 4.1 Primary content + control source — in-process EventBus (`task:subagent:*`)

The tab's **control plane** (when to create/rename/mark/stream/survive/close) and **content plane**
(live deltas) both come from the parent `EventBus`, subscribed via `pi.events.on(...)`:

| EventBus channel | Role in the relay | Source confidence |
|---|---|---|
| `task:subagent:lifecycle` | **Control**: start → create+label tab; idle/park/aborted/revived → relabel + survive; end → final marker. | High [omp://tools/task.md Side Effects] |
| `task:subagent:progress` | **Status badge**: coalesced progress snapshot (150 ms) → status/progress line. | High |
| `task:subagent:event` | **Content**: the live AgentSessionEvents (text deltas, tool execution, …) → rendered + streamed in push order. | High [RESEARCH F3.2] |

**Why EventBus (not the jsonl tail, not RPC) is primary:**

- **Mode-independent in the operator's actual session.** The operator runs the interactive TUI
  (NFR-2, NFR-4). RPC subscription is **only** available under `omp --mode rpc` [RESEARCH F3.5,
  omp://rpc.md] — the operator is *not* in RPC mode (E7). The EventBus fires in **every** mode,
  including interactive TUI, because the executor emits it unconditionally [omp://tools/task.md].
- **Lifecycle-aware by construction.** The lifecycle channel *is* the running/idle/park/aborted/
  revived signal omp already computes [omp://tools/task.md "End-of-run lifecycle"]. Tapping it means
  the tab's state machine is omp's state machine, mirrored — not re-derived from byte diffs.
- **In-process ⇒ can drive `sp`/`tmux`.** The extension runs inside omp and can `pi.exec(...)` the
  terminal CLIs directly [RESEARCH F3.6, omp://hooks.md]. No external bridge process, no second
  transport, no path-resolution hunt for the artifact dir.
- **Rich fidelity for free.** Deltas are the same `AssistantMessageEvent`/tool events omp's own TUI
  renders; the relay **reuses omp's renderer** rather than building one (INV-1 applied to rendering:
  relay, don't re-implement). Color/progress/status/sections come straight from omp's formatting.

### 4.2 Resync / review source — persisted `<agentId>.jsonl` (the INV-1 surface #1)

The on-disk `<agentId>.jsonl` (appended live, full raw also in `<agentId>.md`) is the **durable,
zero-cooperation** source [RESEARCH F3.3, omp://tools/task.md]. It is used for two things, never as
the hot live path:

- **Resync after a gap** (extension late-bound, supaterm was briefly unreachable, a delta was
  dropped): the controller tracks `fromByte` per agent and re-reads the jsonl tail to catch up. This
  is the same seek-and-advance shape as RPC `get_subagent_messages{fromByte}`, just from a file —
  which is exactly why the G2 frame-payload uncertainty is non-load-bearing.
- **Rewind / re-open review** (tab closed, app restarted): replay `<agentId>.jsonl` from
  `fromByte=0` into a fresh tab. The persisted transcript is the source of truth for review (AC3).

> **Note on RPC parity (E7-resilience).** If the operator ever drives omp in `--mode rpc` from an
> external host, the *same* relay logic maps onto `subagent_*` frames + `get_subagent_messages`
> [omp://rpc.md]. The in-process EventBus path is the primary because it matches the operator's
> actual mode; RPC is a transport variant, not a separate design.

### 4.3 Why NOT jsonl-tail as the *hot* live path

A pure `tail -F <id>.jsonl` into a pane (tmux `pipe-pane -I`) is mode-independent and needs zero
harness cooperation — and it **is** the mechanism the tmux fallback leans on (§8) where no in-process
extension is driving the pane. But as the *primary* supaterm path it is weaker: raw JSONL is not
rich (it is `{type:"message_update",…}`), the artifact-dir parent path was not pinned by research
[RESEARCH "Could not verify"], and it carries no lifecycle semantics (idle/park/abort must be
re-derived). The EventBus gives richness + lifecycle + in-process control for free; the jsonl is the
resync/review floor.

### 4.4 Primary terminal mechanism — `sp` socket (`new_tab` + `rename_tab` + `send_text`)

| Step | `sp` call (VERIFIED against `sp --help`) | Returns / effect |
|---|---|---|
| Create | `sp tab new --json --script '<holder>' [--cwd <dir>] [--in <space>]` | JSON `{ tabID, paneID, spaceID, tabIndex, … }` — capture `tabID` + `paneID` (capital `ID`) |
| Label | `sp tab rename "<title>" <tabID>` (title is the FIRST positional; `<tab>` optional second) | sets (locks) tab title (G1) |
| Stream | `sp pane send <paneID> '<chunk>'` (or pipe stdin: `printf '%s' chunk \| sp pane send`; `--newline` optional) | appends verbatim; ANSI→color |
| Badge | `sp pane send` a status line, or `sp tab rename` with a state suffix | status reflected |
| Notify | `sp pane notify --title "<t>" --body "<msg>" <paneID>` (NOT a top-level `sp notify`) | desktop/notification via the pane |
| Close | `sp tab close <tabID>` | explicit cleanup only |

> **C2 note.** Every `sp`/`tmux` invocation goes through `pi.exec(command, args[])` as an
> **argv array** — e.g. `pi.exec("sp", ["tab","new","--json","--script",holder])` — never a
> shell string. `sp` is resolved from `SUPATERM_CLI_PATH` (or PATH); the socket from
> `SUPATERM_SOCKET_PATH`. The holder (below) is passed via `--script` so the tab opens a
> no-echo reader rather than an interactive shell.

**Holder process (mechanism detail, deferred to DEVELOP).** A native tab created with no command
opens an interactive shell, which would interpret streamed bytes as commands. To make `send_text`
*render* rather than *execute*, the tab runs a **no-echo stdin-echo holder** — e.g.
`sh -c 'stty -echo; cat'` — so streamed bytes appear verbatim with ANSI interpreted, and the pane's
scrollback becomes the review buffer. `[INFERENCE]`: this is the standard pty-echo pattern; the exact
holder command and echo handling are implementation choices for MidDev. (Alternative: a per-agent
FIFO + `cat <fifo>` to decouple writer from pty; deferred to DEVELOP as a tunable.)

### 4.5 Concurrency (FR-8, NFR-1)

The relay creates a tab **only on the `lifecycle(start)` event** — i.e., when a job is admitted by
the `task.maxConcurrency` semaphore and the child session actually begins [omp://tools/task.md
Flow/Limits]. Queued jobs emit no such event, so they produce **no tabs** (AC8). Typical 2–4
concurrent agents → 2–4 tabs, one `pi.exec("sp ...")` per delta, unbatched; the relay's work is
purely append-bytes + rename, imposing no measurable parent/subagent impact (NFR-1). Beyond
`maxConcurrency`, no extra tabs appear; the relay simply waits for `lifecycle(start)` per agent.

---

## 5. Data models

### 5.1 `TabRecord` (per agent; value in `TabRegistry`)

```ts
interface TabRecord {
  agentId: string;            // PRIMARY KEY (INV-2). Never a PID.
  role?: string;              // subagent role/oneLineLabel for the tab title
  sessionId: string;          // child session id (for jsonl path / review)
  backend: "supaterm" | "tmux";
  tabId: string;              // supaterm tabID  (supaterm)
  windowId?: string;          // tmux pane_id     (tmux)
  paneId?: string;            // first pane in the tab (supaterm)
  status: AgentTabStatus;     // running | idle | parked | revived | aborted | isolated | ended
  fromByte: number;           // resync cursor into <agentId>.jsonl
  startedAt: number;          // epoch ms (for TTL/cleanup, if enabled)
  endedAt?: number;           // set when agent reaches a terminal/review state
  artifactDir?: string;       // <ts>_<sessionId>/ — for jsonl replay/rewind
}
type AgentTabStatus =
  | "running" | "idle" | "parked" | "revived"
  | "aborted" | "isolated" | "ended";
```

**Invariants on `TabRecord`:** exactly one per `agentId` for the parent session's lifetime; a
revive **mutates `status`/`endedAt` only**, never creates a second record (AC7); `agentId` is the
sole key in every lookup; `fromByte` only moves forward.

### 5.2 `TabRegistry` (parent-session-scoped)

```ts
class TabRegistry {
  private byAgent = new Map<string, TabRecord>();      // agentId -> record
  get(agentId: string): TabRecord | undefined;
  upsert(agentId: string, patch: Partial<TabRecord>): TabRecord;  // revive-safe
  drop(agentId: string): void;                         // explicit close / teardown
  snapshot(): TabRecord[];                             // status table (diagnostics/cleanup)
}
```

### 5.3 `SurfaceBackend` (strategy interface — primary vs fallback)

```ts
interface SurfaceBackend {
  readonly kind: "supaterm" | "tmux";
  available(): Promise<boolean>;                       // socket reachable / tmux present
  createTab(agentId: string, role: string | undefined, cwd: string): Promise<{ tabId: string; paneId?: string }>;
  renameTab(tabId: string, label: string): Promise<void>;
  sendText(target: string, chunk: string): Promise<void>;
  notify(message: string): Promise<void>;
  closeTab(tabId: string): Promise<void>;
}
```

Two implementations: `SupatermBackend` (shells `sp …` via `pi.exec`) and `TmuxBackend` (shells
`tmux …` via `pi.exec`). `TabController` holds one active backend, chosen at first use and switched
on `E1`/`E6` (§8).

### 5.4 Configuration (extension settings — additive, defaults are no-ops)

```ts
interface VisibilityConfig {
  enabled: boolean;                 // master switch (default: true when supaterm env present)
  primaryBackend: "supaterm";      // INV-4 locks this; tmux is automatic fallback
  holderCommand?: string;          // override the no-echo stdin-echo holder (DEVELOP-tunable)
  reviewSurvivesEnd: boolean;      // default true (FR-5 / T1). false => close on agent_end
  reviewTtlMs?: number;            // optional auto-close of ENDED tabs (default: undefined = never)
  renderMode: "rich" | "plain";    // rich = reuse omp renderer (default rich)
}
```

---

## 6. Module breakdown (the extension — LOCKED Path A)

> **Decision (LOCKED by operator): Path A.** The feature is a **NEW, self-contained extension** in
> *this* repo (`omp-agent-gate` → package `omp.extensions`), entry `src/subagent-tabs.ts` registered
> in `package.json#omp.extensions`. It **coexists** with `pi-notify-supaterm` (which lives in a
> separate repo) — it does **NOT** extend or import it (FR-7 / AC6 still hold: no omp core file is
> touched; omp's `task` executor, EventBus, and artifacts are consumed read-only). The earlier
> "extend pi-notify-supaterm" framing (§0 L3, §1) is superseded by this locked decision.

The extension is a single default-export factory `(pi: ExtensionAPI) => void` (same shape as the
repo's existing `src/enforce-orchestrator.ts`), internally decomposed into the sub-modules below.
`pi`-touching units (subscriptions, `pi.exec`) are thin adapters over pure, harness-free logic
(`TabRegistry`, argv builders, `renderEvent`, jsonl rewind, state derivation) so the logic is unit-
testable without a live omp / supaterm session:

| Sub-module | Responsibility | Depends on | Rationale |
|---|---|---|---|
| **`SubagentTabRelay`** (entry) | Registers `pi.events.on(TASK_SUBAGENT_*_CHANNEL)` for lifecycle/progress/event; gates the feature on the supaterm env + `enabled`; owns the per-session `TabRegistry`; routes events to `TabController`. | `pi.events.on`/`pi.exec` (shared bus + exec), env | One subscription point; mirrors the executor's three emission channels (C1). |
| **`TabController`** | State machine: maps each lifecycle transition → backend op (create/rename/mark/stream/survive/close); renders `event` deltas via omp's renderer; updates `TabRecord`. | `TabRegistry`, `SurfaceBackend`, omp renderer | Keeps omp's lifecycle as the source of truth; revive-safe by construction. |
| **`SupatermBackend`** | Implements `SurfaceBackend` over `sp` (`new_tab`/`rename_tab`/`send_text`/`notify`/`close_tab`). | `pi.exec`, `SUPATERM_CLI_PATH` | Primary (INV-4). Non-prompting IPC (G3). |
| **`TmuxBackend`** | Implements `SurfaceBackend` over `tmux` (`new-session -d -s omp-agents`, `new-window -n <agentId>`, `send-keys -l`, `pipe-pane -I` for jsonl, `kill-window`). | `pi.exec`, tmux binary | Portable fallback (FR-10); no TCC (G3). |
| **`ReviewReplay`** | Rewinds/re-opens: replays `<agentId>.jsonl` from `fromByte` into a tab (resync gap-fill + post-end rewind). | `TabRegistry.fromByte`, jsonl | Powers AC3 rewind without recapture. |
| *(existing)* notify/heartbeat | Unchanged: tab activity + desktop notifications via `sp agent receive-agent-hook`/`sp notify`. | — | Coexistence (FR-7). |

**Boundary:** no omp core file is touched. All additions live in the extension package; omp's
`task` executor, registry, EventBus, and artifact manager are consumed read-only (events + files
omp already emits). This is the INV-3 / FR-7 / AC6 guarantee.

---

## 7. Lifecycle coverage (FR-4, FR-5, FR-9, FR-11; T1)

omp registry states are `running | idle | parked | aborted`, with **isolated = parked without a
reviver** (workspace merged+cleaned, session not revivable, transcript still readable via
`history://`) [omp://tools/task.md "End-of-run lifecycle"]. The relay mirrors these into tab state:

| omp state / transition | EventBus signal | Tab action | Tab after |
|---|---|---|---|
| job **queued** (pre-semaphore) | — (no lifecycle(start)) | nothing | *(no tab)* — AC8 |
| **running** (admitted, session started) | `lifecycle(start)` | create + label `"<agentId> · <role>"`; begin streaming | open, streaming |
| **idle** (yielded, revivable, TTL-armed) | `lifecycle(idle)` | relabel suffix `· idle`; stop heartbeat; **keep open** | open, reviewable |
| **parked** (TTL expired, session disposed, `AgentRef`+file retained) | `lifecycle(park)` | relabel `· parked`; keep open | open, reviewable |
| **revived** (irc/Hub message reopens session) | `lifecycle(revive)` | **reuse** existing `agentId→tabId`; relabel `· running`; resume streaming | open, streaming (no dup — AC7) |
| **aborted** (cancel/hard-abort; terminal) | `lifecycle(aborted)` | relabel `[ABORTED] <agentId> · <role>`; stop streaming; keep open | open, reviewable (AC4) |
| **isolated** (parked w/o reviver) | `lifecycle(park, isolated)` | relabel `· isolated (not revivable)`; keep open | open, readable (E4) |
| **ended** (parent teardown / explicit close) | teardown / operator close | drop `TabRecord`; `close_tab` only if operator-initiated or `reviewTtlMs` fires | removed |

**Survive-end (FR-5 / T1).** A tab is **never** auto-closed on agent end. The accumulated scrollback
is the review buffer; the persisted `<agentId>.jsonl`/`.md` is the durable rewind source. Idle TTL
(`task.agentIdleTtlMs`, default 7 min [omp://tools/task.md]) parks the *session* but **not** the
*tab* — the tab outlives the session object. `"Main"` is never parked and never gets a subagent tab
(it is the parent).

**Cleanup policy (§15 decision).** Default: explicit close by the operator; `TabRegistry` is dropped
on parent-session teardown. Optional `reviewTtlMs` auto-closes ENDED tabs after a duration. **This
TTL is the single operator decision relayed in §15.**

---

## 8. Fallback design — tmux bridge (FR-10, SHOULD; E1, E3, E6)

When the supaterm socket is unreachable, `SUPATERM_CLI_PATH`/`SUPATERM_SURFACE_ID` are absent (omp
not launched from a supaterm pane), or a `sp` call is denied (E1/E6), `TabController` switches the
active `SurfaceBackend` to `TmuxBackend` (graceful degradation, NFR-3) and surfaces the degraded
state to the operator (a one-line notice in the parent + `sp pane notify`/tmux message where possible).

**Tmux wiring** (primitives verified in `tmux(1)` [RESEARCH F2.1]):

```
tmux new-session -d -s omp-agents                                  # detached, once
tmux new-window    -t omp-agents -n "<agentId>" -k                  # one window per agent (-k: reuse name)
tmux send-keys     -t omp-agents:"<agentId>" -l "<richDelta>"       # stream literal UTF-8 (push order)
# — or, for full-transcript piping without an in-process renderer —
tmux pipe-pane     -I -t omp-agents:"<agentId>" 'tail -F <id>.jsonl | <renderer>'   # jsonl→pane
tmux kill-window   -t omp-agents:"<agentId>"                        # explicit cleanup
```

- **Content source under tmux.** Two valid modes: (a) same EventBus-driven `send-keys -l` of omp's
  rendered deltas (rich, parity with supaterm path); (b) `pipe-pane -I 'tail -F <id>.jsonl | …'`,
  which streams the persisted transcript into the window directly — the jsonl-tail surface [INV-1 #1]
  shines here because tmux can pipe an external command's stdout into a pane with no per-agent
  process owned by omp. Mode (b) is the **zero-harness-cooperation baseline** of NFR-2.
- **Lifecycle.** `pane_dead*` + `remain-on-exit` give dead-pane detection; the window survives the
  agent (review) and is `kill-window`-ed only on explicit cleanup.
- **No TCC prompt** (G3). tmux attaches inside *any* terminal (supaterm/Ghostty/iTerm2), so the
  operator sees the session wherever they like — this is the terminal-agnostic value (FR-10/AC5).

**Backend selection is a strategy switch, not a fork:** `SupatermBackend` and `TmuxBackend`
implement the same `SurfaceBackend` interface (§5.3); `TabController` is backend-agnostic. Ghostty
(AppleScript) is deliberately **not** implemented — it prompts (G3) and lacks read-back (G5).

---

## 9. Interactivity (FR-6; NFR-5 read-only)

- **Read-only observation.** The tab is a relay surface: streamed bytes render via a no-echo holder;
  the operator cannot inject free text into the subagent through it (NFR-5). No privilege escalation,
  no cross-agent leakage — each tab shows only its `agentId`'s stream.
- **Stop/cancel = existing job-cancel → `aborted`.** The operator cancels a subagent by the
  **existing** mechanism — `job cancel <jobId>` (or parent tool-call abort) [omp://tools/task.md
  "Background work / cancellation"]. The cancel lands the agent `aborted` (terminal); the executor
  emits `lifecycle(aborted)`; the relay relabels the tab `[ABORTED] …` and stops streaming, leaving
  the transcript for review (FR-6 / AC4). To make cancel discoverable *from the visibility context*,
  the tab's status line shows `agentId · jobId · <status>` with a hint `[cancel: job cancel <jobId>]`.
- **No free-text injection in v1 (non-goal, §13).** Injecting steering text would require `prompt`/
  `steer` (RPC) or `irc` send — out of v1 scope. REQ frames in-omp first-class action as COULD
  (FR-13), not MUST.

---

## 10. Error handling (the 7 REQ error cases)

| # | REQ case | Design response | AC |
|---|---|---|---|
| **E1** | Tab creation fails (supaterm down / socket unreachable) | `SupatermBackend.available()` is false → `TabController` switches to `TmuxBackend` (§8); if tmux also absent, degrade to existing in-omp surfaces (`history://`/`agent://`/Agent Hub) with a surfaced notice. **Never crash the parent or any subagent** — all backend ops are fire-and-forget with try/catch around `pi.exec` (NFR-2/NFR-3). | AC5 |
| **E2** | Concurrency exceeds `task.maxConcurrency` | Relay creates a tab **only on `lifecycle(start)`**; queued jobs emit no such event → no phantom/duplicate tabs (FR-8). | AC8 |
| **E3** | Agent aborts | `lifecycle(aborted)` → relabel `[ABORTED]`; streaming stops; transcript remains reviewable. | AC4 |
| **E4** | Agent isolated (non-revivable) | `lifecycle(park, isolated)` → relabel `· isolated (not revivable)`; no revive path; persisted transcript stays readable in-tab and via `history://` (FR-9). | — |
| **E5** | Parked then revived | **Reuse** the existing `agentId→tabId` (no second record); relabel `· running`; resume streaming (FR-4). | AC7 |
| **E6** | Permission denied (TCC) | Primary (supaterm socket) and fallback (tmux) are both **non-prompting** (G3); a denial therefore implies a misconfigured env, handled as E1 (switch backend / degrade), never a silent failure. | AC5 |
| **E7** | RPC-mode-only source chosen but operator in interactive TUI | The design does **not** choose the RPC source as primary for exactly this reason; the EventBus + jsonl baseline is mode-independent and works in interactive TUI (INV-1, NFR-2). RPC is parity-only. | AC9 |

**Cross-cutting:** every backend operation (`createTab`/`sendText`/`renameTab`/`closeTab`) is wrapped
so a thrown error logs + degrades but never propagates into the executor or the child session — the
relay is strictly side-effect-only relative to omp (NFR-2, NFR-3).

---

## 11. Interface contracts

### 11.1 EventBus subscriptions (extension → omp)

```
// C1 (VERIFIED): subagent channels are EventBus channels, NOT ExtensionAPI.on
//   events. ExtensionAPI.on(...) accepts only the fixed extension-event enum
//   (session_start, tool_call, ...); arbitrary channel strings must go through
//   the shared bus: pi.events (EventBus.on -> () => void unsubscribe).
//   Channels are the consts in task/types.d.ts:13-17 (TASK_SUBAGENT_*_CHANNEL).
pi.events.on(TASK_SUBAGENT_LIFECYCLE_CHANNEL, (e: SubagentLifecyclePayload) => …)
pi.events.on(TASK_SUBAGENT_PROGRESS_CHANNEL,  (e: SubagentProgressPayload)  => …)
pi.events.on(TASK_SUBAGENT_EVENT_CHANNEL,     (e: SubagentEventPayload)     => …)

// C2 (VERIFIED): pi.exec(command: string, args: string[], options?: ExecOptions)
//   -> Promise<{ stdout; stderr; code; killed }>. It takes an ARGV ARRAY,
//   never a shell string: pi.exec("sp", ["tab","new","--json","--script",holder]).
```

**Verified payload fields (C3 — the prior draft's `{agentId; role?; sessionId; phase}` was WRONG).**
Sourced from `task/types.d.ts` (Subagent*Lifecycle/Progress/Event*Payload) + `AgentProgress`:

| Channel | Actual payload | agentId | label/role | status |
|---|---|---|---|---|
| lifecycle | `{ id, agent, agentSource, description?, status, sessionFile?, parentToolCallId?, index, detached? }` | `id` | `description` | `status: "started"\|"completed"\|"failed"\|"aborted"` |
| progress | `{ index, agent, agentSource, task, assignment?, progress: AgentProgress, sessionFile?, detached? }` | `progress.id` | `assignment` | `progress.status` ("pending"\|"running"\|"completed"\|"failed"\|"aborted") |
| event | `{ id, event: AgentSessionEvent }` | `id` | — | — |

**State derivation (C3).** Only four lifecycle `status` values are ever emitted —
`started | completed | failed | aborted`. The prior draft's `lifecycle(idle|park|revive|
isolated)` transitions **do not exist**: `idle/parked/revived/isolated` are registry
concepts, never emitted on these channels. Quiet/review tab states are therefore
**derived** — from `progress.status`, an activity-timeout heuristic over the event
stream, and the terminal lifecycle `status`. The persisted transcript is `sessionFile`
(a `<id>.jsonl` path), not a `sessionId`-derived directory; there is no `sessionId`
field on these payloads.

- **Pre:** omp emits these from `task` execution in all modes [omp://tools/task.md]. The extension
  is loaded (`pi install …`) and the supaterm env is present (gating) or a tmux fallback is desired.
- **Post:** zero return value (side-effect only); any thrown error is caught and logged — it never
  reaches omp internals.
- **Error mode:** never throw; on any backend failure, degrade per §10.

### 11.2 `SurfaceBackend` (§5.3) — contract per method

- `available(): Promise<boolean>` — true iff the socket is reachable (supaterm) / tmux binary exists.
- `createTab(agentId, role?, cwd): Promise<{tabId,paneId?}>` — creates a labeled tab; **pre**: agent
  not already in `TabRegistry` as `running`; **post**: a `TabRecord` exists; **error**: E1 → switch.
- `sendText(target, chunk): Promise<void>` — appends `chunk` verbatim; **pre**: tab exists;
  **error**: swallow + log (transient loss is recoverable via `ReviewReplay` from `fromByte`).
- `closeTab(tabId): Promise<void>` — only on explicit cleanup / teardown / TTL; never on agent end.

### 11.3 Cancellation → aborted (control contract)

- **Input:** operator `job cancel <jobId>` (existing). **Output:** agent `aborted` (executor) →
  `lifecycle(aborted)` → tab relabel + stop. The relay adds **no** new cancel path; it only mirrors.

---

## 12. Acceptance-criteria mapping (all 9 traced to design)

| AC | Requirement | Design element that satisfies it |
|---|---|---|
| **AC1** | 2–4 agents → 2–4 labeled tabs, no phantoms | `TabController` creates one tab per `lifecycle(start)`; `rename_tab` labels `"<agentId> · <role>"` (G1); queued jobs → no tab (§4.5). |
| **AC2** | Rich live stream, push-order, no parent impact | `task:subagent:event` deltas → omp renderer → `send_text`, unbatched (§4.1/§4.4); relay is append+rename only (NFR-1). |
| **AC3** | Tab survives end, rewindable to persisted transcript | Survive-end policy (§7); `ReviewReplay` from `<agentId>.jsonl` `fromByte` (§4.2); scrollback = review buffer. |
| **AC4** | Cancel → `aborted`, tab reflects it | `lifecycle(aborted)` → `[ABORTED]` relabel (§9, §11.3). |
| **AC5** | supaterm unavailable → tmux fallback | `TmuxBackend` strategy switch on E1/E6 (§8). |
| **AC6** | No core file modified; extends existing extension | All additions in `pi-notify-supaterm`; omp consumed read-only (§6 boundary). |
| **AC7** | agentId-keying survives idle→park→revive | `TabRegistry` keyed on `agentId`; revive mutates record only (§5.1, §7). |
| **AC8** | Beyond maxConcurrency degrades gracefully | Tab only on `lifecycle(start)`; semaphore gates admission (§4.5). |
| **AC9** | Relay-not-capture demonstrable | Consumes EventBus + `<id>.jsonl`; no new capture backend; reuses omp renderer (§4). |

---

## 13. Non-goals (v1)

- **No implementation code this round.** DEVELOP is gated on operator approval of *this* proposal.
- **No re-opening of any locked REQ decision** (INV-1..4, all locked decisions, all resolved
  tensions T1–T3).
- **No free-text injection into subagents.** The tab is read-only observation; steering/injection
  stays in omp (`prompt`/`steer`/`irc`). FR-13 (in-omp first-class action) is COULD, deferred.
- **No Ghostty backend.** AppleScript-only, prompts (G3), no read-back (G5) — not a recommended
  surface; tmux is the fallback.
- **No new capture backend, no new renderer.** Relay consumes what omp produces and reuses omp's
  formatting (INV-1).
- **No multi-window/space orchestration in v1.** FR-14 (multi-window + extra notifications) is COULD;
  the existing notification path is retained as-is.
- **`collapsible sections` fidelity caveat (faithful note).** A plain streamed terminal pane renders
  color, status, progress, and ANSI section markers, but **not** interactive expand/collapse
  widgets. Full collapsible richness remains available via omp's in-omp `history://<id>` rendering
  (the operator can open that for deep review). The live tab targets streaming-rich; the persisted
  transcript targets full-richness review. This is noted rather than hidden.

---

## 14. Open items / verification notes

- **[INFERENCE] G3 socket-IPC non-prompting.** Stated High because the shipping `pi-notify-supaterm`
  extension already invokes `sp` from inside omp with no permission grant (empirical), and Unix-domain
  same-user socket IPC is not an AppleScript Automation event. Residual: if omp is *not* launched
  from a supaterm pane, the env vars are absent and the feature degrades to tmux (not a TCC issue).
- **[INFERENCE] Holder command / pty echo.** The no-echo stdin-echo holder (`stty -echo; cat`) is the
  standard pattern; exact command + the FIFO alternative are DEVELOP-tunables, not SPEC decisions.
- **G2 frame payloads remain Medium** but are **no longer load-bearing**: the design uses pushed
  frames as wake-signals and the seekable `get_subagent_messages{fromByte}` / jsonl `fromByte` as the
  authoritative content. If DEVELOP finds `task:subagent:event` carries full deltas in-process, the
  jsonl resync becomes a rare path; if not, jsonl resync carries it. Either way AC2/AC3 hold.
- **Artifact-dir parent path** was not pinned by research [RESEARCH "Could not verify"]; the relay
  obtains it from the `lifecycle`/`event` payload (`sessionId` → `<ts>_<sessionId>/`) or from omp's
  artifact manager (in-process), not by filesystem guessing.
- **G4** carried forward as informational (§2); does not block any AC.

---

## 15. Single decision to confirm (relay to operator)

REQ explicitly deferred the **precise cleanup/retention policy** to SPEC (T1 / FR-5: "Precise
cleanup/retention policy (TTL, re-openability) is deferred to SPEC"). The design **recommends**:

> **Tabs survive agent end and are never auto-closed in v1.** Cleanup is explicit (operator closes a
> tab; `TabRegistry` is dropped on parent-session teardown). An **optional** `reviewTtlMs` setting
> auto-closes tabs that have been in an ENDED/ABORTED state longer than the TTL; default is
> **undefined = never**.

**The one decision for the operator:** confirm the **never-auto-close default**, or specify a
`reviewTtlMs` (e.g. "close review tabs 30 min after the agent ends"). Everything else in this SPEC is
determined by the locked REQ posture + verified mechanism; this is the only remaining operator
preference. (Recommendation: ship never-auto-close; add the TTL knob for those who want it.)
