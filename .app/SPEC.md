# Technical Specification — Dot Agreement Token (C1) + Cross-Instance File Transport (C2)

**Plugin suite:** `omp-agent-gate` (Plugin A) + `orchestrator-agents` (Plugin B), both sourced from this repo.
**Phase:** SPEC (LeadDev). **Non-goals:** no implementation (DEVELOP); no new runtime deps; no network-sync design (P2 = local shared disk).
**Traceability:** every section header carries the REQ IDs it satisfies. Verified source evidence is cited inline as `path:line`.

---

## 0. Situation

Two changes ship from this repo. **C1** gives the root orchestrator (Elon) a `.` agreement token for its pending-proposal flow: a lone `.` reply agrees with the most-recent pending ask. Because Elon is an LLM session (not a tool call), C1 is layered — authoritative protocol text (advisory) plus a hard extension hook that injects the recorded pending ask whenever `.` is typed (enforced). **C2** adds file-based messaging **only for cross-instance** delivery: when a receiver runs in a different omp process (same machine, shared `.app/` disk), a message is written to `.app/mess/`; co-located receivers keep using in-app (`irc`) exclusively. The cross-instance gap is bridged by sender→file→receiver-detects→claim→re-inject-via-local-`IrcBus`, reusing the proven in-app path for the actual turn.

---

## 1. Architecture Overview

```
                       ┌─────────────── INSTANCE 1 (process, OMP_INSTANCE_ID=inst-1) ───────────────┐
   user ──"."──► Elon  │  enforce-orchestrator (gate)  +  dot-agreement ext (C1 hook)                │
                       │  mess-transport ext: mess-send/mess-fail tools · detection(scan+poll)       │
                       │            │ write .app/mess/<from>-<to>-<ts>.md                            │
                       └────────────┼─────────────────────────────────────────────────────────────────┘
                                    │  (shared local disk under <cwd>/.app/)
                       ┌────────────▼───────────── INSTANCE 2 (process, OMP_INSTANCE_ID=inst-2) ─────┐
                       │  mess-transport ext: turn_start/agent_start scan + idle setInterval poll     │
                       │     ├─ parse frontmatter; if to: ∈ AgentRegistry(THIS proc) → claim          │
                       │     ├─ claim: mkdir .app/mess/<file>.claim/ (EEXIST race → not ours)         │
                       │     └─ deliver: IrcBus.global().send({from,to,body})  (re-enter in-app)     │
                       │            ├─ subagent recipient → woken/revived (real turn)                │
                       │            └─ Main recipient → sendMessage/nextTurn injection                │
                       │  receiver completes → mess-send(in-reply-to=id) → arc/                      │
                       └─────────────────────────────────────────────────────────────────────────────┘
```

**Data flow (send):** agent calls `mess-send` → resolve `selfInstance` + `toInstance` (manifest, default co-located) → same instance: `IrcBus.send()`; on `failed` receipt fall back to file (R4.2) → different instance: write file (R4.1) → return `{transport}` (R4.3).
**Data flow (receive):** turn-scan / idle-poll finds `to:` ∈ hosted agents → mkdir-claim → `IrcBus.send()` re-injects locally → receiver processes → reply (`mess-send` with `inReplyTo`) → atomic rename to `arc/` (PROCESSED) or `arc/`+annotation after 3 failures (FAILED).

---

## 2. Requirements Traceability Matrix

| REQ | AC (one-line) | SPEC section | Mechanism |
|-----|---------------|--------------|-----------|
| R1.1 | `.` agrees most-recent pending ask | §3.1 | advisory text + hook injection |
| R1.2 | origin-agnostic | §3.1 | pending-ask recorded regardless of origin |
| R1.3 | multi-pending → most-recent, rest deferred | §3.2 | PROJECT.md ordered pending list |
| R1.4 | exact `.` only | §3.1 | `trim(text)==="."` |
| R1.5 | no-pending → ask what they agree to | §3.3 | hook reads PROJECT.md; empty → clarification |
| R1.6 | `yes/ok/y` not mapped | §3.1 | strict equality, no affirmative map |
| R2.1 | additional, gated transport | §4.3 | selection rule |
| R2.2 | agents incl. MidDev; user excluded | §4.6,§7 | tool on agent frontmatter; user never a `to:` |
| R2.3 | folder layout | §4.4 | `.app/mess/` + `arc/` |
| R2.4 | filename grammar | §4.4 | regex + `-NN` |
| R2.5 | content schema | §4.5 | YAML frontmatter + type enum |
| R2.6 | processed = atomic move to arc | §4.8 | `fs.rename` same-volume |
| R2.7 | failure retry×3 then arc+annotation | §4.8 | attempts counter |
| R2.8 | arc retained indefinitely | §4.8 | no eviction code |
| R3.1 | instance = one process | §4.1 | process + OMP_INSTANCE_ID |
| R3.2 | agent→instance mapping | §4.2 | `.app/instances.json` |
| R3.3 | stable unique instance id | §4.2 | env▸manifest▸uuid |
| R4.1 | same→in-app, diff→file | §4.3 | selection in mess-send |
| R4.2 | in-app unreachable → file fallback | §4.3 | `failed` receipt → write file |
| R4.3 | transport observable | §4.3 | return `{transport}` |
| R5.1 | detect without in-app signal | §4.7 | fs scan |
| R5.2 | detect at turn-start / idle | §4.7 | turn_start/agent_start + poll |
| R5.3 | bounded latency | §4.7 | P4 = 2000ms poll default |
| R5.4 | exclusive claim | §4.8 | mkdir-marker claim |
| R6.1 | shared fs | §4.0 | P2 assumption |
| R6.2 | concurrent-write safety | §4.4 | unique filenames + atomic create |
| R6.3 | cross-instance metadata | §4.5 | `from-instance`/`to-instance` |
| R6.4 | reply routes back via same rule | §4.3 | reply uses mess-send selection |

