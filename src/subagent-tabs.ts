/**
 * subagent-tabs.ts — Relays per-subagent transcripts into supaterm native tabs
 * (primary) with a tmux fallback, keyed on agentId. Never auto-closes tabs on
 * agent end (transcript stays in scrollback for review).
 *
 * Pure units (TabRegistry, argv builders, parsers, label/state/render helpers,
 * jsonl rewind, backend selection) are separated from the impure backends so
 * they are unit-testable without a live session. All `@oh-my-pi/pi-coding-agent`
 * symbols are imported with `import type` so they erase at runtime (matches
 * src/enforce-orchestrator.ts).
 *
 * Loading: provided via `package.json#omp.extensions` (the `omp-agent-gate`
 * plugin), discovered by the omp-plugins provider.
 */

import type { ExtensionAPI } from "@oh-my-pi/pi-coding-agent";
import { closeSync, fstatSync, openSync, readSync } from "node:fs";

// ---------------------------------------------------------------------------
// Constants + config
// ---------------------------------------------------------------------------

const TMUX_SESSION = "omp-agents";
const DEFAULT_HOLDER = "stty -echo 2>/dev/null; cat";
const DEFAULT_QUIET_MS = 30_000;
const NOTIFY_TITLE = "Subagent";

// ---------------------------------------------------------------------------
// PURE — ANSI SGR helpers (cosmetic; always reset at line end)
// ---------------------------------------------------------------------------

const SGR = {
  RESET: "\x1b[0m",
  DIM: "\x1b[2m",
  CYAN: "\x1b[36m",
  GREEN: "\x1b[32m",
  RED: "\x1b[31m",
  YELLOW: "\x1b[33m",
  MAGENTA: "\x1b[35m",
} as const;

/** Wrap `text` in `open` ... `text` ... RESET. Pure string build; never throws. */
function sgr(open: string, text: string): string {
  return `${open}${text}${SGR.RESET}`;
}

// ---------------------------------------------------------------------------
// Exported types
// ---------------------------------------------------------------------------

export type BackendKind = "supaterm" | "tmux";
// Tab status is DERIVED (idle/parked/revived/isolated are never emitted):
export type AgentTabStatus = "running" | "quiet" | "aborted" | "ended";

export interface TabRecord {
  agentId: string; // PRIMARY KEY (the payload `id`)
  role?: string; // description (lifecycle) / assignment (progress)
  backend: BackendKind;
  tabId: string; // supaterm tabID | tmux "<agentId>" window name
  paneId?: string; // supaterm paneID
  status: AgentTabStatus;
  fromByte: number; // resync cursor into <id>.jsonl (monotonic ↑)
  startedAt: number; // epoch ms
  lastActivityMs: number; // epoch ms of last event (drives quiet-derivation)
  endedAt?: number; // set on completed/failed/aborted
  sessionFile?: string; // <id>.jsonl path (payload sessionFile)
}

export interface RelayConfig {
  enabled: boolean; // master switch (default: true)
  holderCommand: string; // default "stty -echo 2>/dev/null; cat"
  quietAfterMs: number; // default 30000 — no event for this long ⇒ "quiet"
  renderMode: "rich" | "plain"; // rich = emit ANSI color in the streamed pane (default rich)
}

export interface RelayExecResult {
  stdout: string;
  stderr: string;
  code: number;
  killed: boolean;
}

export type RelayExecFn = (
  command: string,
  args: string[],
  options?: { signal?: AbortSignal; timeout?: number; cwd?: string },
) => Promise<RelayExecResult>;

export interface RelayLogger {
  error(message: string, context?: Record<string, unknown>): void;
  warn(message: string, context?: Record<string, unknown>): void;
  info(message: string, context?: Record<string, unknown>): void;
  debug(message: string, context?: Record<string, unknown>): void;
}

export interface SurfaceBackend {
  readonly kind: BackendKind;
  available(): Promise<boolean>;
  createTab(agentId: string, role: string | undefined, cwd: string): Promise<{ tabId: string; paneId?: string }>;
  renameTab(tabId: string, label: string): Promise<void>;
  sendText(target: string, chunk: string): Promise<void>;
  notify(message: string, target?: string): Promise<void>;
  closeTab(tabId: string): Promise<void>;
}

