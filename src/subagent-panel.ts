/**
 * subagent-panel.ts — Inline subagent observability extension.
 *
 * Adds two always-available surfaces for watching live subagent state:
 *   (A) a persistent ≤10-line panel above (or below) the editor
 *       (ctx.ui.setWidget) that streams per-agent stats, and
 *   (B) a hotkey floating full table (ctx.ui.custom({ overlay: true }))
 *       for when many agents run.
 *
 * It subscribes to the three verified live subagent channels on pi.events,
 * folds each frame into a Map<id, SubagentRow>, and renders both surfaces from
 * that snapshot. A 1s tick refreshes elapsed displays using component-scoped
 * requestComponentRender only (never a forced full repaint).
 *
 * Purely additive: complements (does not touch) the built-in subagentContainer
 * HUD, statusLine, and Agent Hub. Guarded by ctx.hasUI (no-op in headless/RPC).
 *
 * Idiom copied from src/enforce-orchestrator.ts: default export
 * `(pi: ExtensionAPI) => void`, `import type { ExtensionAPI }`, env config read
 * once at module top-level, `ctx.hasUI` guard.
 */

// `import type` is erased at runtime, so this runs under omp regardless of
// whether the package is resolvable for standalone type-checking.
import type { ExtensionAPI, ExtensionContext } from "@oh-my-pi/pi-coding-agent";
import {
  TASK_SUBAGENT_LIFECYCLE_CHANNEL,
  TASK_SUBAGENT_PROGRESS_CHANNEL,
  TASK_SUBAGENT_EVENT_CHANNEL,
} from "@oh-my-pi/pi-coding-agent/task";
import type {
  AgentProgress,
  SubagentProgressPayload,
  SubagentLifecyclePayload,
  SubagentEventPayload,
} from "@oh-my-pi/pi-coding-agent/task";
import { truncateToWidth, replaceTabs, visibleWidth, matchesKey } from "@oh-my-pi/pi-tui";
import type { Component, KeyId, TUI } from "@oh-my-pi/pi-tui";
import { formatNumber } from "@oh-my-pi/pi-utils";

// ---------------------------------------------------------------------------
// Env config — read ONCE at module top-level (defaults accepted, SPEC §11).
// ---------------------------------------------------------------------------

function parseIntSafe(raw: string | undefined, fallback: number): number {
  if (raw === undefined || raw === "") return fallback;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) ? n : fallback;
}

/** Toggle chord as shown in UI hints (preserves the user's casing). */
const TOGGLE_KEY_DISPLAY = process.env.OMP_SUBAGENT_PANEL_KEY || "Alt+S";
/** Lowercased chord for registerShortcut / matchesKey. */
const TOGGLE_KEY = TOGGLE_KEY_DISPLAY.toLowerCase() as KeyId;
const PLACEMENT =
  process.env.OMP_SUBAGENT_PANEL_PLACEMENT === "belowEditor" ? "belowEditor" : "aboveEditor";
const HIDE_EMPTY = process.env.OMP_SUBAGENT_PANEL_HIDE_EMPTY === "1";
const SHOW_SYNC = process.env.OMP_SUBAGENT_PANEL_SHOW_SYNC === "1";
const DONE_TTL_MS = parseIntSafe(process.env.OMP_SUBAGENT_PANEL_DONE_TTL_MS, 30000);
const MIN_RENDER_MS = parseIntSafe(process.env.OMP_SUBAGENT_PANEL_MIN_RENDER_MS, 200);
/**
 * Always-on persistent widget master switch. Defaults OFF so elon-ko's panel
 * COMPLEMENTS omp's native Agent Hub instead of stacking a second live widget
 * on the same surface — which raced both renders on every task:subagent:*
 * event and a 1 s tick, flickering the region. The event store + Alt+S overlay
 * stay active regardless; set OMP_SUBAGENT_PANEL_PERSIST=1 to restore the
 * always-on compact panel above/below the editor.
 */
