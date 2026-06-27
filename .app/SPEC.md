# Technical Specification — Elon Protocol Extension: Idea/Suggestion Storage

**Status:** SPEC (LeadDev) — ready for DEVELOP
**Author:** LeadDev (delegated by Elon)
**Date:** 2026-06-27
**Inputs:** `.app/REQ.md` (R1–R5 locked, §6 assumptions accepted with §6.8 refined), `.app/RESEARCH.md` (substrate findings F1–F5, integration options R1–R6, unknowns U1–U9), `skill://elon` (protocol under extension).
**Scope:** Design, contracts, and grammar for the Idea/Suggestion Storage extension. **No implementation code** — that is the DEVELOP phase. Pseudocode and type signatures appear only where they disambiguate a contract.

---

## 1. Situation

When a user or an agent identifies work worth doing *but outside the current workflow*, the Elon protocol has nowhere to put it: the tangent is either pursued (derailing the active task) or forgotten. This extension adds a lightweight **idea/suggestion storage** layer: ideas are captured into a single human-editable, git-committable `.app/IDEAS.md`; Elon **reminds** the user when a new request relates to a parked idea; and any idea can be **promoted** into a fresh `.app/REQ.md` to launch the FULL workflow. The design mirrors the layered model already proven by `dot-agreement`: **advisory prose** in `skill://elon` (insufficient alone) plus a **hard turn-start hook** that is the load-bearing enforcement. It preserves every existing invariant — Elon's `write` scope stays `.app/PROJECT.md`-only; DocWorm remains the sole writer of artifact files; single-spawner and single-writer-per-file hold.

---

## 2. Architecture Overview

### 2.1 Layered enforcement (parity with `dot-agreement`, satisfies R4 / AC14)

```
                ┌──────────────────────── ADVISORY LAYER (prose, insufficient alone) ────────────────────────┐
                │  skill://elon  →  new `idea_storage` block (capture / remind / promote behavior)            │
                │  src/append-system.default.md  →  condensed companion paragraph (re-injected each session) │
                └─────────────────────────────────────────┬──────────────────────────────────────────────────┘
                                                          │ documents
                ┌──────────────────────── HARD LAYER (load-bearing) ─────────────────────────────────────────┐
                ▼                                                                                                       │
  new Plugin-A extension  src/idea-storage.ts  (default-export ExtensionFactory, dormant unless optedIn)               │
   ├─ pi.on("before_agent_start")   reminder hook   → returns {message:{customType:"elon-ko-gate:idea-reminder",…}}    │
   ├─ pi.registerCommand("idea")    capture steering → pi.sendMessage({customType:"elon-ko-gate:idea-capture",…})       │
   └─ pi.registerCommand("ideas")   on-demand list   → pi.sendMessage({…summary…})                                     │
        │  reads .app/IDEAS.md via node:fs (NEVER the write tool — hook code is not a tool call)                         │
        │  reads .omp/elon.json + OMP_IDEA_REMINDERS for opt-out                                                        │
        └─ writes NOTHING (extension is read-only on disk)                                                              │
                                                                                                                        │
  Elon (LLM, root session)  ── the funnel ──►  task(agent="docworm")  ──►  DocWorm writes .app/IDEAS.md (sole writer)   │
                                                                                                                        │
                └───────────────────────────────────────────────────────────────────────────────────────────────────────┘
```

### 2.2 Data flow — capture

```
USER  "/idea <text>"  ──►  idea-storage command handler ──► pi.sendMessage(idea-capture, nextTurn+triggerTurn)
                                                          └─► NO fs write (U8)
NL phrase ("park this idea: …")  ──►  Elon detects via advisory prose ──► ack + delegate
AGENT  ```idea-suggest``` in output  ──►  Elon INSPECT ──► veto? ──► (accept) ack + delegate  /  (drop) silent

            ┌──── Elon acks IN-TURN (R1.3) ────►  task(agent="docworm", op:append, {source,title,body,tags})
            │                                              │
            │                                              ▼
            │                              DocWorm: next IDEA-NNN, status=parked, atomic whole-file write
            │                                              │
            └──── Elon confirms "📌 Parked as IDEA-NNN: <title>" ◄┘ returns IDEA-NNN
```

### 2.3 Data flow — reminder

```
USER submits prompt  ──►  before_agent_start fires (user turns only)
                          ├─ ctx.hasUI? optedIn(cwd)? remindersEnabled(cwd)?  else no-op
                          ├─ readFileSync(.app/IDEAS.md)  (tolerant, never throws)
                          ├─ parse blocks, keep status=parked
                          ├─ match: token-set∩(request, title∪tags), overlap≥1, rank overlap-desc/created-asc, cap 2
                          └─ if matches: return {message:{customType:"elon-ko-gate:idea-reminder", content, display:false, attribution:"user"}}
                                       else: return nothing
        Elon (LLM) sees injected idea context this turn ──► decides whether to emit ≤2 one-line pointers (default: yes if relevant)
```

---

## 3. Module & Registration  *(SPEC point 1; resolves U6, U9; basis F1.x)*

### 3.1 Module

- **File:** **`src/idea-storage.ts`** (new, Plugin A = `elon-ko-gate`). RESEARCH suggested `idea-reminders.ts`; this SPEC chooses `idea-storage.ts` because the module owns the *full* feature surface (parser + matcher + reminder hook + capture/list commands + opt-out reader), not reminders alone. Filename is a DEVELOP-time label; the contract is the default export.
- **Default export:** `export default function ideaStorage(pi: ExtensionAPI): void { … }` — the `ExtensionFactory` (`types.ts:1240-1241`). omp calls it with `pi`.
- **Dormancy parity:** `import { optedIn } from "./enforce-orchestrator.ts";` (mirrors `dot-agreement.ts:26`). Every hook/command early-returns unless `optedIn(ctx.cwd)`. Dormant = registers handlers but they no-op; never breaks a turn.
- **Type/runtime split (F1.2 — load-bearing):** top-level `import type { ExtensionAPI, BeforeAgentStartEvent, ExtensionContext } from "@oh-my-pi/pi-coding-agent";` (erased at runtime, so `node --test` loads the module under Node v26). Any SDK **runtime value** is fetched via lazy `await import("@oh-my-pi/pi-coding-agent")` inside an impure function (pattern: `mess-transport.ts:19-25`). Node built-ins only: `node:fs`, `node:path`.
- **Zero runtime dependencies (U9):** no new entries in `package.json#dependencies`. `package.json:12-16` has only `devDependencies`. All logic is Node built-ins + SDK types. Verified constraint.