// ---------------------------------------------------------------------------
// Boundary parsing helpers — validated `Record<string, unknown>` at the edge,
// then every field read narrows from `unknown` with typeof/`in`. No inline
// shape casts deeper than this single boundary widening.
// ---------------------------------------------------------------------------

type Rec = Record<string, unknown>;

function asRec(value: unknown): Rec | undefined {
  return value !== null && typeof value === "object" ? (value as Rec) : undefined;
}

function str(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

// ---------------------------------------------------------------------------
// PURE — TabRegistry (keyed on agentId; one record per agent; never duplicates)
// ---------------------------------------------------------------------------

export class TabRegistry {
  private readonly records = new Map<string, TabRecord>();

  get(agentId: string): TabRecord | undefined {
    return this.records.get(agentId);
  }

  /** Merge `patch` into the existing record, or create one. Never duplicates. */
  upsert(agentId: string, patch: Partial<Omit<TabRecord, "agentId">>): TabRecord {
    const existing = this.records.get(agentId);
    const next: TabRecord = existing
      ? { ...existing, ...patch, agentId }
      : {
          agentId,
          backend: "supaterm",
          tabId: "",
          status: "running",
          fromByte: 0,
          startedAt: 0,
          lastActivityMs: 0,
          ...patch,
        };
    this.records.set(agentId, next);
    return next;
  }

  /** The only removal path. */
  drop(agentId: string): boolean {
    return this.records.delete(agentId);
  }

  snapshot(): TabRecord[] {
    return [...this.records.values()];
  }
}

// ---------------------------------------------------------------------------
// PURE — argv builders (each returns string[]; the command binary is prepended
// by the caller)
// ---------------------------------------------------------------------------

export function buildSupatermNewArgs(holder: string, opts: { cwd?: string; in?: string }): string[] {
  return ["tab", "new", "--json", "--script", holder, ...(opts.cwd ? ["--cwd", opts.cwd] : []), ...(opts.in ? ["--in", opts.in] : [])];
}

export function buildSupatermRenameArgs(title: string, tabId: string): string[] {
  return ["tab", "rename", title, tabId];
}

export function buildSupatermSendArgs(paneId: string, chunk: string): string[] {
  return ["pane", "send", paneId, chunk];
}

export function buildSupatermNotifyArgs(title: string, body: string, paneId?: string): string[] {
  return ["pane", "notify", "--title", title, "--body", body, ...(paneId ? [paneId] : [])];
}

export function buildSupatermCloseArgs(tabId: string): string[] {
  return ["tab", "close", tabId];
}

export function buildSupatermLsArgs(): string[] {
  return ["ls", "--json"];
}

export function buildTmuxNewSessionArgs(session: string): string[] {
  return ["new-session", "-d", "-s", session];
}

export function buildTmuxHasSessionArgs(session: string): string[] {
  return ["has-session", "-t", session];
}

export function buildTmuxNewWindowArgs(session: string, agentId: string): string[] {
  return ["new-window", "-t", session, "-n", agentId, "-k"];
}

export function buildTmuxSendKeysArgs(target: string, chunk: string): string[] {
  return ["send-keys", "-t", target, "-l", chunk];
}

export function buildTmuxKillWindowArgs(target: string): string[] {
  return ["kill-window", "-t", target];
}

/** Parse `sp tab new --json` stdout; throws a clear error if `tabID` is missing. */
export function parseSupatermNewJson(stdout: string): { tabId: string; paneId?: string } {
  let parsed: unknown;
  try {
    parsed = JSON.parse(stdout);
  } catch {
    throw new Error(`subagent-tabs: sp tab new returned non-JSON output: ${stdout.trim().slice(0, 200)}`);
  }
  const rec = asRec(parsed);
  const tabId = str(rec?.["tabID"]);
  if (!tabId) {
    throw new Error(`subagent-tabs: sp tab new output missing tabID: ${stdout.trim().slice(0, 200)}`);
  }
  return { tabId, paneId: str(rec?.["paneID"]) };
}

// ---------------------------------------------------------------------------
// PURE — label / state / render
// ---------------------------------------------------------------------------

export function formatTabLabel(agentId: string, role: string | undefined, status: AgentTabStatus): string {
  const who = `${agentId} · ${role ?? agentId}`;
  switch (status) {
    case "running":
      return who;
    case "quiet":
      return `${who} · quiet`;
    case "aborted":
      return `[ABORTED] ${who}`;
    case "ended":
      return `[ended] ${who}`;
  }
}

export function deriveTabStatus(
  lifecycle: "started" | "completed" | "failed" | "aborted" | undefined,
  progress: "pending" | "running" | "completed" | "failed" | "aborted" | undefined,
  nowMs: number,
  lastActivityMs: number,
  quietAfterMs: number,
): AgentTabStatus {
  // Terminal lifecycle wins.
  if (lifecycle === "aborted") return "aborted";
  if (lifecycle === "completed" || lifecycle === "failed") return "ended";
  // Progress failure treated as aborted (AC4); progress completion as ended.
  if (progress === "failed") return "aborted";
  if (progress === "completed") return "ended";
  // Otherwise derive quiet from inactivity.
  if (nowMs - lastActivityMs >= quietAfterMs) return "quiet";
  return "running";
}

/** Defensive single-block text extraction from an AgentMessage-shaped value. */
function readMessageText(message: unknown): string {
  if (typeof message !== "object" || message === null) return "";
  if (!("content" in message)) return "";
  const content = message.content;
  if (!Array.isArray(content)) return "";
  let out = "";
  for (const block of content) {
    if (block !== null && typeof block === "object" && "type" in block && "text" in block) {
      if (block.type === "text" && typeof block.text === "string") {
        out += block.text;
      }
    }
  }
  return out;
}

function argsHint(args: unknown): string {
  if (args === undefined || args === null) return "";
  let s: string;
  if (typeof args === "string") {
    s = args;
  } else {
    try {
      s = JSON.stringify(args) ?? "";
    } catch {
      return "";
    }
  }
  return s.replace(/\s+/g, " ").trim();
}

export function renderAgentSessionEvent(
  event: { type: string; [k: string]: unknown },
  opts?: { renderMode?: "rich" | "plain" },
): string | undefined {
  const rich = (opts?.renderMode ?? "rich") === "rich";
  switch (event.type) {
    case "message_end":
    case "message_update": {
      const text = readMessageText(event.message);
      return text.length > 0 ? text : undefined;
    }
    case "tool_execution_start": {
      const toolName = str(event.toolName);
      if (!toolName) return undefined;
      const hint = argsHint(event.args);
      const visible = hint ? `▸ ${toolName} ${hint}` : `▸ ${toolName}`;
      const capped = visible.length > 60 ? `${visible.slice(0, 59)}…` : visible;
      if (!rich) return capped;
      // Reconstruct the capped visible line colored: dim ▸, cyan toolName, plain hint.
      const sp1 = capped.indexOf(" ");
      const marker = capped.slice(0, sp1); // "▸"
      const rest = capped.slice(sp1 + 1);
      const sp2 = rest.indexOf(" ");
      const name = sp2 === -1 ? rest : rest.slice(0, sp2);
      const tail = sp2 === -1 ? "" : rest.slice(sp2); // " <hint>" (already capped)
      return `${sgr(SGR.DIM, marker)} ${sgr(SGR.CYAN, name)}${tail}${tail ? SGR.RESET : ""}`;
    }
    case "tool_execution_end": {
      const toolName = str(event.toolName);
      if (!toolName) return undefined;
      const isError = event.isError === true;
      const symbol = isError ? "✗" : "✓";
      if (!rich) return `◂ ${toolName} ${symbol}`;
      return `${sgr(SGR.DIM, "◂")} ${sgr(SGR.CYAN, toolName)} ${sgr(isError ? SGR.RED : SGR.GREEN, symbol)}`;
    }
    case "notice": {
      const level = str(event.level) ?? "info";
      const message = str(event.message);
      if (!message) return undefined;
      if (!rich) return `${level}: ${message}`;
      const levelColor =
        level === "error" ? SGR.RED : level === "warning" || level === "warn" ? SGR.YELLOW : SGR.CYAN;
      return `${sgr(levelColor, level)}: ${message}${SGR.RESET}`;
    }
    case "irc_message":
      return rich ? sgr(SGR.MAGENTA, "💬 irc") : `💬 irc`;
    default:
      return undefined; // unknown types skipped — no phantom output
  }
}

// ---------------------------------------------------------------------------
// PURE — jsonl rewind (honors fromByte; never goes backward; never throws)
// ---------------------------------------------------------------------------

export function readJsonlFromByte(path: string, fromByte: number): { lines: string[]; nextFromByte: number } {
  const base = fromByte > 0 ? fromByte : 0;
  let fd: number;
  try {
    fd = openSync(path, "r");
  } catch {
    return { lines: [], nextFromByte: fromByte };
  }
  try {
    const size = fstatSync(fd).size;
    if (base >= size) return { lines: [], nextFromByte: fromByte };
    const want = size - base;
    const buf = Buffer.alloc(want);
    let total = 0;
    while (total < want) {
      const n = readSync(fd, buf, total, want - total, base + total);
      if (n <= 0) break;
      total += n;
    }
    // Split on byte 0x0A boundaries (ASCII newline; never inside a multibyte
    // UTF-8 sequence). Keep only COMPLETE lines (a trailing partial with no
    // newline is dropped and excluded from nextFromByte).
    const lines: string[] = [];
    let lineStart = 0;
    for (let i = 0; i < total; i++) {
      if (buf[i] === 0x0a) {
        lines.push(buf.subarray(lineStart, i).toString("utf8"));
        lineStart = i + 1;
      }
    }
    return { lines, nextFromByte: base + lineStart };
  } finally {
    closeSync(fd);
  }
}

// ---------------------------------------------------------------------------
// PURE — backend selection
// ---------------------------------------------------------------------------

export function selectBackend(supatermUp: boolean, tmuxUp: boolean): BackendKind | null {
  if (supatermUp) return "supaterm";
  if (tmuxUp) return "tmux";
  return null;
}

// ---------------------------------------------------------------------------
// IMPURE — backends
// ---------------------------------------------------------------------------

export class SupatermBackend implements SurfaceBackend {
  readonly kind: BackendKind = "supaterm";
  private readonly exec: RelayExecFn;
  private readonly logger: RelayLogger;
  private readonly holder: string;
  private readonly spBin: string;

  constructor(exec: RelayExecFn, logger: RelayLogger, holder: string = DEFAULT_HOLDER) {
    this.exec = exec;
    this.logger = logger;
    this.holder = holder;
    this.spBin = process.env.SUPATERM_CLI_PATH ?? "sp";
  }

  async available(): Promise<boolean> {
    try {
      const res = await this.exec(this.spBin, buildSupatermLsArgs());
      return res.code === 0;
    } catch (err) {
      this.logger.debug("subagent-tabs: supaterm probe failed", { error: String(err) });
      return false;
    }
  }

  async createTab(agentId: string, role: string | undefined, cwd: string): Promise<{ tabId: string; paneId?: string }> {
    const res = await this.exec(this.spBin, buildSupatermNewArgs(this.holder, { cwd }), { cwd });
    if (res.code !== 0) {
      throw new Error(
        `subagent-tabs: sp tab new failed (code ${res.code}): ${(res.stderr || res.stdout).trim().slice(0, 200)}`,
      );
    }
    return parseSupatermNewJson(res.stdout);
  }

  async renameTab(tabId: string, label: string): Promise<void> {
    try {
      const res = await this.exec(this.spBin, buildSupatermRenameArgs(label, tabId));
      if (res.code !== 0) {
        this.logger.debug("subagent-tabs: sp tab rename non-zero", { code: res.code, stderr: res.stderr });
      }
    } catch (err) {
      this.logger.debug("subagent-tabs: sp tab rename failed", { error: String(err) });
    }
  }

  async sendText(target: string, chunk: string): Promise<void> {
    try {
      const res = await this.exec(this.spBin, buildSupatermSendArgs(target, chunk));
      if (res.code !== 0) {
        this.logger.debug("subagent-tabs: sp pane send non-zero", { code: res.code });
      }
    } catch (err) {
      this.logger.debug("subagent-tabs: sp pane send failed", { error: String(err) });
    }
  }

  async notify(message: string, target?: string): Promise<void> {
    try {
      const res = await this.exec(this.spBin, buildSupatermNotifyArgs(NOTIFY_TITLE, message, target));
      if (res.code !== 0) {
        this.logger.debug("subagent-tabs: sp pane notify non-zero", { code: res.code });
      }
    } catch (err) {
      this.logger.debug("subagent-tabs: sp pane notify failed", { error: String(err) });
    }
  }

  async closeTab(tabId: string): Promise<void> {
    try {
      const res = await this.exec(this.spBin, buildSupatermCloseArgs(tabId));
      if (res.code !== 0) {
        this.logger.debug("subagent-tabs: sp tab close non-zero", { code: res.code });
      }
    } catch (err) {
      this.logger.debug("subagent-tabs: sp tab close failed", { error: String(err) });
    }
  }
}

export class TmuxBackend implements SurfaceBackend {
  readonly kind: BackendKind = "tmux";
  private readonly exec: RelayExecFn;
  private readonly logger: RelayLogger;
  private sessionEnsured = false;

  constructor(exec: RelayExecFn, logger: RelayLogger) {
    this.exec = exec;
    this.logger = logger;
  }

  async available(): Promise<boolean> {
    try {
      const res = await this.exec("tmux", ["-V"]);
      return res.code === 0;
    } catch (err) {
      this.logger.debug("subagent-tabs: tmux probe failed", { error: String(err) });
      return false;
    }
  }

  private async ensureSession(): Promise<void> {
    if (this.sessionEnsured) return;
    const has = await this.exec("tmux", buildTmuxHasSessionArgs(TMUX_SESSION));
    if (has.code !== 0) {
      const created = await this.exec("tmux", buildTmuxNewSessionArgs(TMUX_SESSION));
      if (created.code !== 0) {
        throw new Error(
          `subagent-tabs: tmux new-session failed (code ${created.code}): ${created.stderr.trim().slice(0, 200)}`,
        );
      }
    }
    this.sessionEnsured = true;
  }

  async createTab(agentId: string, _role: string | undefined, _cwd: string): Promise<{ tabId: string; paneId?: string }> {
    await this.ensureSession();
    const res = await this.exec("tmux", buildTmuxNewWindowArgs(TMUX_SESSION, agentId));
    if (res.code !== 0) {
      throw new Error(`subagent-tabs: tmux new-window failed (code ${res.code}): ${res.stderr.trim().slice(0, 200)}`);
    }
    return { tabId: agentId };
  }

  async renameTab(_tabId: string, _label: string): Promise<void> {
    // tmux window name is set at creation; rename is a no-op.
  }

  async sendText(target: string, chunk: string): Promise<void> {
    try {
      const res = await this.exec("tmux", buildTmuxSendKeysArgs(`${TMUX_SESSION}:${target}`, chunk));
      if (res.code !== 0) {
        this.logger.debug("subagent-tabs: tmux send-keys non-zero", { code: res.code });
      }
    } catch (err) {
      this.logger.debug("subagent-tabs: tmux send-keys failed", { error: String(err) });
    }
  }

  async notify(_message: string, _target?: string): Promise<void> {
    // notify unsupported in tmux backend.
  }

  async closeTab(tabId: string): Promise<void> {
    try {
      const res = await this.exec("tmux", buildTmuxKillWindowArgs(`${TMUX_SESSION}:${tabId}`));
      if (res.code !== 0) {
        this.logger.debug("subagent-tabs: tmux kill-window non-zero", { code: res.code });
      }
    } catch (err) {
      this.logger.debug("subagent-tabs: tmux kill-window failed", { error: String(err) });
    }
  }
}

// ---------------------------------------------------------------------------
// Internal — status narrowing from unknown payloads
// ---------------------------------------------------------------------------

function lifecycleStatusOf(
  value: unknown,
): "started" | "completed" | "failed" | "aborted" | undefined {
  if (value === "started" || value === "completed" || value === "failed" || value === "aborted") return value;
  return undefined;
}

function progressStatusOf(
  value: unknown,
): "pending" | "running" | "completed" | "failed" | "aborted" | undefined {
  if (value === "pending" || value === "running" || value === "completed" || value === "failed" || value === "aborted") {
    return value;
  }
  return undefined;
}

/** Validated narrowing to the renderAgentSessionEvent parameter type. */
function eventLike(value: unknown): { type: string; [k: string]: unknown } | undefined {
  const rec = asRec(value);
  if (!rec) return undefined;
  return typeof rec["type"] === "string" ? (rec as { type: string; [k: string]: unknown }) : undefined;
}

// ---------------------------------------------------------------------------
// Internal — TabController
// ---------------------------------------------------------------------------

interface ControllerDeps {
  registry: TabRegistry;
  backend: SurfaceBackend;
  config: RelayConfig;
  logger: RelayLogger;
  now: () => number;
  cwd: () => string;
}

class TabController {
  private readonly deps: ControllerDeps;

  constructor(deps: ControllerDeps) {
    this.deps = deps;
  }

  snapshot(): TabRecord[] {
    return this.deps.registry.snapshot();
  }

  drop(agentId: string): boolean {
    return this.deps.registry.drop(agentId);
  }

  async onLifecycle(data: unknown): Promise<void> {
    try {
      const rec = asRec(data);
      if (!rec) return;
      const id = str(rec["id"]);
      if (!id) return;
      const status = lifecycleStatusOf(rec["status"]);
      const role = str(rec["description"]);
      const sessionFile = str(rec["sessionFile"]);
      const now = this.deps.now();

      if (status === "started") {
        const existing = this.deps.registry.get(id);
        if (existing) {
          // Revive: reuse same record/keep tabId; only status/lastActivityMs/endedAt change.
          this.deps.registry.upsert(id, { status: "running", lastActivityMs: now, endedAt: undefined });
          return;
        }
        const created = await this.deps.backend.createTab(id, role, this.deps.cwd());
        this.deps.registry.upsert(id, {
          backend: this.deps.backend.kind,
          role,
          tabId: created.tabId,
          paneId: created.paneId,
          status: "running",
          fromByte: 0,
          startedAt: now,
          lastActivityMs: now,
          sessionFile,
        });
        const label = formatTabLabel(id, role, "running");
        await this.deps.backend.renameTab(created.tabId, label);
        return;
      }

      if (status === "completed" || status === "failed" || status === "aborted") {
        const tabStatus: AgentTabStatus = status === "aborted" ? "aborted" : "ended";
        const existing = this.deps.registry.get(id);
        const roleKnown = role ?? existing?.role;
        this.deps.registry.upsert(id, { status: tabStatus, endedAt: now, lastActivityMs: now, role: roleKnown });
        if (existing) {
          const label = formatTabLabel(id, roleKnown, tabStatus);
          await this.deps.backend.renameTab(existing.tabId, label);
        }
        // Transcript already streamed live via onEvent; never auto-close (locked).
        return;
      }
    } catch (err) {
      this.deps.logger.error("subagent-tabs: lifecycle handler error", { error: String(err) });
    }
  }

  async onProgress(data: unknown): Promise<void> {
    try {
      const rec = asRec(data);
      if (!rec) return;
      const progress = asRec(rec["progress"]);
      const id = str(progress?.["id"]);
      if (!id) return;
      const existing = this.deps.registry.get(id);
      if (!existing) return; // no tab yet → ignore (no phantom tab)
      const assignment = str(rec["assignment"]);
      const now = this.deps.now();
      const pStatus = progressStatusOf(progress?.["status"]);
      const nextStatus = deriveTabStatus(undefined, pStatus, now, now, this.deps.config.quietAfterMs);
      const role = assignment ?? existing.role;
      this.deps.registry.upsert(id, { role, lastActivityMs: now, status: nextStatus });
      // Relabel only when status flips (cheap).
      if (nextStatus !== existing.status) {
        const label = formatTabLabel(id, role, nextStatus);
        await this.deps.backend.renameTab(existing.tabId, label);
      }
    } catch (err) {
      this.deps.logger.error("subagent-tabs: progress handler error", { error: String(err) });
    }
  }

  async onEvent(data: unknown): Promise<void> {
    try {
      const rec = asRec(data);
      if (!rec) return;
      const id = str(rec["id"]);
      if (!id) return;
      const event = eventLike(rec["event"]);
      if (!event) return;
      const existing = this.deps.registry.get(id);
      if (!existing) return; // AC8: event before lifecycle(start) is ignored (no phantom tab)
      const chunk = renderAgentSessionEvent(event, { renderMode: this.deps.config.renderMode });
      if (!chunk) return;
      await this.deps.backend.sendText(existing.paneId ?? existing.tabId, chunk);
      this.deps.registry.upsert(id, { lastActivityMs: this.deps.now() });
      // fromByte cursor advances only on explicit rewind (not the hot path).
    } catch (err) {
      this.deps.logger.error("subagent-tabs: event handler error", { error: String(err) });
    }
  }

  /** Explicit replay of any transcript bytes not yet sent. Not the hot path. */
  async rewind(agentId: string): Promise<number> {
    const existing = this.deps.registry.get(agentId);
    if (!existing) return 0;
    if (!existing.sessionFile) return existing.fromByte;
    const target = existing.paneId ?? existing.tabId;
    const { lines, nextFromByte } = readJsonlFromByte(existing.sessionFile, existing.fromByte);
    for (const line of lines) {
      try {
        await this.deps.backend.sendText(target, line);
      } catch (err) {
        this.deps.logger.debug("subagent-tabs: rewind send failed", { error: String(err) });
      }
    }
    this.deps.registry.upsert(agentId, { fromByte: nextFromByte });
    return nextFromByte;
  }
}

// ---------------------------------------------------------------------------
// Config + entry
// ---------------------------------------------------------------------------

function readConfig(): RelayConfig {
  const enabledEnv = process.env.OMP_SUBAGENT_TABS;
  const enabled =
    enabledEnv === undefined ? true : enabledEnv !== "0" && enabledEnv.toLowerCase() !== "false";
  const quietRaw = Number(process.env.OMP_SUBAGENT_TABS_QUIET_MS);
  return {
    enabled,
    holderCommand: process.env.OMP_SUBAGENT_TABS_HOLDER ?? DEFAULT_HOLDER,
    quietAfterMs: Number.isFinite(quietRaw) && quietRaw > 0 ? quietRaw : DEFAULT_QUIET_MS,
    renderMode: (process.env.OMP_SUBAGENT_TABS_RENDER ?? "rich").toLowerCase() === "plain" ? "plain" : "rich",
  };
}

/**
 * Default omp extension factory. Probes backends once, picks supaterm (else
 * tmux, else degrades to a no-op with a logged notice), then relays per-agent
 * lifecycle/progress/event channels into one tab per agentId. Tabs are never
 * auto-closed on agent end; they are closed on session_shutdown.
 */
export default async function subagentTabs(pi: ExtensionAPI): Promise<void> {
  const config = readConfig();
  if (!config.enabled) return;

  pi.setLabel("Subagent tab relay");

  const exec: RelayExecFn = (command, args, options) => pi.exec(command, args, options);
  const supaterm = new SupatermBackend(exec, pi.logger, config.holderCommand);
  const tmux = new TmuxBackend(exec, pi.logger);

  const [supatermUp, tmuxUp] = await Promise.all([supaterm.available(), tmux.available()]);
  const choice = selectBackend(supatermUp, tmuxUp);
  if (choice === null) {
    pi.logger.warn(
      "subagent-tabs: no surface backend available (supaterm socket and tmux both missing); relay disabled.",
    );
    return;
  }
  const backend: SurfaceBackend = choice === "supaterm" ? supaterm : tmux;

  let cwd = process.cwd();
  pi.on("session_start", (_event, ctx) => {
    cwd = ctx.cwd;
  });

  const controller = new TabController({
    registry: new TabRegistry(),
    backend,
    config,
    logger: pi.logger,
    now: () => Date.now(),
    cwd: () => cwd,
  });

  const subs: Array<() => void> = [
    pi.events.on("task:subagent:lifecycle", (data) => {
      void controller.onLifecycle(data).catch((err: unknown) => {
        pi.logger.error("subagent-tabs: lifecycle handler rejected", { error: String(err) });
      });
    }),
    pi.events.on("task:subagent:progress", (data) => {
      void controller.onProgress(data).catch((err: unknown) => {
        pi.logger.error("subagent-tabs: progress handler rejected", { error: String(err) });
      });
    }),
    pi.events.on("task:subagent:event", (data) => {
      void controller.onEvent(data).catch((err: unknown) => {
        pi.logger.error("subagent-tabs: event handler rejected", { error: String(err) });
      });
    }),
  ];

  pi.on("session_shutdown", () => {
    for (const unsub of subs) {
      try {
        unsub();
      } catch {
        // best-effort unsubscribe
      }
    }
    const snap = controller.snapshot();
    for (const rec of snap) {
      void backend.closeTab(rec.tabId).catch(() => {
        // best-effort close on shutdown (never auto-close on agent end)
      });
      controller.drop(rec.agentId);
    }
  });
}