const PERSISTENT_PANEL = process.env.OMP_SUBAGENT_PANEL_PERSIST === "1";

/** Stable widget key used with ctx.ui.setWidget. */
const PANEL_KEY = "omp-subagent-panel";
/**
 * macOS US-keyboard Option+<letter> compositions that resolve to a single
 * precomposed Unicode char (e.g. Option+S = "ß" U+00DF). On macOS terminals
 * that ship with Option NOT treated as Alt — the Ghostty and Terminal.app
 * defaults — these composed bytes are what stdin actually receives on
 * Option+<letter>, NOT an "alt+<x>" key event. Dead-key letters
 * (e/i/k/n/u, which emit combining marks) are omitted.
 */
const MACOS_OPTION_COMPOSE: Record<string, string> = {
  a: "å", b: "∫", c: "ç", d: "∂", f: "ƒ", g: "©", h: "˙", j: "∆", l: "¬",
  m: "µ", o: "ø", p: "π", q: "œ", r: "®", s: "ß", t: "†", v: "√", w: "∑",
  x: "≈", y: "¥", z: "Ω",
};

/**
 * If `keyId` is a bare "alt+<letter>" whose macOS Option composition yields a
 * single precomposed char, return that char; otherwise undefined. Only a plain
 * alt+letter toggle has a recoverable composed byte — combos like "ctrl+alt+s"
 * have no single precomposed form.
 */
export function macosOptionComposedFor(keyId: string): string | undefined {
  const m = /^alt\+([a-z])$/.exec(keyId);
  return m ? MACOS_OPTION_COMPOSE[m[1]] : undefined;
}

// ---------------------------------------------------------------------------
// Data model — SPEC §5.1
// ---------------------------------------------------------------------------

type RowStatus =
  | "started"
  | "running"
  | "completed"
  | "failed"
  | "aborted"
  | "parked"
  | "idle";

interface SubagentRow {
  // identity
  id: string;
  index: number;
  agent: string;
  agentSource?: AgentProgress["agentSource"];
  task: string;
  assignment?: string;
  description?: string;
  parentToolCallId?: string;
  detached: boolean;
  sessionFile?: string;
  // live stats
  status: RowStatus;
  toolCount: number;
  requests: number;
  tokens: number;
  contextTokens?: number;
  contextWindow?: number;
  contextPct?: number; // DERIVED, null-safe
  cost: number;
  durationMs: number;
  resolvedModel?: string;
  currentTool?: string;
  currentToolArgs?: string;
  recentOutput: string[]; // capped last ≤8 non-empty lines, sanitized
  recentTools?: AgentProgress["recentTools"];
  retryState?: AgentProgress["retryState"];
  retryFailure?: AgentProgress["retryFailure"];
  // bookkeeping
  startedAtMs: number;
  lastEventAtMs: number;
  finishedAtMs?: number;
  finishedTtlMs?: number;
}

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------

/** contextPct is derived and null-safe: undefined when inputs missing or ≤0. */
function computeContextPct(tokens?: number, window?: number): number | undefined {
  if (tokens === undefined || window === undefined || tokens <= 0 || window <= 0) return undefined;
  return (tokens / window) * 100;
}

/** Cap to the last ≤8 non-empty lines; each is replaceTabs'd + truncateToWidth(_,200). */
function sanitizeOutput(lines: string[] | undefined): string[] {
  if (!lines || lines.length === 0) return [];
  const out: string[] = [];
  for (const raw of lines) {
    if (typeof raw !== "string") continue;
    if (raw.trim() === "") continue;
    out.push(truncateToWidth(replaceTabs(raw), 200));
  }
  return out.length > 8 ? out.slice(out.length - 8) : out;
}

/** Sort rank: active(0) ▸ parked/idle(1) ▸ terminal(2). */
function statusRank(s: RowStatus): number {
  switch (s) {
    case "running":
    case "started":
      return 0;
    case "parked":
    case "idle":
      return 1;
    default:
      return 2; // completed/failed/aborted
  }
}

