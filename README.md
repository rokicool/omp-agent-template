# omp-agent-template

A two-plugin set for [oh-my-pi](https://omp.sh) (`omp`) that turns your project
into a **gated, multi-agent orchestrator pipeline**. Your root `omp` session runs
as **Elon** — an orchestrator that routes, gates, and relays work to a roster of
specialist agents — and is *physically prevented* from implementing directly.
Delegation is enforced by the harness, not by prompt instructions, so the model
cannot bypass it.

> Maintaining, extending, or releasing this plugin set itself? That material
> lives in **[.DEVREADME.md](./.DEVREADME.md)**.

## What you get

Two plugins, installed together:

| Plugin | What it provides |
|---|---|
| **`omp-agent-gate`** | The enforcement **gate** (the root session can only route — direct `edit`/`write`/build are hard-blocked), a Definition-of-Done rule, and **live subagent tabs** (one terminal tab per running agent, streaming colored activity). |
| **`orchestrator-agents`** | **7 specialist agents** + **8 skills**: `reqguru`, `drpe`, `leaddev`, `middev`, `validator`, `docworm`, `hr` (plus the `elon` orchestrator protocol). |

oh-my-pi has two disjoint plugin mechanisms — TypeScript extensions vs. agent
marketplaces — so this repo ships **both from one tree**. You don't deal with
that; the installer wires them up.

## Why use it

- **Non-bypassable delegation.** The orchestrator seat is enforced by a
  `tool_call` gate plus per-agent `tools:`/`spawns:` frontmatter — runtime
  blocks, not prose. A blocked tool throws.
- **A real pipeline.** Requests flow through gated phases (requirements →
  research → spec → develop ⇄ validate), each owned by the right specialist.
- **Visible parallelism.** When Elon delegates to subagents, a tab opens per
  agent and streams live, colored activity.
- **Opt-in per project.** The gate is dormant by default; you switch it on
  project-by-project.

## Prerequisites

- **[oh-my-pi](https://omp.sh) (`omp`)** — the runtime.
- **[bun](https://bun.sh)** — required only by `omp-agent-gate` (a TypeScript
  extension-package; `omp` resolves its deps with `bun install`). Plugin B
  (agents + skills) is pure markdown and needs only `omp`.

The one-line installer below fetches both if they're missing.

## Quick install (one line)

Installs `omp` and `bun` if missing, then **both** plugins:

```bash
curl -fsSL https://raw.githubusercontent.com/rokicool/omp-agent-template/main/elon_ko.sh | bash
```

Pin `omp-agent-gate` to a release tag (Plugin B always tracks latest);
re-running is idempotent — every step is safe to repeat:

```bash
curl -fsSL https://raw.githubusercontent.com/rokicool/omp-agent-template/main/elon_ko.sh | OMP_AGENT_REF=v1.4.0 bash
```

See [`elon_ko.sh`](./elon_ko.sh) for exactly what it runs.

## Manual install

```bash
# 1. Plugin A — the gate + rule + live tabs (installs user-wide; requires bun).
#    Pin to a release tag. Switching the ref later needs `omp plugin uninstall omp-agent-gate` first.
omp plugin install github:rokicool/omp-agent-template#v1.4.0
# local dev / linking:
omp plugin link ./omp-agent-template

# 2. Plugin B — the agents + skills (marketplace).
omp plugin marketplace add rokicool/omp-agent-template
omp plugin install orchestrator-agents@omp-agent-template
```

## Switch it on (per project)

The gate is **dormant by default** — Plugin A loads everywhere but imposes
nothing until a project opts in. Precedence (highest wins):

1. `OMP_BYPASS_ORCHESTRATOR=1` — fully **OFF** (escape hatch).
2. `OMP_ENABLE_ORCHESTRATOR=1` — **ON** (env opt-in; no marker needed).
3. `<cwd>/.omp/elon.json` with `{"enabled": true}` — **ON** (project marker).
4. otherwise — **dormant**.

```bash
echo '{"enabled": true}' > .omp/elon.json   # gate active in this project only
```

When active, your root session is Elon: it may `read`/`ask`/manage todos, spawn
**team agents** (`reqguru`, `drpe`, `leaddev`, `validator`, `docworm`, `hr`),
write only `.app/PROJECT.md`, and run only `git …`. Everything else (direct
`edit`, `write`, builds, search, browse, …) is blocked — it must delegate.
Subagents are never gated by this; they're restricted by their own agent
frontmatter.

## Using it

Once the gate is on for a project, just talk to `omp` normally:

- Describe what you want. Elon **classifies** it (a small fix → *TRIVIAL*; a
  feature or architecture change → *FULL*) and routes it through the right phases.
- Elon may **ask you clarifying questions** (relayed from `reqguru`) and feed
  your answers back — it is the only seat that talks to you.
- Specialist agents do the work in their own isolated contexts; Elon reviews and
  integrates.
- Protocol artifacts land in `.app/` (`REQ.md`, `RESEARCH.md`, `SPEC.md`,
  `PROJECT.md`), committed by Elon at phase gates.

You'll see delegation happen as `task(agent="<name>", …)` calls in the transcript.

## Live subagent tabs

Whenever Elon delegates to a subagent, a tab opens per agent and streams live
activity — on by default wherever `omp-agent-gate` is installed.

**What you see**

- A tab opens the instant a subagent actually **starts** (not while queued),
  labeled `<agentId> · <role>`.
- It streams the agent's transcript in color: tool calls (`▸ …` entering, `◂ ✓` /
  `✗` on exit — green / red), color-coded notices (`error` / `warning` / `info`),
  and a `💬 irc` marker on inter-agent messages.
- Tabs **survive the subagent's end** for review: completed/failed runs show
  `[ended] …`, a cancelled run `[ABORTED] …`. They close when the parent `omp`
  session shuts down (or when you close one).
- Interactive collapsible widgets live only in `omp`'s `history://<agentId>`
  view; the tab carries their color and status, not the collapsible chrome —
  open `history://<agentId>` for the full interactive transcript.

**Tune it** — environment variables, read once at session start:

| Variable | Default | Effect |
|---|---|---|
| `OMP_SUBAGENT_TABS` | enabled | Master switch. `0` or `false` (case-insensitive) disables it; unset or any other value leaves it on. |
| `OMP_SUBAGENT_TABS_TMUX_SESSION` | `omp-subagents` | Name of the shared tmux session that holds one window (tab) per subagent. |
| `OMP_SUBAGENT_TABS_FOCUS` | off | When set to a truthy value (`1`/`true`/anything other than `0`/`false`), each new tab is selected (`tmux select-window`) and the Ghostty viewer is best-effort raised. Unset leaves new tabs in the background. |
| `OMP_SUBAGENT_TABS_RENDER` | `rich` | `rich` streams ANSI color into the tab; `plain` strips it to plain text. |
| `OMP_SUBAGENT_TABS_QUIET_MS` | `30000` | Milliseconds with no activity before a running tab is marked `quiet`. Must be `> 0`, else the default applies. |

```bash
OMP_SUBAGENT_TABS=0 omp                                  # off for this session
OMP_SUBAGENT_TABS_FOCUS=1 omp                            # focus + raise each new tab
OMP_SUBAGENT_TABS_RENDER=plain OMP_SUBAGENT_TABS_QUIET_MS=10000 omp   # plain text, 10 s quiet threshold
```

The backend is **tmux**: one shared session (default `omp-subagents`, set via
`OMP_SUBAGENT_TABS_TMUX_SESSION`) holds one tmux window per subagent — those
windows *are* the tabs. On the first subagent to start, **one** Ghostty window is
opened (once, if Ghostty is installed) attached to that session, so every
subagent appears as a tab inside the single viewer. If tmux isn't available the
feature becomes an invisible no-op (the subagent still runs; one log line is
emitted) — install tmux and restart the session to re-probe. Tabs are read-only
views; cancel via `omp`'s normal job-cancel. (Backend internals — including why
there is one viewer window rather than one per subagent — are documented in
[.DEVREADME.md](./.DEVREADME.md).)