### 3.2 Registration

- Add **`"./src/idea-storage.ts"`** to `package.json#omp.extensions` (`package.json:17-19`). The array currently holds the four extensions; this becomes the fifth.
- `pi.setLabel("Idea/suggestion storage (opt-in)")` at factory top (parity with `enforce-orchestrator.ts:127`, `dot-agreement.ts:134`).
- Register one `before_agent_start` handler (§7) and two commands `idea`, `ideas` (§6). No new tools, no flags.

---

## 4. Invariants Preserved (NFR1, NFR2, NFR3, R5.1, AC4, AC10)

| Invariant | How this SPEC preserves it |
|---|---|
| **Elon `write` scope = `.app/PROJECT.md` only** (NFR1) | Elon never calls `write` on `.app/IDEAS.md` or `.omp/elon.json`. The gate (`enforce-orchestrator.ts:174-184`) would block it. All artifact writes go through DocWorm. |
| **DocWorm is sole writer of `.app/IDEAS.md`** (R2.4, AC4) | The extension is read-only on `.app/IDEAS.md` (hook uses `node:fs`, not the `write` tool — F5.5). Command handlers never call `write` (U8). Only `task(agent="docworm")` writes it. |
| **Single-spawner** (NFR2) | Only Elon spawns DocWorm (routing table → DocWorm for docs). Agents never spawn DocWorm to self-capture (§5). |
| **Ideas ≠ Pending Asks** (R5.1, AC10) | Separate file (`.app/IDEAS.md` vs `.app/PROJECT.md`), separate section header (`## Ideas` vs `## Pending Asks`), separate customType namespace (`elon-ko-gate:idea-reminder` vs `elon-ko-gate:dot-agreement`), separate parser. No shared state. |
| **Human-editable + reparseable** (NFR3, AC13) | `.app/IDEAS.md` is plain markdown (§5). Tolerant parser: a manual edit re-parses on the next turn; a corrupting edit yields zero parsed ideas + a located log line, never a crash (§5.4). |
| **Boring matcher** (NFR5, R3.2, AC12) | Pure local string/set operations. No network, no embeddings, no subprocess (§8). |

---

## 5. `.app/IDEAS.md` Grammar & Parser  *(SPEC point 3; resolves U1; basis F3.3, §6.6)*

### 5.1 File grammar

One section, one fenced block per idea, **append-style** (newest at end, R2.2). Created at runtime by DocWorm on first capture (REQ error case: "absent on first capture → create with minimal header, then append").

```
# Ideas

Stored ideas/suggestions for the Elon protocol. One block per idea, newest
appended at the end. Human-editable; status lifecycle per the SPEC.

```idea
id: IDEA-001
created: 2026-06-27T12:00:00Z
source: user
title: Add a dark-mode toggle
tags: ui, theme, css
status: parked

Add a dark-mode toggle to the settings page. Should respect
`prefers-color-scheme` but allow a manual override.

--- notes ---
- 2026-06-27T13:00:00Z — user: consider persisting choice in localStorage
- 2026-06-28T09:00:00Z — agent(drpe): Tailwind v4 has a dark: variant
```

```idea
id: IDEA-002
created: 2026-06-28T10:00:00Z
source: leaddev
title: ...
tags: ...
status: promoted
promoted_to: .app/REQ.md
promoted_at: 2026-06-29T08:00:00Z

...

--- notes ---
- ...
```
```

### 5.2 Block structure (deterministic, parse-robust)

Each idea is a fenced block whose fence info string is exactly `idea`. Inside, **top-down**:

1. **Metadata** — consecutive `key: value` lines (no blanks). Whitespace around `:` tolerant. Required: `id`, `created`, `source`, `title`, `tags`, `status`. Optional (lifecycle): `promoted_to`, `promoted_at` (iff `status=promoted`); `superseded_by` (iff `status=superseded`).
2. **A blank line** separates metadata from body.
3. **Body** — free-form markdown (the idea itself, §6.6 `body`). Extends until a `--- notes ---` marker line or the closing fence.
4. **`--- notes ---` marker** (optional) introduces the notes subsection.
5. **Notes** — append-only `- <ISO-8601 UTC> — <free-form text>` lines (§6.7). No inline edits to prior notes.

The `key: value` line and the `--- notes ---` marker give the parser deterministic boundaries, so free-form body text (which may itself contain colon-bearing lines) is never mistaken for metadata. This is what makes the format both human-editable and robustly reparseable (NFR3, AC13).

### 5.3 Field encoding (REQ §6.6 — verbatim field set; SPEC fixes the byte encoding)

| Field | Line | Constraint |
|---|---|---|
| `id` | `id: IDEA-NNN` | Monotonic, zero-padded to 3 digits (`IDEA-001`…). Assigned by DocWorm on append. |
| `created` | `created: <ISO-8601 UTC>` | Set once at capture; immutable. |
| `source` | `source: <user\|/idea\|<agent-name>>` | `user` = NL phrase; `/idea` = explicit command; agent-name = autonomous path (§6.3). |
| `title` | `title: <≤80 chars>` | Single line. |
| `tags` | `tags: a, b, c` | Comma-separated, ≤5 lowercase kebab-case tokens. Feeds the matcher. |
| `status` | `status: <parked\|promoted\|rejected\|superseded>` | From the §10.5 state machine. |
| `promoted_to` | `promoted_to: .app/REQ.md` | Present iff `status=promoted`. |
| `promoted_at` | `promoted_at: <ISO-8601 UTC date>` | Present iff `status=promoted`. |
| `superseded_by` | `superseded_by: IDEA-NNN` | Present iff `status=superseded`. |
| `notes` | `--- notes ---` subsection | Append-only dated remarks (§6.7). |

