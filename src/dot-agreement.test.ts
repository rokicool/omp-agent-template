// dot-agreement.test.ts — unit tests for the C1 `.` agreement token extension,
// using Node's BUILT-IN test runner (node:test + node:assert). No new deps.
// Mirrors the style of enforce-orchestrator.test.ts.
//
// Exercises the PURE helpers (mostRecentPendingAsk, buildDotInjection) plus a
// behavioral check of the before_agent_start hook via a stub ExtensionAPI. The
// stub never imports oh-my-pi at runtime (ExtensionAPI is `import type` only),
// so the module loads cleanly under `node --test`.

import { test } from "node:test";
import { doesNotThrow, equal, match, notEqual, ok } from "node:assert";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { ExtensionAPI } from "@oh-my-pi/pi-coding-agent";
import dotAgreement, { buildDotInjection, mostRecentPendingAsk, type PendingAsk } from "./dot-agreement.ts";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

interface AskFixture {
  id: string;
  ts: string;
  origin: string;
  status: string;
  summary: string;
}

/** Build a PROJECT.md body containing a `## Pending Asks` section. */
function projectWithPending(asks: AskFixture[]): string {
  const lines = ["# PROJECT", "", "## Pending Asks", ""];
  for (const a of asks) {
    lines.push(`- [${a.id}] ${a.ts} origin=${a.origin} status=${a.status} | "${a.summary}"`);
  }
  lines.push("");
  return lines.join("\n");
}

/** Write `<dir>/.app/PROJECT.md`; returns its absolute path. Creates `.app/`. */
function writeProjectMd(dir: string, content: string): string {
  mkdirSync(join(dir, ".app"), { recursive: true });
  const path = join(dir, ".app", "PROJECT.md");
  writeFileSync(path, content);
  return path;
}

/** Drop the opt-in marker so `optedIn(dir)` is true (parity with the gate). */
function optIn(dir: string): void {
  mkdirSync(join(dir, ".omp"), { recursive: true });
  writeFileSync(join(dir, ".omp", "elon.json"), '{"enabled": true}\n');
}