## Dot-agreement token & cross-instance messaging

Two opt-in extensions ship alongside the gate: a `.` agreement token for the root orchestrator, and cross-instance messaging for agents running in separate `omp` processes. Both follow the **same opt-in as the gate** (`OMP_ENABLE_ORCHESTRATOR=1` or `.omp/elon.json` with `{"enabled": true}`) and are dormant otherwise.

**Dot-agreement token (C1).** The root orchestrator (Elon) accepts a lone `.` as explicit agreement with the most-recent **pending ask** recorded in `.app/PROJECT.md`. The token triggers **only** when the trimmed reply is `.` — so whitespace-padded forms (`. ` , ` .`) also count, while inputs with embedded or repeated dots (`v1.2`, `ok.`, `3.14`, `..`) are literal text; affirmatives (`yes`, `ok`, `y`, `sure`) are ordinary input, **not** the token. On agreement Elon marks the ask `status=agreed`; if no pending ask is recorded he asks what you are agreeing to. The advisory framing is re-injected each session by `enforce-orchestrator`, and the `dot-agreement` extension hook surfaces the pending-ask context on the `.` turn.

**Cross-instance messaging (C2).** When team agents run in **separate `omp` processes** that share the same `.app/` directory on disk, messages addressed to a remote agent are written to `.app/mess/` and picked up by the receiver's detection — a turn-start scan plus an idle poll. Co-located agents (same process) keep using normal in-app delivery. Implemented by the `mess-transport` extension, which exposes the `mess-send` and `mess-fail` tools on team agents: reply to an inbound message with `mess-send` (setting `inReplyTo` to the received id) to mark it processed; call `mess-fail({id, reason})` to reject it.

