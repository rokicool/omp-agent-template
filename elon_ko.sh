#!/usr/bin/env bash
#
# elon_ko.sh — one-line installer for the elon-ko plugin set.
#
# Ensures oh-my-pi (`omp`) and bun are present, then installs BOTH plugins:
#   • elon-ko-gate        — Elon orchestrator enforcement gate (needs bun)
#   • elon-ko-agents   — 7 agents + 8 skills (marketplace)
#
# ── Stable install (no argument) ─────────────────────────────────────────────
# Plugin A pinned to the release tag below (override with OMP_AGENT_REF);
# Plugin B installed LATEST from the repo's default branch.
#
#   curl -fsSL https://raw.githubusercontent.com/rokicool/elon-ko/main/elon_ko.sh | bash
#   curl -fsSL https://raw.githubusercontent.com/rokicool/elon-ko/main/elon_ko.sh | OMP_AGENT_REF=v2.0.0 bash
#
# ── Pre-release install (pass a tag) ─────────────────────────────────────────
# Pass a pre-release tag to pin BOTH plugins to that exact ref — for testing
# work that is not yet released to production. omp marketplaces CANNOT be
# ref-pinned (they track the repo's default branch), so Plugin B is fetched as
# a source tarball of the tag and registered as a LOCAL marketplace. The tarball
# is extracted under $OMP_PRERELEASE_DIR (default ~/.omp-prerelease) and KEPT —
# omp references a local marketplace in place, so the directory must persist.
#
#   bash elon_ko.sh pr-dev-abc1234
#   curl -fsSL https://raw.githubusercontent.com/rokicool/elon-ko/main/elon_ko.sh | bash -s -- pr-dev-abc1234
#
# Works on a clean machine, in a docker container, and on a machine where an
# earlier (stable OR pre-release) version is already installed — every step is
# idempotent, and the marketplace is re-registered each run so it always points
# at the source selected by the mode.
set -euo pipefail

REPO="rokicool/elon-ko"
MARKETPLACE="elon-ko"        # value of marketplace.json#name
PLUGIN_B="elon-ko-agents"
PRERELEASE_BASE="${OMP_PRERELEASE_DIR:-$HOME/.omp-prerelease}"

# ── mode: a positional tag switches to pre-release (both plugins pinned) ──────
TAG="${1:-}"
if [ -n "$TAG" ]; then
  MODE="pre-release"
  REF="$TAG"                            # Plugin A pinned to the tag
else
  MODE="stable"
  REF="${OMP_AGENT_REF:-v2.0.0}"        # static tag: avoids store ref-drift + network deps; OMP_AGENT_REF overrides for dev
fi

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
# Plugin A (elon-ko-gate) is a TypeScript extension-package; `omp plugin
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

GH_A="github:${REPO}${REF:+#$REF}"       # Plugin A source (always pinned to REF)

# ── resolve the marketplace source for this mode ─────────────────────────────
# stable      → the GitHub repo (omp fetches the default-branch catalog fresh on add)
# pre-release → a LOCAL directory extracted from the tag's source tarball, because
#               omp marketplaces cannot be ref-pinned. The directory is kept under
#               $OMP_PRERELEASE_DIR — omp references a local marketplace in place.
if [ "$MODE" = "pre-release" ]; then
  say "Fetching pre-release '${TAG}' (pins Plugin A AND Plugin B to this tag)"
  have tar || die "'tar' is required for a pre-release install"
  extract_dir="$PRERELEASE_BASE/$TAG"
  tarball_url="https://github.com/${REPO}/archive/${TAG}.tar.gz"
  rm -rf "$extract_dir"
  mkdir -p "$extract_dir"
  curl -fsSL "$tarball_url" | tar -xz -C "$extract_dir" \
    || die "failed to fetch pre-release '${TAG}' from ${tarball_url} — does the tag exist?"
  # GitHub's archive extracts to a single top-level dir; resolve it dynamically
  # (its name depends on the ref — e.g. v2.0.0 → elon-ko-2.0.0).
  MKT_SOURCE="$(find "$extract_dir" -mindepth 1 -maxdepth 1 -type d | head -n1)"
  [ -n "$MKT_SOURCE" ] && [ -f "$MKT_SOURCE/.omp-plugin/marketplace.json" ] \
    || die "pre-release '${TAG}' tarball has no marketplace (.omp-plugin/marketplace.json)"
  ok "pre-release extracted → ${MKT_SOURCE}"
