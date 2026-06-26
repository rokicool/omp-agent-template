# RESEARCH — Cross-Instance File Transport + Dot Agreement Token

**Phase:** RESEARCH (DrPe, read-only)
**Status:** VERIFIED — every finding below is grounded in source the LeadDev re-read directly during SPEC. File paths are relative to the repo root or to `node_modules/@oh-my-pi/pi-coding-agent/`.
**Sensitivity:** P2 (user-confirmed) — instances run on the SAME machine sharing a LOCAL filesystem. Network sync is explicitly OUT OF SCOPE. Designs below target local shared disk; network-mount caveats are noted as risks only.

This repo (`~/github/omp-agent-template`) IS THE SOURCE of both plugins, so every "fact" is editable source, not an immutable external binary:
- **Plugin A — `omp-agent-gate`**: `src/enforce-orchestrator.ts`, `src/subagent-tabs.ts`, `src/append-system.default.md`, `rules/`. Registered via `package.json#omp.extensions`.
- **Plugin B — `orchestrator-agents`**: rooted at `./plugins/agents/`. Agent definitions at `plugins/agents/agents/*.md`; skills at `plugins/agents/skills/<name>/SKILL.md`. `skill://elon` resolves to `plugins/agents/skills/elon/SKILL.md`. There is **no `elon.md` agent definition** — Elon is the root interactive session, not a spawned agent.

---

## F1 — INSTANCE IDENTITY (R3.3 / P3)

**Finding.** No reusable instance / process / session id exists in the omp runtime surface exposed to extensions.

**Evidence.**
- `AgentRegistry` and `IrcBus` are **process-global singletons** (`AgentRegistry.global()`, `IrcBus.global()`), keyed by *agent id* (e.g. `"Main"`, `"LeadDev"`), never by instance/process.
  - `node_modules/@oh-my-pi/pi-coding-agent/src/registry/agent-registry.ts:59-72` (`static global()`, `#refs = new Map<string, AgentRef>`).
  - `node_modules/@oh-my-pi/pi-coding-agent/src/irc/bus.ts:49-57` (`static global()`); `MAIN_AGENT_ID = "Main"` at `agent-registry.ts:15`.
- `ExtensionContext` exposes **`cwd`, `hasUI`, `isIdle()`, `hasPendingMessages()`, `getSystemPrompt()`, `sessionManager`, `modelRegistry`, `memory`** — and **NO** instance/process/session id.
  - `node_modules/@oh-my-pi/pi-coding-agent/src/extensibility/extensions/types.ts:325-356`.

**Implication (BUILD).** An instance id must be **SUPPLIED**. Provisioning mechanism designed in SPEC §R3:
- Precedence: `OMP_INSTANCE_ID` env ▸ `.app/instances.json#self` ▸ auto-generated `inst-<crypto.randomUUID()>` persisted into `.app/instances.json#self` on first run.
- Concurrent instances get distinct ids (UUID); an instance's id is stable across restarts (persisted). Satisfies R3.3 AC.

---

## F2 — IN-APP "UNREACHABLE" RETURN SHAPE (defines R4.2 fallback trigger)

**Finding.** `IrcBus.send()` to a receiver absent from THIS process's registry returns a **RESOLVED receipt** `{ outcome: "failed", error: 'Unknown or terminated agent "R".' }` — it does **NOT** throw.

**Evidence.** `node_modules/@oh-my-pi/pi-coding-agent/src/irc/bus.ts:95-100`:
```ts
async send(msg, opts?): Promise<IrcDeliveryReceipt> {
  const ref = this.#registry.get(message.to);
  if (!ref || ref.status === "aborted") {
    return { to: message.to, outcome: "failed", error: `Unknown or terminated agent "${message.to}".` };
  }
  ...
}
```
`IrcDeliveryReceipt` shape: `{ to: string; outcome: "injected" | "woken" | "revived" | "failed"; error?: string }` (`irc/bus.ts:34-38`).