function statusIcon(status: RowStatus, retryState?: AgentProgress["retryState"]): string {
  switch (status) {
    case "running":
    case "started":
      return retryState ? "⏸" : "▸";
    case "parked":
      return "⏸";
    case "idle":
      return "◦";
    case "completed":
      return "✓";
    case "failed":
      return "✗";
    case "aborted":
      return "⊘";
    default:
      return "▸";
  }
}

/** Width-safe every emitted line: truncateToWidth(replaceTabs(line), width). */
function safeLine(width: number, line: string): string {
  return truncateToWidth(replaceTabs(line), width > 0 ? width : 1);
}

function clamp(n: number, lo: number, hi: number): number {
  return n < lo ? lo : n > hi ? hi : n;
}

/** Compact duration: "2s" / "4m12" / "1h30". */
function fmtDur(ms: number): string {
  if (!ms || ms < 0 || !Number.isFinite(ms)) return "0s";
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  const rs = s % 60;
  if (m < 60) return rs ? `${m}m${rs}` : `${m}m`;
  const h = Math.floor(m / 60);
  const rm = m % 60;
  return rm ? `${h}h${rm}` : `${h}h`;
}

function countActive(rows: SubagentRow[]): number {
  let n = 0;
  for (const r of rows) if (r.status === "running" || r.status === "started") n++;
  return n;
}

function countDone(rows: SubagentRow[]): number {
  let n = 0;
  for (const r of rows) {
    if (r.status === "completed" || r.status === "failed" || r.status === "aborted") n++;
  }
  return n;
}

/** Per-row stats suffix mirroring contract §9 (drops requests/cost/model when narrow). */
function buildStats(row: SubagentRow, narrow: boolean): string {
  let s = `${row.toolCount}🔧`;
  if (!narrow) s += ` ${row.requests} req`;
  if (row.contextPct !== undefined && row.contextWindow) {
    s += ` ${row.contextPct.toFixed(1)}%/${formatNumber(row.contextWindow)}`;
  }
  if (!narrow) {
    if (row.cost > 0) s += ` $${row.cost.toFixed(2)}`;
    if (row.resolvedModel) s += ` ${truncateToWidth(row.resolvedModel, 20)}`;
  }
  // Rate-limit indicators are surfaced in every width (AC: never look "stuck").
  if (row.retryState) s += ` (retry ${row.retryState.attempt}/${row.retryState.maxAttempts})`;
  if (row.retryFailure) s += ` ✗`;
  return s;
}

/** One compact panel stat line; task is inserted between head and stats when it fits. */
function renderStatLine(row: SubagentRow, width: number, narrow: boolean): string {
  const head = `${statusIcon(row.status, row.retryState)} ${row.agent} · `;
  const stats = buildStats(row, narrow);
  const sep = "   ";
  const availForTask = width - visibleWidth(head) - visibleWidth(sep) - visibleWidth(stats);
  if (availForTask > 4 && row.task) {
    const task = truncateToWidth(replaceTabs(row.task), availForTask);
    return safeLine(width, `${head}${task}${sep}${stats}`);
  }
  return safeLine(width, `${head}${stats}`);
}

// ---------------------------------------------------------------------------
// Overlay column layout
// ---------------------------------------------------------------------------

const COL_ST = 2;
const COL_AGENT = 12;
const COL_TOOL = 4;
const COL_REQ = 4;
const COL_TOK = 6;
const COL_CTX = 7;
const COL_COST = 5;
const COL_MODEL = 14;
const COL_DUR = 5;
const COL_AGE = 4;

interface OverlayCol {
  header: string;
  width: number;
  value: (row: SubagentRow, now: number) => string;
}

/**
 * Trailing columns after the flex TASK column. Trailing cols drop for narrow
 * widths: <80 drops $/MODEL/DUR/AGE; ≥80 adds $+DUR; ≥120 adds MODEL; ≥200 adds AGE.
 */