**Knobs** — read once at session start:

| Variable | Default | Effect |
|---|---|---|
| `OMP_MESS_POLL_MS` | `2000` | Idle-poll interval (ms) for inbound messages. |
| `OMP_MESS_CLAIM_STALE_MS` | `300000` | A claimed message is considered stale after this many ms and becomes re-claimable. |
| `OMP_INSTANCE_ID` | auto-derived | Overrides the local instance id used to address and claim messages. |

**Setting up cross-instance messaging.** This is a power feature — most projects never need it: co-located agents (the common case) always use in-app delivery. It only matters when you run **two or more `omp` processes** that share the same project directory (and therefore the same `.app/` on disk). To wire it up:

1. **Opt in** the project, exactly as for the gate — C2 follows the same opt-in contract: `OMP_ENABLE_ORCHESTRATOR=1`, or `.omp/elon.json` with `{"enabled": true}`. Both extensions (`dot-agreement`, `mess-transport`) stay dormant otherwise.
2. **Give each instance a stable id.** Each `omp` process resolves its instance id in this order: the `OMP_INSTANCE_ID` env var ▸ the `self` field persisted in `.app/instances.json` ▸ an auto-generated `inst-<uuid>` (written to `.app/instances.json#self` on first run). For a fixed two-process setup, export a distinct `OMP_INSTANCE_ID` per process.
3. **Declare which agents are remote.** Create `.app/instances.json` mapping each agent that runs in a *different* instance to its instance id. Agents **absent** from the map default to co-located (in-app delivery); the user is never a valid recipient.

   ```json
   {
     "self": "inst-1",
     "agents": { "middev": "inst-2", "leaddev": "inst-2" }
   }
   ```

   Here `middev` and `leaddev` are declared remote (instance `inst-2`); every other agent is co-located and uses in-app delivery.

When a team agent sends to a remote receiver, `mess-send` writes a file to `.app/mess/`; the receiver detects it (turn-start scan + idle poll) and delivers it as a normal turn. Replies/acks are also `mess-send` calls with `inReplyTo` set — there is no separate completion tool.

**Debugging `.app/mess/`.** Each message is a markdown file named `<from>-<to>-<YYYYMMDDTHHMMSSZ>.md` (a `-NN` suffix breaks same-second collisions) with YAML frontmatter — `from`, `to`, `timestamp`, `type`, `in-reply-to`, plus `from-instance`/`to-instance` for cross-instance routing (`type` ∈ `DELEGATION`, `DELIVERABLE`, `QUESTION_BATCH`, `FAILURE`, `HANDOFF`). Lifecycle:

- `.app/mess/<file>.md` — **PENDING** (written, not yet detected).
- `.app/mess/<file>.claim/` present — **CLAIMED** (exactly one instance owns it; a claim older than `OMP_MESS_CLAIM_STALE_MS` / 5 min is reaped so a crashed processor's message is recovered).
- `.app/mess/arc/<file>.md` — **PROCESSED** (the receiver replied) or **FAILED** (after 3 attempts, with a `## FAILURE` annotation). `arc/` is kept indefinitely — nothing is auto-deleted.

## FAQ

- **Do I need bun?** Only for Plugin A (`omp-agent-gate`). Plugin B is pure
  markdown. The one-line installer adds bun if missing.
- **Is anything enforced before I opt in?** No. The gate is dormant until
  `OMP_ENABLE_ORCHESTRATOR=1` or `.omp/elon.json` opts the project in.
- **Can I turn it off in a hurry?** Yes — `OMP_BYPASS_ORCHESTRATOR=1` fully
  disables the root guard (emergencies only; lets you patch a file by hand).
- **It installed, but the root session isn't gated.** The project hasn't opted
  in. Add `.omp/elon.json` (see above) or set `OMP_ENABLE_ORCHESTRATOR=1`.
- **Switching the Plugin A ref gives a `DependencyLoop`.** Uninstall first:
  `omp plugin uninstall omp-agent-gate`, then install the new pinned ref. (The
  one-line installer does this for you.)
- **Is it safe to install?** Plugin code runs **in-process, unsandboxed** when
  loaded — install only from sources you trust. MIT licensed.

## For developers / maintainers

Repo layout, the two-mechanism architecture, how to add or modify agents,
skills, and extensions, the enforcement internals, build/test/release, and
troubleshooting live in **[.DEVREADME.md](./.DEVREADME.md)**.