### 5.4 Parser contract (U1) — tolerant, never-throws, mirrors `mostRecentPendingAsk`

Signature (pure, dependency-free):

```ts
export interface IdeaRecord {
  id: string;            // "IDEA-NNN"
  created: string;       // ISO-8601
  source: string;
  title: string;
  tags: string[];        // parsed, lowercased
  status: "parked" | "promoted" | "rejected" | "superseded";
  promotedTo?: string;
  promotedAt?: string;
  supersededBy?: string;
  body: string;
  notes: { ts: string; text: string }[];
}

/** Returns ALL idea blocks (any status). Never throws. */
export function parseIdeas(ideasMdPath: string): IdeaRecord[];
```

Algorithm (parallel to `mostRecentPendingAsk`, `dot-agreement.ts:57-86`):

1. `if (!existsSync(path)) return [];`
2. `try { text = readFileSync(path, "utf8") } catch { return []; }`
3. Walk lines. Locate the `## Ideas` section header (`/^##\s+Ideas\s*$/`). A later `#{1,6}` heading closes the section (mirror `HEADING_RE`, `dot-agreement.ts:50`).
4. Within the section, match fenced `idea` blocks. Per block: split metadata lines (until first blank) into a `key:value` map (skip lines not matching `/^\s*([a-z_]+)\s*:\s*(.*)$/`); body = until `--- notes ---` or closer; notes = `- <ts> — <text>` lines.
5. A block missing a *required* field, or with an unparseable status, is **skipped** (not fatal). A totally corrupt file yields `[]`. **Never throw** — wrap the whole body in try/catch returning `[]` on any unexpected error.
6. The hook consumes only `status === "parked"` entries (§8).

Fail-safe behavior (REQ error cases, AC13): missing/unreadable/corrupt file → `[]` → no reminders injected, capture delegations still work (DocWorm appends to the raw file). The hook additionally logs a one-line located warning via `pi.logger` when the file exists but yields zero records from a non-empty file (aids AC13's "located error" requirement) — but injection is unconditionally suppressed, never crashed.

---

## 6. Capture & Listing Commands  *(SPEC point 5a/5b partial; resolves U8; basis F1.2, R6)*

### 6.1 `/idea <text>` — explicit user capture (AC1)

Registered via `pi.registerCommand("idea", { description, handler })` (`types.ts:1027-1035`). The handler signature is `(args: string, ctx: ExtensionCommandContext) => Promise<void>`; the factory closes over `pi`, so the handler calls `pi.sendMessage`.

**Contract (U8 — no fs write from the handler):** the handler does NOT call `write`/`edit`/`fs` on `.app/IDEAS.md`. It only steers Elon. Pseudocode:

```ts
pi.registerCommand("idea", {
  description: "Capture an idea/suggestion for later.",
  handler: async (args /* = "<text>" */, ctx) => {
    if (!optedIn(ctx.cwd)) return;                 // dormancy parity
    const text = (args ?? "").trim();
    if (!text) { /* steer: empty /idea — ask user for text */ }
    pi.sendMessage(
      {
        customType: "elon-ko-gate:idea-capture",
        display: false,
        attribution: "user",
        content:
          `The user invoked the /idea command with: "${text}". ` +
          `Acknowledge capture now (one line), then delegate appending a new ` +
          `status=parked block to DocWorm via task(agent="docworm", op:append, ` +
          `{ source:"/idea", title:<derived ≤80 chars>, body:"${text}", tags:<derived ≤5> }). ` +
          `On DocWorm's returned IDEA-NNN, confirm to the user: "📌 Parked as IDEA-NNN: <title>".`,
      },
      { deliverAs: "nextTurn", triggerTurn: true },
    );
  },
});
```

`/idea` subcommands route on `args`:
- `/idea promote IDEA-NNN` → steer a **promotion** delegation (§10), not a capture.
- `/idea note IDEA-NNN: <text>` → steer a `append_note` delegation.
- `/idea reject IDEA-NNN` → steer an `update_status` delegation (`status=rejected`).
- otherwise → capture (above).

**Why this satisfies AC1 within one Elon turn:** the command's `triggerTurn:true` produces a continuation turn in which Elon sees the capture intent, acks, spawns DocWorm (which writes), and confirms `IDEA-NNN`. From the user's POV the whole `/idea <text>` → ack + ID + confirmation is a single interaction. The DocWorm round-trip is internal to Elon's handling.

### 6.2 Natural-language capture (AC2)

No hook. Advisory prose in `skill://elon` (§11) lists the trigger phrases (REQ §6.1): `idea: …`, `park this idea: …`, `we should … later`, `future idea: …`, `remember to …`. Elon's LLM detects these during CLASSIFY/INSPECT and runs the **same** ack → DocWorm-append → confirm flow as §6.1. `/idea` is the unambiguous fallback.

### 6.3 `/ideas` — on-demand listing (AC7)

Registered via `pi.registerCommand("ideas", { handler })`. Reads `.app/IDEAS.md` via `node:fs` + `parseIdeas`, then `pi.sendMessage` a formatted summary (steers Elon to render it, OR renders directly — DEVELOP choice; either way no fs write by the listing itself is needed, only a read).

- `/ideas` → one-line per non-terminal (`status=parked`) idea: `IDEA-NNN — <title> [<tags>]`.
- `/ideas all` → include terminal statuses with badges: `IDEA-NNN — <title> [<tags>] (promoted→.app/REQ.md / rejected / superseded→IDEA-MMM)`.

On-demand listing is **independent of the opt-out** (REQ error case: opted-out user can still `/ideas`). The listing command does not consult `remindersEnabled`.

### 6.4 Agent autonomous capture — `idea-suggest` block (AC3, §5.2 of REQ)

