/**
 * enforce-orchestrator.ts — Hard enforcement that the interactive root session
 * operates as Elon (the orchestrator seat) and cannot implement directly.
 *
 * Why this exists: AGENTS.md / PROTO.md / skill bodies are prompt-level and
 * ignorable in principle. The only mechanisms the model CANNOT bypass in
 * oh-my-pi are (a) agent-definition `tools:`/`spawns:` frontmatter (which
 * governs subagents) and (b) an extension `tool_call` handler returning
 * `{ block: true, reason }` (which governs the root session). This extension
 * is (b): it restricts the root session to Elon's contract.
 *
 * Enforcement surface (interactive root only — `ctx.hasUI === true`, AND the
 * project has opted in — see "Opt-in" below):
 *   - read, ask, todo                                   -> allowed
 *   - task                                              -> allowed only when
 *                                                          agent ∈ TEAM
 *   - write                                             -> allowed only for
 *                                                          .app/PROJECT.md
 *   - bash                                              -> allowed only for
 *                                                          `git ...` commands
 *   - everything else (edit, ast_edit, debug, browser,
 *     eval, web_search, find, search, lsp, irc, ...)    -> blocked
 *
 * Subagents are headless (`ctx.hasUI === false`) so this guard never fires
 * inside them — they are restricted instead by their own agent-definition
 * frontmatter (shipped by the `elon-ko-agents` marketplace plugin).
 *
 * Opt-in (disabled by default): the gate registers in every project that
 * installs this plugin, but the handler early-returns (imposes nothing) unless
 * the project opts in. Precedence (highest wins):
 *   OMP_BYPASS_ORCHESTRATOR=1  -> fully OFF (escape hatch; registers nothing)
 *   OMP_ENABLE_ORCHESTRATOR=1  -> ON (env opt-in, no marker needed)
 *   <cwd>/.omp/elon.json {"enabled":true} -> ON (project marker)
 *   otherwise                  -> DORMANT
 *
 * Advisory framing (BLEND): the bundled APPEND_SYSTEM (Elon role framing) is
 * re-injected once per session at `session_start` as an advisory custom message
 * (`display:false`, queued for the next turn). A project-local
 * `<cwd>/.omp/APPEND_SYSTEM.md` overrides the bundled default. This is advisory
 * only — no oh-my-pi ExtensionAPI call yields a true system-attributed block
 * (`MessageAttribution` is `"user" | "agent"`; `getSystemPrompt()` is read-only;
 * `appendEntry` is not sent to the LLM). Hard enforcement is this gate + the
 * agent frontmatter, never the prompt alone.
 *
 * Loading: provided via `package.json#omp.extensions` (the `elon-ko-gate`
 * plugin). Discovered by the `omp-plugins` provider when the package is loaded
 * through its own `extensions:` entry (npm/git install or `omp plugin link`).
 */

// `import type` is erased at runtime, so this runs under omp regardless of
// whether the package is resolvable for standalone type-checking.
import type { ExtensionAPI } from "@oh-my-pi/pi-coding-agent";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const BYPASS = process.env.OMP_BYPASS_ORCHESTRATOR === "1";
const ENABLE = process.env.OMP_ENABLE_ORCHESTRATOR === "1";

/** Agents Elon (the root) is permitted to spawn. */
const TEAM = [
  "reqguru",
  "drpe",
  "leaddev",
  "validator",
  "docworm",
  "hr",
] as const;

/** Tools the root orchestrator may call unconditionally (static lookup). */
const ROOT_ALLOWED: Record<string, true> = { read: true, ask: true, todo: true };

/** Directory of this module — sibling assets (bundled APPEND_SYSTEM) live here. */
const MODULE_DIR = (() => {
  try {
    return fileURLToPath(new URL(".", import.meta.url));
  } catch {
    return "";
  }
})();

/**
 * Bundled default Elon framing (APPEND_SYSTEM.md), shipped as the sibling asset
 * `append-system.default.md`. Read once at load; advisory only.
 */
const BUNDLED_APPEND_SYSTEM: string | undefined = (() => {
  if (!MODULE_DIR) return undefined;
  try {
    return readFileSync(join(MODULE_DIR, "append-system.default.md"), "utf8");
  } catch {
    return undefined;
  }
})();