/** Fresh temp project root, cleaned up after `fn` returns. */
function withTmp(fn: (dir: string) => void): void {
  const dir = mkdtempSync(join(tmpdir(), "dot-agreement-"));
  try {
    fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const A = (over: Partial<AskFixture> = {}): AskFixture => ({
  id: "PA-1",
  ts: "2026-06-26T12:00:00Z",
  origin: "reqguru",
  status: "pending",
  summary: "Should the default be Y?",
  ...over,
});

// ---------------------------------------------------------------------------
// R1.1 — `.` agrees with the (single) most-recent pending ask
// ---------------------------------------------------------------------------

test("R1.1: buildDotInjection('.', pending) names the ask and its summary", () => {
  withTmp((dir) => {
    const path = writeProjectMd(dir, projectWithPending([A({ id: "PA-1" })]));
    const pending = mostRecentPendingAsk(path);
    notEqual(pending, null);

    const msg = buildDotInjection(".", pending);
    notEqual(msg, null);
    equal(msg!.customType, "elon-ko-gate:dot-agreement");
    equal(msg!.display, false);
    equal(msg!.attribution, "user");
    match(msg!.content, /PA-1/);
    match(msg!.content, /Should the default be Y/);
  });
});

// ---------------------------------------------------------------------------
// R1.2 — origin-agnostic: reqguru and elon inject identically (id present)
// ---------------------------------------------------------------------------

test("R1.2: pending asks from any origin inject the id", () => {
  for (const origin of ["reqguru", "elon"]) {
    withTmp((dir) => {
      const path = writeProjectMd(
        dir,
        projectWithPending([A({ id: "PA-2", origin, summary: "Proceed TRIVIAL path?" })]),
      );
      const pending = mostRecentPendingAsk(path);
      notEqual(pending, null);
      equal(pending!.origin, origin);

      const msg = buildDotInjection(".", pending);
      notEqual(msg, null);
      match(msg!.content, /PA-2/);
    });
  }
});

// ---------------------------------------------------------------------------
// R1.3 — multi-pending: `.` resolves to the LAST pending in document order
// ---------------------------------------------------------------------------

test("R1.3: mostRecentPendingAsk returns the last pending; injection names only it", () => {
  withTmp((dir) => {
    const path = writeProjectMd(
      dir,
      projectWithPending([
        A({ id: "PA-3", ts: "2026-06-26T12:00:00Z", origin: "reqguru", summary: "Should the default be Y?" }),
        A({ id: "PA-4", ts: "2026-06-26T12:05:00Z", origin: "elon", summary: "Proceed TRIVIAL path?" }),
      ]),
    );
    const pending = mostRecentPendingAsk(path);
    notEqual(pending, null);
    equal(pending!.id, "PA-4");

    const msg = buildDotInjection(".", pending);
    notEqual(msg, null);
    match(msg!.content, /PA-4/);
    ok(!msg!.content.includes("PA-3"), "must not surface the superseded ask");
  });
});

test("R1.3: agreed/deferred asks are ignored — only status=pending counts", () => {
  withTmp((dir) => {
    const path = writeProjectMd(
      dir,
      projectWithPending([
        A({ id: "PA-1", status: "agreed", summary: "done" }),
        A({ id: "PA-2", status: "pending", summary: "live one" }),
        A({ id: "PA-3", status: "deferred", summary: "later" }),
      ]),
    );
    const pending = mostRecentPendingAsk(path);
    notEqual(pending, null);
    equal(pending!.id, "PA-2");
  });
});

// ---------------------------------------------------------------------------
// R1.4 — only a reply that trims to exactly `.` is the token
// ---------------------------------------------------------------------------

test("R1.4: period-bearing strings that are not a lone `.` pass through (null)", () => {
  const pending: PendingAsk = A();
  for (const reply of ["v1.2", "ok.", "3.14", ".."]) {
    equal(buildDotInjection(reply, pending), null, `expected null for ${JSON.stringify(reply)}`);
  }
});

test("R1.4: trim semantics — a dot padded with whitespace IS the token", () => {
  // NOTE (SPEC ambiguity, flagged to LeadDev): the assignment's R1.4 list also
  // names `". "` (dot+space) as a non-token. That is incompatible with the
  // trim() rule stated in the buildDotInjection contract and SPEC §3.1
  // (`prompt.trim() === "."`): `". ".trim() === "."`. The trim rule is the
  // authoritative, multiply-stated enforcement, so whitespace-padded dots are
  // treated as the token. Asserted here so the behavior is explicit.
  const pending: PendingAsk = A();
  for (const reply of [" . ", ". ", " ."]) {
    const msg = buildDotInjection(reply, pending);
    notEqual(msg, null, `expected the token for ${JSON.stringify(reply)}`);
    match(msg!.content, /PA-1/);
  }
});

// ---------------------------------------------------------------------------
// R1.5 — no pending ask (missing file / empty section) → ask the user
// ---------------------------------------------------------------------------

test("R1.5: missing file → mostRecentPendingAsk is null (never throws)", () => {
  withTmp((dir) => {
    const missing = join(dir, ".app", "PROJECT.md");
    doesNotThrow(() => void mostRecentPendingAsk(missing));
    equal(mostRecentPendingAsk(missing), null);
  });
});

test("R1.5: section with no pending entries → null", () => {
  withTmp((dir) => {
    const path = writeProjectMd(
      dir,
      projectWithPending([A({ id: "PA-9", status: "agreed" })]),
    );
    equal(mostRecentPendingAsk(path), null);
  });
});

test("R1.5: PROJECT.md without the section → null", () => {
  withTmp((dir) => {
    const path = writeProjectMd(dir, "# PROJECT\n\nNo pending section here.\n");
    equal(mostRecentPendingAsk(path), null);
  });
});

test("R1.5: buildDotInjection('.', null) tells Elon to ask the user", () => {
  const msg = buildDotInjection(".", null);
  notEqual(msg, null);
  ok(/no pending/i.test(msg!.content) || /ask/i.test(msg!.content), "must prompt for clarification");
  equal(msg!.customType, "elon-ko-gate:dot-agreement");
});

// ---------------------------------------------------------------------------
// R1.6 — affirmatives are NOT mapped to the token
// ---------------------------------------------------------------------------

test("R1.6: affirmatives (yes/ok/y/sure) pass through (null)", () => {
  const pending: PendingAsk = A();
  for (const reply of ["yes", "ok", "y", "sure"]) {
    equal(buildDotInjection(reply, pending), null, `expected null for ${JSON.stringify(reply)}`);
  }
});

// ---------------------------------------------------------------------------
// Behavioral hook check (strongest feasible) — exercises the real handler via
// a stub ExtensionAPI capturing the registered before_agent_start handler.
// ---------------------------------------------------------------------------

test("hook: on `.` it injects the most-recent pending ask; non-dot passes through", () => {
  const handlers: Record<string, (event: { prompt: string }, ctx: { hasUI: boolean; cwd: string }) => unknown> =
    {};
  const pi = {
    setLabel() {},
    on(name: string, h: (event: { prompt: string }, ctx: { hasUI: boolean; cwd: string }) => unknown) {
      handlers[name] = h;
    },
  } as unknown as ExtensionAPI;

  dotAgreement(pi);
  ok(handlers["before_agent_start"], "handler registered");

  withTmp((dir) => {
    optIn(dir);
    writeProjectMd(
      dir,
      projectWithPending([
        A({ id: "PA-7", origin: "reqguru", summary: "Ship the feature?" }),
      ]),
    );

    // `.` → injects PA-7.
    const hit = handlers["before_agent_start"](
      { prompt: "." },
      { hasUI: true, cwd: dir },
    ) as { message?: { content?: string } } | undefined;
    notEqual(hit, undefined);
    notEqual(hit!.message, undefined);
    match(hit!.message!.content!, /PA-7/);

    // Ordinary input → pass-through (undefined).
    const pass = handlers["before_agent_start"](
      { prompt: "hello there" },
      { hasUI: true, cwd: dir },
    );
    equal(pass, undefined);
  });
});

test("hook: dormant when not opted in (no marker → no injection)", () => {
  const handlers: Record<string, (event: { prompt: string }, ctx: { hasUI: boolean; cwd: string }) => unknown> =
    {};
  const pi = {
    setLabel() {},
    on(name: string, h: (event: { prompt: string }, ctx: { hasUI: boolean; cwd: string }) => unknown) {
      handlers[name] = h;
    },
  } as unknown as ExtensionAPI;
  dotAgreement(pi);

  withTmp((dir) => {
    writeProjectMd(dir, projectWithPending([A({ id: "PA-1" })]));
    // No .omp/elon.json → optedIn false → pass-through.
    const r = handlers["before_agent_start"](
      { prompt: "." },
      { hasUI: true, cwd: dir },
    );
    equal(r, undefined);
  });
});

test("hook: headless context (hasUI false) is never gated", () => {
  const handlers: Record<string, (event: { prompt: string }, ctx: { hasUI: boolean; cwd: string }) => unknown> =
    {};
  const pi = {
    setLabel() {},
    on(name: string, h: (event: { prompt: string }, ctx: { hasUI: boolean; cwd: string }) => unknown) {
      handlers[name] = h;
    },
  } as unknown as ExtensionAPI;
  dotAgreement(pi);

  withTmp((dir) => {
    optIn(dir);
    writeProjectMd(dir, projectWithPending([A({ id: "PA-1" })]));
    const r = handlers["before_agent_start"](
      { prompt: "." },
      { hasUI: false, cwd: dir },
    );
    equal(r, undefined);
  });
});