function overlayTrailingCols(width: number): OverlayCol[] {
  const cols: OverlayCol[] = [
    { header: "🔧", width: COL_TOOL, value: r => String(r.toolCount || 0) },
    { header: "REQ", width: COL_REQ, value: r => String(r.requests || 0) },
    { header: "TOK", width: COL_TOK, value: r => formatNumber(r.tokens || 0) },
    {
      header: "CTX%",
      width: COL_CTX,
      value: r =>
        r.contextPct !== undefined && r.contextWindow ? `${r.contextPct.toFixed(1)}%` : "—",
    },
  ];
  if (width >= 80) {
    cols.push({ header: "$", width: COL_COST, value: r => (r.cost > 0 ? r.cost.toFixed(2) : "—") });
  }
  if (width >= 120) {
    cols.push({
      header: "MODEL",
      width: COL_MODEL,
      value: r => (r.resolvedModel ? truncateToWidth(r.resolvedModel, COL_MODEL) : "—"),
    });
  }
  if (width >= 80) {
    cols.push({ header: "DUR", width: COL_DUR, value: r => fmtDur(r.durationMs) });
  }
  if (width >= 200) {
    cols.push({ header: "AGE", width: COL_AGE, value: (r, now) => fmtDur(now - r.lastEventAtMs) });
  }
  return cols;
}

function overlayTaskWidth(width: number, trailing: OverlayCol[]): number {
  const sumTrailing = trailing.reduce((s, c) => s + c.width, 0);
  const separators = 2 + trailing.length; // ST|AGENT|TASK|…trailing joins
  const w = width - COL_ST - COL_AGENT - sumTrailing - separators;
  return w < 4 ? 4 : w;
}

function renderOverlayHeader(trailing: OverlayCol[], width: number): string {
  const parts: string[] = [padField("ST", COL_ST), padField("AGENT", COL_AGENT)];
  const taskW = overlayTaskWidth(width, trailing);
  parts.push(padField("TASK", taskW));
  for (const c of trailing) parts.push(padField(c.header, c.width));
  return safeLine(width, parts.join(" "));
}

function renderOverlayRow(row: SubagentRow, trailing: OverlayCol[], width: number, now: number): string {
  const parts: string[] = [
    padField(statusIcon(row.status, row.retryState), COL_ST),
    padField(row.agent, COL_AGENT),
  ];
  const taskW = overlayTaskWidth(width, trailing);
  parts.push(padField(row.task || "", taskW));
  for (const c of trailing) parts.push(padField(c.value(row, now), c.width));
  return safeLine(width, parts.join(" "));
}

/** truncateToWidth(replaceTabs(text),w) then pad with spaces to visibleWidth w. */
function padField(text: string, width: number): string {
  if (width <= 0) return "";
  const t = truncateToWidth(replaceTabs(text), width);
  const vw = visibleWidth(t);
  return vw >= width ? t : t + " ".repeat(width - vw);
}

// ---------------------------------------------------------------------------
// SubagentStore — aggregation core (SPEC §5.2)
// ---------------------------------------------------------------------------

class SubagentStore {
  private rows = new Map<string, SubagentRow>();

  private seedRow(
    id: string,
    index: number,
    agent: string,
    agentSource: AgentProgress["agentSource"],
    task: string,
    detached: boolean,
    now: number,
  ): SubagentRow {
    return {
      id,
      index,
      agent,
      agentSource,
      task,
      detached,
      status: "started",
      toolCount: 0,
      requests: 0,
      tokens: 0,
      cost: 0,
      durationMs: 0,
      recentOutput: [],
      startedAtMs: now,
      lastEventAtMs: now,
    };
  }

