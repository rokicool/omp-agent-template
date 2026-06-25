# Requirements Document — Per-Subagent Terminal Visibility (Native Tabs)

> **Status:** LOCKED (GRILL round 2). All seven operator branches are resolved;
> DrPe's RESEARCH.md is folded in as authoritative for feasibility.
> **Phase gate:** this document is the input to SPEC (LeadDev). Mechanism internals
> (which live surface feeds a tab, `pane` vs `tab` wiring, exact `sp` command
> sequence) are deliberately NOT chosen here — they belong to SPEC.

---

## Overview

A harness-integrated feature that gives the operator real-time, full-log visibility into every
running oh-my-pi subagent via **native terminal tabs across the top of the supaterm window — one
tab per agent, labeled with the agent id/role — each streaming that agent's live activity**, with
rich fidelity and continued availability for after-the-fact review after the agent ends. It is a
**relay of output that the harness already produces**, not a new capture backend; it is delivered
by extending an existing omp extension/hook surface, not by forking the core. supaterm is the
primary surface; a tmux bridge is the documented portable fallback.

## Invariants (non-negotiable, derived from operator answers + RESEARCH.md)

- **INV-1 — Relay, not capture.** omp already produces a live per-subagent transcript. The feature
  consumes an **existing** live surface; it MUST NOT add a new transcript-capture backend. The
  three verified live sources (selection deferred to SPEC): (1) on-disk `<id>.jsonl` tail
  (`tail -F`, zero harness cooperation, **mode-independent** — works in the operator's interactive
  TUI session); (2) RPC `set_subagent_subscription` + `get_subagent_messages{fromByte}` (seekable,
  structured, **requires RPC mode**); (3) in-process EventBus hooks
  `task:subagent:event/progress/lifecycle` (can call `pi.exec`).
- **INV-2 — Key on `agentId`, never on PID/process.** Subagents are **in-process `AgentSession`s,
  not OS processes**. Every tab↔agent mapping MUST be keyed on the agent id; "one tab per agent"
  is the correct unit (there is no OS process per agent to attach to).
- **INV-3 — No core fork; harness-integrated.** Delivered via an existing extension/hook/TUI
  surface (the shipped `pi-notify-supaterm` extension already maps `agentId↔surface` and forwards
  Pi events — today notifications only, NOT full-log streaming). The feature EXTENDS this; it does
  not fork omp core and does not duplicate an existing surface.
- **INV-4 — supaterm-native primary.** supaterm (libghostty core + Unix-socket `sp` CLI with
  `new_tab`/`new_pane`/`send_text`/`send_key`/`capture_pane`/`close_pane`/`close_tab`/`notify`,
  plus `sp tmux` interop) is the primary terminal surface. This is an explicit operator override
  of research's generic #1 (tmux) ranking, accepted because the operator runs supaterm and wants
  the richest native UX.

## Locked Decisions (operator-confirmed, GRILL r1 + mid-GRILL)

| Decision | Locked value | Tag |
|---|---|---|
| Coupling | Harness-integrated via existing extension/hook/TUI surface; **no core fork** | MUST |
| Temporal | **Live streaming AND after-the-fact review** | MUST |
| Retention | Persisted / rewindable (survives agent end) | MUST |
| Interactivity | Read-only observation **PLUS stop/cancel** (reuses existing job cancel → `aborted`) | MUST |
| Terminal scope | supaterm/ghostty-specific (supaterm primary) | MUST |
| Concurrency | Typical 2–4; degrade gracefully beyond `task.maxConcurrency` | MUST |
| Fidelity | Rich: status, progress, color, collapsible sections | MUST |
| Layout / UX | **Native terminal tabs on top, one per agent, labeled with agent id/role** (primary surface, NOT tiling panes) | MUST |
| Fallback posture | tmux bridge as documented terminal-agnostic fallback | SHOULD |

## Functional Requirements

- **FR-1 [MUST]** — While a subagent runs, exactly **one native supaterm tab** exists for it,
  created when the agent starts. The tab is **labeled with the agent's id/role**. (Paned/tiling is
  NOT the primary surface.)
- **FR-2 [MUST]** — Each tab **streams the agent's live activity** in push order (no batching),
  near-real-time, sourced from an existing live surface (INV-1). The stream is never a new capture
  backend.
- **FR-3 [MUST]** — Tab content renders **rich fidelity**: agent status, progress, color, and
  collapsible sections.
- **FR-4 [MUST]** — The tab↔agent mapping is keyed on **`agentId`** (INV-2) and survives the
  in-process-session identity, including the **idle→park→revive** lifecycle cycle (the revived
  agent reuses/keeps its correct tab).