**Finding (task has no remote semantic).** `task()` spawns a **new in-process subagent**; it cannot target an agent in another instance. Cross-instance delivery is therefore **irc-shaped** (fire-and-forget peer messaging / delegation payloads), not task-shaped. The file message `type` enum (R2.5) *mirrors* `task()` return semantics (DELEGATION/DELIVERABLE/…) as a payload convention, but the transport is invoked at the send/irc layer.

**Implication (BUILD).** The transport-selection fallback signal is the irc receipt `outcome === "failed"` with the "Unknown or terminated agent" error. SPEC wires this inside the `mess-send` tool: a co-located send whose `IrcBus.send()` returns `failed` falls back to writing a file (R4.2).

**Corroborating extension hook.** A `tool_result` post-call hook exists (`types.ts:1012`, `ToolResultEventResult` at `shared-events.ts:288-295`) that can **modify** a tool result and carries `input` + `content` (`ToolResultEventBase`, `types.ts:717-723`). It can observe a raw `irc` call's failed receipt and is available as an optional secondary fallback path (the primary path is the `mess-send` tool).

---

## F3 — ATOMICITY & LOCK PATTERN (R5.4 / R2.6 / R2.7)

**Finding.** On a local volume, `fs.rename` (POSIX `rename(2)`) is **atomic** and replaces/creates the destination in one step. `.app/mess/`, `.app/mess/arc/`, and any sibling subdir (e.g. `.app/mess/claimed/`) are the **same volume** (all under `.app/mess/`), so:
- terminal moves `.app/mess/ → arc/` (R2.6/R2.7) are atomic;
- an exclusive-claim move into a `claimed/` subdir is atomic and race-free.

**Reusable lock pattern (re-implement, do NOT import).** `node_modules/@oh-my-pi/pi-coding-agent/src/config/file-lock.ts`:
- `tryAcquireLock` (`:71-83`): `fs.mkdir(lockPath)`; on success write a token file inside; `EEXIST` ⇒ already held, return `null`.
- `releaseLock` (`:85-105`): token-ownership check then `fs.rm(lockPath,{recursive:true})`; a non-owner release is a no-op (never wipes a rightful owner).
- `isLockStale` (`:50-69`): **both** PID-based (`isProcessAlive`) **and** time-based (`Date.now() - ts > staleMs`).
- Marked `__internalsForTesting` (`:153-164`) — **NOT public API. Must re-implement the pattern in-plugin; do not import the internal module.**

**Decision.** Use **time-based staleness only** for the claim/reclaim logic. PID-based `isProcessAlive` is local-process-only and unsafe across machines (incorrect if the holding process differs); time-based is correct and general even though P2 is local. SPEC uses a mkdir claim-marker `.app/mess/<file>.claim/` + token + `ts`, with time-based reaping, OR an atomic rename into `.app/mess/claimed/` — see SPEC §R5.4 for the chosen mechanism.

**No runtime deps.** `package.json` has **zero** runtime dependencies (`devDependencies` only: `@oh-my-pi/pi-coding-agent`, `@types/node`, `typescript`). **Use Node `fs` built-ins only; do not add dependencies.**

---

## F4 — DETECTION LEVERS (R5)

**Finding.** There is **NO** scheduler hook and **NO** file-watch hook in the extension event catalog. `fs.watch` works locally (kqueue) but **NOT** over network mounts — so a poll is the robust correct choice for P2 and forward-compatible.

