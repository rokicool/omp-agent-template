// subagent-tabs.test.ts — unit tests for the PURE logic of subagent-tabs.ts
// using Node's BUILT-IN test runner (node:test + node:assert). No new deps.
//
// These tests cover the pure logic (registry, argv builders, parser, label/
// state/render, jsonl rewind, backend selection) plus the injectable-exec
// backends (TmuxBackend, GhosttyViewer) via a recording fake RelayExecFn. They
// do NOT exercise a live tmux server or a live omp subagent session.

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
  formatTabLabel,
  deriveTabStatus,
  renderAgentSessionEvent,
  readJsonlFromByte,
  selectBackend,
  buildTmuxNewSessionArgs,
  buildTmuxHasSessionArgs,
  buildTmuxNewWindowArgs,
  buildTmuxRenameWindowArgs,
  buildTmuxSendKeysArgs,
  buildTmuxKillWindowArgs,
  buildTmuxSelectWindowArgs,
  buildTmuxListClientsArgs,
  buildGhosttyViewerArgs,
  parseTmuxWindowId,
  shouldOpenViewer,
  TmuxBackend,
  GhosttyViewer,
  type RelayExecFn,
  type RelayExecResult,
  type RelayLogger,
} from "./subagent-tabs.ts";
// ANSI SGR strip helper for rich-mode assertions (no dependency).
const stripAnsi = (s: string) => s.replace(/\x1b\[[0-9;]*m/g, "");

// ---------------------------------------------------------------------------
// Fake-exec test scaffolding: records every [cmd, args] invocation and returns
// scripted RelayExecResults chosen by the per-test `handler`. No real tmux.
// ---------------------------------------------------------------------------

const ok0 = (stdout: string): RelayExecResult => ({ stdout, stderr: "", code: 0, killed: false });

const noopLogger: RelayLogger = {
  error: () => {},
  warn: () => {},
  info: () => {},
  debug: () => {},
};

/** Count recorded calls of binary `cmd` whose first arg (tmux subcommand) is `sub`. */
function tmuxCalls(calls: ReadonlyArray<readonly [string, string[]]>, sub: string): string[][] {
  return calls.filter(([c, a]) => c === "tmux" && a[0] === sub).map(([, a]) => a);
}

function recordingExec(handler: (cmd: string, args: string[]) => RelayExecResult): {
  exec: RelayExecFn;
  calls: Array<[string, string[]]>;
} {
  const calls: Array<[string, string[]]> = [];
  const exec: RelayExecFn = async (cmd, args) => {
    calls.push([cmd, [...args]]);
    return handler(cmd, args);
  };
  return { exec, calls };
}

// ---------------------------------------------------------------------------
// 1. TabRegistry
// ---------------------------------------------------------------------------

test("TabRegistry: create → get; upsert merge; revive keeps tabId; never-close; drop", () => {
  const r = new TabRegistry();

  // create
  r.upsert("a", { backend: "tmux", tabId: "t1", status: "running", fromByte: 0, startedAt: 1, lastActivityMs: 1 });
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
  // session ops use the =<session> EXACT-match prefix
  deepEqual(buildTmuxHasSessionArgs("omp-subagents"), ["has-session", "-t", "=omp-subagents"]);
  deepEqual(buildTmuxNewSessionArgs("omp-subagents"), ["new-session", "-d", "-s", "omp-subagents"]);
  deepEqual(
    buildTmuxNewWindowArgs("omp-subagents", "middev · Implementer"),
    ["new-window", "-t", "=omp-subagents", "-n", "middev · Implementer", "-P", "-F", "#{window_id}"],
  );
  // per-window ops target the opaque @N window id directly (no session:window prefix)
  deepEqual(buildTmuxRenameWindowArgs("@3", "x"), ["rename-window", "-t", "@3", "x"]);
  deepEqual(buildTmuxSendKeysArgs("@3", "chunk"), ["send-keys", "-t", "@3", "-l", "chunk"]);
  deepEqual(buildTmuxKillWindowArgs("@3"), ["kill-window", "-t", "@3"]);
  deepEqual(buildTmuxSelectWindowArgs("@3"), ["select-window", "-t", "@3"]);
  deepEqual(
    buildTmuxListClientsArgs("omp-subagents"),
    ["list-clients", "-t", "=omp-subagents", "-F", "#{client_name}"],
  );
  deepEqual(
    buildGhosttyViewerArgs("omp-subagents"),
    ["-na", "Ghostty", "--args", "-e", "tmux", "attach", "-t", "omp-subagents"],
  );
});

// ---------------------------------------------------------------------------
// 3. parseTmuxWindowId
// ---------------------------------------------------------------------------

test("parseTmuxWindowId: parses @N id; throws on anything else", () => {
  equal(parseTmuxWindowId("@5\n"), "@5");
  equal(parseTmuxWindowId("  @12 "), "@12");
  equal(parseTmuxWindowId("@0"), "@0");
  // throws on empty / non-id / bare number / malformed
  throws(() => parseTmuxWindowId(""), /no window id/);
  throws(() => parseTmuxWindowId("nope"), /no window id/);
  throws(() => parseTmuxWindowId("5"), /no window id/);
  throws(() => parseTmuxWindowId("@x"), /no window id/);
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

test("selectBackend: tmux when up, null otherwise", () => {
  equal(selectBackend(true), "tmux");
  equal(selectBackend(false), null);
});

// ---------------------------------------------------------------------------
// 9. TmuxBackend — ensureSession idempotency + window targeting
// ---------------------------------------------------------------------------

test("TmuxBackend.ensureSession: session present → has-session once, zero new-session across creates", async () => {
  let win = 0;
  const { exec, calls } = recordingExec((cmd, args) => {
    if (cmd === "tmux" && args[0] === "new-window") return ok0(`@${++win}`);
    return ok0(""); // has-session → code 0 (session exists); everything else ok
  });
  const backend = new TmuxBackend(exec, noopLogger, "omp-subagents", false);

  const a = await backend.createTab("a", "doer", "/p");
  const b = await backend.createTab("b", "doer", "/p");

  equal(tmuxCalls(calls, "has-session").length, 1, "has-session runs exactly once (memoized)");
  equal(tmuxCalls(calls, "new-session").length, 0, "no new-session when the session already exists");
  equal(tmuxCalls(calls, "new-window").length, 2, "one new-window per createTab");
  equal(a.tabId, "@1", "first create returns the first scripted @N");
  equal(b.tabId, "@2", "second create returns the second scripted @N");
});

test("TmuxBackend.ensureSession: missing session → exactly one new-session across creates", async () => {
  let win = 0;
  const { exec, calls } = recordingExec((cmd, args) => {
    if (cmd === "tmux" && args[0] === "has-session") return { stdout: "", stderr: "no session", code: 1, killed: false };
    if (cmd === "tmux" && args[0] === "new-window") return ok0(`@${++win}`);
    return ok0(""); // new-session → code 0 (created)
  });
  const backend = new TmuxBackend(exec, noopLogger, "omp-subagents", false);

  await backend.createTab("a", "doer", "/p");
  await backend.createTab("b", "doer", "/p");

  equal(tmuxCalls(calls, "new-session").length, 1, "exactly one new-session across two creates");
});

test("TmuxBackend.createTab titles the window with formatTabLabel(running)", async () => {
  const { exec, calls } = recordingExec((cmd, args) => {
    if (cmd === "tmux" && args[0] === "new-window") return ok0("@7");
    return ok0("");
  });
  const backend = new TmuxBackend(exec, noopLogger, "omp-subagents", false);

  const created = await backend.createTab("middev", "Implementer", "/p");
  equal(created.tabId, "@7");

  const nw = tmuxCalls(calls, "new-window")[0];
  ok(nw, "new-window called");
  equal(nw[nw.indexOf("-n") + 1], formatTabLabel("middev", "Implementer", "running"), "-n label is the running-state formatTabLabel");
});

test("TmuxBackend: focus off → no select-window; on → exactly one select-window -t <@N>", async () => {
  // focus off → no select-window
  {
    const { exec, calls } = recordingExec((cmd, args) => {
      if (cmd === "tmux" && args[0] === "new-window") return ok0("@3");
      return ok0("");
    });
    const backend = new TmuxBackend(exec, noopLogger, "omp-subagents", false);
    await backend.createTab("a", "doer", "/p");
    equal(tmuxCalls(calls, "select-window").length, 0, "focus off → no select-window");
  }
  // focus on → one select-window targeting the created @N
  {
    const { exec, calls } = recordingExec((cmd, args) => {
      if (cmd === "tmux" && args[0] === "new-window") return ok0("@9");
      return ok0("");
    });
    const backend = new TmuxBackend(exec, noopLogger, "omp-subagents", true);
    const created = await backend.createTab("a", "doer", "/p");
    const selects = tmuxCalls(calls, "select-window");
    equal(selects.length, 1, "focus on → one select-window");
    equal(selects[0][selects[0].indexOf("-t") + 1], created.tabId, "select-window targets the created @N");
  }
});

// ---------------------------------------------------------------------------
// 10. GhosttyViewer — open-exactly-once, client-attached guard, ghostty-absent
// ---------------------------------------------------------------------------

test("GhosttyViewer opens exactly once across N openIfFirst calls", async () => {
  const { exec, calls } = recordingExec((cmd, args) => {
    if (cmd === "tmux" && args[0] === "list-clients") return ok0(""); // no client attached
    if (cmd === "open") return ok0("");
    return ok0("");
  });
  const viewer = new GhosttyViewer(exec, noopLogger, "omp-subagents", true); // ghosttyPresent=true

  await viewer.openIfFirst();
  await viewer.openIfFirst();
  await viewer.openIfFirst();

  const opens = calls.filter(([c, a]) => c === "open" && a[0] === "-na");
  equal(opens.length, 1, "open (Ghostty viewer) invoked exactly once");
  deepEqual(opens[0][1], buildGhosttyViewerArgs("omp-subagents"), "open argv matches buildGhosttyViewerArgs");
});

test("GhosttyViewer not spawned when a client already attached", async () => {
  const { exec, calls } = recordingExec((cmd, args) => {
    if (cmd === "tmux" && args[0] === "list-clients") return ok0("/dev/ttys001"); // client attached
    if (cmd === "open") return ok0("");
    return ok0("");
  });
  const viewer = new GhosttyViewer(exec, noopLogger, "omp-subagents", true);

  await viewer.openIfFirst();
  await viewer.openIfFirst();
  equal(calls.filter(([c]) => c === "open").length, 0, "no open when a client is already attached");
});

test("GhosttyViewer never opens when ghostty absent", async () => {
  const { exec, calls } = recordingExec((cmd, args) => {
    if (cmd === "tmux" && args[0] === "list-clients") return ok0(""); // no client
    if (cmd === "open") return ok0("");
    return ok0("");
  });
  const viewer = new GhosttyViewer(exec, noopLogger, "omp-subagents", false); // ghosttyPresent=false

  await viewer.openIfFirst();
  await viewer.openIfFirst();
  equal(calls.filter(([c]) => c === "open").length, 0, "no open when ghostty absent");
  equal(tmuxCalls(calls, "list-clients").length, 0, "list-clients not even probed when ghostty absent");
});

test("shouldOpenViewer: true only for (opened=false, present=true, attached=false)", () => {
  // the one true combination
  equal(shouldOpenViewer(false, true, false), true);
  // all other 7 combinations are false
  equal(shouldOpenViewer(true, true, false), false, "already opened");
  equal(shouldOpenViewer(false, false, false), false, "ghostty absent");
  equal(shouldOpenViewer(false, true, true), false, "client attached");
  equal(shouldOpenViewer(true, false, false), false);
  equal(shouldOpenViewer(true, true, true), false);
  equal(shouldOpenViewer(true, false, true), false);
  equal(shouldOpenViewer(false, false, true), false);
});
