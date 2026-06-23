#!/usr/bin/env bash
#
# elon_ko.sh — one-line installer for the omp-agent-template plugin set.
#
# Ensures oh-my-pi (`omp`) and bun are present, then installs BOTH plugins:
#   • omp-agent-gate        — Elon orchestrator enforcement gate (needs bun)
#   • orchestrator-agents   — 7 agents + 8 skills (marketplace)
#
# Usage:
#   curl -fsSL https://raw.githubusercontent.com/rokicool/omp-agent-template/main/elon_ko.sh | bash
#
# Pin Plugin A to a tag/branch. Plugin B (the agents) always installs LATEST —
# the script refreshes the marketplace catalog every run, because omp
# marketplaces cannot be ref-pinned (they track the repo's default branch).
#   curl -fsSL https://raw.githubusercontent.com/rokicool/omp-agent-template/main/elon_ko.sh | OMP_AGENT_REF=v1.0.0 bash
#
# Re-running is safe — every step is idempotent.
set -euo pipefail

REPO="rokicool/omp-agent-template"
MARKETPLACE="omp-agent-template"        # value of marketplace.json#name
PLUGIN_B="orchestrator-agents"
REF="${OMP_AGENT_REF:-}"                # optional tag/branch pin for Plugin A

have() { command -v "$1" >/dev/null 2>&1; }

say()  { printf '\n== %s ==\n' "$*"; }
ok()   { printf '  ✓ %s\n' "$*"; }
warn() { printf '  ! %s\n' "$*"; }
die()  { printf '  ✗ %s\n' "$*" >&2; exit 1; }

# Installers drop their binaries in these dirs; put them on PATH up front so the
# rest of THIS script can call omp/bun in the same invocation.
export PATH="$HOME/.local/bin:$HOME/.bun/bin:$PATH"

# ── oh-my-pi (omp) ───────────────────────────────────────────────────────────
say "Checking for oh-my-pi (omp)"
if have omp; then
  ok "omp present ($(omp --version 2>/dev/null || echo installed))"
else
  warn "omp not found — installing via omp.sh (--source bundles bun)…"
  curl -fsSL https://omp.sh/install | sh -s -- --source || die "omp installer failed — see https://omp.sh"
  export PATH="$HOME/.local/bin:$HOME/.bun/bin:$PATH"
  have omp || die "omp installed but not on PATH — restart your shell and re-run"
  ok "omp installed ($(omp --version))"
fi

# ── bun ──────────────────────────────────────────────────────────────────────
# Plugin A (omp-agent-gate) is a TypeScript extension-package; `omp plugin
# install` resolves its deps with `bun install`, so bun must be on PATH. (If omp
# was just installed via --source above, bun came with it and this is a no-op.)
say "Checking for bun"
if have bun; then
  ok "bun present ($(bun --version 2>/dev/null || echo installed))"
else
  warn "bun not found — installing via bun.sh…"
  curl -fsSL https://bun.sh/install | bash || die "bun installer failed — see https://bun.sh"
  export PATH="$HOME/.bun/bin:$PATH"
  have bun || die "bun installed but not on PATH — restart your shell and re-run"
  ok "bun installed ($(bun --version))"
fi

# When no explicit OMP_AGENT_REF pin is given, resolve the LATEST release tag at
# runtime (git ls-remote sorts tags by version, newest first) so this script
# always installs the newest version and never goes stale on the next release.
if [ -z "${REF}" ]; then
  REF="$(git ls-remote --tags --sort=-v:refname "https://github.com/${REPO}.git" \
        | awk -F/ '/refs\/tags\// && !/\^\{\}/ {print $3; exit}')" \
    || die "could not query tags for ${REPO} — set OMP_AGENT_REF=<tag>"
  [ -n "${REF}" ] || die "no tags found for ${REPO} — set OMP_AGENT_REF=<tag>"
fi
GH_A="github:${REPO}${REF:+@$REF}"       # Plugin A source (optionally pinned)

# ── marketplace registration (idempotent — `marketplace add` errors if dup) ──
say "Registering marketplace '${MARKETPLACE}'"
if omp plugin marketplace list 2>/dev/null | grep -q "${MARKETPLACE}"; then
  ok "marketplace already registered"
else
  omp plugin marketplace add "${REPO}" || die "failed to add marketplace ${REPO}"
  ok "marketplace registered"
fi

# omp marketplaces track the repo's default branch and CANNOT be ref-pinned, so
# refresh the catalog every run to install the LATEST agents — a bare re-install
# would otherwise reuse a stale snapshot. (OMP_AGENT_REF still pins Plugin A.)
say "Refreshing marketplace '${MARKETPLACE}' to latest"
if omp plugin marketplace update "${MARKETPLACE}" >/dev/null 2>&1; then
  ok "agents catalog at latest"
else
  warn "marketplace refresh failed — continuing with the cached catalog"
fi

# ── Plugin A: omp-agent-gate (extension-package; --force = idempotent) ───────
say "Installing Plugin A: omp-agent-gate"
omp plugin install "${GH_A}" --force || die "Plugin A install failed"
ok "omp-agent-gate installed (${GH_A})"

# ── Plugin B: orchestrator-agents (marketplace; --force = idempotent) ────────
say "Installing Plugin B: ${PLUGIN_B}"
omp plugin install "${PLUGIN_B}@${MARKETPLACE}" --force || die "Plugin B install failed"
ok "${PLUGIN_B} installed"

# ── summary ──────────────────────────────────────────────────────────────────
cat <<EOF

============================================================
  omp-agent-template installed.

  Plugins:
    • omp-agent-gate         — gate + Definition-of-Done rule
    • orchestrator-agents    — 7 agents + 8 skills (always latest)

  The gate is dormant until a project opts in:
    echo '{"enabled": true}' > .omp/orchestrator.json

  If 'omp'/'bun' aren't found in a NEW shell, add to your PATH:
    export PATH="\$HOME/.local/bin:\$HOME/.bun/bin:\$PATH"
============================================================
EOF
