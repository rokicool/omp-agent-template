# RESEARCH — Per-Subagent Terminal Visibility (oh-my-pi harness)

> Landscape report. Answers the four research questions, gives an options matrix,
> ranks 2–3 solution directions, and ends with an Impact Assessment.
> Author: DrPe. Date: 2026-06-24. Environment: macOS Apple Silicon; operator terminal "supaterm"; ghostty also available.

---

## Scope

Researched the full landscape for streaming each oh-my-pi (omp) subagent's live log into a
dedicated terminal pane (one pane per agent; N concurrent agents → N panes). Four dimensions:

1. **supaterm** — product identity, pane model, and programmatic control surface.
2. **macOS terminal-multiplexing options** for "external process creates a pane and streams a log
   into it" — tmux, zellij, and native terminals (Ghostty, iTerm2, Kitty).
3. **Current omp subagent observability** — how `task` launches subagents, what live output
   surfaces exist (on-disk files, `history://`, `agent://`, `artifact://`, RPC, EventBus/hooks),
   and whether an external process can tail a subagent's **live** output today.
4. **Prior art** — how comparable multi-agent runtimes expose per-agent live logs.

**Primary sources:** supaterm.com + its GitHub `docs/`; oh-my-pi internal docs
(`task-agent-discovery.md`, `tools/task.md`, `blob-artifact-architecture.md`, `rpc.md`,
`hooks.md`, `tools/irc.md`, `sdk.md`, `collab.md`, `tui-runtime-internals.md`); the OpenBSD
`tmux(1)` man page; Ghostty / Kitty / iTerm2 / Zellij official docs.

> ⚠️ **Tool caveat (honesty):** the `web_search` tool returned `MCP error -401: Api key not
> found` after its first successful call (apparent quota exhaustion). All findings below are
> grounded in **direct reads of canonical/primary sources** via `read` rather than search
> snippets. Dimensions that could not be corroborated against multiple live sources are flagged
> in the per-finding Confidence fields and in **"Could not verify"** at the end. This does not
> weaken the omp or supaterm findings (both read from primary docs) but limits Q4 prior-art
> breadth.

---

## Findings

### Q1 — supaterm

**F1.1 — Product identity.** supaterm is a **native macOS terminal** (Swift app), built on
**libghostty** (the same terminal core/renderer as Ghostty). It is positioned as "agent-first"
("a terminal for the coding agents age", "the terminal with skills"). It organizes via
**spaces, tabs, and panes**.
- Source: https://supaterm.com/ (meta) · https://github.com/supabitapp/supaterm (README: "A terminal for ur coding agents", Language: Swift, License: Other). **Confidence: High.**

**F1.2 — It DOES support multiple windows/panes/splits/tabs** — that is its core organizational
model (space → tab → pane). **Confidence: High.**

**F1.3 — It exposes a full programmatic control surface** (the differentiator vs. vanilla
Ghostty): a **Unix-domain-socket IPC** with a **newline-delimited JSON** protocol and a bundled
**`sp` CLI**. One socket per running app process. Each socket endpoint has an id, name, path,
pid. Discovery is per-user (`sp instance ls` / `--json`). Targeting is hierarchical and 1-based:
space `1`, tab `1/2`, pane `1/2/3`; UUIDs accepted anywhere.
- Tree/diagnostics: `sp ls [--json]`, `sp instance ls`, `sp diagnostic`.
- Terminal control: `sp space new`, `sp tab new --in 1 --cwd ~/tmp -- ping 1.1.1.1`,
  `sp pane split --in 1/2 right`, `sp pane send --newline 'echo hello'`,
  `sp pane capture --scope scrollback --lines 200`, `sp pane layout main-vertical 1/2`.
- **Method families (the wire surface an external process can call):** `terminal.new_pane`,
  `terminal.new_tab`, `terminal.create_space`, `terminal.send_text`, `terminal.send_key`,
  `terminal.capture_pane`, `terminal.close_pane`, `terminal.close_tab`, `terminal.resize_pane`,
  `terminal.set_pane_size`, `terminal.equalize_panes`, `terminal.tile_panes`,
  `terminal.main_vertical_panes`, `terminal.notify`, plus `terminal.agent_hook`.
- Source: https://raw.githubusercontent.com/supabitapp/supaterm/main/docs/how-socket-works.md
  (read in full). **Confidence: High.**