- **FR-5 [MUST]** — After a subagent ends, its tab/transcript **remains available for
  after-the-fact review**, rewindable to the persisted transcript (Retention). The tab is **not
  auto-destroyed on agent end** — see Surfaced Tension T1. Precise cleanup/retention policy (TTL,
  re-openability) is deferred to SPEC.
- **FR-6 [MUST]** — The operator can **stop/cancel** a subagent from the visibility context by
  reusing the existing job-cancel mechanism; the cancel maps to the agent's `aborted` (terminal)
  state, which the tab MUST reflect.
- **FR-7 [MUST]** — The feature is delivered **without modifying omp core** (INV-3), extending the
  existing extension/hook surface; it coexists with the current `pi-notify-supaterm` behavior
  (extend, do not fork or replace).
- **FR-8 [MUST]** — Concurrency beyond `task.maxConcurrency` degrades gracefully: tabs are created
  only for actually-running agents; queued agents do not produce phantom/duplicate tabs.
- **FR-9 [MUST]** — The agent's terminal lifecycle states are represented in the tab: running,
  idle/parked, revived, aborted (terminal), and isolated (non-revivable but whose transcript is
  still readable in-review).
- **FR-10 [SHOULD]** — A **documented tmux-bridge fallback** provides equivalent per-agent
  streaming when supaterm is unavailable (terminal-agnostic, no TCC prompt). This is the portable
  fallback, not the primary surface.
- **FR-11 [SHOULD]** — Robust lifecycle coverage across `task.maxConcurrency` queuing,
  idle→park→revive, aborted, and isolated runs, with no orphan tabs and no lost review access.
- **FR-12 [SHOULD]** — A **non-permission-prompting path** exists for at least the primary
  surface, so the feature works without interactive macOS permission grants where feasible (TCC
  behavior per mechanism is a SPEC consideration — see Open Questions).
- **FR-13 [COULD]** — A first-class in-omp action ("stream/inspect this agent's transcript into a
  tab") reusing the Agent Hub / RPC / EventBus surfaces, keeping the relay logic in one place.
- **FR-14 [COULD]** — Multi-window/space support and attention/notifications (the latter already
  emitted by `pi-notify-supaterm`).

## Non-Functional Requirements

- **NFR-1 Performance** — Live stream is near-real-time (events in push order, no batching) at
  typical 2–4 concurrent agents; the relay imposes no measurable latency/throughput impact on the
  parent session or on subagent execution.
- **NFR-2 Reliability** — A **zero-harness-cooperation baseline** exists: the file-tail source
  works in any omp mode, including the operator's interactive TUI session (RPC source requires RPC
  mode). Failure to create or stream a tab MUST NOT crash the parent session or any subagent.
- **NFR-3 Degradation** — Partial terminal availability (supaterm not running, socket unreachable,
  permission denied) degrades gracefully to the fallback or to existing in-omp surfaces — never a
  silent hard failure.
- **NFR-4 Platform** — macOS Apple Silicon. supaterm (libghostty) primary; ghostty 1.3.0+ is
  present but **weaker** for live streaming (AppleScript only: paste-style `input text`,
  **no socket CLI, no pane read-back**) — see Open Questions. tmux is the portable fallback.
- **NFR-5 Security/Permissions** — macOS TCC surfaces differ by mechanism (socket IPC vs
  AppleScript vs tmux); the feature MUST avoid privilege escalation and MUST preserve per-agent
  isolation. Beyond the explicit stop/cancel (FR-6), the tab surface is **read-only** observation.
- **NFR-6 Compatibility** — Must not require omp core changes; must coexist with and extend the
  existing `pi-notify-supaterm` extension rather than fork it.

## Input / Output Contract

- **Input** — Per-agent live transcript deltas + lifecycle state, obtained from one of the three
  existing surfaces in INV-1 (selection is a SPEC decision, not a requirement). Identity is the
  `agentId`; lifecycle is one of {running, idle/parked, revived, aborted, isolated}.
- **Output** — One native supaterm **tab per agent**, labeled with agent id/role, rendering the
  rich live stream while running and the rewindable persisted transcript for review after end. A
  stable **`agentId ↔ tabId` mapping** is maintained for the agent's lifetime and review window.
- **Control** — stop/cancel input (FR-6) reuses the existing job-cancel mechanism; output effect
  is the agent's `aborted` terminal state reflected in the tab.

## Error Cases

- **E1 — Tab creation fails** (supaterm not running / socket unreachable): fall back to the tmux
  bridge (FR-10) or to existing in-omp surfaces; never crash the parent. Surface the degraded
  state to the operator.
- **E2 — Concurrency exceeds `task.maxConcurrency`**: do not create tabs for not-yet-scheduled
  agents; create a tab only when an agent actually starts (FR-8).