---

## 3. C1 — Dot Agreement Token (R1.1–R1.6)

### 3.1 Enforcement layering & the token (R1.1, R1.4, R1.6)

**ADVISORY (drives LLM behavior — not bypass-proof):**
- `plugins/agents/skills/elon/SKILL.md`: new `<dot_token>` protocol block. Defines: a user reply whose trimmed value is **exactly** `.` agrees with the **most-recent pending ask** (R1.1); triggers **only** on `trim(reply)==="."` — so whitespace-padded dots (`. `, ` .`) match, while `v1.2`, `ok.`, `3.14`, `..` (embedded/repeated dots) are literal (R1.4); other affirmatives (`yes`,`ok`,`y`,`sure`) are **not** mapped to the token and are ordinary input (R1.6).
- `src/append-system.default.md`: append a one-paragraph `.` summary to the Elon framing (re-injected at `session_start` by `enforce-orchestrator.ts:132-150`).

**ENFORCED (hard, via extension — impossible to silently drop):**
- New extension `src/dot-agreement.ts`. Registers a `before_agent_start` handler (`BeforeAgentStartEvent { prompt }`, verified `types.ts:522-528`; result `BeforeAgentStartEventResult { message? }`, `:875-879`). When `prompt.trim() === "."`, it returns a model-visible `CustomMessage` for the turn that injects the recorded most-recent pending ask (or the no-pending clarification — §3.3). Applies only to the interactive root (`ctx.hasUI === true`, mirroring `enforce-orchestrator.ts:155`).
- Rationale (grounded): `before_agent_start` is the hardest reachable surface for input-semantics — it fires once per submitted prompt with the literal `prompt` text and can inject turn context. It cannot *force* Elon's generated prose (he is an LLM), but the pending-ask context is **always** surfaced on the `.` turn, so the token is never silently lost or misrouted. (An optional `input` handler `types.ts:1008`/`InputEventResult:851-859` is an equivalent alternative surface; `before_agent_start` is chosen as primary for its per-prompt, once-only semantics.)

### 3.2 Pending-ask model & recording (R1.2, R1.3)

The "pending ask" notion is made **concrete and testable** via a structured section in `.app/PROJECT.md` (the single file Elon may `write`, per `enforce-orchestrator.ts:174-184`). Elon maintains:

```markdown
## Pending Asks
- [PA-3] 2026-06-26T12:00:00Z origin=reqguru status=pending | "Should the default be Y?"
- [PA-4] 2026-06-26T12:05:00Z origin=elon status=pending | "Proceed TRIVIAL path?"   # MOST RECENT
```

