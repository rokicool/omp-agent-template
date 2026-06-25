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
curl -fsSL https://raw.githubusercontent.com/rokicool/omp-agent-template/main/elon_ko.sh | OMP_AGENT_REF=v1.3.1 bash
```

See [`elon_ko.sh`](./elon_ko.sh) for exactly what it runs.

## Manual install

```bash
# 1. Plugin A — the gate + rule + live tabs (installs user-wide; requires bun).
#    Pin to a release tag. Switching the ref later needs `omp plugin uninstall omp-agent-gate` first.
omp plugin install github:rokicool/omp-agent-template#v1.3.1
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

Whenever Elon delegates to a subagent, a native terminal tab opens per agent and
streams live activity — on by default wherever `omp-agent-gate` is installed.

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
| `OMP_SUBAGENT_TABS_RENDER` | `rich` | `rich` streams ANSI color into the tab; `plain` strips it to plain text. |
| `OMP_SUBAGENT_TABS_QUIET_MS` | `30000` | Milliseconds with no activity before a running tab is marked `quiet`. Must be `> 0`, else the default applies. |
| `OMP_SUBAGENT_TABS_HOLDER` | `stty -echo 2>/dev/null; cat` | No-echo holder process the tab runs, so streamed bytes render verbatim instead of executing. |

```bash
OMP_SUBAGENT_TABS=0 omp                                  # off for this session
OMP_SUBAGENT_TABS_RENDER=plain OMP_SUBAGENT_TABS_QUIET_MS=10000 omp   # plain text, 10 s quiet threshold
```

The terminal backend (supaterm primary, tmux fallback) is chosen once at startup.
If the supaterm socket dies mid-session, the relay degrades silently rather than
crashing — restart the session to re-probe. Tabs are read-only views; cancel via
`omp`'s normal job-cancel. (Backend internals are documented in
[.DEVREADME.md](./.DEVREADME.md).)

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