- **E3 — Agent aborts**: tab reflects the `aborted` terminal state; transcript remains reviewable.
- **E4 — Agent is isolated** (non-revivable): no revive path; the persisted transcript is still
  readable in-review (FR-9).
- **E5 — Agent parked then revived**: the existing tab is reused/kept (FR-4); no duplicate tab.
- **E6 — Permission denied (TCC)**: take the documented non-prompting fallback path (FR-12); no
  silent failure.
- **E7 — RPC-mode-only source chosen but operator in interactive TUI**: rely on the
  mode-independent file-tail/EventBus baseline (INV-1, NFR-2).

## Acceptance Criteria (observable, testable)

- **AC1** — Launch 2–4 subagents concurrently → 2–4 native supaterm tabs appear, each labeled with
  that agent's id/role, and no extra/phantom tabs.
- **AC2** — Each tab streams its agent's live activity with rich fidelity (status/progress/color/
  collapsible) in push order, near-real-time, with no measurable parent-session impact.
- **AC3** — After each subagent ends, its tab remains available for after-the-fact review and is
  rewindable to the persisted transcript (not auto-destroyed on end).
- **AC4** — Canceling a subagent via the existing job-cancel mechanism marks it `aborted`, and the
  tab reflects that terminal state.
- **AC5** — With supaterm unavailable, the documented tmux-bridge fallback provides equivalent
  per-agent streaming.
- **AC6** — No omp core file is modified; the feature is delivered within the existing
  extension/hook surface and coexists with current `pi-notify-supaterm` behavior.
- **AC7** — agentId-keying is demonstrable: an idle→park→revive cycle keeps the correct tab
  (no PID/process assumption, no duplicate).
- **AC8** — Exceeding `task.maxConcurrency` degrades gracefully (no duplicate tabs, no crash, tabs
  appear only as agents actually start).
- **AC9** — Relay-not-capture is demonstrable: the feature consumes an existing live surface and
  adds no new transcript-capture backend.

## Surfaced Tensions (resolved at REQ level; internals deferred to SPEC)

- **T1 (RESOLVED) — Auto-close-on-end vs. after-the-fact review.** Research lists "auto-cleanup on
  agent end" as a trait of every candidate surface, which conflicts with the locked Temporal
  (live + review) and Retention (persisted/rewindable, survives end). **Resolution:** the per-agent
  tab MUST survive agent end to support review (FR-5); immediate auto-close on end is NOT a
  requirement. The precise cleanup/retention policy is a SPEC carry-over.
- **T2 (RESOLVED by operator fiat) — Research's generic #1 (tmux) vs. operator's supaterm-native
  primary.** DrPe ranks the terminal-agnostic tmux bridge highest generically; the operator
  explicitly chose supaterm-native tabs as primary for the richest native UX. **Resolution:**
  supaterm-native = MUST primary (INV-4, FR-1); tmux-bridge = SHOULD fallback (FR-10). Recorded
  for traceability — not a defect.
- **T3 (NOT a contradiction — SPEC carry-over) — Existing extension maps `agentId↔pane`; the
  feature needs `agentId↔tab` with full-log streaming.** The operator chose tabs as the primary
  surface (a UX decision in scope); how to adapt the existing pane-oriented extension/mapping to
  tabs and full-log relay is mechanism internals → SPEC. Flagged so SPEC does not silently reuse
  the pane assumption.

## Open Questions / Verification Gaps (LISTED for SPEC — not resolved here)

- **G1 [affects FR-1, MUST]** — Does `sp new_tab` set a tab **TITLE/name explicitly**, or does
  labeling require a separate notify/send step? (Unverified in research.) Determines how the
  "labeled with agent id/role" requirement is met.
- **G2 [affects INV-1 source selection]** — Full field **payload schemas** for RPC
  `set_subagent_subscription` and `get_subagent_messages{subagentId,sessionFile,fromByte}` and the
  `subagent_*` frames (research confidence Medium — rpc.md lists frame types, not per-frame
  payloads). Determines RPC viability as a data source.
- **G3 [affects NFR-5, FR-12]** — Exact **macOS TCC permission surface per mechanism** (supaterm
  socket IPC vs. Ghostty AppleScript vs. tmux): which prompt, if any, and whether a non-prompting
  path exists for the primary surface.
- **G4 [informational]** — DrPe Q4 third-party prior-art confidence is **Medium** due to a
  `web_search` quota error; broad third-party corroboration was not fetched. Not blocking.
- **G5 [affects fallback realism]** — Ghostty's AppleScript-only control (paste-style `input
  text`, **no socket CLI, no pane read-back**) limits it as a live-streaming fallback; the tmux
  bridge remains the recommended portable fallback.