A subagent signals a guarded tangent by emitting a fenced block in its returned output to Elon (parsed by Elon's LLM via advisory prose, not by a hook):

```
```idea-suggest
title: <short label, ≤80 chars>
body: <the idea, markdown>
tags: <comma-separated, ≤5 lowercase kebab-case>
rationale: <why worth parking, not pursuing now>
source_agent: <agent-name>
```
```

**Veto rule (Elon-side, §5.2 step 3 — the double guard):** Elon reviews each `idea-suggest`. **Accept** (ack + delegate `op:append` with `source=<source_agent>`) iff ALL hold: (a) out of the current task's scope; (b) plausibly valuable (not a passing curiosity/question/nit); (c) specific enough to act on later. Otherwise **drop silently** (no ack, no write, no user surfacing — REQ §6.3). A **malformed** block (missing required field, unparseable) is treated as noise and dropped (REQ error case). Accepted agent captures that Elon promotes to `parked` are surfaced in his next user reply.

### 6.5 DocWorm delegation payload (§7.3 of REQ)

Elon's `task(agent="docworm")` carries a JSON payload:

```ts
type DocWormIdeaOp =
  | { op: "append";       source: string; title: string; body: string; tags: string[] }
  | { op: "update_status"; id: string; status: "promoted"|"rejected"|"superseded";
      promotedTo?: string; promotedAt?: string; supersededBy?: string }
  | { op: "append_note";   id: string; note: string };
```

- `append` → DocWorm assigns the next `IDEA-NNN` (max existing id +1, zero-padded), sets `created=now`, `status=parked`, atomic-writes the new block at end of file. Returns `IDEA-NNN`.
- `update_status` → DocWorm rewrites **only that block's metadata lines** in place (block KEPT — R5.3 audit). Returns `IDEA-NNN`.
- `append_note` → DocWorm appends `- <now> — <note>` to that block's `--- notes ---` section (creating the section if absent). Returns `IDEA-NNN`.

DocWorm returns the affected `IDEA-NNN` + a one-line confirmation. Elon never writes IDEAS.md (R2.4).

---

## 7. Reminder Hook & Matcher  *(SPEC points 2 & 4; resolves U3, U5, U6; basis F2.2/F2.4, R2)*

### 7.1 The hook (R4.2 hard layer)

```ts
pi.on("before_agent_start", (event /* BeforeAgentStartEvent */, ctx /* ExtensionContext */) => {
  try {
    if (!ctx.hasUI) return;                       // user turns only (U5); subagents headless
    if (!optedIn(ctx.cwd)) return;                // dormancy parity (dot-agreement.ts:141)
    if (!remindersEnabled(ctx.cwd)) return;       // opt-out (§9)
    const parked = parseIdeas(join(ctx.cwd, ".app", "IDEAS.md"))
                     .filter(i => i.status === "parked");          // matcher reads parked only
    const hits = matchIdeas(event.prompt, parked);                 // ≤2, overlap≥1
    if (hits.length === 0) return;
    return { message: buildIdeaInjection(hits) };                  // F2.2 mechanism
  } catch {
    return;                                       // advisory safety: never break a turn
  }
});
```

Rationale for `before_agent_start` (F2.4): it carries `event.prompt` (required for matching), fires **once per prompt** (lowest latency, no double-fire), and injects the **current** turn — strictly better than `pi.sendMessage(nextTurn)` (F2.3, which defers and lacks current-prompt context). `turn_start`/`agent_start` have no `prompt` field and cannot drive prompt-keyed reminders.

### 7.2 Injection message (resolves U6)

```ts
const IDEA_REMINDER_CUSTOM_TYPE = "elon-ko-gate:idea-reminder";   // namespace per U6

function buildIdeaInjection(hits: IdeaRecord[]): {
  customType: string; content: string; display: false; attribution: "user";
} {
  const lines = hits.map(h =>
    `- [${h.id}] "${h.title}" (tags: ${h.tags.join(", ")})`
  ).join("\n");
  return {
    customType: IDEA_REMINDER_CUSTOM_TYPE,
    display: false,                               // keeps out of editable pending-queue UI
    attribution: "user",                          // only runtime option (U7); "system" unreachable
    content:
      `The current user request may relate to these previously parked ideas:\n${lines}\n\n` +
      `If genuinely relevant, surface at most a one-line pointer per idea (≤2 total) to the ` +
      `user, e.g. "Note: this overlaps parked idea IDEA-NNN — <title> (/idea promote to start it).". ` +
      `If not relevant, do not mention them. Never fabricate ideas not listed here.`,
  };
}
```

The injected content is **advisory framing** (`display:false`, `attribution:"user"`). It becomes a model-visible `CustomMessage` for the current turn (F2.2). Elon (the LLM) then decides whether to emit the ≤2 one-line pointers in his reply (REQ §6.9 step 5). This double-gate (hook cap of 2 + LLM relevance judgment) is the noise control — see U5.

### 7.3 The matcher (resolves U3 — dependency-free, boring/debuggable, AC12)

```ts
/** Pure. Token-set intersection after stopword removal. Reads parked ideas only. */
export function matchIdeas(request: string, parked: IdeaRecord[]): IdeaRecord[] {
  const reqTokens = tokenize(request);
  const scored = parked
    .map(idea => {
      const ideaTokens = new Set([...tokenize(idea.title), ...idea.tags.map(t => t)]);
      const overlap = reqTokens.filter(t => ideaTokens.has(t));   // min overlap 1
      return { idea, overlap: overlap.length };
    })
    .filter(s => s.overlap >= 1)                                  // REQ §6.8: min-overlap 1
    .sort((a, b) => b.overlap - a.overlap                         // overlap-count desc
                 || a.idea.created.localeCompare(b.idea.created)); // then created asc (older first)
  return scored.slice(0, 2).map(s => s.idea);                     // cap 2/turn (R3.1)
}
```

**Tokenizer (REQ §6.8 "SPEC's choice"):** lowercase, then match `[a-z0-9]+` (split on any non-alphanumeric). Drop tokens in a single hardcoded English stopword `Set` (≈40 common tokens: `a, an, the, and, or, but, of, to, in, on, for, with, is, are, be, it, this, that, we, should, would, can, will, do, does, idea, park, add, make, etc.` — the feature-word `idea`/`park` are themselves stopwords so capture-phrases don't self-match). The list is one `const STOPWORDS = new Set([...])` — trivially readable and debuggable. `tags` are already lowercase kebab-case from the parser; matched as whole tokens (kebab → split on `-`? **Decision:** tags match as whole normalized tokens; the tokenizer splits both request and tag strings identically, so `dark-mode` → `{dark, mode}` on both sides, giving overlap on either component). Hyphen-splitting on both sides keeps it symmetric and boring.

**Properties (REQ §6.8, AC12):** min-overlap 1; rank overlap-desc then created-asc; cap 2/turn; reads `status=parked` only; pure local string/Set ops; no network, no embeddings, no subprocess. `O(reqTokens × parked)` — negligible for <1000 ideas (NFR6).

---

## 8. Reminder cadence  *(resolves U5)*

**Decision: ALWAYS-ON injection on every user turn (capped at 2), relying on the hook cap + Elon's LLM relevance judgment as the noise controls.** No PROJECT.md phase parsing.

**Justification:**
1. The injected message is **hidden advisory framing** (`display:false`); Elon's LLM decides whether to surface a one-line pointer. Irrelevant matches → Elon emits nothing → user sees nothing. The double-gate already suppresses noise.
2. Adding a `## Current Phase` parser duplicates `dot-agreement`'s `.app/PROJECT.md` coupling and introduces a second reader, a new failure surface, and a new "what counts as mid-flight" policy — violating "boring/debuggable" (R3.2).
3. A user deep in DEVELOP who types `fix the bug on line 42` costs only a few tokens of hidden context; a user whose mid-workflow message *is* relevant (`also handle the auth thing we parked`) correctly gets the reminder. Suppression would lose the second case.
4. The user already has a clean suppression switch: the opt-out (§9) — `OMP_IDEA_REMINDERS=0` or `.omp/elon.json` `ideas.reminders:false` — for when reminders genuinely annoy mid-workflow.

**Alternative considered & rejected:** suppress when `.app/PROJECT.md` `## Current Phase` ∈ {DEVELOP, VALIDATE, RESOLVE}. Rejected for the reasons above. (If field evidence later shows noise, a phase-gate is an additive future change that does not alter this SPEC's contracts.)

---

## 9. Opt-out  *(SPEC point 8; resolves U2; §6.8 refinement)*

The opt-out lives in **`.omp/elon.json`** as a nested key — NOT in `.app/PROJECT.md`. This **supersedes** REQ §6.8/§7.1's `idea_reminders=off`-in-PROJECT.md variant (per the §6.8 refinement in this SPEC's charter).

**Config shape:** `{ "enabled": true, "ideas": { "reminders": false } }`. Read by the new extension's own tolerant JSON parse, mirroring `optedIn` (`enforce-orchestrator.ts:105-119`):

```ts
/** Fail-safe default = reminders ON (when opted-in). Env wins over file. */
export function remindersEnabled(cwd: string): boolean {
  const env = process.env.OMP_IDEA_REMINDERS;
  if (env === "0") return false;            // explicit off (escape hatch)
  if (env === "1") return true;             // explicit on
  try {
    const p = join(cwd, ".omp", "elon.json");
    if (!existsSync(p)) return true;        // default ON
    const parsed: unknown = JSON.parse(readFileSync(p, "utf8"));
    if (typeof parsed !== "object" || parsed === null) return true;
    const ideas = (parsed as { ideas?: unknown }).ideas;
    if (typeof ideas !== "object" || ideas === null) return true;
    const r = (ideas as { reminders?: unknown }).reminders;
    return r !== false;                     // false → off; anything else (incl. absent) → ON
  } catch {
    return true;                            // malformed → default ON (fail-safe)
  }
}
```

**Precedence:** `OMP_IDEA_REMINDERS` env ▸ `.omp/elon.json` `ideas.reminders` ▸ default ON. All gated by `optedIn(cwd)` (if the project hasn't opted in at all, the extension is dormant — reminders off as a consequence).

**Toggle flow (important — Elon cannot write `.omp/elon.json`):** the gate (`enforce-orchestrator.ts:174-184`) blocks Elon's `write` to anything but `.app/PROJECT.md`. Therefore the natural-language toggle ("stop reminding me about ideas" / "remind me about ideas") is resolved one of three ways, all preserving the write-ownership invariant:
1. **User-direct:** the user edits `.omp/elon.json` or exports `OMP_IDEA_REMINDERS=0`.
2. **DocWorm-mediated:** Elon delegates `task(agent="docworm")` to update `.omp/elon.json` (DocWorm's `write` has no path restriction — F5.2). Advisory prose documents this.
3. **Per-session note:** Elon records the user's preference in `.app/PROJECT.md` (within his write scope) as a reminder to himself, while the *effective* suppression still requires (1) or (2). (The reminder hook reads only `.omp/elon.json`/env, not PROJECT.md, so this note is informational only.)

`/ideas` (§6.3) and capture (§6.1) are **independent** of the opt-out — only proactive reminders are suppressed (REQ error case, AC6 vs AC7).

---

## 10. Promotion & Lifecycle  *(SPEC points 6; §5.4 of REQ; resolves part of U1)*

### 10.1 State machine (REQ §6.5 — verbatim)

```
                 ┌──────── parked (initial, on capture) ────────┐
                 │            │            │                     │
                 ▼            ▼            ▼                     │
            promoted     rejected    superseded                  │
          (terminal,   (terminal,   (terminal,                   │
           audit-kept)  re-openable)  points to newer)           │
                       └─► parked (re-open)                      │
```

No transitions outside this graph. `promoted` is **NOT** re-openable (AC11). Field representation is fixed in §5.3; no new states.

### 10.2 Promotion flow (`/idea promote IDEA-NNN` or Elon-proposed — AC8, AC9)

1. **Resolve target.** `parseIdeas` confirms `IDEA-NNN` exists and `status=parked`. If missing or not `parked` → Elon reports the error; **no state change** (REQ error case).
2. **Conflict check (AC9, §6.4).** Elon reads `.app/PROJECT.md` `## Current Phase`. If it indicates an in-flight FULL workflow (phase ∈ {GRILL, RESEARCH, SPEC, DEVELOP, VALIDATE, RESOLVE}) **and** a `.app/REQ.md` exists → **queue, do not clobber**: Elon records a **Pending Ask** under `## Pending Asks` in `.app/PROJECT.md` ("Promote IDEA-NNN? This will start a new FULL workflow and replace the active context. `.` to confirm.") and stops. The user may agree with `.` (the dot-agreement mechanism). **No REQ.md overwrite until confirmed.**
3. **Status update first (audit anchor, R5.3).** On a clear path (no conflict, or user confirmed), Elon delegates DocWorm `op:update_status` `{ id, status:"promoted", promotedTo:".app/REQ.md", promotedAt:<now> }`. The block is **KEPT** in `.app/IDEAS.md` (only its metadata lines change) — the audit anchor.
4. **Seed REQ.md.** Elon delegates ReqGuru with the idea block as seed context to produce a **new** `.app/REQ.md` for the FULL workflow (content copied; IDEAS.md entry remains the audit anchor). Then Elon `[PROTO]`-commits `.app/REQ.md` and `.app/IDEAS.md` at the phase gate (F3.2).

### 10.3 Other transitions

- `/idea reject IDEA-NNN` → DocWorm `op:update_status` `{ id, status:"rejected" }`. Re-openable later via a `parked` re-set.
- Duplicate near-detection (REQ error case): on `op:append`, DocWorm (or Elon before delegating) compares the new title/normalized-tag-set against existing `parked` ideas; if same normalized tag-set **AND** >0.8 title-token overlap → Elon raises a Pending Ask: store as new, or mark the older `superseded` (`op:update_status` `status:"superseded", supersededBy:<new>`). No silent dedup.

---

## 11. Atomic Writes & Fail-safety  *(SPEC point 7; resolves U4)*

**The never-throws parser (§5.4) is the primary U4 defense.** A torn/partial `readFileSync` of `.app/IDEAS.md` yields zero parsed records → **no reminders injected** (the correct fail-safe: no false matches, no crash). This alone guarantees no partial file ever corrupts behavior.

**Write granularity:** DocWorm performs IDEAS.md mutations as **whole-file read-modify-write** via the `write` tool (read current content → apply the append/status/note edit → write the complete file back), never an in-place byte patch. This minimizes the torn-write window to a single tool call.

**Atomicity mandate:** IDEAS.md writes MUST be atomic (temp-file + `fs.rename`, POSIX `rename(2)` on a local volume). **Substrate caveat (residual risk R-U4):** DocWorm's toolset is `read, write, edit, search, find, mess-send, mess-fail` — **no `bash`**, so DocWorm cannot itself perform `temp+rename`. True atomicity therefore depends on the omp `write` tool's own implementation, which RESEARCH did **not** verify. Two outcomes:
- If omp `write` is atomic (standard for such tools): torn reads are impossible; U4 is fully satisfied.
- If it is not: the fail-safe parser (§5.4) is the guarantee — a torn read degrades to "no reminders this turn" (correct, recoverable next turn), never corrupt data or a crash.

**DEVELOP action:** verify the omp `write` tool's atomicity (read omp tool internals). If non-atomic and torn reads become a practical concern, the backstop is already in place; no contract change is needed. The SPEC does NOT mandate adding `bash` to DocWorm (that would be an agent-frontmatter change — explicitly out of scope, F5.2).

---

## 12. Advisory Prose  *(SPEC point 9; resolves U7; R4.1)*

**U7 resolution:** any injected reminder is `attribution:"user"` (`MessageAttribution` is `"user"|"agent"`; `getSystemPrompt()` is read-only; `appendEntry` is not LLM-sent — F2.2, `enforce-orchestrator.ts:37-43`). System-attributed framing is **unreachable** via any ExtensionAPI call. The advisory layer therefore lives entirely in **prose** — exactly as `dot-agreement` and the APPEND_SYSTEM framing already do — NOT in a system-prompt injection.

### 12.1 `idea_storage` block to add to `skill://elon`

The `skill://elon` source is **plugin-defined**, at **`plugins/agents/skills/elon/SKILL.md`** (Plugin B = `elon-ko-agents`). Add a new section (sibling to `<dot_token>`):

```xml
<idea_storage>
  <capture>
    When the user runs `/idea <text>` or uses a trigger phrase (`idea: …`, `park this idea: …`,
    `we should … later`, `future idea: …`, `remember to …`), or an agent emits a well-formed
    ```idea-suggest``` block, capture the tangent WITHOUT derailing the active workflow:
    1. Acknowledge capture in-turn (one line).
    2. Delegate the append to DocWorm via task(agent="docworm", op:append, …). Elon does NOT write
       .app/IDEAS.md (his write scope is .app/PROJECT.md only).
    3. Confirm: "📌 Parked as IDEA-NNN: <title>."
    Agent idea-suggest blocks are vetoed by Elon (drop silently if not clearly worthwhile).
  </capture>
  <remind>
    On each user turn, the hard before_agent_start hook injects (hidden) up to 2 parked ideas whose
    title/tags share ≥1 token with the request. Surface a one-line pointer per relevant idea
    (≤2/turn) ONLY if genuinely relevant; never fabricate. Suppressed when opted out.
  </remind>
  <promote>
    `/idea promote IDEA-NNN` sets status=promoted (block KEPT for audit) and seeds a fresh
    .app/REQ.md via ReqGuru. If a FULL workflow is active, queue via Pending Ask — never clobber.
  </promote>
  <opt_out>
    Suppress proactive reminders via .omp/elon.json { "ideas": { "reminders": false } } or
    OMP_IDEA_REMINDERS=0. Toggle by delegating DocWorm to edit .omp/elon.json (Elon cannot write it).
    /ideas listing still works when opted out.
  </opt_out>
  <enforcement>
    <rule severity="LIMIT">The advisory prose above is INSUFFICIENT alone. The load-bearing
    enforcement is the before_agent_start hook in src/idea-storage.ts (Plugin A). Removing the hook
    leaves only this prose — ideas would still be capturable via delegation, but proactive reminders
    would silently stop. This mirrors dot-agreement's documented limit.</rule>
  </enforcement>
</idea_storage>
```

### 12.2 Companion line in `src/append-system.default.md`

**YES — a companion is needed**, for parity with how `dot-agreement` is represented in both the skill and the bundled advisory framing (`append-system.default.md:30-37` re-injects each session via the `session_start` hook, `enforce-orchestrator.ts:132-150`). Add a condensed paragraph after the `.` token section:

```
## Idea/suggestion storage

When a user or agent identifies work worth doing but outside the current workflow, it is parked in
`.app/IDEAS.md` (written by DocWorm, committed by Elon as [PROTO]). On each user turn a hard hook
injects up to 2 related parked ideas; surface a one-line pointer only if relevant. `/idea <text>`
captures; `/ideas` lists; `/idea promote IDEA-NNN` starts a fresh FULL workflow. Opt out via
`.omp/elon.json` `{"ideas":{"reminders":false}}` or `OMP_IDEA_REMINDERS=0`. The hook is load-bearing;
this prose alone is insufficient (mirrors the dot-agreement limit).
```

### 12.3 Two-plugin note

The advisory prose (§12.1, Plugin B) and the extension code (§3, Plugin A) live in **two independently-versioned plugins** (`marketplace.json`). A release that ships the hook MUST ship the matching skill prose in the same coordinated release; otherwise the hook injects context Elon has no documented behavior for. DEVELOP/commit organization should keep the two changes in lockstep.

---

## 13. File Map & Change Set  *(SPEC point 10)*

| File | Plugin | Change | Owner (DEVELOP) |
|---|---|---|---|
| **`src/idea-storage.ts`** | A (`elon-ko-gate`) | **NEW.** Extension: `before_agent_start` reminder hook, `idea`/`ideas` commands, `parseIdeas` parser, `matchIdeas` matcher, `remindersEnabled` opt-out reader, `buildIdeaInjection`/capture-steer builders. Default-export `ExtensionFactory`. `import { optedIn } from "./enforce-orchestrator.ts"`. | LeadDev→MidDev |
| **`src/idea-storage.test.ts`** | A | **NEW.** `node --test` unit tests for the pure functions (`parseIdeas` tolerant cases, `matchIdeas` ranking/cap/stopword, `remindersEnabled` precedence, `buildIdeaInjection` shape). Mirror `dot-agreement`'s testability (F3.3). | LeadDev→MidDev |
| **`package.json`** | A | Add `"./src/idea-storage.ts"` to `omp.extensions` (`package.json:17-19`). No dependency changes. | LeadDev→MidDev |
| **`plugins/agents/skills/elon/SKILL.md`** | B (`elon-ko-agents`) | Add `<idea_storage>` block (§12.1). | LeadDev→MidDev |
| **`src/append-system.default.md`** | A | Add condensed companion paragraph (§12.2). | LeadDev→MidDev |
| **`.app/IDEAS.md`** | (runtime artifact) | **Created at runtime by DocWorm** on first capture. Auto-tracked by `.gitignore:4-5` (`!.app/*.md`) — **no .gitignore edit**. Committed by Elon as `[PROTO]`. | DocWorm (runtime) |

**Confirmed NO-ops (per RESEARCH F5.2):**
- **No agent-frontmatter change.** DocWorm's `tools: read, write, edit, search, find, mess-send, mess-fail` already permits writing `.app/IDEAS.md` (no path restriction). No other agent gains/loses tools. REQ NFR7 holds: no HR work, no new agent roles.
- **No `.gitignore` change.** `.app/IDEAS.md` is auto-tracked.
- **No change to `enforce-orchestrator.ts`** beyond the new extension importing its `optedIn` export (read-only dependency, already public at `enforce-orchestrator.ts:105-119`).

---

## 14. U1–U9 Resolution Summary

| ID | Unknown | Resolution (section) |
|---|---|---|
| **U1** | IDEAS.md block grammar unmodeled | §5 — fenced `idea` blocks under `## Ideas`; metadata `key:value` lines / blank / body / `--- notes ---`. Tolerant `parseIdeas` mirrors `mostRecentPendingAsk`; never throws; corrupt → `[]` (no injection). |
| **U2** | Opt-out key precedence / nested schema is new | §9 — `.omp/elon.json` `{ideas:{reminders:false}}` + `OMP_IDEA_REMINDERS=0`. Precedence: env ▸ file ▸ default ON. `remindersEnabled(cwd)` mirrors `optedIn`'s JSON guard. |
| **U3** | Matcher is fully new code, zero deps | §7.3 — `matchIdeas`: tokenize `[a-z0-9]+`, drop a hardcoded stopword Set, token-set ∩ with `title∪tags`, overlap≥1, rank overlap-desc/created-asc, cap 2. Pure local ops. |
| **U4** | Concurrent write/read race (torn read) | §11 — fail-safe parser is primary defense (torn read → `[]` → no injection). Whole-file `write` by DocWorm minimizes window. True atomicity depends on omp `write` tool (flagged R-U4 for DEVELOP verification). No DocWorm frontmatter change. |
| **U5** | Reminder cadence mid-workflow | §8 — **always-on**, user-turn only, cap 2; noise controlled by hook cap + Elon LLM relevance judgment + opt-out. Phase-based suppression rejected (complexity vs. marginal benefit). |
| **U6** | customType naming | §7.2 — `elon-ko-gate:idea-reminder` (reminder), `elon-ko-gate:idea-capture` (command steering). Namespace matches existing `elon-ko-gate:` convention. |
| **U7** | Advisory layer can't be system-attributed | §12 — `attribution:"user"` is the only runtime option; system-prompt injection unreachable. Advisory lives in **prose** (`skill://elon` + `append-system.default.md`), exactly like `dot-agreement`/APPEND_SYSTEM. |
| **U8** | `/idea` handler must not write IDEAS.md | §6.1 — command handler only `pi.sendMessage`s an `idea-capture` steering message; Elon acks + delegates `append` to DocWorm. No fs write from the handler. Ownership invariant preserved. |
| **U9** | No new runtime deps | §3.1 — Node built-ins + SDK types only; no `package.json#dependencies` change. |

---

## 15. Acceptance Criteria → SPEC Section + Verification  *(REQ AC1–AC14)*

| AC | Requirement | SPEC § | Verification method |
|---|---|---|---|
| **AC1** | `/idea <text>` → ack + parked block + `IDEA-NNN` within one turn | §6.1, §6.5 | Turn transcript shows ack line + DocWorm `write` of a `status=parked` block + Elon confirmation with `IDEA-NNN`. Tool-call audit: the write is by `docworm`, never `elon`. |
| **AC2** | NL trigger phrase → same as AC1 | §6.2 | Same evidence; phrase from §6.2 triggers the same Elon→DocWorm→confirm flow. |
| **AC3** | Agent `idea-suggest` + veto (accept writes+sourced; drop = no write) | §6.4 | Agent-output transcript contains the block; accepted case → IDEAS.md diff has `source=<agent>` block + Elon surfaces it; dropped/malformed case → no IDEAS.md change, no surfacing. |
| **AC4** | Only DocWorm writes `.app/IDEAS.md` | §4, §6.5 | Tool-call audit across ALL agents in the scenario: `write`/`edit` to `.app/IDEAS.md` appears only under `docworm`. |
| **AC5** | Proactive reminder on ≥1 token overlap, not opted out, ≤2 pointers | §7, §8 | Hook injection log shows `elon-ko-gate:idea-reminder` message with ≤2 hits; Elon reply contains ≤2 one-line pointers. |
| **AC6** | Opt-out → hook no-op, no pointer | §9 | With `ideas.reminders=false` (or `OMP_IDEA_REMINDERS=0`): hook log shows no injection; reply has no pointer regardless of overlap. |
| **AC7** | `/ideas` lists non-terminal; `/ideas all` includes terminal | §6.3 | `/ideas` reply = one-line per `parked`; `/ideas all` reply includes `promoted`/`rejected`/`superseded` with badges. Works even when opted out. |
| **AC8** | `/idea promote` → status=promoted + `promoted_to`/`promoted_at`, block KEPT, REQ.md seeded | §10.2 | IDEAS.md block: `status=promoted`, `promoted_to:.app/REQ.md`, `promoted_at:<ISO>`, block still present; new `.app/REQ.md` exists seeded from the idea. |
| **AC9** | Promotion during active FULL → Pending Ask, no clobber | §10.2 step 2 | `.app/PROJECT.md` `## Pending Asks` has the promotion ask; `.app/REQ.md` unchanged until `.`-confirmed. |
| **AC10** | Ideas ≠ Pending Asks (disjoint stores) | §4, §5 | grep `.app/IDEAS.md` for `## Pending Asks`/PA ids = none; grep `.app/PROJECT.md` `## Pending Asks` for `## Ideas`/IDEA-NNN blocks = none. |
| **AC11** | No state transition outside §10.1; `promoted` not re-openable | §10.1, §10.3 | State-transition audit on IDEAS.md git history: every transition is in the graph; no `promoted→*`. |
| **AC12** | Matcher is pure local string/set ops | §7.3 | Code review of `matchIdeas`: no `fetch`/`http`/`net`/`child_process`/embedding import; only `String`/`Set` ops. |
| **AC13** | Human edit re-parses; breaking edit → located error, no injection | §5.4 | (a) add a tag by hand → next turn reminder reflects it; (b) corrupt a block → hook logs a located `pi.logger` line and injects nothing. |
| **AC14** | Layered enforcement documented; hard hook is load-bearing | §2.1, §12.1 | SPEC/skill text states prose is insufficient alone; `src/idea-storage.ts` registers the `before_agent_start` hook; removing it leaves only prose. |

---

## 16. Residual Risks for DEVELOP (flagged)

- **R-U4 (write atomicity):** RESEARCH did not verify whether omp's `write` tool performs temp+rename. The fail-safe parser is the guaranteed backstop (torn read → no injection, never corrupt). DEVELOP should confirm tool atomicity; if non-atomic and torn reads are observed, no contract change is needed (§11).
- **R-U8 (command delivery timing):** `pi.sendMessage` from a `registerCommand` handler with `deliverAs:"nextTurn", triggerTurn:true` is the assumed mechanism to make Elon ack within the user's `/idea` interaction. RESEARCH verified `sendMessage` exists (`types.ts:1083-1086`) but not its exact behavior when invoked from a command handler. DEVELOP must confirm the continuation turn fires and Elon receives the steering message in a single user-perceived interaction. **Fallback if awkward:** drop `registerCommand` for `/idea` and rely on the literal `/idea <text>` text reaching Elon's prompt + advisory prose (REQ R1.1 allows NL-only; the explicit command then becomes a documented phrase). The contract (no fs write from handler; DocWorm sole writer) is unchanged either way.
- **R-sync (two-plugin release):** the hook (Plugin A) and the skill prose (Plugin B) must ship together; a hook without prose injects context Elon has no documented behavior for (§12.3).
- **R-stopwords (matcher recall):** the hardcoded stopword list (§7.3) is a judgment call. Over-aggressive stopwords reduce recall; under-aggressive increase noise. It is a single readable `const`, trivially tunable post-hoc without contract change. DEVELOP should include stopword-list cases in unit tests.

---

## 17. Open Questions for Elon

None blocking. All U1–U9 resolved with concrete substrate-grounded decisions; all AC1–AC14 mapped to a SPEC section + verification method; all invariants preserved. The two residual risks (R-U4, R-U8) are DEVELOP-time confirmations, not design forks — the SPEC's contracts hold under either outcome. Ready for DEVELOP.
