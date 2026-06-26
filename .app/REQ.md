# Requirements Document — omp-agent-gate / orchestrator-agents

**Phase:** GRILL (Round 2, FINAL)
**Scope:** Two changes to the orchestrator plugin suite that ships from this repo.
- **C1** — `.` (dot) agreement token for Elon's pending-proposal flow.
- **C2** — file-based inter-agent messaging, **reframed as cross-instance IPC**: in-app (`task()`/`irc`) stays primary when agents are co-located; file transport is used **only** when the receiver runs in a different omp instance.

**Legend.** Each requirement carries **AC** (observable/testable acceptance criteria) and **ASSUMPTION** where a decision is deferred. `[FOR-SPEC]` = implementation detail owned by LeadDev's SPEC phase, not a requirement. Source tags: `[user]` = user-resolved; `[default]` = adopted default; `[DrPe]` = verified feasibility fact.

---

## 1. Resolved-Decisions Summary

### C1 — `.` agreement token
| Tag | Decision | Source |
|----|----------|--------|
| C1-target | A lone `.` (trimmed) = agree with ANY currently-pending proposal, regardless of origin (ReqGuru, LeadDev, or Elon's own confirmation, e.g. "Proceed TRIVIAL path?"). | [user] |
| C1-multi | If several proposals are pending, `.` accepts the MOST RECENT pending ask; the rest are deferred with a recorded note. | [user] |
| C1-exact | Triggers ONLY when the trimmed reply is exactly one `.`. Embedded dots (`v1.2`, `ok.`, `3.14`) and `..` are literal. | [default] |
| C1-noproposal | `.` arriving with nothing pending → Elon asks the user what they are agreeing to. | [default] |
| C1-scope | Strictly `.`; other affirmatives (`yes`, `ok`, `y`) are NOT mapped to agreement. | [default] |

### C2 — file-based messaging (cross-instance IPC)
| Tag | Decision | Source |
|----|----------|--------|
| C2-intent | File transport is an **additional** method, used **only** when in-app (`task()`/`irc`) cannot reach the receiver because the receiver runs in a **different omp instance**. | [user] |
| C2-processed | A message is "processed" once the receiver has **completed** the requested action; the receiver moves the file `.app/mess/` → `.app/mess/arc/` via an atomic rename at the end of its turn. | [user] |
| C2-agentscope | All registered agents participate, **including MidDev**. The human user is **excluded**; user↔Elon `ask` traffic is out of scope. | [default] |
| C2-naming | Filename `<sender>-<receiver>-<datetime>.md`; `datetime` = ISO-8601 UTC compact `YYYYMMDDTHHMMSSZ`; a `-NN` sequence suffix breaks same-second collisions; agent names restricted to `[A-Za-z0-9]` (no hyphens). | [default] |
| C2-content | YAML frontmatter (`from`, `to`, `timestamp`, `type`, `in-reply-to`) + markdown body; `type` ∈ {DELEGATION, DELIVERABLE, QUESTION_BATCH, FAILURE, HANDOFF}, mirroring `task()` return semantics. | [default] |
| C2-failure | On processing failure, retry-in-place in `.app/mess/` up to N attempts, then move to `arc/` with an explicit FAILURE annotation; mirrors the 3-cycle DEVELOP⇄VALIDATE spirit (N=3). | [default] |
| C2-retention | `arc/` retained indefinitely for debug. | [default] |

### Ground-truth feasibility facts (DrPe)
- This repo is the **source of both plugins**: `omp-agent-gate` (Plugin A, `src/enforce-orchestrator.ts`) and `orchestrator-agents` (Plugin B, rooted at `./plugins`). The `tool_call` gate, `APPEND_SYSTEM` framing, agent `tools:`/`spawns:` frontmatter, and `skill://elon` are **all editable source here** — nothing is an immutable external binary.
- `skill://elon` resolves to `plugins/agents/skills/elon/SKILL.md`. Agent definitions live at `plugins/agents/agents/{leaddev,middev,reqguru,drpe,validator,docworm,hr}.md`. There is **no `elon.md`** (Elon is the root session, not a spawned agent).
- The **one capability absent** from the entire repo: an async file-delivery / polling / listener mechanism. It **must be built** for cross-instance C2.

---

## 2. C1 Requirements — `.` Agreement Token

**Scope locus:** a **root-session** behavior (Elon parsing user replies). Implementation surface is editable source (gate / `APPEND_SYSTEM` framing / `skill://elon`); exact placement is `[FOR-SPEC]`. This mechanism applies to user replies to **any** pending ask, including questions ReqGuru/LeadDev raised that Elon relayed via `ask`.

> **Definition — "pending ask":** a proposal or confirmation question that Elon has presented and that is awaiting a user decision. The **most-recent pending ask** is the last such unanswered item (typically the most recently relayed question or confirmation).

**R1.1 — Agreement token.** A user reply whose trimmed value is exactly `.` marks the **most-recent pending ask** as agreed.
- AC: given pending ask P as most-recent and reply `.`, P is recorded as agreed and the flow proceeds on P.

**R1.2 — Origin-agnostic pending set.** `.` agrees with a pending ask **regardless of origin** — ReqGuru question, LeadDev escalation, or Elon's own confirmation (e.g. "Proceed TRIVIAL path?").
- AC: for a pending ask originating from a relayed ReqGuru question, reply `.` agrees with it identically to an Elon-origin confirmation.

**R1.3 — Multi-pending resolution.** When ≥2 asks are pending, `.` accepts the **most-recent** one; the remaining pending asks are **deferred with a recorded note** (they stay pending for a later reply).
- AC: with pending asks [A, B] (B most recent) and reply `.`, B is agreed; A remains pending and a note records "A deferred (superseded by agreement to B)".

**R1.4 — Exact-match only.** The token triggers **only** when `trim(reply) == "."`. Replies with embedded or repeated dots are **literal** text, not agreement.
- AC: replies `v1.2`, `ok.`, `3.14`, `..` are NOT agreement tokens (literal input); a reply whose trimmed value is `.` triggers — including whitespace-padded forms (`. ` , ` .`).

**R1.5 — No-pending guard.** If `.` arrives with **nothing pending**, Elon asks the user what they are agreeing to (does not fabricate a target).
- AC: with an empty pending set and reply `.`, Elon emits a clarification ask naming no proposal; no ask is marked agreed.

**R1.6 — Affirmative scope is `.`-only.** Other affirmatives (`yes`, `ok`, `y`, `sure`, etc.) are **not** mapped to the agreement-token mechanism; they are processed as ordinary user input (Elon may still interpret them in normal conversation, but there is no token-level auto-agreement shortcut for them).
- AC: reply `ok` to a pending yes/no ask does **not** invoke the `.` agreement-token path; it is ordinary input (observable: the agreement-token handler is not entered).

---

## 3. C2-core Requirements — File-Based Messaging (transport-agnostic core)

**R2.1 — Additional, gated transport.** File-based messaging is an **additional** transport, invoked **only** when in-app (`task()`/`irc`) cannot reach the receiver because the receiver runs in a **different omp instance**. Co-located receivers use in-app **exclusively**.
- AC: a message to a **co-located** receiver produces **no** file under `.app/mess/` (in-app used); a message to a **remote** receiver produces a file under `.app/mess/`.

**R2.2 — Agent scope; user excluded.** All **registered agents** participate, including **MidDev**. The **human user is excluded**; user↔Elon `ask` traffic never uses file transport.
- AC: a send whose `to:` is a registered agent is accepted; a send whose `to:` resolves to the user (or a non-registered name) is rejected/out-of-scope and writes no file.

**R2.3 — Folder layout.** `.app/mess/` holds in-flight messages; `.app/mess/arc/` holds processed and failed messages.
- AC: a freshly created message exists only under `.app/mess/`; after terminal disposition it exists only under `.app/mess/arc/`.

**R2.4 — Filename naming.** `<sender>-<receiver>-<datetime>.md` where `datetime = YYYYMMDDTHHMMSSZ` (ISO-8601 UTC compact); a `-NN` zero-padded sequence suffix breaks same-second same-pair collisions; agent names restricted to `[A-Za-z0-9]` so the `-` delimiter is unambiguous.
- AC: every filename matches `^[A-Za-z0-9]+-[A-Za-z0-9]+-\d{8}T\d{6}Z(-\d{2,})?\.md$`; two messages with identical sender/receiver/second receive distinct `-NN` suffixes and neither overwrites the other.

**R2.5 — Content schema.** Each file = YAML frontmatter with required keys `from`, `to`, `timestamp`, `type`, `in-reply-to` + a markdown body. `type` ∈ {DELEGATION, DELIVERABLE, QUESTION_BATCH, FAILURE, HANDOFF}, mirroring `task()` return semantics.
- AC: every file parses to valid YAML frontmatter containing all required keys, a `type` from the enumerated set, and a non-empty markdown body.

**R2.6 — Processed lifecycle (terminal success).** A message is "processed" once the receiver has **completed** the requested action; at the **end of its turn** the receiver moves the file `.app/mess/` → `.app/mess/arc/` via an **atomic rename**.
- AC: after the receiver completes the requested action, the file is absent from `.app/mess/` and present in `.app/mess/arc/` (no partial/duplicate state).

**R2.7 — Failure handling.** On processing failure, the receiver retries **in place** (file stays in `.app/mess/`) up to **N=3** attempts (mirroring the 3-cycle DEVELOP⇄VALIDATE spirit); after the Nth failure it moves the file to `arc/` with an explicit **FAILURE annotation** (attempt count + reason).
- AC: a receiver that fails ≤2 times leaves the message in `.app/mess/` with an incremented attempt counter; on the 3rd failure the message resides in `arc/` with a FAILURE annotation recording count and reason.

**R2.8 — Retention.** `arc/` entries are retained **indefinitely** for debugging (no automatic eviction).
- AC: no automated process deletes or ages out `arc/` entries.

---

## 4. C2-cross-instance Requirements

### 4a. Instance Model (R3.x)

**R3.1 — "omp instance" definition.** An **omp instance** is a single oh-my-pi runtime process that hosts a set of agents and provides the in-app tools (`task`, `irc`). Agents hosted by the **same** instance are **co-located**; agents hosted by **different** instances are **remote** to each other.
- AC: two agents in the same process can reach each other via in-app tools; an agent in process P1 cannot reach an agent in P2 via `task()`/`irc` (the in-app call returns "not reachable in this instance").

**R3.2 — Agent→instance mapping.** There exists a mapping from each participating agent name to the instance that hosts it; a sender consults this mapping to classify a receiver as co-located or remote.
- ASSUMPTION [PRODUCT, non-blocking]: mapping is provided by an **instance manifest** (e.g. `.app/instances.json` or equivalent config) listing `agent → instance-id`. Agents **absent** from the manifest default to **co-located** with the current sender's instance.
- AC: given a manifest mapping agent `A → inst1` and sender in `inst2`, a send to `A` is routed to **file transport**; a send to agent `B` absent from the manifest uses **in-app** and writes no file.

**R3.3 — Instance identity.** Every instance has a **stable, unique instance id**.
- ASSUMPTION [PRODUCT, non-blocking]: derived from manifest/env; exact generation `[FOR-SPEC]`.
- AC: two concurrently-running instances have **distinct** ids; an instance's id is **stable across restarts within a session**.
- Open `[FEASIBILITY]`: confirm whether omp already exposes an instance-id concept (env var, pid, config) to reuse.

### 4b. Transport-Selection Rule (R4.x)

**R4.1 — Primary selection (instance-based).** To send to receiver R, sender S looks up R's instance via the mapping (R3.2). If `instance(R) == instance(S)` → use **in-app** (`task`/`irc`). If `instance(R) != instance(S)` → use **file transport**.
- AC: a send to a co-located receiver uses in-app and writes no file; a send to a remote receiver writes a file and does not rely on in-app.

**R4.2 — Fallback on unreachable in-app.** If an in-app delivery returns a "receiver not reachable in this instance" result, S **falls back** to file transport. This operationalizes the user intent ("file transport used when in-app cannot reach the receiver").
- AC: an in-app send that returns "not reachable in this instance" is followed by a file being written to `.app/mess/`; the message is ultimately delivered via file transport.
- Open `[FEASIBILITY]`: what exact return does `task()`/`irc` produce when the target is not in the instance? (defines the fallback trigger signal).

**R4.3 — Transport observability.** The transport actually used for a given message is **observable** (recorded), so a test can assert which transport handled it.
- AC: for any sent message there is a determinable record of `in-app` vs `file` transport; a test can assert the expected transport per receiver.

### 4c. Message Detection — Remote Delivery (R5.x)

> **Requirement-level only.** The detection *mechanism* (poll interval vs. event/listener) is `[FOR-SPEC]`. The requirement is the **observable** detection contract: a remote receiver becomes aware of a waiting message without any in-app signal (none crosses instances).

**R5.1 — Detection requirement.** A remote receiver MUST be able to **detect** messages in `.app/mess/` addressed to it (`to:` == its agent name) **without** an in-app signal.
- AC: a message written by a remote sender to `.app/mess/` with `to: Receiver` is detected by the `Receiver` instance even though no in-app channel connects the two instances.

**R5.2 — Detection points.** Detection is triggered at **well-defined points**: at the **start of an agent's turn**, and whenever an agent is **idle / awaiting input**. Exact mechanism `[FOR-SPEC]`.
- AC: a message present in `.app/mess/` addressed to an agent is detected at that agent's next turn-start or idle-check (not silently ignored).

**R5.3 — Bounded detection latency.** A message addressed to an **idle** remote receiver is detected within a **bounded window** (a defined constant), not "eventually / never".
- ASSUMPTION [PRODUCT, non-blocking]: window = "turn-start + a bounded idle-poll"; numeric value `[FOR-SPEC]`.
- AC: a message written while the receiver is idle is detected within the bounded window; a test asserts detection-onset ≤ window.

**R5.4 — Exclusive claim (no double-processing).** Once a receiver begins processing a detected message it **claims** the message exclusively, so **no other instance** processes the same message. Claim mechanism `[FOR-SPEC]` (atomic rename-to-claim, lockfile, etc.).
- AC: with **two** receiver instances and **one** message addressed to that agent, **exactly one** instance processes it; the other does not act on it.
- Open `[FEASIBILITY]`: confirm atomic-rename / lockfile guarantees on the target shared filesystem (macOS APFS, network mount).

> **Lifecycle reconciliation (R2.6 + R5.4):** full state machine is `PENDING` (in `.app/mess/`, undetected) → `CLAIMED` (in `.app/mess/`, exclusively owned, in-progress) → `PROCESSED` (moved to `arc/`, R2.6) **or** `FAILED` (moved to `arc/` with annotation, R2.7). The claim (R5.4) covers the window between detection and end-of-turn completion.

### 4d. Instance Identity, Addressing & Concurrency (R6.x)

**R6.1 — Shared-filesystem assumption.** `.app/mess/` resides on a filesystem **readable and writable by all participating instances**.
- ASSUMPTION [PRODUCT, **load-bearing**, non-blocking]: shared filesystem (local multi-process, network mount, or a transparent sync layer). **If this assumption is false** (instances on machines with no shared fs and no sync), the file-transport approach is not viable as specified and the transport design changes materially (network sync becomes a separate epic) — see Open Items P2.
- AC: a message written by instance I1 is **visible/readable** by instance I2 within the detection window (R5.3).

**R6.2 — Concurrent-write safety.** Multiple senders — possibly across instances — may write concurrently; naming uniqueness plus atomic-create guarantees **no two messages collide and none is lost**.
- AC: N concurrent sends produce **N distinct files**, none overwritten; same-second same-pair collisions are resolved by the `-NN` suffix (R2.4).

**R6.3 — Cross-instance addressing metadata.** Frontmatter **SHOULD** carry instance-routing metadata (`from-instance`, `to-instance`) so a receiver can attribute and reply across instances. The R2.5 required keys remain authoritative; exact field names `[FOR-SPEC]`.
- AC: a cross-instance message includes enough metadata for the receiver to identify the originating instance and route a reply back.

**R6.4 — Reply routing is not assumed co-located.** A reply (`in-reply-to`) to a cross-instance message is routed back to the originator's instance by the **same** selection rule (R4.1) — replies are **not** assumed in-app.
- AC: a reply to a remote-origin message is written to `.app/mess/` (file transport) rather than assumed reachable in-app.

---

## 5. Open Items

All open items below have a **non-blocking assumption** baked into the REQ above; they confirm/refine rather than gate SPEC/RESEARCH.

### [PRODUCT] — for the user (confirm at convenience)
- **P1 — Instance declaration mechanism.** How does the user declare that an agent runs in a different omp instance? *(Assumption R3.2: an instance manifest such as `.app/instances.json` maps `agent → instance-id`; absent agents default co-located.)*
- **P2 — Shared filesystem vs. network sync (LOAD-BEARING).** Is `.app/mess/` on a shared filesystem (mount) or synced across separate machines (Syncthing/git/…)? *(Assumption R6.1: shared filesystem. If false, C2's file-transport is not viable as specified and becomes a larger network-sync epic — recommend confirming before SPEC.)*
- **P3 — Instance-id provenance.** Should instance ids be user-assigned, manifest-derived, or auto-generated? *(Assumption R3.3: manifest/env-derived, stable per session.)*
- **P4 — Detection-latency window value.** What bounded latency is acceptable for a remote receiver to notice a waiting message? *(Assumption R5.3: turn-start + bounded idle-poll; value `[FOR-SPEC]`.)*
- **P5 — Cross-instance peer (irc-style) messaging scope.** The enumerated `type` set mirrors `task()` return semantics. Should fire-and-forget peer messaging across instances (irc-equivalent) be in scope now or deferred? *(Assumption: same transport reuses the schema; treat as extension, not blocking.)*

### [FEASIBILITY] — for DrPe (RESEARCH phase)
- **F1 — Existing instance-id concept.** Does omp already expose an instance id (env var, pid, config) reusable for R3.3?
- **F2 — In-app "unreachable" return shape.** What exact return does `task()`/`irc` produce when the target agent/peer is not present in the current instance? (Defines the R4.2 fallback trigger signal.)
- **F3 — Atomicity guarantees on the shared fs.** Confirm atomic-rename / lockfile semantics on the target filesystem (macOS APFS / network mount) for R5.4 exclusive claim and R2.6/R2.7 terminal moves.
- **F4 — Existing cross-instance/shared-state primitives.** Is there any pre-existing cross-instance or shared-state mechanism in omp (lockfile convention, known dirs) the new transport can build on?

---

## 6. Non-Goals (explicit)
- Do **not** design the detection/polling/listener **implementation** — that is SPEC/LeadDev (`[FOR-SPEC]` throughout R5).
- Do **not** design the claim/lock **mechanism** — `[FOR-SPEC]` (R5.4).
- Do **not** specify the instance-manifest **file format** beyond the requirement it satisfies (R3.2) — `[FOR-SPEC]`.
- Do **not** include user↔Elon `ask` traffic in C2 (out of scope by C2-agentscope).
- Do **not** design network sync (only relevant if P2 disproves the shared-fs assumption).