/** Build the `{ block: true, reason }` result shared by every denial path. */
function block(reason: string) {
  return { block: true as const, reason };
}

/**
 * Whether the gate is ACTIVE in the given project root. Precedence:
 * BYPASS (off) ▸ ENABLE (on) ▸ project marker ▸ dormant. A malformed or absent
 * marker is dormant (fail-safe).
 */
export function optedIn(cwd: string): boolean {
  if (BYPASS) return false;
  if (ENABLE) return true;
  const markerPath = join(cwd, ".omp", "elon.json");
  if (!existsSync(markerPath)) return false;
  try {
    const parsed: unknown = JSON.parse(readFileSync(markerPath, "utf8"));
    if (typeof parsed !== "object" || parsed === null || !("enabled" in parsed)) {
      return false;
    }
    return (parsed as { enabled?: unknown }).enabled === true;
  } catch {
    return false;
  }
}

export default function enforceOrchestrator(pi: ExtensionAPI): void {
  if (BYPASS) {
    // Escape hatch active: register nothing, impose no restrictions.
    return;
  }

  pi.setLabel("Orchestrator enforcement (opt-in)");

  // Advisory framing: re-inject APPEND_SYSTEM once per session. A project-local
  // <cwd>/.omp/APPEND_SYSTEM.md overrides the bundled default. Wrapped so a
  // read/send failure can never break the session — it is advisory only.
  pi.on("session_start", async (_event, ctx) => {
    try {
      let text = BUNDLED_APPEND_SYSTEM;
      const overridePath = join(ctx.cwd, ".omp", "APPEND_SYSTEM.md");
      if (existsSync(overridePath)) text = readFileSync(overridePath, "utf8");
      if (!text) return;
      pi.sendMessage(
        {
          customType: "elon-ko-gate:append-system",
          content: text,
          display: false,
          attribution: "user",
        },
        { deliverAs: "nextTurn", triggerTurn: false },
      );
    } catch {
      // Advisory injection must never break the session.
    }
  });

  pi.on("tool_call", async (event, ctx) => {
    // Only the interactive root session is gated. Subagents run headless
    // (ctx.hasUI === false) and are restricted by their own agent frontmatter.
    if (!ctx.hasUI) return;
    // Disabled by default: impose nothing unless the project opted in (§5).
    if (!optedIn(ctx.cwd)) return;

    const tool = String(event.toolName ?? "");
    const input = (event.input ?? {}) as Record<string, unknown>;

    if (ROOT_ALLOWED[tool]) return;

    if (tool === "task") {
      const agent = String(input.agent ?? "").toLowerCase().trim();
      if ((TEAM as readonly string[]).includes(agent)) return;
      const passedAgent = agent || "(none)";
      return block(
        `The root orchestrator may only spawn team agents (${TEAM.join(", ")}). ` +
          `You passed agent="${passedAgent}". Delegate through the pipeline; do not implement directly.`,
      );
    }

    if (tool === "write") {
      const path = String(input.path ?? "");
      // Elon owns only the protocol status artifact.
      if (path.endsWith(".app/PROJECT.md") || path.endsWith("/.app/PROJECT.md")) {
        return;
      }
      return block(
        `The root orchestrator may only write .app/PROJECT.md (got "${path}"). ` +
          `All other file creation belongs to a team agent — spawn one via task(agent="<name>").`,
      );
    }

    if (tool === "bash") {
      const command = String(input.command ?? "").trim();
      if (command === "git" || command.startsWith("git ")) return;
      return block(
        `The root orchestrator may only run git commands (for protocol artifact commits). ` +
          `All other commands belong to a team agent. Command was: ${command.slice(0, 80)}`,
      );
    }

    // Everything else (edit, ast_edit, ast_grep, debug, browser, eval,
    // web_search, find, search, lsp, irc, resolve, ...) is out of scope for
    // the orchestrator seat.
    return block(
      `Tool "${tool}" is not available to the root orchestrator (Elon). ` +
        `Delegate the work to a team agent via task(agent="<name>", context="skill://<name>").`,
    );
  });
}