**F1.4 — tmux integration is explicit.** supaterm ships `sp tmux list-panes` and `sp run -- …`
interop, i.e. it deliberately coexists with a tmux server rather than only replacing it.
- Source: how-socket-works.md "Public CLI Surface" / "Compatibility and config". **Confidence: High.**

**F1.5 — It already integrates with omp/"Pi" (load-bearing finding).** supaterm ships an omp
extension package, `supaterm-skills`, with `pi-notify-supaterm`. Install:
`pi install git:github.com/supabitapp/supaterm-skills`. The extension only forwards events when
it sees both `SUPATERM_CLI_PATH` and `SUPATERM_SURFACE_ID`, **synthesizes a stable session id
from the pane surface id**, sends hook events via `sp agent receive-agent-hook --agent pi`, emits
running heartbeats during active work, and sends completion/attention notifications. Claude and
Codex get equivalent hook bridges (`sp agent install-hook claude|codex`).
- **Important nuance:** the existing integration is **tab-activity / notification oriented**
  (marks a tab `running`/`idle`/`needs-input`, desktop notifications), **not** "stream the full
  agent log into its own pane." However, the *primitives* for full per-pane streaming already
  exist (`new_pane` + `send_text` + `close_pane`); the current bridge simply doesn't use them for
  log streaming. The architecture doc explicitly prescribes the split to follow:
  thin agent adapter → forwards lifecycle events → **app owns the pane/UI state**.
- Source: https://raw.githubusercontent.com/supabitapp/supaterm/main/docs/coding-agents-integration.md
  (read in full; "Pi" section + "Shared Responsibilities"). **Confidence: High.**

**supaterm conclusion:** supaterm is purpose-built for exactly this use case and already has an
omp integration path; what's missing is wiring the live transcript into a dedicated pane via the
primitives it already exposes.

---

### Q2 — Terminal multiplexing on macOS for "one pane per streaming log"

All commands below were verified against primary docs (tmux OpenBSD man page; Ghostty/Kitty/
iTerm2/Zellij official docs).

**F2.1 — tmux (strongest programmatic fit; terminal-agnostic).** Socket server/client model
(server in `/tmp`/`TMUX_TMPDIR`); detached persistent sessions; control mode (`-C`) for JSONL
control of tmux itself. The exact primitives for this task, verified in `tmux(1)`:
- `new-session -d -s <name>` — detached session.
- `new-pane` / `split-window` (`splitw`): `-d` (don't focus), `-P -F '#{pane_id}'` (print the
  new pane's unique id), **`-E`/empty command creates an empty pane**, and **`-I` forwards stdin
  into the pane**: the man page's own example is `make 2>&1 | tmux splitw -dI &`. `-W` waits for a
  command to exit and returns its status; `-k` keeps the pane open after exit (`remain-on-exit`).
- **`pipe-pane` (`pipep`)**: "pipe output sent by the program in target-pane to a shell command
  **or vice versa**." `-I` connects the command's stdout to the pane (**anything the command
  prints is written to the pane as if typed**) → `tmux pipe-pane -I -t <pane> 'tail -F <log>'`
  streams an external command's live output *into* a pane. `-O` captures pane output to a
  command. One pipe per pane at a time.
- **`send-keys` (`send`)**: send keys/chars to `target-pane`; `-l` sends **literal UTF-8** (no
  key-name lookup) → `tmux send-keys -t <pane> -l "<chunk>"` streams arbitrary text into a pane.
- `capture-pane` (read pane content), `kill-pane` (cleanup), `respawn-pane` (reactivate),
  `remain-on-exit` option (lifecycle), floating panes.
- Lifecycle formats (verified in FORMATS section): `pane_id` (#D, unique), `pane_pid`,
  `pane_pipe`/`pane_pipe_pid`, **`pane_dead`/`pane_dead_status`/`pane_dead_time`** (dead-pane
  detection → clean auto-cleanup), `pane_tty`.
- **macOS:** first-class (Homebrew); runs headless/detached and can be attached inside **any**
  terminal (supaterm, Ghostty, iTerm2). No GUI/Automation permission required.
- Source: https://man.openbsd.org/tmux.1 (DESCRIPTION, COMMANDS: new-pane/split-window/pipe-pane/
  send-keys/kill-pane/respawn-pane, FORMATS: pane_id/pane_pipe/pane_dead*, display-popup -E).
  **Confidence: High.**

