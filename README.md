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
| **`omp-agent-gate`** (Plugin A) | extension-package (`package.json#omp.extensions`) | the `tool_call` enforcement gate + the Definition-of-Done rule | `omp plugin install github:<owner>/omp-agent-template` |
| **`orchestrator-agents`** (Plugin B) | marketplace (`.omp-plugin/marketplace.json`) | 7 agent definitions + 8 skills | `omp plugin marketplace add <owner>/omp-agent-template` then `omp plugin install orchestrator-agents@omp-agent-template` |

## Install

```bash
# 1. Plugin A — the gate + rule. Installs user-wide.
omp plugin install github:<owner>/omp-agent-template
# local dev:
omp plugin link ./omp-agent-template

# 2. Plugin B — the agents + skills (marketplace).
omp plugin marketplace add <owner>/omp-agent-template
omp plugin install orchestrator-agents@omp-agent-template

# 3. (optional) drop the advisory scaffold docs into your project root.
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

## Layout

```
package.json                      # Plugin A manifest (omp.extensions)
.omp-plugin/marketplace.json      # Plugin B catalog (pluginRoot=./plugins)
src/enforce-orchestrator.ts       # gate + opt-in + APPEND_SYSTEM inject
src/append-system.default.md      # bundled Elon framing (injection default)
rules/ro-definition-of-done.md    # Plugin A rule (alwaysApply)
plugins/agents/agents/*.md        # 7 agent definitions (Plugin B)
plugins/agents/skills/*/SKILL.md  # 8 skills (Plugin B, co-located)
scaffold/{AGENTS,PROTO,APPEND_SYSTEM,RULES}.md  # advisory docs (init-time copy)
```

## Caveats (verification)

- **APPEND_SYSTEM is advisory, not a true system-prompt append.** No `ExtensionAPI` method
  yields a system-attributed block (`MessageAttribution` is `"user"|"agent"`; the `Message`
  union has no `SystemMessage`; `getSystemPrompt()` is read-only; `appendEntry` is not sent
  to the LLM). The extension re-injects the framing via `sendMessage` (`display:false`,
  queued for the next turn). Do not rely on the prompt alone — the gate enforces the
  contract.
- **`skill://elon` cross-provider resolution** is design-confirmed (skills feed one unified
  registry queried by name) but not runtime-verified here.
- Targeted at `@oh-my-pi/pi-coding-agent` 16.0.x (checked against 16.0.5).
- Plugin code executes **in-process, unsandboxed** when loaded — install only from sources
  you trust. MIT license.
