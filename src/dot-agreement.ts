/**
 * dot-agreement.ts — Implements the `.` agreement token for the interactive
 * root orchestrator (Elon).
 *
 * When the user's reply trims to EXACTLY `.`, the `before_agent_start` hook
 * injects turn context naming the most-recent pending ask recorded in
 * `.app/PROJECT.md` (or, if none is pending, a no-pending clarification asking
 * Elon what the user is agreeing to).
 *
 * This is the ENFORCED layer of C1 (the advisory text lives in the Elon skill +
 * append-system.default.md). Like the companion gate it ships DORMANT unless the
 * project opts in (`optedIn`, reused from enforce-orchestrator.ts), and it only
 * fires for the interactive root (`ctx.hasUI === true`).
 *
 * Pure functions (`mostRecentPendingAsk`, `buildDotInjection`) are exported for
 * unit testing without an LLM. They never throw; the hook body is wrapped in
 * try/catch so an extension failure can never break a turn.
 */

// `import type` is erased at runtime (Node v26 cannot strip types under
// node_modules), so this module loads under `node --test` regardless of whether
// the package is resolvable for standalone type-checking.
import type { ExtensionAPI } from "@oh-my-pi/pi-coding-agent";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { optedIn } from "./enforce-orchestrator.ts";

/** Custom-message discriminator used for injected `.`-token turn context. */
const DOT_CUSTOM_TYPE = "elon-ko-gate:dot-agreement";

/** A single pending-ask record parsed from `.app/PROJECT.md`. */
export interface PendingAsk {
  id: string;
  ts: string;
  origin: string;
  summary: string;
}

// Tolerant parser for one Pending-Asks list line, e.g.:
//   - [PA-4] 2026-06-26T12:05:00Z origin=elon status=pending | "Proceed TRIVIAL path?"
// Captures: id (inside [...]), ts, origin, status, summary (inside the quotes).
// Whitespace-tolerant; lines that do not match are skipped (never throw).
const PENDING_ASK_RE =
  /^\s*-\s*\[([^\]]+)\]\s+(\S+)\s+origin=(\S+)\s+status=(\S+)\s*\|\s*"(.*)"\s*$/;

/** The `## Pending Asks` section header (documented in SPEC §3.2). */
const SECTION_HEADER_RE = /^##\s+Pending Asks\s*$/;

/** Any markdown heading — its appearance ends the current section. */
const HEADING_RE = /^#{1,6}\s+\S/;

/**
 * Read-only parse of a PROJECT.md file. Returns the most-recent (LAST in
 * document order) line with `status=pending`, or `null` when the file/section is
 * absent, unreadable, or contains no pending entries. NEVER throws.
 */
export function mostRecentPendingAsk(projectMdPath: string): PendingAsk | null {
  if (!existsSync(projectMdPath)) return null;
  let text: string;
  try {
    text = readFileSync(projectMdPath, "utf8");
  } catch {
    return null;
  }

  let inSection = false;
  let last: PendingAsk | null = null;

  for (const line of text.split(/\r?\n/)) {
    if (!inSection) {
      if (SECTION_HEADER_RE.test(line)) inSection = true;
      continue;
    }
    // Inside the section: another heading closes it.
    if (HEADING_RE.test(line)) {
      inSection = false;
      continue;
    }
    const m = PENDING_ASK_RE.exec(line);
    if (!m) continue; // skip blank / malformed lines — never crash
    if (m[4] !== "pending") continue; // only pending asks are candidates
    last = { id: m[1], ts: m[2], origin: m[3], summary: m[5] };
  }

  return last;
}

/**
 * Pure. Returns `null` when `dotReply.trim() !== "."` (R1.4/R1.6: non-dot input
 * is passed through untouched). Otherwise builds the turn-injection message
 * naming the pending ask (R1.1) — or the no-pending clarification (R1.5).
 *
 * The returned shape is assignable to `BeforeAgentStartEventResult["message"]`
 * (`Pick<CustomMessage, "customType"|"content"|"display"|"details"|"attribution">`).
 */
export function buildDotInjection(
  dotReply: string,
  pending: PendingAsk | null,
): { customType: string; content: string; display: boolean; attribution: "user" } | null {
  // R1.4/R1.6: the token is a reply that trims to exactly ".". `v1.2`, `ok.`,
  // `3.14`, `..` are NOT the token; affirmatives (`yes`,`ok`,`y`,`sure`) are NOT
  // mapped. (See the SPEC-ambiguity note below re. `". "`.)
  if (dotReply.trim() !== ".") return null;

  if (pending !== null) {
    return {
      customType: DOT_CUSTOM_TYPE,
      display: false,
      attribution: "user",
      content:
        `The user replied with the "." agreement token, agreeing with the most-recent ` +
        `pending ask [${pending.id}] (origin: ${pending.origin}): "${pending.summary}". ` +
        `Treat this as explicit agreement with that ask and proceed accordingly.`,
    };
  }

  // R1.5: no pending ask recorded — do not fabricate a target.
  return {
    customType: DOT_CUSTOM_TYPE,
    display: false,
    attribution: "user",
    content:
      `You received the "." agreement token, but no pending ask is recorded in ` +
      `.app/PROJECT.md. Ask the user what they are agreeing to; do not fabricate a target.`,
  };
}

/**
 * Default omp extension factory. Registers a `before_agent_start` handler that,
 * for an interactive opted-in root, injects the `.`-agreement turn context.
 * Dormant otherwise (parity with the companion gate). Never breaks a turn.
 */
export default function dotAgreement(pi: ExtensionAPI): void {
  pi.setLabel("Dot-agreement token (opt-in)");

  pi.on("before_agent_start", (event, ctx) => {
    try {
      // Interactive root only — subagents run headless (hasUI === false).
      if (!ctx.hasUI) return;
      // Dormant unless the project opted in (mirrors enforce-orchestrator.ts:155).
      if (!optedIn(ctx.cwd)) return;
      // Pass-through for all non-dot input (R1.4/R1.6).
      if (event.prompt.trim() !== ".") return;

      const pending = mostRecentPendingAsk(join(ctx.cwd, ".app", "PROJECT.md"));
      const msg = buildDotInjection(event.prompt, pending);
      if (!msg) return; // defensive: prompt is "." so msg is non-null in practice
      return { message: msg };
    } catch {
      // An extension failure must never break the turn (advisory safety).
      return;
    }
  });
}
