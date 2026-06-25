# PROJECT — Subagent Execution Visibility

**Classification:** FULL · **Status: DONE** · Created 2026-06-24

## Goal → Outcome
Per-subagent execution visibility via native supaterm tabs (one per agent, `<agentId> · <role>`, colored live stream, survives end for review, tmux fallback). **Delivered + validated.**

## Resolved decisions (operator-confirmed)
No core fork · Live+Review · Persisted/rewindable · Read-only+stop/cancel · supaterm primary · 2–4 concurrency · Rich (incl. color) · Native tabs one-per-agent labeled · Never-auto-close · Path A (new in-repo extension).

## Locked invariants
1. Relay, not capture. 2. Key on agentId. 3. No core fork. 4. supaterm-native primary; tmux fallback.

## Phase Log — all ✓
REQUEST → GRILL r1 → RESEARCH → GRILL r2 (REQ.md, GATE `dbc26d7`) → SPEC (GATE `1441ed2`) → APPROVED → DEVELOP (`9c1fe93`/`0780237`) → VALIDATE **PASS** → DEVELOP color (`6f09077`) → VALIDATE color **PASS** (15/15) → DocWorm (README.md) → **DONE**.

## Deliverable
- `src/subagent-tabs.ts` (extension) + `src/subagent-tabs.test.ts` (8 tests), registered in `package.json#omp.extensions`. Branch `dev`, pushed.
- Docs: README.md "Subagent live tabs" section.
- Env: on by default; `OMP_SUBAGENT_TABS=0` disable; `OMP_SUBAGENT_TABS_RENDER` rich|plain; `OMP_SUBAGENT_TABS_QUIET_MS`=30000; `OMP_SUBAGENT_TABS_HOLDER`.

## Validation
MET: 4 invariants, N1, AC3/AC5/AC6/AC7/AC8/AC9, 7/7 errors, C1–C3 API vs dist/types. 8/8 unit + tsc clean (reproduced twice). Live supaterm socket + tmux capture-pane verified end-to-end. Live-only (logic unit-tested): AC1/AC2/AC4.

## Deferred (non-blocking)
(2) no mid-session backend failover · (3) no 'isolated' label (API gap) · (4) no cancel-hint in label · (5) rewind() unwired.
