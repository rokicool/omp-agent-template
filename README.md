# omp-agent-template

A distributable **two-plugin set** for [oh-my-pi](https://omp.sh) (`omp`) that turns a
project into a gated **Elon multi-agent orchestrator** pipeline: a root session runs as
"Elon" (the orchestrator), hard-restricted from implementing directly, and delegates to
7 specialist agents whose `tools:`/`spawns:` frontmatter is harness-enforced.

Because oh-my-pi has two disjoint plugin mechanisms — **extension-package** (Mechanism A,
the only way to load TypeScript extensions + rules) and **marketplace** (Mechanism B, the
only way to ship agent definitions) — this repo publishes **both from one tree**:

| Plugin | Mechanism | Provides | Install |
|---|---|---|---|
| **`omp-agent-gate`** (Plugin A) | extension-package (`package.json#omp.extensions`) | the `tool_call` enforcement gate + the Definition-of-Done rule | `omp plugin install github:<owner>/omp-agent-template#<tag>` |
| **`orchestrator-agents`** (Plugin B) | marketplace (`.omp-plugin/marketplace.json`) | 7 agent definitions + 8 skills | `omp plugin marketplace add <owner>/omp-agent-template` then `omp plugin install orchestrator-agents@omp-agent-template` |


## Quick install (one line)

Installs [oh-my-pi](https://omp.sh) (`omp`) and [bun](https://bun.sh) if missing, then
**both** plugins (`omp-agent-gate` + `orchestrator-agents`):

```bash
curl -fsSL https://raw.githubusercontent.com/rokicool/omp-agent-template/main/elon_ko.sh | bash
```

Pin Plugin A to a release tag with `OMP_AGENT_REF` (the Plugin B marketplace always tracks
latest), and re-run safely — every step is idempotent:

```bash
curl -fsSL https://raw.githubusercontent.com/rokicool/omp-agent-template/main/elon_ko.sh | OMP_AGENT_REF=v1.2.1 bash
```

See [`elon_ko.sh`](./elon_ko.sh) for exactly what it does. For the manual step-by-step, see [Install](#install) below.

## Install

> **Plugin A requires [bun](https://bun.sh).** It is a TypeScript
> extension-package, and `omp` resolves its dependencies with `bun install`. The
> default `omp` installer (binary mode) does **not** install bun — get it with
> `curl -fsSL https://bun.sh/install | bash`, or install `omp` itself with
> `--source` (which installs bun as a side effect). Plugin B needs only `omp`.

```bash
# 1. Plugin A — the gate + rule. Installs user-wide. (requires bun — see above)
#    Pin to a release tag. Switching the ref later needs `omp plugin uninstall omp-agent-gate` first.
omp plugin install github:<owner>/omp-agent-template#v1.2.1
# local dev:
omp plugin link ./omp-agent-template

# 2. Plugin B — the agents + skills (marketplace).
omp plugin marketplace add <owner>/omp-agent-template
omp plugin install orchestrator-agents@omp-agent-template

# 3. (optional) drop advisory scaffold docs into your project root (local overrides/references; the live protocol already ships via `skill://elon` in Plugin B — no copy needed for the orchestrator to function).
cp -r omp-agent-template/scaffold/. .
#   → AGENTS.md, PROTO.md, APPEND_SYSTEM.md, RULES.md
```

## Opt in to the gate (per project)

The gate is **disabled by default**. Plugin A loads in every project that installs it, but
imposes nothing until the project opts in. Precedence (highest wins):

1. `OMP_BYPASS_ORCHESTRATOR=1` — fully OFF (escape hatch; registers nothing).
2. `OMP_ENABLE_ORCHESTRATOR=1` — ON (env opt-in; no marker needed).
3. `<cwd>/.omp/orchestrator.json` with `{"enabled": true}` — ON (project marker).
4. otherwise — dormant.

```bash
echo '{"enabled": true}' > .omp/orchestrator.json   # gate active in this project only
```

The gate enforces (root session, `ctx.hasUI === true`, opted in): `read`/`ask`/`todo` and
team `task` allowed; `write` only to `.app/PROJECT.md`; `bash` only `git …`; everything
else blocked. Subagents (`ctx.hasUI === false`) are never gated — they are restricted by
their own agent frontmatter.

## APPEND_SYSTEM framing

`APPEND_SYSTEM.md` (the Elon role framing) is **not plugin-shippable** by either mechanism,
so Plugin A's extension **re-injects** it at `session_start` as an advisory session message.
A project-local `<cwd>/.omp/APPEND_SYSTEM.md` overrides the bundled default. This is
advisory only — the hard enforcement is the gate + agent frontmatter, not the prompt.

The framing points Elon at `skill://elon` (shipped by Plugin B) for the full protocol — it
does **not** require `AGENTS.md`/`PROTO.md` in the project. Those scaffold docs are optional
local references/overrides; the one-liner installer needs no extra copy step for the
orchestrator to work. If Elon nonetheless tries to `read ./AGENTS.md` or `./PROTO.md` and
fails, you are on a stale build of the plugin — reinstall Plugin A **pinned**, uninstalling
first so the changed ref doesn't trip a `DependencyLoop`:
`omp plugin uninstall omp-agent-gate && omp plugin install github:<owner>/omp-agent-template#v1.2.1`.

## Subagent live tabs

When the orchestrator delegates work to subagents, `subagent-tabs` opens **one native
supaterm tab per subagent** and streams its live activity — so you can watch several
agents work in parallel without losing the main thread. It ships with Plugin A
(`omp-agent-gate`) and is **on by default** wherever that plugin is installed.

### What you see

- A tab opens the instant a subagent actually **starts** (not while it merely waits in
  the queue), labeled `<agentId> · <role>`.
- The tab streams the agent's live transcript in color: assistant message text, tool
  calls (`▸ tool …` on entry, `◂ tool ✓` / `✗` on exit — green / red), color-coded
  notices (`error` / `warning` / `info`), and a `💬 irc` indicator on inter-agent
  messages.
- The tab **survives the subagent's end** for review — completed/failed runs are
  relabeled `[ended] …`, a cancelled run `[ABORTED] …`. Tabs are never auto-closed on
  agent end; they close only when the parent omp session shuts down (or when you close
  one yourself).

> The interactive collapsible widgets live only in omp's `history://<agentId>` view.
> The tab carries their **color and status**, not the collapsible chrome — open
> `history://<agentId>` for the full interactive transcript.

### Enable / disable / tune

All knobs are environment variables, read once at session start:

| Variable | Default | Effect |
|---|---|---|
| `OMP_SUBAGENT_TABS` | enabled | Master switch. `0` or `false` (case-insensitive) disables it; unset or any other value leaves it on. |
| `OMP_SUBAGENT_TABS_RENDER` | `rich` | `rich` streams ANSI color into the tab; `plain` strips it to plain text. |
| `OMP_SUBAGENT_TABS_QUIET_MS` | `30000` | Milliseconds with no activity before a running tab is marked `quiet`. Must be `> 0`, else the default applies. |
| `OMP_SUBAGENT_TABS_HOLDER` | `stty -echo 2>/dev/null; cat` | No-echo holder process the tab runs, so streamed bytes render verbatim instead of executing. |

```bash
# disable for a session
OMP_SUBAGENT_TABS=0 omp

# plain text, 10 s quiet threshold
OMP_SUBAGENT_TABS_RENDER=plain OMP_SUBAGENT_TABS_QUIET_MS=10000 omp
```

### Terminal backend (supaterm, with tmux fallback)

At startup the extension probes once for a usable backend and keeps it for the session:

1. **supaterm** (primary) — native tabs over the `sp` socket; this is what gives you the
   labeled top-bar tabs.
2. **tmux** (fallback) — if the supaterm socket is unreachable, it relays into a detached
   `omp-agents` tmux session, one window per subagent.
3. If neither is available, the relay disables itself and logs a notice — your omp
   session is otherwise unaffected.

### Caveats

- **The backend is chosen once, at startup.** If the supaterm socket dies
  *mid-session*, the relay degrades silently (updates stop) rather than switching to
  tmux — it does not crash. Restart the session to re-probe.
- **No phantom tabs for queued agents.** A tab appears only when a subagent is admitted
  and starts; agents waiting on the concurrency limit get none until they begin.
- **Read-only.** The tab is a live view with no free-text injection. Stop/cancel still
  works through omp's normal job-cancel.

### Verify it live

Open supaterm, run an omp session that spawns 2–4 subagents (for example, an Elon
pipeline), and a tab appears per agent with streaming, colored activity.

## Layout

```
elon_ko.sh                        # one-line installer (deps + both plugins)
package.json                      # Plugin A manifest (omp.extensions)
.omp-plugin/marketplace.json      # Plugin B catalog (pluginRoot=./plugins)
src/enforce-orchestrator.ts       # gate + opt-in + APPEND_SYSTEM inject
src/append-system.default.md      # bundled Elon framing (injection default)
rules/ro-definition-of-done.md    # Plugin A rule (alwaysApply)
plugins/agents/agents/*.md        # 7 agent definitions (Plugin B)
plugins/agents/skills/*/SKILL.md  # 8 skills (Plugin B, co-located)
scaffold/{AGENTS,PROTO,APPEND_SYSTEM,RULES}.md  # advisory docs (init-time copy)
scripts/validate-plugins.sh        # structural validation (CI + release gate)
.github/workflows/ci.yml           # typecheck + validate + omp install smoke-test
.github/workflows/release.yml      # tag -> artifacts + GitHub Release
```

## Releases & CI

Two GitHub Actions workflows gate and ship both plugins.

- **CI** (`.github/workflows/ci.yml`) runs on every push/PR: `tsc --noEmit`
  (Plugin A), `scripts/validate-plugins.sh` (manifest shape + agent/skill
  coverage for both), then installs both through the real `omp` binary as a
  smoke test.
- **Release** (`.github/workflows/release.yml`) fires on a `v*` tag. After the
  same typecheck + validation gate (and an assertion that the tag matches
  `package.json#version`), it publishes a GitHub Release with two consumable
  archives:

| Artifact | Plugin | Local install |
|---|---|---|
| `omp-agent-gate-<ver>.tgz` | A — extension-package (`npm pack`, honors `files`) | extract, then `omp plugin install ./package` |
| `orchestrator-agents-<ver>.tar.gz` | B — self-contained marketplace (`.omp-plugin/` + `plugins/`) | extract, then `omp plugin marketplace add ./<dir>` |

omp consumes plugins straight from git, so **the tag itself is the distribution
pin** — the attached archives are for offline/pinned/local installs, and the
release notes carry the exact install commands for that version.

```bash
# cut a release (version must match package.json#version)
git tag v1.2.1 && git push origin v1.2.1

# install a pinned version straight from the tag
omp plugin install github:<owner>/omp-agent-template#v1.2.1
```

## Caveats (verification)

- **APPEND_SYSTEM is advisory, not a true system-prompt append.** No `ExtensionAPI` method
  yields a system-attributed block (`MessageAttribution` is `"user"|"agent"`; the `Message`
  union has no `SystemMessage`; `getSystemPrompt()` is read-only; `appendEntry` is not sent
  to the LLM). The extension re-injects the framing via `sendMessage` (`display:false`,
  queued for the next turn). Do not rely on the prompt alone — the gate enforces the
  contract.
- **Plugin A install requires bun.** `omp plugin install` of an extension-package
  runs `bun install` to resolve `package.json` deps, and the omp binary installer
  ships no bun — so on a default clean install Plugin A fails with
  `Executable not found in $PATH: "bun"` until bun is present. Plugin B (agents +
  skills, pure markdown) is unaffected. Verified in a clean container; see the
  note under [Install](#install).
- **`skill://elon` is Elon's primary protocol source** (shipped by Plugin B; structural
  resolution confirmed by `scripts/validate-plugins.sh`). Live-session resolution still
  depends on the omp skills provider scanning the plugin's `skills/` tree; if a session ever
  fails to resolve it, the bundled APPEND_SYSTEM framing above is sufficient for Elon to route.
- Targeted at `@oh-my-pi/pi-coding-agent` 16.x (install path re-verified against 16.1.16 in a clean-container install).
- Plugin code executes **in-process, unsandboxed** when loaded — install only from sources
  you trust. MIT license.