else
  MKT_SOURCE="${REPO}"                  # github owner/repo → tracks default branch
fi

# ── marketplace registration ─────────────────────────────────────────────────
# `marketplace add` errors on a duplicate name, so remove first (a no-op when
# absent). Re-registering every run also recovers from a prior run's source: a
# stable run drops a stale pre-release local registration, and vice-versa.
say "Registering marketplace '${MARKETPLACE}' (${MODE})"
omp plugin marketplace remove "${MARKETPLACE}" >/dev/null 2>&1 || true
omp plugin marketplace add "${MKT_SOURCE}" || die "marketplace add failed for '${MKT_SOURCE}'"
ok "marketplace registered (${MKT_SOURCE})"
# NOTE: deliberately NO `marketplace update` — in pre-release mode an update
# would pull the default branch and overwrite the pinned tag with latest.

# ── Plugin A: elon-ko-gate (extension-package) ─────────────────────────────
# omp resolves Plugin A as a git-sourced dep whose key (`elon-ko-gate`) equals
# the package name this repo provides. If a DIFFERENT ref is already locked in
# ~/.omp/plugins/ (a prior version, a bare/floating ref, or main-HEAD vs the
# pinned tag), `bun install` aborts with `DependencyLoop`. `--force` alone does
# NOT clear that stale resolution, so uninstall first — a no-op on a clean
# machine — then install the pinned ref so every run/upgrade resolves cleanly.
say "Installing Plugin A: elon-ko-gate"
omp plugin uninstall elon-ko-gate >/dev/null 2>&1 || true
omp plugin install "${GH_A}" --force || die "Plugin A install failed"
ok "elon-ko-gate installed (${GH_A})"

# ── Plugin B: elon-ko-agents (marketplace; --force = idempotent) ────────
say "Installing Plugin B: ${PLUGIN_B}"
omp plugin install "${PLUGIN_B}@${MARKETPLACE}" --force || die "Plugin B install failed"
ok "${PLUGIN_B} installed"

# ── summary ──────────────────────────────────────────────────────────────────
if [ "$MODE" = "pre-release" ]; then
  cat <<EOF

============================================================
  elon-ko installed — PRE-RELEASE '${TAG}'.

  Both plugins are pinned to tag '${TAG}':
    • elon-ko-gate         — gate + Definition-of-Done rule
    • elon-ko-agents    — 7 agents + 8 skills (from the tag, not latest)

  Plugin B was registered as a LOCAL marketplace from:
    ${MKT_SOURCE}
  (kept under ${PRERELEASE_BASE}; omp references it in place.)

  To return to the latest STABLE release, re-run without a tag:
    bash elon_ko.sh

  The gate is dormant until a project opts in:
    echo '{"enabled": true}' > .omp/elon.json
============================================================
EOF
else
  cat <<EOF

============================================================
  elon-ko installed.

  Plugins:
    • elon-ko-gate         — gate + Definition-of-Done rule
    • elon-ko-agents    — 7 agents + 8 skills (always latest)

  The gate is dormant until a project opts in:
    echo '{"enabled": true}' > .omp/elon.json

  If 'omp'/'bun' aren't found in a NEW shell, add to your PATH:
    export PATH="\$HOME/.local/bin:\$HOME/.bun/bin:\$PATH"
============================================================
EOF
fi
