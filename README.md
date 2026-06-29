# elon-ko

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
| **`elon-ko-gate`** | The enforcement **gate** (the root session can only route — direct `edit`/`write`/build are hard-blocked), a Definition-of-Done rule. |
| **`elon-ko-agents`** | **7 specialist agents** + **8 skills**: `reqguru`, `drpe`, `leaddev`, `middev`, `validator`, `docworm`, `hr` (plus the `elon` orchestrator protocol). |

oh-my-pi has two disjoint plugin mechanisms — TypeScript extensions vs. agent
marketplaces — so this repo ships **both from one tree**. You don't deal with
that; the installer wires them up.

## Why use it

- **Non-bypassable delegation.** The orchestrator seat is enforced by a
  `tool_call` gate plus per-agent `tools:`/`spawns:` frontmatter — runtime
  blocks, not prose. A blocked tool throws.
- **A real pipeline.** Requests flow through gated phases (requirements →
  research → spec → develop ⇄ validate), each owned by the right specialist.
- **Opt-in per project.** The gate is dormant by default; you switch it on
  project-by-project.

## Prerequisites

- **[oh-my-pi](https://omp.sh) (`omp`)** — the runtime.
- **[bun](https://bun.sh)** — required only by `elon-ko-gate` (a TypeScript
  extension-package; `omp` resolves its deps with `bun install`). Plugin B
  (agents + skills) is pure markdown and needs only `omp`.

The one-line installer below fetches both if they're missing.

## Quick install (one line)

Installs `omp` and `bun` if missing, then **both** plugins:

```bash
curl -fsSL https://raw.githubusercontent.com/rokicool/elon-ko/main/elon_ko.sh | bash
```

Pin `elon-ko-gate` to a release tag (Plugin B always tracks latest);
re-running is idempotent — every step is safe to repeat:

```bash
curl -fsSL https://raw.githubusercontent.com/rokicool/elon-ko/main/elon_ko.sh | OMP_AGENT_REF=v2.2.0 bash
```

See [`elon_ko.sh`](./elon_ko.sh) for exactly what it runs.

## Testing a pre-release

Every push to a branch (other than `main`) is automatically published as a
**pre-release** tagged `pr-<branch>-<short-sha>` (see
[`.github/workflows/prerelease.yml`](./.github/workflows/prerelease.yml)). Pass
that tag to `elon_ko.sh` to install **both** plugins pinned to that exact ref —
for testing work that is not yet released to production:

```bash
# from the pre-release's GitHub Release page, copy its tag (e.g. pr-dev-abc1234):
curl -fsSL https://raw.githubusercontent.com/rokicool/elon-ko/pr-dev-abc1234/elon_ko.sh | bash -s -- pr-dev-abc1234
```

This differs from `OMP_AGENT_REF` (which pins **only** Plugin A, with Plugin B
still tracking latest): passing a tag pins **Plugin A and Plugin B** to that
tag. Because omp marketplaces cannot be ref-pinned, Plugin B is fetched as the
tag's source tarball and registered as a local marketplace
(`~/.omp-prerelease/<tag>/`). The same command works on a clean machine, in a
docker container, and on a machine where a stable or older pre-release version
is already installed — re-running re-registers the marketplace to the selected
source every time.

To return to the latest **stable** release, re-run with no argument:

```bash
curl -fsSL https://raw.githubusercontent.com/rokicool/elon-ko/main/elon_ko.sh | bash
```

## Manual install

```bash
# 1. Plugin A — the gate + rule (installs user-wide; requires bun).
#    Pin to a release tag. Switching the ref later needs `omp plugin uninstall elon-ko-gate` first.
omp plugin install github:rokicool/elon-ko#v2.2.0
# local dev / linking:
omp plugin link ./elon-ko

# 2. Plugin B — the agents + skills (marketplace).
omp plugin marketplace add rokicool/elon-ko
omp plugin install elon-ko-agents@elon-ko
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

When active, your root session is Elon: it may `read`/`ask`/manage todos,
`job` (inspect/wait on async agent jobs), `irc` (live coordination with parallel
sibling agents — not a substitute for spawning), spawn **team agents**
(`reqguru`, `drpe`, `leaddev`, `validator`, `docworm`, `hr`), write only
`.app/PROJECT.md`, and run only `git …`. Everything else (direct `edit`,
`write`, builds, search, browse, …) is blocked — it must delegate.
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

## Subagent observability panel

> **Available since v1.8.0.** The `subagent-panel` extension ships with the v1.8.0 release — install it via the one-line installer (`elon_ko.sh`), or pin Plugin A to `github:rokicool/elon-ko#v1.8.0`.

A live view of the subagents your orchestrator spawns. The `subagent-panel` extension keeps a live event store fed by the `task:subagent:*` bus and surfaces it two ways: an on-demand **`Alt+S`** full-table overlay, and an optional compact panel above (or below) the editor that streams per-subagent stats — status, agent, task, tool count, requests, context %, cost, and resolved model — plus a one-line tail of the most-active agent's current work and an aggregate header. **The persistent panel is OFF by default** so elon-ko COMPLEMENTS omp's native Agent Hub instead of stacking a second live widget on the same surface — which raced both renders on every `task:subagent:*` event and a 1 s tick, flickering the region. The live event store and the `Alt+S` overlay stay active regardless; set `OMP_SUBAGENT_PANEL_PERSIST=1` to restore the always-on compact panel. A 1 s tick only refreshes elapsed durations and sweeps finished rows, and the extension redraws only its own widget — purely additive, it complements (does not replace) the built-in subagent HUD, status line, and Agent Hub.

**Not gated by the orchestrator opt-in.** Unlike `dot-agreement` and `mess-transport`, this extension does not require `OMP_ENABLE_ORCHESTRATOR=1` or `.omp/elon.json`. It is registered in `package.json#omp.extensions`, so it loads wherever Plugin A (`elon-ko-gate`) is installed, and activates in any **interactive TUI session** — it no-ops when `ctx.hasUI` is false (headless, RPC, subagent, and print paths). Install Plugin A and run `omp` interactively; the live event store and the `Alt+S` overlay are active by default — the always-on compact panel needs `OMP_SUBAGENT_PANEL_PERSIST=1` (it's off by default so it complements omp's native Agent Hub instead of racing it).

**What you see.**

- *Persistent panel (≤ 10 lines, above the editor; **off by default**).* Enable it with `OMP_SUBAGENT_PANEL_PERSIST=1` — otherwise only the `Alt+S` overlay is shown. An aggregate header — `Subagents: N active · M done │ Σ <tokens> tok · $<cost>` — followed by one compact row per running subagent, e.g.:

  ```
  ▸ AuthLoader · wire JWT flow into session middleware   42🔧 18 req 61.3%/200K $1.04 zai/glm-5.2
  ⏸ RateWatch · retry-after 429                          3🔧 1 req 0.9%/200K $0.02 zai/glm-5.2 (retry 2/5)
  ```

  a one-line tail of the most-active agent's work (`↳ AuthLoader: writing src/auth/session.ts …`), and — when more agents run than fit — an overflow hint (`… +R more (Alt+S for all)`). With zero agents it collapses to a single idle line (`Subagents: idle (0 active) · Alt+S to open table`), or hides entirely when `OMP_SUBAGENT_PANEL_HIDE_EMPTY=1`. Status icons: `▸` running · `⏸` parked/retrying · `✓` completed · `✗` failed · `⊘` aborted.

- *Full table overlay (Alt+S).* A scrollable list of **all** agents with no 10-line cap and a column per stat; `↑`/`↓`/`PgUp`/`PgDn`/`Home`/`End` scroll, and `Alt+S`, `Esc`, or `q` close it. The footer shows the current viewport range and total.

**Knobs** — read once at session start:

| Variable | Default | Effect |
|---|---|---|
| `OMP_SUBAGENT_PANEL_PERSIST` | unset | `1` enables the always-on compact panel above/below the editor. **Off by default** — the panel complements omp's native Agent Hub instead of racing it; the live event store and `Alt+S` overlay stay active either way. |
| `OMP_SUBAGENT_PANEL_KEY` | `Alt+S` | Overlay toggle chord. |
| `OMP_SUBAGENT_PANEL_PLACEMENT` | `aboveEditor` | `aboveEditor` \| `belowEditor`. |
| `OMP_SUBAGENT_PANEL_HIDE_EMPTY` | unset | `1` hides the panel when zero agents run. |
| `OMP_SUBAGENT_PANEL_SHOW_SYNC` | unset | `1` includes synchronous spawns (default: detached only, matching the built-in HUD). |
| `OMP_SUBAGENT_PANEL_DONE_TTL_MS` | `30000` | How long a finished agent's frozen row is retained (ms). |
| `OMP_SUBAGENT_PANEL_MIN_RENDER_MS` | `200` | Panel re-render throttle (ms). |

**Known limits.** Agent identity (role label, parent, unread count) is derived from the live event payloads, not the IRC registry — there is no in-process accessor for the registry's `displayName`/`parent`/`unread`, so the overlay has no parent column. The toggle is registered via `pi.registerShortcut`, which does not expose a `keybindings.yml` action id; use `OMP_SUBAGENT_PANEL_KEY` to change the chord.

## FAQ

- **Do I need bun?** Only for Plugin A (`elon-ko-gate`). Plugin B is pure
  markdown. The one-line installer adds bun if missing.
- **Is anything enforced before I opt in?** No. The gate is dormant until
  `OMP_ENABLE_ORCHESTRATOR=1` or `.omp/elon.json` opts the project in.
- **Can I turn it off in a hurry?** Yes — `OMP_BYPASS_ORCHESTRATOR=1` fully
  disables the root guard (emergencies only; lets you patch a file by hand).
- **It installed, but the root session isn't gated.** The project hasn't opted
  in. Add `.omp/elon.json` (see above) or set `OMP_ENABLE_ORCHESTRATOR=1`.
- **Switching the Plugin A ref gives a `DependencyLoop`.** Uninstall first:
  `omp plugin uninstall elon-ko-gate`, then install the new pinned ref. (The
  one-line installer does this for you.)
- **Is it safe to install?** Plugin code runs **in-process, unsandboxed** when
  loaded — install only from sources you trust. MIT licensed.

## For developers / maintainers

Repo layout, the two-mechanism architecture, how to add or modify agents,
skills, and extensions, the enforcement internals, build/test/release, and
troubleshooting live in **[.DEVREADME.md](./.DEVREADME.md)**.