**Available native levers** (`node_modules/@oh-my-pi/pi-coding-agent/src/extensibility/extensions/types.ts:961-1014`):
- `turn_start` (`TurnStartEvent { turnIndex, timestamp }`, `shared-events.ts:197-201`) — fired at the start of each turn.
- `agent_start` (`AgentStartEvent`, `shared-events.ts:186-188`) — fired when an agent loop starts (once per user prompt).
- `before_agent_start` (`BeforeAgentStartEvent { prompt, images?, systemPrompt }`, `types.ts:522-528`) — fired after the user submits a prompt, **before** the agent loop; result `BeforeAgentStartEventResult { message?, systemPrompt? }` (`:875-879`) can inject a model-visible `CustomMessage` for the turn. *(This is also the C1 hardening hook — see §C1 below.)*
- `context` (`ContextEvent { messages: AgentMessage[] }`, `shared-events.ts:177-181`; result `ContextEventResult { messages? }`, `types.ts:843-845`) — fired before each LLM call; the deep-copied `messages[]` are safe to modify. Exposes the latest user message.
- `input` (`InputEvent { text, images?, source }`, `types.ts:637-643`; result `InputEventResult { handled?, text?, images? }`, `:851-859`) — fired when the user submits input (interactive only); can replace/consume input.
- `session_stop` (`SessionStopEvent`, `shared-events.ts:96-105`; result `SessionStopEventResult { continue?, additionalContext?, decision?, reason? }`, `:343-353`) — fired when a main-agent turn is about to settle; handlers may **request one continuation turn** with model-visible `additionalContext`.
- `ctx.isIdle()` / `ctx.hasPendingMessages()` (`types.ts:345,349`) — runtime predicates.
- `pi.sendMessage({customType,content,display,attribution},{deliverAs:"nextTurn",triggerTurn})` (`types.ts:1083-1086`) — injects hidden next-turn context; `triggerTurn:true` schedules an internal continuation.
- `pi.sendUserMessage(content,{deliverAs:"steer"|"followUp"})` (`:1089-1092`).

**Runtime imports needed for receive-side delivery.** The package export map exposes subpaths: `"./*": "./src/*.ts"` (`node_modules/@oh-my-pi/pi-coding-agent/package.json#exports`). Therefore:
- `import { IrcBus } from "@oh-my-pi/pi-coding-agent/irc/bus"` — resolves to `src/irc/bus.ts` (`export class IrcBus`).
- `import { AgentRegistry, MAIN_AGENT_ID } from "@oh-my-pi/pi-coding-agent/registry/agent-registry"` — `export class AgentRegistry` with public `get(id)`, `list(): AgentRef[]`, `listVisibleTo(id)` (`:151-165`); `MAIN_AGENT_ID = "Main"` (`:15`).

These are stable process-singletons. Receive-side detection re-enters the proven in-app path by calling `IrcBus.global().send()` against a co-located agent. **Coupling risk noted** (internal API) — mitigated by pinning to the exact subpath + a resolve test.

**Implication (BUILD).** Detection = **turn-boundary scan** of `.app/mess/` (on `turn_start`/`agent_start`) **+ a bounded idle `setInterval` poll** (poll-only is the robust correct choice; `fs.watch` rejected for network-mount incompatibility). A detected message is claimed exclusively, then re-injected locally via `IrcBus.send()` (subagent recipients are woken/revived; the main agent is surfaced via `sendMessage`/`session_stop` continuation). Bounded-latency constant proposed in SPEC §R5.3 (P4).

---

## C1 — DOT AGREEMENT TOKEN: enforcement reach

**Finding.** Elon is the **root interactive LLM session**, not a spawned agent. The `.` token is **input-semantics** interpreted by the model, not a tool-call — so it **cannot be 100% hard-enforced** at the `tool_call` gate (the gate governs tool execution, not reply interpretation).

**What IS reachable (verified above):**
- `before_agent_start` fires with `prompt: string` (the submitted user text) and can inject a model-visible `CustomMessage` for that turn. A handler that detects `trim(prompt) === "."` can inject the recorded most-recent pending ask. This is the **hardest feasible** C1 enforcement: the `.` can never be silently dropped or misrouted, because the pending-ask context is always surfaced on the turn it is typed. It cannot *force* Elon's generated output (Elon is an LLM), but it guarantees the input is never lost.
- `input` and `context` hooks are additional injection surfaces (same evidence as F4).
- The pending-ask state must be made **concrete and testable**: SPEC records pending asks in `.app/PROJECT.md` (the one file Elon is allowed to `write`), and the hook reads that file to resolve the most-recent pending ask. R1.5 (no-pending) is therefore enforceable: if the hook finds no recorded pending ask, it injects the "what are you agreeing to?" clarification.