  mergeLifecycle(p: SubagentLifecyclePayload, now: number): void {
    if (!p) return;
    const id = p.id;
    let row = this.rows.get(id);
    if (p.status === "started") {
      if (!row) {
        row = this.seedRow(id, p.index, p.agent, p.agentSource, "", p.detached === true, now);
        this.rows.set(id, row);
      }
      row.status = "running";
      if (p.agentSource) row.agentSource = p.agentSource;
      if (p.description) row.description = p.description;
      if (p.parentToolCallId) row.parentToolCallId = p.parentToolCallId;
      if (p.sessionFile) row.sessionFile = p.sessionFile;
      row.lastEventAtMs = now;
      return;
    }
    // terminal: completed | failed | aborted — seed a frozen row if unseen.
    if (!row) {
      row = this.seedRow(id, p.index, p.agent, p.agentSource, "", p.detached === true, now);
      if (p.description) row.description = p.description;
      if (p.parentToolCallId) row.parentToolCallId = p.parentToolCallId;
      if (p.sessionFile) row.sessionFile = p.sessionFile;
      this.rows.set(id, row);
    }
    row.status = p.status;
    if (row.finishedAtMs === undefined) {
      row.finishedAtMs = now; // FREEZE — no further stat merges for this id.
      row.finishedTtlMs = DONE_TTL_MS;
    }
    row.lastEventAtMs = now;
  }

  mergeProgress(p: SubagentProgressPayload, now: number): void {
    if (!p || !p.progress) return;
    const id = p.progress.id;
    let row = this.rows.get(id);
    if (!row) {
      // Lazy-seed from the first progress frame seen for an unseen id.
      row = this.seedRow(id, p.index, p.agent, p.agentSource, p.task, p.detached === true, now);
      this.rows.set(id, row);
    }
    if (row.finishedAtMs !== undefined) return; // frozen
    const prog = p.progress;
    if (prog.status === "pending") {
      if (row.status !== "running") row.status = "started";
    } else {
      row.status = prog.status;
    }
    // Monotonic counters: never decrement.
    row.toolCount = Math.max(row.toolCount, prog.toolCount || 0);
    row.requests = Math.max(row.requests, prog.requests || 0);
    row.tokens = Math.max(row.tokens, prog.tokens || 0);
    row.cost = Math.max(row.cost, prog.cost || 0);
    row.durationMs = Math.max(row.durationMs, prog.durationMs || 0);
    // Overlay the live snapshot (mirrors payload; clears retryState/retryFailure on resolve).
    row.contextTokens = prog.contextTokens;
    row.contextWindow = prog.contextWindow;
    row.contextPct = computeContextPct(row.contextTokens, row.contextWindow);
    row.resolvedModel = prog.resolvedModel;
    row.currentTool = prog.currentTool;
    row.currentToolArgs = prog.currentToolArgs;
    row.recentTools = prog.recentTools;
    row.retryState = prog.retryState;
    row.retryFailure = prog.retryFailure;
    row.recentOutput = sanitizeOutput(prog.recentOutput);
    if (prog.task) row.task = prog.task;
    if (prog.assignment) row.assignment = prog.assignment;
    if (prog.description) row.description = prog.description;
    if (p.assignment) row.assignment = p.assignment;
    if (p.parentToolCallId) row.parentToolCallId = p.parentToolCallId;
    if (p.sessionFile) row.sessionFile = p.sessionFile;
    if (p.agentSource) row.agentSource = p.agentSource;
    row.lastEventAtMs = now;
  }

  /** Freshness bump only; never seeds, never touches counters (AC-3). */
  noteEvent(id: string | undefined, now: number): void {
    if (id === undefined) return;
    const row = this.rows.get(id);
    if (row && row.finishedAtMs === undefined) row.lastEventAtMs = now;
  }

  /** Ordered snapshot: detached-only by default; active ▸ parked/idle ▸ terminal; by recency within group. */
  snapshot(opts?: { includeSync?: boolean }): SubagentRow[] {
    const includeSync = opts?.includeSync ?? SHOW_SYNC;
    const rows: SubagentRow[] = [];
    for (const row of this.rows.values()) {
      if (includeSync || row.detached === true) rows.push(row);
    }
    rows.sort((a, b) => {
      const ga = statusRank(a.status);
      const gb = statusRank(b.status);
      return ga !== gb ? ga - gb : b.lastEventAtMs - a.lastEventAtMs;
    });
    return rows;
  }