- **Most-recent pending ask** = the **last** line (document order) with `status=pending`. Document-order (not a counter) is robust to Elon rewriting the file wholesale via `write`.
- **Origin-agnostic (R1.2):** every ask Elon presents (ReqGuru question relayed via `ask`, LeadDev escalation, or Elon's own confirmation) is appended here with its origin. The hook reads only `status=pending` lines, ignoring origin.
- **Multi-pending (R1.3):** on `.` agreeing PA-N (most-recent), Elon marks PA-N `status=agreed` and each other pending PA-M `status=deferred (superseded by PA-N)`. Deferred asks remain pending for a later reply (they are re-listed). The hook injects only the most-recent; Elon's advisory protocol text specifies the deferred-note behavior.

### 3.3 No-pending guard (R1.5)

The `before_agent_start` hook reads `.app/PROJECT.md`; if there is **no** `status=pending` entry (or the file/section is absent), it injects: *"You received the `.` agreement token, but no pending ask is recorded in `.app/PROJECT.md`. Ask the user what they are agreeing to; do not fabricate a target."* No ask is marked agreed. (R1.5 AC.)

### 3.4 C1 interface contract (`src/dot-agreement.ts`)

```ts
// Read-only parse of .app/PROJECT.md pending-asks. Returns most-recent pending, or null.
function mostRecentPendingAsk(projectMdPath: string): PendingAsk | null;
interface PendingAsk { id: string; ts: string; origin: string; summary: string; }
// Hook payload builder (pure, testable without an LLM).
function buildDotInjection(dotReply: string, pending: PendingAsk | null): CustomMessage | null;
// Returns null when trim(reply)!=="." (R1.4/R1.6 — non-dot input is passed through untouched).
```
Default export: `dotAgreement(pi: ExtensionAPI): void` registers the `before_agent_start` handler. Opt-in parity with the gate: active only when `optedIn(ctx.cwd)` (reuse the exported `optedIn` from `enforce-orchestrator.ts:105`) — so C1 hardening ships dormant unless the project opts in, identical to the existing gate contract.

---

## 4. C2 — Cross-Instance File Transport (R2–R6)

### 4.0 Topology assumption (R6.1)

P2 (user-confirmed): instances run on the **same machine** sharing a **local** `.app/` filesystem. All atomic-rename and mkdir-claim guarantees rely on `.app/mess/`, `.app/mess/arc/`, and claim markers being the **same volume** (verified: all nested under `.app/mess/`). Network-mount and cross-machine sync are **out of scope**; the time-based-poll + atomic-rename design degrades gracefully (latency only) if `.app/` is later moved to a network share.

### 4.1 Instance model (R3.1, R3.3)

An **omp instance** = one oh-my-pi runtime process. Agents in the same process are **co-located**; in different processes, **remote**. Verified: `AgentRegistry`/`IrcBus` are process-global singletons (`agent-registry.ts:59-72`, `bus.ts:49-57`); no instance id is exposed (`ExtensionContext` `types.ts:325-356`).

**Instance id provisioning (BUILD, satisfies R3.3):** `getInstanceId(cwd)` with precedence:
1. `process.env.OMP_INSTANCE_ID` (if non-empty);
2. `.app/instances.json#self` (persisted);
3. auto-generated `inst-<crypto.randomUUID()>`, persisted into `.app/instances.json#self` (atomic write) on first read.

Distinct across concurrent instances (UUID); stable across restarts (persisted). (R3.3 AC.)

### 4.2 Instance manifest (R3.2, R6.3)

File: `<cwd>/.app/instances.json`. Schema (JSON, tolerant of extra keys):

```json
{
  "self": "inst-9f3a-...",
  "agents": {
    "middev": "inst-2",
    "leaddev": "inst-1"
  }
}
```

- `self`: this instance's id (provisioned, §4.1).
- `agents`: `agent-name → instance-id` map. **Agent→instance resolution:** `instanceOf(name) = manifest.agents[name] ?? self` — agents **absent** from the map default to **co-located** with the sender (R3.2 AC).
- Names are lowercased agent names (matching agent-definition `name:` frontmatter). Matching against the live registry is **case-insensitive** (registry ids are CamelCase, e.g. `Main`, `LeadDev`; `agent-registry.ts:15,151-157`).
- Cross-instance metadata (R6.3): every written message frontmatter carries `from-instance` and `to-instance` (§4.5), letting a receiver attribute and route a reply.

### 4.3 Transport selection — the `mess-send` tool (R2.1, R4.1, R4.2, R4.3, R6.4)

A **single registered tool** `mess-send` is the canonical send primitive (registered via `pi.registerTool`, verified `types.ts:1020-1021`). It centralizes selection, fallback, and observability.

```ts
// Registered tool: name "mess-send", approval "write".
interface MessSendInput {
  from: string;        // sender agent name (caller knows its own name; ctx exposes no agentId)
  to: string;          // receiver agent name (MUST be a registered agent; user rejected — R2.2)
  type: MessType;      // DELEGATION|DELIVERABLE|QUESTION_BATCH|FAILURE|HANDOFF (R2.5)
  body: string;        // markdown body (non-empty)
  inReplyTo?: string | null;  // message id being answered (R6.4 reply routing)
}
interface MessSendResult {
  transport: "in-app" | "file";   // R4.3 observable
  fallback?: boolean;             // true when in-app failed and we fell back to file (R4.2)
  outcome?: string;               // in-app receipt outcome, when in-app
  path?: string;                  // file path, when file
  to: string;
  ackedId?: string;               // if inReplyTo referenced a PENDING/CLAIMED msg addressed to `from`, its id (now PROCESSED)
}
```

**Algorithm** (`execute` body):
1. Validate `from`/`to` against `^[A-Za-z0-9]+$` and the **addressable set** = the registered agent-definition names (`leaddev,middev,drpe,reqguru,validator,docworm,hr`; `enforce-orchestrator.ts:61-68`) **plus `main`** (the Main agent / Elon — `MAIN_AGENT_ID="Main"`, `agent-registry.ts:15`; Elon is a valid cross-instance recipient per §4.7). A `to:` resolving to the user or any non-addressable name → reject, write no file (R2.2 AC).
2. `selfInst = getInstanceId(ctx.cwd)`; `manifest = readManifest(ctx.cwd)`; `toInst = instanceOf(to, manifest)` (= `manifest.agents[to] ?? manifest.self`, §4.2).
3. Resolve the receiver's live registry id: `toId = resolveAgentId(to)` — case-insensitive lookup over `AgentRegistry.global().list()` returning the actual CamelCase `id` (e.g. `"MidDev"`, `"Main"`), or `null` if not hosted here. **This is required:** `IrcBus.send` → `registry.get(to)` is **case-sensitive and id-exact** — the `irc` tool passes `to` verbatim (`tools/irc.ts:282-286`) and its own examples use `"Main"`/`"AuthLoader"`; a lowercase `"middev"` would miss and spuriously `failed`. Messages carry the lowercase agent *name* (R2.4/R2.5); delivery resolves name→id.
4. **Known-remote (R4.1):** if `toInst !== selfInst` (manifest declares a different instance) → write a file directly, skip in-app; return `{transport:"file", fallback:false, path, to}`.
5. **Co-located, live (R4.1):** if `toId !== null` → `receipt = IrcBus.global().send({ from, to: toId, body, replyTo: inReplyTo })` (verified signature `bus.ts:95`). If `receipt.outcome !== "failed"` → return `{transport:"in-app", outcome:receipt.outcome, to}` (no file written — R2.1/R4.1 AC).
6. **Fallback to file (R4.2):** if `toId === null` (valid agent name but **not currently hosted** in this registry — it lives in another instance, or is not spawned yet) **OR** step 5 returned `receipt.outcome === "failed"` → write a file (§4.4/4.5) and return `{transport:"file", fallback:true, reason:"receiver not reachable in-app", path, to}`. The `null` resolution and the `failed` receipt are **both** R4.2 trigger signals (R4.2 AC).
7. **Reply/ack side-effect (R6.4):** if `inReplyTo` references a PENDING/CLAIMED message whose `to:` == `from` (this agent is replying to a message it received), mark that original **PROCESSED** (atomic move to `arc/`, §4.8) and set `ackedId`. Replies reuse the **same** selection rule (a reply to a remote-origin message writes a file rather than assuming in-app — R6.4 AC).

**Why a tool, not a raw `irc` + hook?** (1) One chokepoint for selection/fallback/observability → fully unit-testable in isolation. (2) Agents need no `irc` tool (kept forbidden per their frontmatter); `mess-send` internally uses `IrcBus` for co-located delivery. (3) `task()` has no remote semantic (F2) and is unaffected.

**Optional secondary fallback (belt-and-suspenders, not required for AC):** a `tool_result` handler (`types.ts:1012`) that observes a raw `irc` call's `failed` receipt and writes a file. Documented but not load-bearing; the `mess-send` tool is the primary path.

### 4.4 Message store — layout & filenames (R2.3, R2.4, R6.2)

```
<cwd>/.app/mess/                 # in-flight (PENDING + CLAIMED)
<cwd>/.app/mess/arc/             # terminal (PROCESSED + FAILED) — retained indefinitely (R2.8)
<cwd>/.app/mess/<file>.claim/    # claim marker (CLAIMED state); contains owner.json
```

**Filename grammar (R2.4):** `<from>-<to>-<YYYYMMDDTHHMMSSZ>.md`, with a `-NN` zero-padded sequence suffix only on same-second same-pair collision. Regex every file must match:
```
^[A-Za-z0-9]+-[A-Za-z0-9]+-\d{8}T\d{6}Z(-\d{2,})?\.md$
```
Agent names restricted to `[A-Za-z0-9]+` so the `-` delimiter is unambiguous. `datetime` = ISO-8601 UTC compact.

**Concurrent-write safety (R6.2):** write is **atomic** — content is written to a temp sibling `<file>.tmp.<rand>` then `fs.rename`'d to the final name (same dir/volume → atomic, F3). Same-second same-pair collisions are resolved by probing `-01`,`-02`,… for a free name before the rename. N concurrent sends → N distinct files, none overwritten (R6.2 AC). `arc/` is created with `mkdir {recursive:true}` at write time.

### 4.5 Content schema (R2.5, R6.3)

Each file = YAML frontmatter delimited by `---` + a markdown body.

**Required keys:** `from`, `to`, `timestamp` (ISO-8601 with offset, e.g. `2026-06-26T12:05:00.000Z`), `type`, `in-reply-to` (message id or `null`). **Optional keys:** `from-instance`, `to-instance` (R6.3 cross-instance metadata), `attempts` (failure counter, default `0`), `id` (the filename stem, for ack correlation).

**`type` enum (R2.5):** `DELEGATION | DELIVERABLE | QUESTION_BATCH | FAILURE | HANDOFF` — mirroring `task()` return semantics.

```yaml
---
id: leaddev-middev-20260626T120500Z
from: leaddev
to: middev
from-instance: inst-1
to-instance: inst-2
timestamp: 2026-06-26T12:05:00.000Z
type: DELEGATION
in-reply-to: null
attempts: 0
---
Implement the foo module per SPEC §4.4. Return a DELIVERABLE.
```

**Parser/serializer (pure, testable):** `parseMessage(raw): Message | null` (strict frontmatter split on the first two `---` lines; validates required keys + enum; returns null on malformed); `serializeMessage(msg): string`. No YAML dependency — a minimal hand-rolled key/value reader for the flat frontmatter (keys are scalar only), since `type` is the sole enum and all values are strings/ints/null. Malformed files are skipped by the scanner (never crash the extension) and logged via `pi.logger`.

### 4.6 Agent scope; user excluded (R2.2)

All **registered agents** participate, including **MidDev**; **Elon** (`main`) is also a valid recipient but never a sender of file-transport messages (he spawns co-located agents via `task`). The `to:` validation in `mess-send` (§4.3 step 1) accepts the addressable set (`TEAM ∪ {"main"}`) only; the user is never a valid `to:` (user↔Elon `ask` traffic is out of scope). The `mess-send`/`mess-fail` tools are added to participating agent frontmatter (§7).

### 4.7 Detection — remote delivery (R5.1, R5.2, R5.3)

The `mess-transport` extension runs in **every** instance and detects messages without any in-app signal (R5.1). Three triggers:

1. **Turn-boundary scan** on `turn_start` (`types.ts:992`) and `agent_start` (`:989`) — scan `.app/mess/` for files whose `to:` ∈ this instance's hosted agents.
2. **Idle poll** — a `setInterval(DETECTION_POLL_MS)` (P4 default **2000ms**, configurable via `OMP_MESS_POLL_MS`) that scans only when `ctx.isIdle() && !ctx.hasPendingMessages()` (verified `types.ts:345,349`) to avoid interrupting active turns. Cleared on `session_shutdown` (`:979`).
3. **Continuation injection** — when a message was detected-and-delivered during a main-agent turn, the `session_stop` handler (`:991`; result `SessionStopEventResult { continue, additionalContext }`, `shared-events.ts:343-353`) returns `{continue:true, additionalContext:"<delivered summary>"}` so the main agent takes a continuation turn to act on it (bounded latency even when idle — R5.3).

**Hosted set:** `new Set(AgentRegistry.global().list().map(r => r.id.toLowerCase()))` — includes `"main"` and every live/parked subagent (`agent-registry.ts:151-157`; parked agents are revivable, `bus.ts:103-114`). Match `to:` case-insensitively.

**Detection → turn (R5.2):** a detected-and-claimed message is **re-injected locally**. First resolve the name→id: `toId = resolveAgentId(msg.to)` (§5; case-insensitive registry lookup — required because `IrcBus.send` is id-exact, `irc.ts:282-286`). Detection only selects messages whose `to:` is hosted here, so `toId` is non-null; if defensively null, skip and leave the message PENDING. Then `IrcBus.global().send({from: msg.from, to: toId, body: injectedBody(msg), replyTo: msg["in-reply-to"]})`. Because the recipient is co-located in THIS registry, the receipt is `injected`/`woken`/`revived` (verified `bus.ts:120-134`) — the message becomes a real agent turn through the proven in-app path. The injected body prefixes `[:mess-id=<id> from=<from> type=<type>]` and suffixes an ack instruction (`mess-done(id)` or reply via `mess-send(in-reply-to=id)`).

**Main-agent recipient:** delivered via `pi.sendMessage({customType:"omp-mess:deliver", content:body, display:false, attribution:"user"}, {deliverAs:"nextTurn", triggerTurn:true})` (verified `types.ts:1083-1086`) plus the `session_stop` continuation; treated **PROCESSED on delivery** (moved to `arc/` after injection), since a Main-recipient message is a notification Elon incorporates into his next turn (no deferred action-completion semantics, and Elon has no `mess-done` tool).

**Bounded latency (R5.3):** worst case = `DETECTION_POLL_MS` (2000ms) for an idle receiver; turn-start gives immediate detection for a busy one. (R5.3 AC.)

### 4.8 Claim & lifecycle (R5.4, R2.6, R2.7, R2.8)

**State machine:** `PENDING` (`.app/mess/<file>.md`, no claim) → `CLAIMED` (`.app/mess/<file>.md` + `.claim/` marker, exclusively owned) → `PROCESSED` (`arc/<file>.md`) **or** `FAILED` (`arc/<file>.md` + annotation). (Reconciles R2.6 + R5.4 per REQ §4c.)

**Exclusive claim (R5.4) — re-implemented mkdir-marker (F3):**
```ts
function tryClaim(file: string, selfInst: string): { ok: boolean; token?: string } {
  const claimDir = `${file}.claim`;
  try { fs.mkdirSync(claimDir); }               // atomic EEXIST race — exactly one wins
  catch (e) { if (e.code === "EEXIST") return reapIfStale(file, claimDir, selfInst); throw e; }
  const token = randomUUID();
  fs.writeFileSync(join(claimDir, "owner.json"), JSON.stringify({ token, instance: selfInst, ts: Date.now() }));
  return { ok: true, token };
}
```
With two receiver instances and one message, exactly one `mkdir` succeeds (R5.4 AC). The scanner **skips** any file with a non-stale `.claim/`.

**Staleness (time-based only — F3):** `reapIfStale` reads `owner.json#ts`; if `Date.now() - ts > CLAIM_STALE_MS` (default **300000ms** / 5 min, configurable), it reaps the claim (`fs.rm` the `.claim/`) and retries — recovering a crashed/forgotten processor without losing the message. PID-based staleness is deliberately **not** used (unsafe across machines; time-based is correct and general).

**Terminal success (R2.6):** on a `mess-send` reply that references the message id (§4.3 step 6) from the receiver, `fs.rename(file, join(arcDir, basename(file)))` — atomic same-volume move (F3); remove `.claim/`. After completion the file is absent from `.app/mess/` and present only in `arc/` (R2.6 AC).

**Failure handling (R2.7):** `mess-fail({id, reason})` (or a `type:FAILURE` reply) increments `attempts` in the frontmatter (rewrite in place via temp+rename). `attempts < 3` → file stays in `.app/mess/`, claim removed, re-deliverable on the next scan (retry in place). `attempts >= 3` → atomic rename to `arc/` with a `## FAILURE` annotation block appended (attempt count + last reason) (R2.7 AC).

**Retention (R2.8):** no automated process deletes or ages `arc/` entries. (R2.8 AC.)

---

## 5. Interface Contracts (exported, `src/mess-transport.ts`)

```ts
// — Provisioning / manifest —
export function getInstanceId(cwd: string): string;                 // §4.1
export interface InstanceManifest { self: string; agents: Record<string, string>; }
export function readManifest(cwd: string): InstanceManifest;        // §4.2 (absent → {self:getInstanceId, agents:{}})
export function instanceOf(name: string, manifest: InstanceManifest): string;  // manifest.agents[name] ?? manifest.self

// — Message model —
export type MessType = "DELEGATION"|"DELIVERABLE"|"QUESTION_BATCH"|"FAILURE"|"HANDOFF";
export interface Message {
  id: string; from: string; to: string; type: MessType;
  timestamp: string; inReplyTo: string | null;
  fromInstance?: string; toInstance?: string; attempts?: number;
  body: string;
}
export const FILENAME_RE: RegExp;                 // ^[A-Za-z0-9]+-[A-Za-z0-9]+-\d{8}T\d{6}Z(-\d{2,})?\.md$
export function parseMessage(raw: string, filename: string): Message | null;   // §4.5 (null = malformed)
export function serializeMessage(msg: Message): string;

// — Store —
export function messDir(cwd: string): string;     // <cwd>/.app/mess
export function arcDir(cwd: string): string;      // <cwd>/.app/mess/arc
export function writeMessage(cwd: string, msg: Message): string;   // §4.4 atomic; returns final path
export function compactUtc(d = new Date()): string;                // YYYYMMDDTHHMMSSZ

// — Registry resolution (name → live id) —
// Case-insensitive lookup over AgentRegistry.global().list(): returns the actual
// CamelCase registry id (e.g. "MidDev", "Main") for a lowercase agent name, or null.
// Required because IrcBus.send → registry.get(to) is id-exact (tools/irc.ts:282-286).
export function resolveAgentId(name: string): string | null;

// — Claim / lifecycle —
export function tryClaim(file: string, selfInst: string): { ok: boolean; token?: string };   // §4.8
export function releaseClaim(file: string, token: string): void;
export function moveToArc(file: string): string;                  // atomic rename; returns arc path
export function markFailed(file: string, reason: string): void;   // attempts++ then arc+annotation if >=3

// — Extension entry —
export default function messTransport(pi: ExtensionAPI): void;     // registers tools + hooks + poll
```

**Preconditions / errors:** `writeMessage` requires `.app/mess/` writable (creates it + `arc/` via `mkdir recursive`). `tryClaim` never throws on `EEXIST`. `parseMessage` returns `null` (never throws) on malformed input. All hook handlers are wrapped in try/catch — a transport failure must never break the session (parity with `enforce-orchestrator.ts:147-149`).

---

## 6. Data Models & Constants

| Constant | Value | Source |
|---|---|---|
| `DETECTION_POLL_MS` | 2000 (env `OMP_MESS_POLL_MS`) | P4 §4.7 |
| `CLAIM_STALE_MS` | 300000 (env `OMP_MESS_CLAIM_STALE_MS`) | §4.8 |
| `FAIL_MAX` | 3 | R2.7 |
| `MAILBOX`/dirs | `.app/mess/`, `.app/mess/arc/`, `*.claim/` | R2.3 §4.4 |
| `TEAM` + addressable `to:` set | `reqguru,drpe,leaddev,validator,docworm,hr,middev` **+ `main`** | `enforce-orchestrator.ts:61-68` + middev + `MAIN_AGENT_ID` (§4.3) |
| instance id env | `OMP_INSTANCE_ID` | §4.1 |

`Message` / `MessType` / `InstanceManifest` — see §5. `PendingAsk` — see §3.4.

---

## 7. Agent Permissions — frontmatter changes (R2.2)

The `mess-send` and `mess-fail` tools are added to the `tools:` whitelist of every participating agent definition. Exact edits (`plugins/agents/agents/*.md`):

| File | `tools:` becomes |
|---|---|
| `leaddev.md` | `read, write, edit, bash, search, find, ast_grep, ast_edit, lsp, debug, task, mess-send, mess-fail` |
| `middev.md` | `read, write, edit, bash, search, find, ast_grep, ast_edit, lsp, debug, mess-send, mess-fail` |
| `drpe.md` | `web_search, read, browser, edit, write, mess-send, mess-fail` |
| `reqguru.md` | `read, write, search, find, mess-send, mess-fail` |
| `validator.md` | `read, search, find, lsp, bash, mess-send, mess-fail` |
| `docworm.md` | `read, write, edit, search, find, mess-send, mess-fail` |
| `hr.md` | `read, write, edit, mess-send, mess-fail` |

**Read-only tension (OPEN Q7.1):** `validator` is read-only and `docworm` is doc-only. `mess-send`/`mess-fail` write/move **only** under `.app/mess/` — a constrained transport capability, not arbitrary file mutation, so it does not grant codebase/artifact edit power. Deemed acceptable; flagged for sign-off. **Elon is unchanged** (no transport tools; Elon receives Main-recipient messages via the extension's detection, not a tool he calls).

---

## 8. Protocol Documentation edits

- **`plugins/agents/skills/elon/SKILL.md`** — add `<dot_token>` block (§3.1: token def, exact-match, no-affirmative-map, pending-ask PROJECT.md convention §3.2, deferred-note §3.3) + a short `<cross_instance>` note that messages addressed to Elon may be surfaced by the extension as next-turn context.
- **`src/append-system.default.md`** — append the `.` token summary paragraph.
- **`plugins/agents/skills/{leaddev,middev,drpe,reqguru,validator,docworm,hr}/SKILL.md`** — add a `## Cross-instance messaging` section: when to use `mess-send` (receiver in another instance), the `mess-send`/`mess-fail` lifecycle, filename/frontmatter conventions, and the `in-reply-to` reply/ack pattern.
- **`README.md`** (Plugin A) — short section on the two extensions + opt-in (`OMP_ENABLE_ORCHESTRATOR` already gates the companion gate; C1/C2 follow the same opt-in via `optedIn`).

---

## 9. File-by-File Change List

**NEW**
| File | Purpose |
|---|---|
| `src/mess-transport.ts` | C2 extension: provisioning/manifest, `mess-send`/`mess-fail` tools, message parse/serialize, detection (turn-scan + idle poll + `session_stop` continuation), re-implemented mkdir claim + time-based staleness, PENDING→CLAIMED→PROCESSED\|FAILED lifecycle. Subpath-imports `IrcBus` + `AgentRegistry`/`MAIN_AGENT_ID`. |
| `src/mess-transport.test.ts` | Unit tests (§10). |
| `src/dot-agreement.ts` | C1 extension: `before_agent_start` hook, `mostRecentPendingAsk` PROJECT.md parser, `buildDotInjection`. Opt-in via `optedIn`. |
| `src/dot-agreement.test.ts` | Unit tests (§10). |

**MODIFIED**
| File | Change |
|---|---|
| `package.json` | `omp.extensions` += `./src/mess-transport.ts`, `./src/dot-agreement.ts`. |
| `plugins/agents/skills/elon/SKILL.md` | `<dot_token>` + `<cross_instance>` blocks. |
| `src/append-system.default.md` | `.` token summary paragraph. |
| `plugins/agents/agents/{leaddev,middev,drpe,reqguru,validator,docworm,hr}.md` | add `mess-send, mess-fail` to `tools:` (§7). |
| `plugins/agents/skills/{leaddev,middev,drpe,reqguru,validator,docworm,hr}/SKILL.md` | `## Cross-instance messaging` section. |
| `README.md` | C1/C2 extensions + opt-in note. |

**RUNTIME-GENERATED (not shipped)** `.app/instances.json` — created on first `getInstanceId`/`readManifest`; schema documented §4.2.

---

## 10. Test Plan (AC → test; `node --test src/*.test.ts`)

**C1 (`src/dot-agreement.test.ts`):**
- R1.1: PROJECT.md with one pending; `buildDotInjection(".", pending)` returns a message naming that ask.
- R1.2: pending with `origin=reqguru` injects identically to `origin=elon`.
- R1.3: two pending [PA-3, PA-4]; `.` resolves to PA-4 (last in document order).
- R1.4: `buildDotInjection("v1.2",_)`, `"ok."`, `"3.14"`, `".."` return **null** (pass-through); whitespace-padded dots (`". "`, `" ."`, `" . "`) return a message (trim-based token — asserted in `dot-agreement.test.ts` R1.4 "trim semantics").
- R1.5: no pending / missing file → injection text asks the user what they agree to.
- R1.6: `"yes"`,`"ok"`,`"y"` return **null** (not mapped).
- Strongest feasible behavioral check: assert the hook, given `prompt="."` and a PROJECT.md fixture, returns a `BeforeAgentStartEventResult.message` whose content contains the pending ask id. (Full LLM-output enforcement is inherently impossible — documented as a limit.)

**C2 (`src/mess-transport.test.ts`) — pure-function tests against a temp dir:**
- R2.3: `writeMessage` → file under `.app/mess/`; `moveToArc` → only under `arc/`.
- R2.4: generated filenames match `FILENAME_RE`; two same-second same-pair writes get distinct `-NN`.
- R2.5: `parseMessage(serializeMessage(m))` round-trips; required keys present; enum enforced; malformed → null.
- R2.6: `moveToArc` leaves `.app/mess/` empty of the file, present in `arc/`.
- R2.7: 1st/2nd `markFailed` → file stays in `.app/mess/` with `attempts` 1/2; 3rd → in `arc/` with FAILURE annotation.
- R4.1/R4.2/R4.3: `mess-send` with a stubbed `IrcBus` (co-located success → `{transport:"in-app"}`; `failed` → `{transport:"file",fallback:true}`; manifest-remote → `{transport:"file"}`).
- R5.4: two concurrent `tryClaim` on one file → exactly one `{ok:true}`.
- R6.2: N concurrent `writeMessage` (same second/pair) → N distinct files, none overwritten.
- R3.2/R3.3: `instanceOf` defaults absent agents to `self`; `getInstanceId` precedence env▸manifest▸uuid (uuid persisted on first call, stable on second).
- Resolve test: `import { IrcBus } from "@oh-my-pi/pi-coding-agent/irc/bus"` resolves (guards the subpath-coupling risk).

**Behavioral / integration (Elon's VALIDATE phase, not unit):** two-process scenario — instance-1 writes a file; instance-2's extension detects within `DETECTION_POLL_MS`, claims, and the co-located receiver's turn reflects the delivered body.

---

## 11. Risks & Open Questions

- **Q7.1 (C2 permissions):** adding `mess-send`/`mess-fail` to `validator`/`docworm` (read/doc-only agents). Decision: constrained `.app/mess/`-only capability, acceptable — **needs Elon/user sign-off** if strict read-only is a hard contract.
- **C1 enforcement limit (inherent):** the hook guarantees the pending-ask context is *injected* on a `.` turn; it cannot *force* the model's final wording. This is the strongest feasible enforcement for LLM-input semantics. Documented; not a defect.
- **Idle-poll cost:** a 2s poll does one `readdir` + stat per tick per instance. Negligible on local disk; configurable (`OMP_MESS_POLL_MS`). `fs.watch` rejected (breaks on network mounts).
- **Message ordering across instances:** no global ordering is provided. Same-pair ordering is timestamp-ordered within a second (filename sort); cross-pair ordering is unspecified (acceptable — messages are addressed, not a global stream).
- **Subpath coupling:** receive-side delivery imports `IrcBus`/`AgentRegistry` from package subpaths. Mitigated by a resolve test (§10) + pinning to exact subpaths. Alternative (main-agent-relay via `sendMessage` only) avoids coupling but weakens subagent-to-subagent delivery — rejected for R2.2 coverage.
- **Receiver not currently alive:** a message whose `to:` is a hosted agent that has not yet been spawned (absent from the registry) stays PENDING until that agent registers (next scan picks it up). Correct; documented behavior, not a failure.
- **Stale-claim re-delivery vs double-processing:** a reaped stale claim re-delivers; combined with the receiver's own ack (`mess-send` reply) this can double-inject. Mitigation: re-injection is idempotent at the turn level (the receiver sees the same body twice in the worst case); the file is moved to `arc/` on first ack, so a second scan finds it gone. `CLAIM_STALE_MS` (5 min) is tuned well beyond normal turn duration to make this rare.