**Enforcement layering (SPEC §C1).**
- **ADVISORY (drives LLM behavior, not bypass-proof):** authoritative protocol text in `plugins/agents/skills/elon/SKILL.md` + `src/append-system.default.md` defining the `.` token, the pending-ask model, and the `.app/PROJECT.md` recording convention.
- **ENFORCED (hard, via extension):** a `before_agent_start` (and/or `input`) hook that detects `.` and **always** injects the recorded most-recent pending ask (or the no-pending clarification). Bypass of the *injection* is impossible; bypass of the *model's final wording* remains theoretically possible (inherent to LLM-input semantics).

---

## REUSE vs BUILD

**REUSE (existing, editable source):**
- The `.app/` location convention (already Elon's artifact dir; `enforce-orchestrator.ts:174-184` whitelists `.app/PROJECT.md`).
- The `package.json#omp.extensions` registration mechanism + extension-factory shape (`enforce-orchestrator.ts` default export; `ExtensionFactory = (pi) => void`, `types.ts:1240-1241`).
- The mkdir+token lock pattern (`file-lock.ts:71-83`) — **re-implemented** in-plugin (internal module, not imported).
- Turn-lifecycle hooks (`turn_start`, `agent_start`, `session_stop`), `before_agent_start`/`context`/`input`, `ctx.isIdle()`, `ctx.hasPendingMessages()`.
- Same-volume atomic `fs.rename` for terminal moves + claim.
- `pi.registerTool()` (`types.ts:1020-1021`) for a dedicated send tool; `pi.sendMessage`/`sendUserMessage` for delivery injection.
- Stable singletons `IrcBus` / `AgentRegistry` (subpath-importable) for co-located receive-side re-injection.

**BUILD (new, this epic):**
- Instance-id provisioning (env + manifest + auto-gen) — F1.
- Transport-selection (`mess-send` tool) with the irc-failed fallback — F2 / R4.
- `.app/mess/` write/parse (filename grammar, YAML frontmatter, type enum) — R2.3–R2.5.
- Detection (turn-scan + bounded idle poll + `session_stop` continuation) — R5.
- Exclusive claim + PENDING→CLAIMED→PROCESSED|FAILED lifecycle with time-based staleness — R5.4/R2.6/R2.7.
- C1 advisory protocol text + hardening hook.

**Explicitly NOT reused:** `collab/` network relay (session-replication, wrong shape — not a transport for addressed peer messages).

---

## SYNTHESIS

Both changes are feasible against the verified omp surface with **zero new runtime dependencies** (Node `fs` built-ins + the already-present `@oh-my-pi/pi-coding-agent` types/runtime). The cross-instance gap is bridged by: **sender writes a file in `.app/mess/`** (selection in the `mess-send` tool, fallback on the irc `failed` receipt) → **receiver's extension detects it** (turn-scan + idle poll) → **claims it exclusively** (mkdir-marker / atomic rename, time-based staleness) → **re-injects locally via `IrcBus.send()`** so the proven in-app delivery path handles the actual turn. C1 is layered: advisory protocol text + a hard `before_agent_start` injection hook that reads pending-ask state from `.app/PROJECT.md`.

**P2 sensitivity.** Every atomicity/lock decision assumes a local shared volume (same machine, same disk for `.app/mess/`). `fs.watch` and PID-based staleness are rejected as primary mechanisms because they break under network mounts; the time-based-poll + atomic-rename design remains correct if a project later moves `.app/` onto a network share, at the cost of poll latency. This keeps the design forward-compatible without designing network sync now.
