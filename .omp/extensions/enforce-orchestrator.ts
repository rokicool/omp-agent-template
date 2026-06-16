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
 * Enforcement surface (interactive root only — `ctx.hasUI === true`):
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
 * inside them — they are restricted instead by their agent-definition
 * frontmatter under `.omp/agents/`.
 *
 * Escape hatch: set OMP_BYPASS_ORCHESTRATOR=1 to disable the guard entirely
 * (e.g. if the pipeline is broken and you must patch a file by hand).
 *
 * Loading: discovered automatically from `<cwd>/.omp/extensions/`
 * (see oh-my-pi extension-loading docs).
 */

// `import type` is erased at runtime, so this runs under omp regardless of
// whether the package is resolvable for standalone type-checking.
import type { ExtensionAPI } from "@oh-my-pi/pi-coding-agent";

const BYPASS = process.env.OMP_BYPASS_ORCHESTRATOR === "1";

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

function block(reason: string) {
  return { block: true as const, reason };
}

export default function enforceOrchestrator(pi: ExtensionAPI): void {
  if (BYPASS) {
    // Escape hatch active: register nothing, impose no restrictions.
    return;
  }

  pi.setLabel("Orchestrator enforcement");

  pi.on("tool_call", async (event, ctx) => {
    // Only the interactive root session is gated. Subagents run headless
    // (ctx.hasUI === false) and are restricted by their own agent frontmatter.
    if (!ctx.hasUI) return;

    const tool = String(event.toolName ?? "");
    const input = (event.input ?? {}) as Record<string, unknown>;

    if (ROOT_ALLOWED[tool]) return;

    if (tool === "task") {
      const agent = String(input.agent ?? "").toLowerCase().trim();
      if ((TEAM as readonly string[]).includes(agent)) return;
      return block(
        `The root orchestrator may only spawn team agents (${TEAM.join(", ")}). ` +
          `You passed agent="${agent || "(none)}". Delegate through the pipeline; do not implement directly.`,
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