**F2.2 — Kitty (`kitty @` remote control; strongest pure-terminal alternative).** Socket-based
remote control with a documented wire protocol. Verified commands: `launch` (create a window/tab/
OS-window running a command, `--type=window/tab/os-window`), `new-window`, **`send-text`** /
`send-key` (stream into a window), **`get-text`** (capture pane contents), `close-window` /
`close-tab` / **`signal-child`** (signal the child of a window → lifecycle/cleanup), `set-user-vars`,
`resize-window`, `ls` (tree), `goto-layout`. Fine-grained permissions + a **custom authorization
program** hook; the `rc` protocol supports async/streaming requests; window/tab matching by id/
title/etc.
- **macOS:** first-class. Not the operator's primary terminal, but the cleanest "external process
  fully controls panes" story among the native terminals.
- Source: https://sw.kovidgoyal.net/kitty/remote-control/ (command index verified: launch,
  new-window, send-text, send-key, get-text, close-window, close-tab, signal-child, permissions).
  **Confidence: High.**

**F2.3 — Ghostty (operator's secondary terminal; 1.3.0+).** Native macOS **splits/tabs/windows**
(interactive) **plus an AppleScript dictionary** (object model: application → windows → tabs →
terminals). Verified AppleScript commands: `new window`, `new tab`, `split` (returns the new
terminal; directions right/left/down/up), **`input text "..." to <terminal>`** (paste-style text
into a specific terminal — the streaming primitive), `send key`, `send mouse *`, `focus`,
`close` / `close tab` / `close window`, `perform action`. Surface-configuration records support
`command`, `initial working directory`, `environment variables`, `initial input`.
- **Gaps vs. this task:** **no socket/CLI remote control** (no `kitty @` equivalent), and
  **no documented read-back of pane contents** (no `capture-pane`/`contents`). AppleScript via
  `osascript` works headlessly but triggers a **TCC Automation permission prompt**; can be
  disabled via `macos-applescript = false`.
- Note: the workstation runs `ghostty 1.3.1-HEAD` → AppleScript (added in 1.3.0) is available.
- Source: https://ghostty.org/docs/features (AppleScript Automation listed) +
  https://ghostty.org/docs/features/applescript (full command tables + examples read).
  **Confidence: High** (create+stream+close); **Medium** (read-back: no capture primitive found).

**F2.4 — iTerm2 (most mature macOS programmatic control).** AppleScript (create
`window`/`tab`/`session`, `split horizontally/vertically with profile`, `write text`,
**`contents`** read-back, `close`, `is processing`, `is at shell prompt`) **plus an async Python
API** (`iterm2` package) that can create sessions, send text, and monitor screen output
reactively. AppleScript is marked "Deprecated" for new use but still present; Python API is the
recommended path. Not the operator's terminal, but the richest surface.
- Source: https://iterm2.com/documentation-scripting.html (object model + session commands read
  in full) + https://iterm2.com/python-api . **Confidence: High.**

**F2.5 — Zellij (session-attached; weaker fit for *external* per-pane streaming).** Declarative
**layouts** with `pane` nodes supporting `command`/`args`, `cwd`, `close_on_exit` (auto-close the
pane when its command exits), nested `split_direction`. Runtime control via the **`zellij action`
CLI** (e.g. `new-pane`, `write-chars`, `write`, `close-pane`, `move-focus`) that talks to a
running session over IPC; `attach`/`list-sessions`/`kill-sessions`; built-in web-client; WASM
plugin system.
- **Gap for this task:** zellij's actions primarily target the **focused pane of a running,
  attached session**; there is no clean **address-a-specific-pane-by-id from an arbitrary external
  process** like tmux's `-t <pane_id>` or kitty's `--match`, and no `pipe-pane`-equivalent.
  Zellij fits "run a distinct process in each pane of a fixed layout" better than "an external
  orchestrator streams text into N arbitrary panes."
