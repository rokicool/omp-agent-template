// subagent-tabs.test.ts — unit tests for the PURE logic of subagent-tabs.ts
// using Node's BUILT-IN test runner (node:test + node:assert). No new deps.
//
// Live-environment ACs (AC1 two-live-tabs, AC2 live rich stream, AC4 live
// cancel→aborted tab) REQUIRE a live supaterm socket + live omp subagent
// session and are NOT covered by these unit tests.

import { test } from "node:test";
import { deepEqual, equal, ok, throws } from "node:assert";
import { appendFileSync, mkdtempSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Node's built-in TS loader requires the explicit ".ts" extension (extensionless
// specifiers fail with ERR_MODULE_NOT_FOUND); tsconfig sets
// allowImportingTsExtensions so tsc accepts it too.
import {
  TabRegistry,
  buildSupatermNewArgs,
  buildSupatermRenameArgs,
  buildSupatermSendArgs,
  buildSupatermNotifyArgs,
  buildSupatermCloseArgs,
  buildSupatermLsArgs,
  buildTmuxNewSessionArgs,
  buildTmuxHasSessionArgs,
  buildTmuxNewWindowArgs,
  buildTmuxSendKeysArgs,
  buildTmuxKillWindowArgs,
  parseSupatermNewJson,
  formatTabLabel,
  deriveTabStatus,
  renderAgentSessionEvent,
  readJsonlFromByte,
  selectBackend,
} from "./subagent-tabs.ts";
// ANSI SGR strip helper for rich-mode assertions (no dependency).
const stripAnsi = (s: string) => s.replace(/\x1b\[[0-9;]*m/g, "");

// ---------------------------------------------------------------------------
// 1. TabRegistry
// ---------------------------------------------------------------------------

test("TabRegistry: create → get; upsert merge; revive keeps tabId; never-close; drop", () => {
  const r = new TabRegistry();

  // create
  r.upsert("a", { backend: "supaterm", tabId: "t1", status: "running", fromByte: 0, startedAt: 1, lastActivityMs: 1 });
  const got = r.get("a");
  ok(got, "get returns the created record");
  equal(got?.agentId, "a");
  equal(got?.tabId, "t1");
  equal(got?.status, "running");
  equal(r.snapshot().length, 1);

  // upsert merge mutates role but keeps tabId
  r.upsert("a", { role: "doer" });
  equal(r.get("a")?.role, "doer");
  equal(r.get("a")?.tabId, "t1");
  equal(r.snapshot().length, 1, "merge does not create a second record");

  // terminate → ended keeps the record present (never-close)
  r.upsert("a", { status: "ended", endedAt: 5, lastActivityMs: 5 });
  ok(r.get("a"), "ended record is still present (never auto-closed)");
  equal(r.get("a")?.status, "ended");
  equal(r.get("a")?.endedAt, 5);
  equal(r.snapshot().length, 1);

  // revive: mutate status/lastActivityMs/endedAt only; keep tabId
  r.upsert("a", { status: "running", endedAt: undefined, lastActivityMs: 9 });
  const revived = r.get("a");
  equal(revived?.status, "running");
  equal(revived?.lastActivityMs, 9);
  ok(revived?.endedAt === undefined, "revive clears endedAt");
  equal(revived?.tabId, "t1", "revive keeps tabId");
  equal(r.snapshot().length, 1, "revive reuses the same record");

  // second upsert for a brand-new agent creates a 2nd record
  r.upsert("b", { backend: "tmux", tabId: "b", status: "running", fromByte: 0, startedAt: 2, lastActivityMs: 2 });
  equal(r.snapshot().length, 2);

  // drop removes the record and reports truthiness
  equal(r.drop("a"), true);
  ok(r.get("a") === undefined, "dropped agent is gone");
  equal(r.snapshot().length, 1);
  equal(r.drop("a"), false, "dropping again reports false");
});

// ---------------------------------------------------------------------------
// 2. argv builders
// ---------------------------------------------------------------------------

test("argv builders produce exact arrays", () => {
  // supaterm
  deepEqual(buildSupatermNewArgs("cat", {}), ["tab", "new", "--json", "--script", "cat"]);
  deepEqual(buildSupatermNewArgs("cat", { cwd: "/p" }), ["tab", "new", "--json", "--script", "cat", "--cwd", "/p"]);
  deepEqual(
    buildSupatermNewArgs("cat", { cwd: "/p", in: "main" }),
    ["tab", "new", "--json", "--script", "cat", "--cwd", "/p", "--in", "main"],
  );
  deepEqual(buildSupatermRenameArgs("Title", "T1"), ["tab", "rename", "Title", "T1"]);
  deepEqual(buildSupatermSendArgs("P1", "hi"), ["pane", "send", "P1", "hi"]);
  deepEqual(buildSupatermNotifyArgs("T", "B"), ["pane", "notify", "--title", "T", "--body", "B"]);
  deepEqual(buildSupatermNotifyArgs("T", "B", "P1"), ["pane", "notify", "--title", "T", "--body", "B", "P1"]);
  deepEqual(buildSupatermCloseArgs("T1"), ["tab", "close", "T1"]);
  deepEqual(buildSupatermLsArgs(), ["ls", "--json"]);

  // tmux
  deepEqual(buildTmuxNewSessionArgs("omp-agents"), ["new-session", "-d", "-s", "omp-agents"]);
  deepEqual(buildTmuxHasSessionArgs("omp-agents"), ["has-session", "-t", "omp-agents"]);
  deepEqual(buildTmuxNewWindowArgs("omp-agents", "middev"), ["new-window", "-t", "omp-agents", "-n", "middev", "-k"]);
  deepEqual(buildTmuxSendKeysArgs("omp-agents:middev", "chunk"), ["send-keys", "-t", "omp-agents:middev", "-l", "chunk"]);
  deepEqual(buildTmuxKillWindowArgs("omp-agents:middev"), ["kill-window", "-t", "omp-agents:middev"]);
});

// ---------------------------------------------------------------------------
// 3. parseSupatermNewJson
// ---------------------------------------------------------------------------

test("parseSupatermNewJson: valid {tabID,paneID} and missing tabID", () => {
  deepEqual(parseSupatermNewJson('{"tabID":"T","paneID":"P"}'), { tabId: "T", paneId: "P" });
  deepEqual(parseSupatermNewJson('{"tabID":"T"}'), { tabId: "T", paneId: undefined });
  // tabID present but paneID absent/non-string → paneId undefined
  deepEqual(parseSupatermNewJson('{"tabID":"T","paneID":42}'), { tabId: "T", paneId: undefined });
  // missing tabID throws
  throws(() => parseSupatermNewJson('{"paneID":"P"}'), /missing tabID/);
  throws(() => parseSupatermNewJson("{}"), /missing tabID/);
  // non-JSON throws
  throws(() => parseSupatermNewJson("not json"), /non-JSON/);
});

// ---------------------------------------------------------------------------
// 4. formatTabLabel — one case per AgentTabStatus
// ---------------------------------------------------------------------------

test("formatTabLabel: one case per status", () => {
  equal(formatTabLabel("middev", "Implementer", "running"), "middev · Implementer");
  equal(formatTabLabel("middev", "Implementer", "quiet"), "middev · Implementer · quiet");
  equal(formatTabLabel("middev", "Implementer", "aborted"), "[ABORTED] middev · Implementer");
  equal(formatTabLabel("middev", "Implementer", "ended"), "[ended] middev · Implementer");
  // role undefined falls back to agentId
  equal(formatTabLabel("middev", undefined, "running"), "middev · middev");
});

// ---------------------------------------------------------------------------
// 5. deriveTabStatus precedence
// ---------------------------------------------------------------------------

test("deriveTabStatus: terminal lifecycle > progress > quiet > running", () => {
  const now = 10_000;
  // terminal lifecycle
  equal(deriveTabStatus("aborted", "running", now, now, 30_000), "aborted", "lifecycle aborted beats progress running");
  equal(deriveTabStatus("completed", undefined, now, now, 30_000), "ended");
  equal(deriveTabStatus("failed", undefined, now, now, 30_000), "ended");
  // progress failure (no terminal lifecycle) → aborted (AC4)
  equal(deriveTabStatus(undefined, "failed", now, now, 30_000), "aborted");
  equal(deriveTabStatus(undefined, "completed", now, now, 30_000), "ended");
  // quiet from inactivity
  equal(deriveTabStatus(undefined, "running", now, now - 30_000, 30_000), "quiet");
  equal(deriveTabStatus(undefined, "pending", now, now - 60_000, 30_000), "quiet");
  // active → running
  equal(deriveTabStatus(undefined, "running", now, now, 30_000), "running");
  equal(deriveTabStatus("started", undefined, now, now - 1_000, 30_000), "running");
});

// ---------------------------------------------------------------------------
// 6. renderAgentSessionEvent
// ---------------------------------------------------------------------------

test("renderAgentSessionEvent: plain byte-identical + rich ANSI codes", () => {
  // ---- PLAIN mode (renderMode: "plain") — regression guard: today's exact outputs ----
  const plain = { renderMode: "plain" as const };

  // message_end multi-block → "hello world"
  equal(
    renderAgentSessionEvent(
      { type: "message_end", message: { content: [{ type: "text", text: "hello " }, { type: "text", text: "world" }] } },
      plain,
    ),
    "hello world",
  );
  // message_update with text → "x"
  equal(
    renderAgentSessionEvent({ type: "message_update", message: { content: [{ type: "text", text: "x" }] } }, plain),
    "x",
  );
  // message_end no-text → undefined; no-message → undefined
  equal(
    renderAgentSessionEvent({ type: "message_end", message: { content: [{ type: "tool_use", id: "1" }] } }, plain),
    undefined,
  );
  equal(renderAgentSessionEvent({ type: "message_end" }, plain), undefined);
  // tool_execution_start with args → exactly '▸ read {"path":"x"}'
  equal(
    renderAgentSessionEvent({ type: "tool_execution_start", toolName: "read", args: { path: "x" } }, plain),
    '▸ read {"path":"x"}',
  );
  // tool_execution_start no args → '▸ read'
  equal(renderAgentSessionEvent({ type: "tool_execution_start", toolName: "read" }, plain), "▸ read");
  // tool_execution_end success → '◂ write ✓'; error → '◂ write ✗'
  equal(renderAgentSessionEvent({ type: "tool_execution_end", toolName: "write", isError: false }, plain), "◂ write ✓");
  equal(renderAgentSessionEvent({ type: "tool_execution_end", toolName: "write", isError: true }, plain), "◂ write ✗");
  // notice → 'warning: careful'
  equal(renderAgentSessionEvent({ type: "notice", level: "warning", message: "careful" }, plain), "warning: careful");
  // irc_message → '💬 irc'
  equal(renderAgentSessionEvent({ type: "irc_message", message: {} }, plain), "💬 irc");
  // unknown type → undefined
  equal(renderAgentSessionEvent({ type: "auto_compaction_start" }, plain), undefined);
  equal(renderAgentSessionEvent({ type: "something_new" }, plain), undefined);

  // ---- RICH mode (default = no opts; also asserted via explicit { renderMode: "rich" }) ----
  const rich = { renderMode: "rich" as const };

  // message_end → exactly "hello world", NO ANSI (assistant text never colorized)
  {
    const out = renderAgentSessionEvent({
      type: "message_end",
      message: { content: [{ type: "text", text: "hello " }, { type: "text", text: "world" }] },
    });
    equal(out, "hello world");
    ok(out !== undefined && !out.includes("\x1b"), "rich message_end must not contain ANSI escapes");
    // explicit rich opt reproduces the default
    equal(
      renderAgentSessionEvent(
        { type: "message_end", message: { content: [{ type: "text", text: "hello " }, { type: "text", text: "world" }] } },
        rich,
      ),
      "hello world",
    );
  }
  // tool_execution_start (no args): starts DIM, CYAN before name, ends RESET
  {
    const out = renderAgentSessionEvent({ type: "tool_execution_start", toolName: "read" });
    ok(out !== undefined, "rich tool_execution_start produced output");
    ok(out!.startsWith("\x1b[2m"), `starts with DIM (got ${JSON.stringify(out)})`);
    ok(out!.includes("\x1b[36mread"), `contains CYAN before name (got ${JSON.stringify(out)})`);
    ok(out!.endsWith("\x1b[0m"), `ends with RESET (got ${JSON.stringify(out)})`);
    equal(stripAnsi(out!), "▸ read");
  }
  // tool_execution_start with args: stripped equals '▸ read {"path":"x"}'
  {
    const out = renderAgentSessionEvent({ type: "tool_execution_start", toolName: "read", args: { path: "x" } }, rich);
    equal(stripAnsi(out!), '▸ read {"path":"x"}');
  }
  // tool_execution_end success: GREEN + ✓
  {
    const out = renderAgentSessionEvent({ type: "tool_execution_end", toolName: "write", isError: false });
    ok(out!.includes("\x1b[32m"), `contains GREEN (got ${JSON.stringify(out)})`);
    ok(out!.includes("✓"), `contains ✓ (got ${JSON.stringify(out)})`);
    equal(stripAnsi(out!), "◂ write ✓");
  }
  // tool_execution_end error: RED + ✗
  {
    const out = renderAgentSessionEvent({ type: "tool_execution_end", toolName: "write", isError: true });
    ok(out!.includes("\x1b[31m"), `contains RED (got ${JSON.stringify(out)})`);
    ok(out!.includes("✗"), `contains ✗ (got ${JSON.stringify(out)})`);
    equal(stripAnsi(out!), "◂ write ✗");
  }
  // notice warning: YELLOW
  {
    const out = renderAgentSessionEvent({ type: "notice", level: "warning", message: "careful" });
    ok(out!.includes("\x1b[33m"), `contains YELLOW (got ${JSON.stringify(out)})`);
    equal(stripAnsi(out!), "warning: careful");
  }
  // notice error level: RED
  {
    const out = renderAgentSessionEvent({ type: "notice", level: "error", message: "boom" });
    ok(out!.includes("\x1b[31m"), `contains RED (got ${JSON.stringify(out)})`);
    equal(stripAnsi(out!), "error: boom");
  }
  // irc_message → exactly magenta marker
  equal(renderAgentSessionEvent({ type: "irc_message", message: {} }), "\x1b[35m💬 irc\x1b[0m");
  // unknown type → undefined
  equal(renderAgentSessionEvent({ type: "auto_compaction_start" }), undefined);
  // 60-char cap in RICH: ANSI-STRIPPED length ≤ 60 (escape bytes don't count)
  {
    const out = renderAgentSessionEvent({ type: "tool_execution_start", toolName: "x", args: "a".repeat(100) });
    ok(out !== undefined, "rich long-args produced output");
    const stripped = stripAnsi(out!);
    ok(
      stripped.length <= 60,
      `rich tool_execution_start stripped ≤ 60 (got ${stripped.length}: ${JSON.stringify(stripped)})`,
    );
  }
});

// ---------------------------------------------------------------------------
// 7. readJsonlFromByte — temp-file rewind, missing file, trailing partial
// ---------------------------------------------------------------------------

test("readJsonlFromByte: rewind, missing file, trailing partial line", () => {
  const dir = mkdtempSync(join(tmpdir(), "omp-tabs-"));
  try {
    const file = join(dir, "abc.jsonl");
    const lines = ["line-one", "line-two", "line-three"];
    writeFileSync(file, lines.map((l) => l + "\n").join(""));
    const size = statSync(file).size;

    // fromByte 0 → 3 lines, nextFromByte = file size
    const r1 = readJsonlFromByte(file, 0);
    deepEqual(r1.lines, lines);
    equal(r1.nextFromByte, size);

    // fromByte = byteLen(line1 + "\n") → 2 lines
    const off = Buffer.byteLength(lines[0] + "\n");
    const r2 = readJsonlFromByte(file, off);
    deepEqual(r2.lines, lines.slice(1));
    equal(r2.nextFromByte, size);

    // missing file → {lines:[], nextFromByte: same}
    const r3 = readJsonlFromByte(join(dir, "nope.jsonl"), 7);
    deepEqual(r3.lines, []);
    equal(r3.nextFromByte, 7);

    // trailing partial line (no newline) is dropped and NOT counted in nextFromByte
    appendFileSync(file, "partial-no-newline");
    const partialStart = size;
    const r4 = readJsonlFromByte(file, 0);
    deepEqual(r4.lines, lines, "partial trailing line dropped");
    equal(r4.nextFromByte, partialStart, "nextFromByte excludes the partial tail");
    // re-reading from partialStart reads the still-incomplete line → dropped again
    const r5 = readJsonlFromByte(file, partialStart);
    deepEqual(r5.lines, []);
    equal(r5.nextFromByte, partialStart);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// 8. selectBackend
// ---------------------------------------------------------------------------

test("selectBackend: supaterm preferred, tmux fallback, null if neither", () => {
  equal(selectBackend(true, true), "supaterm");
  equal(selectBackend(true, false), "supaterm");
  equal(selectBackend(false, true), "tmux");
  equal(selectBackend(false, false), null);
});