  /** Drop finished rows past their TTL; returns whether anything changed. */
  sweep(now: number): boolean {
    let changed = false;
    for (const [id, row] of this.rows) {
      if (
        row.finishedAtMs !== undefined &&
        now - row.finishedAtMs >= (row.finishedTtlMs ?? DONE_TTL_MS)
      ) {
        this.rows.delete(id);
        changed = true;
      }
    }
    return changed;
  }

  dispose(): void {
    this.rows.clear();
  }
}

// ---------------------------------------------------------------------------
// Extension factory
// ---------------------------------------------------------------------------

export default function subagentPanel(pi: ExtensionAPI): void {
  pi.setLabel("Inline subagent observability panel");

  let store: SubagentStore | undefined;
  let panelTui: TUI | undefined;
  let panelComponent: Component | undefined;
  let overlayTui: TUI | undefined;
  let overlayCloser: (() => void) | undefined;
  let overlayScroll = 0;
  let tickHandle: NodeJS.Timeout | undefined;
  let renderTimer: NodeJS.Timeout | undefined;
  let lastRenderMs = 0;
  let unsubFns: Array<() => void> = [];
  let active = false;
  let shortcutRegistered = false;
  let activeCtx: ExtensionContext | undefined;

  // --- (A) Persistent panel render (≤10 lines hard cap) -----------------

  function renderPanel(width: number): string[] {
    const rows = store ? store.snapshot() : [];
    const activeCount = countActive(rows);
    const doneCount = countDone(rows);
    const sumTokens = rows.reduce((s, r) => s + (r.tokens || 0), 0);
    const sumCost = rows.reduce((s, r) => s + (r.cost || 0), 0);

    if (rows.length === 0) {
      if (HIDE_EMPTY) return [];
      return [safeLine(width, `Subagents: idle (0 active) · ${TOGGLE_KEY_DISPLAY} to open table`)];
    }

    const lines: string[] = [
      safeLine(
        width,
        `Subagents: ${activeCount} active · ${doneCount} done │ Σ ${formatNumber(
          sumTokens,
        )} tok · $${sumCost.toFixed(2)}`,
      ),
    ];

    // Tail line for the most-recent active agent's work output.
    const tailRow = rows.find(r => r.status === "running" || r.status === "started");
    const tailLine = tailRow && tailRow.recentOutput.length > 0 ? 1 : 0;

    // Body budget = 9 (10 − header); reserve tail + overflow, slice the rest.
    const maxRows = 9 - tailLine;
    let visibleCount: number;
    let overflowLine: number;
    if (rows.length <= maxRows) {
      visibleCount = rows.length;
      overflowLine = 0;
    } else {
      overflowLine = 1;
      visibleCount = Math.max(maxRows - 1, 0);
    }

    const narrow = width < 60;
    for (let i = 0; i < visibleCount; i++) {
      lines.push(renderStatLine(rows[i], width, narrow));
    }
    if (tailLine === 1 && tailRow) {
      const last = tailRow.recentOutput[tailRow.recentOutput.length - 1];
      lines.push(safeLine(width, `  ↳ ${tailRow.agent}: ${last}`));
    }
    if (overflowLine === 1) {
      const remaining = rows.length - visibleCount;
      lines.push(safeLine(width, `… +${remaining} more (${TOGGLE_KEY_DISPLAY} for all)`));
    }
    return lines.slice(0, 10);
  }

  // --- (B) Overlay full table (no cap, paginated) -----------------------

  function renderOverlay(width: number): string[] {
    const rows = store ? store.snapshot() : [];
    const live = rows.length - countDone(rows);
    const done = countDone(rows);
    const lines: string[] = [safeLine(width, `── Subagents (${live} live · ${done} done) ──`)];

    if (rows.length === 0) {
      lines.push(safeLine(width, "No active subagents"));
      lines.push(safeLine(width, `${TOGGLE_KEY_DISPLAY}/Esc close`));
      return lines;
    }

    const total = rows.length;
    overlayScroll = Math.min(overlayScroll, Math.max(total - 1, 0));
    const viewport = overlayTui?.terminal.rows ?? 24;
    const trailing = overlayTrailingCols(width);
    lines.push(renderOverlayHeader(trailing, width));

    const bodyHeight = Math.max(viewport - 3, 1); // reserve title + header + footer
    let slots = bodyHeight;
    let showOverflow = false;
    if (total - overlayScroll > slots) {
      showOverflow = true;
      slots = Math.max(slots - 1, 1);
    }
    const now = Date.now();
    for (const row of rows.slice(overlayScroll, overlayScroll + slots)) {
      lines.push(renderOverlayRow(row, trailing, width, now));
    }
    if (showOverflow) {
      const rest = total - (overlayScroll + slots);
      lines.push(safeLine(width, `… (+${Math.max(rest, 0)} more)`));
    }
    const lastShown = Math.min(overlayScroll + slots, total);
    lines.push(
      safeLine(
        width,
        `↑↓/PgUp/PgDn scroll · ${TOGGLE_KEY_DISPLAY}/Esc close · ${overlayScroll + 1}-${lastShown}/${total}`,
      ),
    );
    return lines;
  }

  function handleOverlayInput(data: string): void {
    if (matchesKey(data, "escape") || matchesKey(data, TOGGLE_KEY) || matchesKey(data, "q")) {
      if (overlayCloser) overlayCloser();
      return;
    }
    const total = store ? store.snapshot().length : 0;
    const maxScroll = Math.max(total - 1, 0);
    const viewport = Math.max((overlayTui?.terminal.rows ?? 24) - 3, 1);
    if (matchesKey(data, "up")) overlayScroll = clamp(overlayScroll - 1, 0, maxScroll);
    else if (matchesKey(data, "down")) overlayScroll = clamp(overlayScroll + 1, 0, maxScroll);
    else if (matchesKey(data, "pageUp"))
      overlayScroll = clamp(overlayScroll - viewport, 0, maxScroll);
    else if (matchesKey(data, "pageDown"))
      overlayScroll = clamp(overlayScroll + viewport, 0, maxScroll);
    else if (matchesKey(data, "home")) overlayScroll = 0;
    else if (matchesKey(data, "end")) overlayScroll = maxScroll;
    // Do NOT call any render method — the TUI auto-renders after handleInput.
  }

  function toggleOverlay(ctx: ExtensionContext): void {
    if (overlayCloser) {
      overlayCloser();
      return;
    }
    if (!active || !ctx.hasUI) return;
    overlayScroll = 0;
    ctx.ui
      .custom<unknown>((tui, _theme, _kb, done) => {
        overlayTui = tui;
        overlayCloser = () => {
          try {
            done(undefined);
          } catch {
            /* ignore */
          }
          overlayCloser = undefined;
          overlayScroll = 0;
        };
        const comp: Component = {
          render: (width: number): string[] => renderOverlay(width),
          handleInput: (data: string): void => handleOverlayInput(data),
        };
        return comp;
      }, { overlay: true })
      .catch(() => {
        /* overlay dismissed unexpectedly — ignore */
      });
  }

  // --- Render throttle (component-scoped only) --------------------------

  function schedulePanelRender(): void {
    if (!active) return;
    const now = Date.now();
    if (now - lastRenderMs >= MIN_RENDER_MS) {
      lastRenderMs = now;
      if (panelTui && panelComponent) panelTui.requestComponentRender(panelComponent);
      return;
    }
    if (renderTimer === undefined) {
      const remainder = MIN_RENDER_MS - (now - lastRenderMs);
      renderTimer = setTimeout(() => {
        renderTimer = undefined;
        lastRenderMs = Date.now();
        if (panelTui && panelComponent) panelTui.requestComponentRender(panelComponent);
      }, remainder > 0 ? remainder : 0);
    }
  }

  // --- Activation / teardown (SPEC §7) -----------------------------------

  function activate(ctx: ExtensionContext): void {
    if (!ctx.hasUI) return; // AC-11: headless/subagent/print no-op
    if (active) teardown(); // re-entry safe
    activeCtx = ctx;
    store = new SubagentStore();
    unsubFns = [];
    unsubFns.push(
      pi.events.on(TASK_SUBAGENT_LIFECYCLE_CHANNEL, d => {
        store?.mergeLifecycle(d as SubagentLifecyclePayload, Date.now());
        schedulePanelRender();
      }),
      pi.events.on(TASK_SUBAGENT_PROGRESS_CHANNEL, d => {
        store?.mergeProgress(d as SubagentProgressPayload, Date.now());
        schedulePanelRender();
      }),
      pi.events.on(TASK_SUBAGENT_EVENT_CHANNEL, d => {
        store?.noteEvent((d as SubagentEventPayload).id, Date.now()); // freshness only — no render
      }),
    );

    if (PERSISTENT_PANEL) {
      ctx.ui.setWidget(
        PANEL_KEY,
        (tui, _theme) => {
          panelTui = tui;
          const comp: Component = {
            render: (width: number): string[] => renderPanel(width),
          };
          panelComponent = comp;
          return comp;
        },
        { placement: PLACEMENT },
      );
    }

    tickHandle = setInterval(() => {
      if (store) store.sweep(Date.now());
      if (panelTui && panelComponent) panelTui.requestComponentRender(panelComponent); // AC-5
    }, 1000);

    if (!shortcutRegistered) {
      pi.registerShortcut(TOGGLE_KEY, {
        description: "Toggle subagent observability overlay",
        handler: c => toggleOverlay(c),
      });
      shortcutRegistered = true; // register once per process
    }

    // macOS fallback: on default macOS terminals (Ghostty / Terminal.app, where
    // Option is NOT treated as Alt), Option+S emits a *composed* char ("ß"
    // U+00DF) instead of an alt key sequence. parseKey() returns null for that
    // byte, so registerShortcut above never fires and the panel stays
    // unreachable — the recurring "still not available" bug. Catch the composed
    // byte on the raw terminal-input path (the same surface omp uses for
    // enhanced-paste / focused-agent gestures) and toggle directly. Inert on
    // every other input; alt-aware terminals are already handled above.
    const composedToggle = macosOptionComposedFor(TOGGLE_KEY);
    if (composedToggle !== undefined) {
      unsubFns.push(
        ctx.ui.onTerminalInput(data => {
          if (!active) return undefined;
          if (data === composedToggle) {
            toggleOverlay(ctx);
            return { consume: true };
          }
          return undefined;
        }),
      );
    }

    active = true;
    schedulePanelRender(); // initial frame
  }

  function teardown(): void {
    for (const fn of unsubFns) {
      try {
        fn();
      } catch {
        /* ignore */
      }
    }
    unsubFns = [];
    if (tickHandle !== undefined) {
      clearInterval(tickHandle);
      tickHandle = undefined;
    }
    if (renderTimer !== undefined) {
      clearTimeout(renderTimer);
      renderTimer = undefined;
    }
    if (overlayCloser) overlayCloser();
    if (activeCtx) {
      try {
        activeCtx.ui.setWidget(PANEL_KEY, undefined); // AC-9: clear widget
      } catch {
        /* ignore */
      }
    }
    panelTui = undefined;
    panelComponent = undefined;
    overlayTui = undefined;
    store?.dispose();
    store = undefined;
    activeCtx = undefined;
    lastRenderMs = 0;
    active = false;
  }

  pi.on("session_start", (_event, ctx) => activate(ctx));
  pi.on("session_shutdown", () => teardown());
}