- **macOS:** first-class.
- Source: https://zellij.dev/documentation/creating-a-layout.html (pane/command/close_on_exit
  verified) + https://zellij.dev/documentation/commands.html (attach/ls/kill/options/setup) +
  https://github.com/zellij-org/zellij README. **Confidence: Medium** — the `action`
  subcommand enumeration could not be fetched (zellij.dev doc slugs 404'd / were JS-gated); relied
  on layout+commands docs and established behavior. Flagged in "Could not verify."

**F2.6 — Cross-cutting note.** supaterm and Ghostty share libghostty, but **supaterm adds the
socket IPC + agent layer that vanilla Ghostty deliberately omits.** So "operator terminal =
supaterm" and "ghostty also available" is effectively "agent-controllable libghostty (supaterm)"
vs. "AppleScript-controllable libghostty (Ghostty)."

---

### Q3 — Current omp subagent observability (the critical question)

**F3.1 — How subagents launch (and the key fact: they are in-process, not OS processes).**
`task` → `TaskTool.#runSpawn` → `runSubprocess(...)` creates an **isolated child `AgentSession`
in-process** (own settings snapshot, own agentId, own internal-URL router + `AgentOutputManager`),
forces `async.enabled=false` and `bash.autoBackground.enabled=false` in the child, and bounds
concurrency with a session-scoped `Semaphore` (`task.maxConcurrency`). Output schema precedence:
agent frontmatter `output` → parent session schema. The child must finish via the hidden `yield`
tool. **Implication:** "one pane per process" is really **"one pane per agent id"** — there is no
OS process per agent to attach a terminal to.
- Source: `omp://task-agent-discovery.md` + `omp://tools/task.md` (Flow, Modes, Side Effects).
  **Confidence: High.**

**F3.2 — Live streaming is produced as `AgentSessionEvent`s.** The child session emits
`agent_start`, `message_update` (carrying `assistantMessageEvent` deltas incl. `text_delta` /
`toolcall_delta`), `message_end`, `tool_execution_*`, `agent_end`, etc. Subscribers receive these
immediately, in push order (no batching). This is the canonical live stream.
- Source: `omp://provider-streaming-internals.md` + `omp://sdk.md` (`session.subscribe`).
  **Confidence: High.**

**F3.3 — On-disk LIVE transcript that an external process can tail (the enabler).** When the
parent persists artifacts, each subagent writes **`<id>.jsonl`** (session history, **appended live
as the agent runs**) and **`<id>.md`** (final full output) under the session artifacts dir
`<timestamp>_<sessionId>/` (derived from the session file). Truncation caps exist
(`MAX_OUTPUT_BYTES=500_000`, `MAX_OUTPUT_LINES=5000`; overridable) but the **full raw output is
still written to `<id>.md`**, and the JSONL grows live. → **An external process can `tail -F
<id>.jsonl` for real-time output with zero harness cooperation, in any mode (incl. the operator's
interactive TUI session).**
- Source: `omp://tools/task.md` (Outputs: "`<id>.jsonl` session history … works for live and
  parked agents"; "`agent://<id>` holds the full output") + `omp://blob-artifact-architecture.md`
  (artifact dir layout, `AgentOutputManager`). **Confidence: High.**

**F3.4 — In-process read URLs (NOT exposed to external processes).** `history://<id>` renders the
JSONL as a concise transcript; `agent://<id>` returns the `.md` (with JSON extraction
`/path`|`?q=`); `artifact://<numericId>` returns spilled/truncated tool output (`.log`). These
are handled by the **internal-URL router** for tools/agents inside the process — there is no
socket/IPC a foreign process uses to resolve them.
- Source: `omp://blob-artifact-architecture.md` (URL access model) + `omp://tools/task.md`.
  **Confidence: High.**

**F3.5 — RPC surface (real external live-subscription — but only in RPC mode).** RPC mode
(`omp --mode rpc`) is newline-delimited JSON over stdio. It exposes:
- `set_subagent_subscription` — `off | progress | events` (turns on pushed subagent frames).
- `get_subagents` — list live subagents.
- **`get_subagent_messages { subagentId, sessionFile, fromByte }`** — **seekable incremental
  transcript read** (pass `fromByte` and advance it each poll → tail without re-reading).
- Pushed frames (gated by the subscription): **`subagent_lifecycle`**, **`subagent_progress`**,
  **`subagent_event`**.
- Source: `omp://rpc.md` (Command Schema: State; Outbound frame category 10 "Subagent frames").
  **Confidence: High** that these commands/frames exist; **Medium** on exact field schemas (rpc.md
  lists frame types, not full per-frame payloads).

**F3.6 — EventBus hooks (in-process extension → could drive external panes).** Extensions
register `pi.on(...)`; the task executor **emits `task:subagent:event`, `task:subagent:progress`,
and `task:subagent:lifecycle` on the parent EventBus** (collab re-broadcasts these as `bus`
frames to guests). An extension can also run shell via `pi.exec(...)`. → An omp extension is a
clean place to bridge subagent events → tmux/supaterm panes without any external process.
- Source: `omp://tools/task.md` (Side Effects: EventBus emissions) + `omp://hooks.md`
  (`pi.on`, `pi.exec`) + `omp://collab.md` (`bus` frames). **Confidence: High.**

**F3.7 — `irc` is NOT a log-tail surface.** It is a peer mailbox bus (send/wait/inbox/list) for
agent-to-agent messaging; it revives parked agents on message. Useful for control/follow-up, not
for streaming transcripts.
- Source: `omp://tools/irc.md`. **Confidence: High.**

**Q3 conclusion:** **Yes — an external process can tail a subagent's live output today**, through
three independent surfaces, ranked by friction:
1. **On-disk `<id>.jsonl` tail** (`tail -F`) — simplest, mode-independent, needs **no** harness
   cooperation. *(F3.3)*
2. **RPC** `set_subagent_subscription=events` + `get_subagent_messages{fromByte}` — structured,
   seekable, lifecycle-aware — but requires running omp in **RPC mode** (the operator's
   interactive TUI session is not). *(F3.5)*
3. **In-process extension hook** on the parent EventBus (`task:subagent:*`) — richest, can call
   out to a pane via `pi.exec`, but runs inside the omp process. *(F3.6)*
The gap is **not** "no live output exists"; it is that **no built-in feature wires that output to
a terminal pane.** `history://`/`agent://` exist but are process-internal only.

---

### Q4 — Prior art (per-agent live logs in comparable runtimes)

**F4.1 — omp's own Agent Hub + Collab (closest first-party prior art).** omp already implements
the "per-agent live panel" pattern: the Agent Hub shows a live subagent table with progress, and
(on-demand) the per-agent transcript; Collab guests get `agents` frames (registry snapshots), `bus`
frames (mirrored subagent lifecycle/progress), and incremental `fetch-transcript`→`transcript`
reads; the Collab **web client renders a "subagent panel with on-demand transcripts."** Guests can
steer/kill/revive host subagents. This proves the dominant pattern inside omp is a **dedicated
per-agent panel/stream**, not per-OS-process terminals.
- Source: `omp://collab.md` (Guest permission model, Architecture notes: `bus`/`agents` frames,
  fetch-transcript; web client "subagent panel with on-demand transcripts") + `omp://tools/task.md`
  (Agent Hub / registry). **Confidence: High.**

**F4.2 — supaterm's agent-pane model (terminal-native prior art).** supaterm binds an agent
session to a **pane surface**, derives tab activity (running/idle/needs-input), and reads live
progress from agent-native sources (Claude `~/.claude/tasks/<id>/*.json`, Codex rollout/transcript
tail, Pi extension events) — i.e. **"one terminal pane per agent with live status"** as a
shipping product pattern. It streams *status/progress* today, not full transcripts.
- Source: supaterm `coding-agents-integration.md`. **Confidence: High.**

**F4.3 — Dominant pattern across runtimes (general).** The recurring design split (from both
supaterm docs and omp) is: **thin agent adapter → forwards lifecycle/transcript events → the host
owns the UI/pane state.** Most widely-used coding-agent runtimes expose per-agent live output as a
**web/UI side panel with a streaming transcript + status** (the omp Collab web client and Agent Hub
are examples). **Terminal-native, one-tmux-pane-per-agent** is a popular **community/operator**
pattern (running multiple CLI agents side-by-side in panes) but is rarely a *first-party* feature
of runtimes. *(Web search was unavailable — see Scope caveat — so this general claim is
corroborated by omp + supaterm primary docs plus established knowledge; broader third-party
corroboration could not be fetched.)* **Confidence: Medium.**

---

## Options Matrix

Rows = approach. Columns: **(a)** programmatic pane creation on demand · **(b)** live-log
streaming fit · **(c)** auto-cleanup on agent end · **(d)** macOS support · **(e)** coupling to
the omp harness.

| Approach | (a) Create pane on demand | (b) Stream live log into pane | (c) Auto-cleanup on end | (d) macOS | (e) Harness coupling |
|---|---|---|---|---|---|
| **tmux** | ✅ `new-session -d` / `new-pane`/`split-window -dP` (prints pane_id) | ✅ best: `pipe-pane -I` (cmd→pane) **or** `send-keys -l` **or** `new-pane -I` (stdin→pane) | ✅ `kill-pane`; `pane_dead*` + `remain-on-exit` | ✅ first-class; runs inside supaterm/Ghostty/iTerm2 | **Low** — tail `<id>.jsonl` or use RPC; needs no omp changes |
| **Kitty `kitty @`** | ✅ `launch`/`new-window` (by id/match) | ✅ `send-text`/`send-key` | ✅ `close-window`/`signal-child` | ✅ first-class | Low — external; Kitty not operator's primary terminal |
| **supaterm `sp` socket** | ✅ `terminal.new_pane`/`new_tab` (by selector/UUID) | ✅ `terminal.send_text`/`send_key` | ✅ `terminal.close_pane` | ✅ (native; operator's terminal) | **Low–Med** — omp extension (`pi-notify-supaterm`) already exists; extend it |
| **Ghostty (AppleScript)** | ✅ `new window/tab`, `split` | ⚠️ `input text` (paste-style); no `pipe` | ✅ `close` | ✅ native (TCC prompt) | Low — external `osascript`; **no read-back** |
| **iTerm2 (AS/Python)** | ✅ create window/tab/session, `split` | ✅ `write text` (AS) / send (Py) | ✅ `close` | ✅ native (TCC prompt) | Low — external; richest API but not operator's terminal |
| **Zellij** | ⚠️ `action new-pane` (focused-pane/session-attached) | ⚠️ `action write-chars` (focused pane); no `pipe-pane` | ⚠️ `action close-pane`; layout `close_on_exit` only at launch | ✅ first-class | Med — weaker external per-pane targeting |

Legend: ✅ first-class / well-fit · ⚠️ partial / awkward.

---

## Recommendations — 2–3 most promising solution directions

**Direction 1 (RECOMMENDED) — tmux "bridge": detached session + per-agent pane.**
Spawn/attach a **detached tmux session**; for each subagent, create a dedicated pane and stream
its live transcript into it; kill the pane when the agent ends. Two equally-valid wiring options:
- **External bridge** (no omp changes): tail the on-disk `<id>.jsonl` (F3.3) per agent id and
  `pipe-pane -I -t <pane> 'tail -F <id>.jsonl'` (F2.1); reconcile pane lifecycle against
  `pane_dead*`/`kill-pane`.
- **omp extension** (F3.6): subscribe to `task:subagent:lifecycle/progress/event` on the EventBus
  and drive tmux via `pi.exec`, so lifecycle (start/idle/park/abort) maps cleanly to
  pane create/stream/close.
- **Why:** lowest coupling, terminal-agnostic (the operator sees the tmux session inside supaterm
  *or* Ghostty), decades-stable primitives verified in `tmux(1)`, no TCC permission. **Supporting
  findings: F2.1, F3.3, F3.6.**

**Direction 2 — supaterm-native (extend the existing omp integration).**
If the operator standardizes on supaterm, extend the shipped `pi-notify-supaterm`/`sp` bridge so
that, per agent, it calls `terminal.new_pane` + `terminal.send_text` (streaming the live
transcript) + `terminal.close_pane` on lifecycle end — reusing the agent-id↔pane mapping that the
extension already synthesizes from `SUPATERM_SURFACE_ID`. Gives the best native UX (tab activity,
notifications, layouts) and is the shortest path *given supaterm is the operator's terminal*.
- **Trade-off:** couples the feature to supaterm (pre-1.0, niche, "Other" license), and supaterm
  is not universally installed. **Supporting findings: F1.3, F1.5, F3.3/F3.6.**

**Direction 3 — omp-native: surface per-agent streaming in-omp + a "open in pane" action.**
Rather than only external panes, lean on surfaces omp already has: the Agent Hub (live table) +
RPC/JSONL/EventBus, and add a first-class action "stream this agent's transcript into a tmux/supaterm
pane." This reuses F3.3/F3.5/F3.6 and keeps the bridge logic inside omp (one place), while still
emitting to tmux or supaterm.
- **Supporting findings: F4.1, F3.5, F3.6.**

> **Native-terminal alternatives (Ghostty AppleScript / Kitty `@` / iTerm2):** all are viable for
> an operator already on that terminal; **Kitty `@`** is the strongest pure-terminal alternative to
> tmux (clean launch/send-text/get-text/signal-child + auth). They are secondary to Direction 1
> because they are terminal-specific, and Ghostty lacks pane read-back.

---

## Impact Assessment

- **Verdict: EXPAND.** Findings **materially expand the requirements** in three ways, and do not
  contradict them.

1. **The premise "they get NO visibility today" is only half-true.** omp **already** produces a
   live per-subagent transcript on disk (`<id>.jsonl`), exposes a structured/seekable RPC
   subscription (`set_subagent_subscription`/`get_subagent_messages{fromByte}`), and emits
   per-agent EventBus events. *(F3.3, F3.5, F3.6)* So the work is a **bridge/relay**, not a new
   observability backend — this **lowers scope/risk** vs. the likely assumption. Affected
   requirement: whatever REQ.md frames as "capture subagent output" → reframe as "relay existing
   output to a pane."

2. **New constraint: subagents are in-process sessions, not OS processes.** *(F3.1)* "One pane per
   process" is really **one pane per agent id**; the bridge must map `agentId ↔ paneId` and handle
   omp lifecycle nuance: concurrency cap (`task.maxConcurrency`), **idle→park** with revival,
   **aborted** (terminal), and **isolated** runs (non-revivable; transcript still readable). This
   affects any requirement assuming 1:1 process↔pane.

3. **New options fork: tmux-bridge vs. supaterm-native vs. in-omp.** *(F1.5, F2.1, F4.1)*
   supaterm already ships an omp integration to extend; tmux is the terminal-agnostic default;
   omp's own Agent Hub/Collab already model the "per-agent panel." macOS permission model also
   forks: tmux/zellij/kitty need **no** TCC prompt; Ghostty/iTerm2/supaterm AppleScript-style
   control may prompt.

- **Affected requirements:** (to confirm against REQ.md when available) the "visibility,"
  "one pane per agent," "stream full log," "auto-cleanup," and "macOS/supaterm/ghostty"
  requirements are all touched by the above.
- **Recommendation to the workflow: PROCEED to SPEC** — there is enough verified ground to design.
  Carry these **design inputs** into ReqGuru/LeadDev: (i) build a relay, not a capture backend;
  (ii) key on `agentId`, not PID; (iii) choose file-tail (`<id>.jsonl`) vs. RPC vs. EventBus-hook
  as the data source (file-tail needs no mode change; RPC needs RPC mode; hook is in-process);
  (iv) pick tmux (terminal-agnostic) vs. supaterm-native (best UX, coupled) vs. in-omp;
  (v) handle idle/park/abort/isolated lifecycle explicitly; (vi) decide macOS TCC behavior.

---

## Could not verify (honest gaps)

- **RPC subagent frame payloads.** `rpc.md` lists `subagent_lifecycle`/`subagent_progress`/
  `subagent_event` as frame types and `get_subagent_messages{subagentId, sessionFile, fromByte}`
  as a command, but **not the full field schemas** of each frame. Confidence **Medium.** The
  seekable `get_subagent_messages`/`fromByte` behavior is stated plainly, so the tail conclusion
  holds.
- **Zellij `action` enumeration.** zellij.dev documentation slugs for actions/pane-management
  returned 404 or were JS-gated; the `creating-a-layout` (pane/command/close_on_exit) and
  `commands` (attach/ls/kill) pages were read, and the README confirms the model, but the exact
  `zellij action <name>` list is from established behavior, not a fetched primary page.
  Confidence **Medium** on zellij specifics; **High** that it is session-attached (weaker
  external per-pane targeting than tmux/kitty).
- **Q4 breadth beyond omp/supaterm/tmux.** `web_search` returned `-401` after one call (quota).
  Third-party runtime claims (Claude Code / Codex / Cursor / Aider / Goose / OpenHands panel
  patterns) are from general knowledge, **not** freshly corroborated. Confidence **Medium.**
- **Exact on-disk path of `<id>.jsonl` in interactive mode.** The artifact dir is
  `<timestamp>_<sessionId>/` (verified), but the parent directory location was not pinned. Low
  impact — it is tailable regardless once located.

---

## Sources Consulted

**supaterm (primary)**
- https://supaterm.com/ — product identity, "agent-first native macOS terminal built with libghostty"; spaces/tabs/panes; "Automate via the sp CLI and agent skills."
- https://github.com/supabitapp/supaterm — README ("a terminal for the coding agents age"; Swift; links to `docs/how-socket-works.md`, `docs/coding-agents-integration.md`).
- https://raw.githubusercontent.com/supabitapp/supaterm/main/docs/how-socket-works.md — socket IPC model, `sp` CLI, method families (`terminal.new_pane/send_text/capture_pane/close_pane/…`), `sp tmux` interop, targeting/discovery.
- https://raw.githubusercontent.com/supabitapp/supaterm/main/docs/coding-agents-integration.md — pane-context env injection, Claude/Codex/Pi hook bridges, **`pi-notify-supaterm` extension**, agent-id↔pane mapping, adapter/app responsibility split.

**oh-my-pi harness (internal docs, primary for Q3)**
- `omp://task-agent-discovery.md` — agent shape, discovery/precedence, spawn/depth/disabled constraints.
- `omp://tools/task.md` — `task`/`runSubprocess` flow, **in-process child sessions**, `<id>.jsonl`/`<id>.md` artifacts, `history://`/`agent://`, EventBus emissions (`task:subagent:*`), concurrency/idle-TTL/isolated lifecycle, truncation caps.
- `omp://blob-artifact-architecture.md` — artifact dir layout (`<timestamp>_<sessionId>/`), `<id>.jsonl`/`<id>.md`, `artifact://`/`agent://` URL access model (process-internal).
- `omp://rpc.md` — RPC JSONL-over-stdio; `set_subagent_subscription`, `get_subagents`, `get_subagent_messages{subagentId,sessionFile,fromByte}`, subagent frames.
- `omp://hooks.md` — `pi.on(...)`, `pi.exec(...)`, event surfaces.
- `omp://tools/irc.md` — peer mailbox bus (not a tail surface); parked-agent revival.
- `omp://sdk.md` — in-process `session.subscribe()` streaming events.
- `omp://collab.md` — Agent Hub / Collab `bus`+`agents` frames, `fetch-transcript`→`transcript`, web client "subagent panel with on-demand transcripts."
- `omp://provider-streaming-internals.md` — `AssistantMessageEvent`/`message_update` live-stream contract.
- `omp://tui-runtime-internals.md` — `subagentContainer`, event-driven incremental UI (context for in-omp rendering).

**Multiplexers / native terminals (primary for Q2)**
- https://man.openbsd.org/tmux.1 — server/socket/control-mode/detach; COMMANDS (`new-pane`/`split-window` `-dP -E -I`, `pipe-pane -I/-O`, `send-keys -l`, `kill-pane`, `respawn-pane`, `display-popup -E`), FORMATS (`pane_id`, `pane_pipe`/`pane_pipe_pid`, `pane_dead*`), `remain-on-exit`.
- https://sw.kovidgoyal.net/kitty/remote-control/ — `kitty @` socket control: `launch`, `new-window`, `send-text`/`send-key`, `get-text`, `close-window`/`close-tab`/`signal-child`, fine-grained perms + custom auth, `rc` protocol.
- https://ghostty.org/docs/features + https://ghostty.org/docs/features/applescript — native splits + **AppleScript dictionary** (`new window/tab`, `split`, `input text`, `send key`, `close`); no socket CLI; TCC Automation prompt; `macos-applescript=false`.
- https://ghostty.org/docs/config/keybind — action model (`text:`/`csi:`/`esc:` send sequences); no remote-control CLI.
- https://iterm2.com/documentation-scripting.html + https://iterm2.com/python-api — AppleScript (create/split/`write text`/`contents`/`close`) + async Python API.
- https://zellij.dev/documentation/creating-a-layout.html + https://zellij.dev/documentation/commands.html + https://github.com/zellij-org/zellij — layouts (`pane command/args/close_on_exit`), `attach`/`list-sessions`/`kill-sessions`, session-attached `action` model.
