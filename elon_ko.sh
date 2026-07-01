#!/usr/bin/env bash
#
# elon_ko.sh — one-line installer for the elon-ko plugin set.
#
# Ensures oh-my-pi (`omp`) and bun are present, then installs BOTH plugins:
#   • elon-ko-gate        — Elon orchestrator enforcement gate (needs bun)
#   • elon-ko-agents   — 8 agents + 9 skills (marketplace)
#
# ── Stable install (no argument) ─────────────────────────────────────────────
# Plugin A pinned to the release tag below (override with OMP_AGENT_REF);
# Plugin B installed LATEST from the repo's default branch.
#
#   curl -fsSL https://raw.githubusercontent.com/rokicool/elon-ko/main/elon_ko.sh | bash
#   curl -fsSL https://raw.githubusercontent.com/rokicool/elon-ko/main/elon_ko.sh | OMP_AGENT_REF=v2.3.1 bash
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
#
# ── LOCAL install mode (-local) ──────────────────────────────────────────────
# Add `-local` to install EVERYTHING under ./.elon-ko/ (a project-local omp home)
# and NOTHING under $HOME: vendored omp/bun in ./.elon-ko/bin/, plugins + the
# marketplace registry in the relocated omp config root (PI_CONFIG_DIR). Activate
# it in a new shell with `source ./.elon-ko/env.sh` (PATH alone is NOT enough).
#
#   bash elon_ko.sh -local                       # LOCAL stable install
#   bash elon_ko.sh -local pr-dev-abc1234        # LOCAL pre-release install
#   bash elon_ko.sh -local uninstall             # remove ./.elon-ko/ only
#   bash elon_ko.sh --local                      # alias for -local
#
# There is NO -global flag: omitting -local means global (the default). Flags are
# position-agnostic (before or after the positional). "local" is overloaded here:
# LOCAL install mode = WHERE artifacts land (./.elon-ko/); "local marketplace" =
# HOW a pre-release Plugin B is sourced (a kept tarball). See the table header.
#
# ── Uninstall (pass `uninstall`) ─────────────────────────────────────────────
# Removes everything elon-ko-specific: BOTH plugins + the marketplace under their
# current names AND the pre-v2.0.0 branding (omp-agent-gate, orchestrator-agents,
# marketplace @omp-agent-template), plus the elon-ko-only pre-release source cache.
# omp and bun are left in place. Each step is a tolerant no-op if already absent.
#
#   bash elon_ko.sh uninstall                    # remove the GLOBAL install only
#   bash elon_ko.sh -local uninstall             # remove the LOCAL install only
# Works on a clean machine, in a docker container, and on a machine where an
# earlier (stable OR pre-release) version is already installed — every step is
# idempotent, and the marketplace is re-registered each run so it always points
# at the source selected by the mode.
set -euo pipefail

REPO="rokicool/elon-ko"
MARKETPLACE="elon-ko"        # value of marketplace.json#name
PLUGIN_B="elon-ko-agents"

have() { command -v "$1" >/dev/null 2>&1; }

say()  { printf '\n== %s ==\n' "$*"; }
ok()   { printf '  ✓ %s\n' "$*"; }
warn() { printf '  ! %s\n' "$*"; }
die()  { printf '  ✗ %s\n' "$*" >&2; exit 1; }

# §2.4 usage block (emitted on usage-class errors). The first line of a usage
# error still carries die's `✗` prefix (usage_die below); this is the help text.
print_usage() { cat >&2 <<'USAGE'
============================================================
  elon_ko.sh — installer for the elon-ko plugin set.

  Usage: elon_ko.sh [-local|--local] [uninstall | <pre-release-tag>]

    (no args)                 GLOBAL stable install (default; current behavior)
    <pre-release-tag>         GLOBAL pre-release install (pin both plugins to tag)
    uninstall                 remove the GLOBAL install only
    -local                    LOCAL install  → everything under ./.elon-ko/, nothing under $HOME
    -local <pre-release-tag>  LOCAL pre-release install
    -local uninstall          remove the LOCAL install (./.elon-ko/) only
    --local                   alias for -local

  There is NO -global flag: no flag means global.
  Flags are position-agnostic and may appear before or after the positional.

  Env:
    OMP_AGENT_REF=<git-ref>     pin Plugin A (elon-ko-gate) to a ref (default v2.3.1)
    OMP_PRERELEASE_DIR=<dir>    override the pre-release source cache dir

  Unknown flags and more than one positional are rejected.
============================================================
USAGE
}

usage_die() { printf '  ✗ %s\n' "$*" >&2; print_usage; exit 1; }

# ── §2.3 multi-arg parser: a mode flag (-local/--local) + ≤1 positional.
# Sets INSTALL_MODE (global|local), SUB_MODE (stable|pre-release|uninstall),
# REF, TAG. `-global`/`--global`/`-l` are NOT valid (unknown flag → die, NFR-5).
INSTALL_MODE=global
SUB_MODE=stable
REF="${OMP_AGENT_REF:-v2.3.1}"
TAG=""
POSITIONAL=""
for arg in "$@"; do
  case "$arg" in
    -local|--local) INSTALL_MODE=local ;;
    -?*)            usage_die "unknown flag: '$arg' (there is no -global; use -local for LOCAL install mode)" ;;  # NFR-5
    *)
      if [ -n "$POSITIONAL" ]; then usage_die "more than one positional argument (got '$POSITIONAL' and '$arg')"; fi
      POSITIONAL="$arg"
      ;;
  esac
done
case "$POSITIONAL" in
  "")           : ;;                          # stable
  uninstall)    SUB_MODE=uninstall ;;
  # Latent-bug fix: set BOTH REF and TAG. The pre-release tarball block + the
  # summaries reference ${TAG} (never REF), but the old parser only set REF, so a
  # global pre-release install aborted under `set -u` ('TAG: unbound variable').
  *)            SUB_MODE=pre-release; REF="$POSITIONAL"; TAG="$POSITIONAL" ;;
esac
# MODE mirrors SUB_MODE for the install flow (stable|pre-release); the uninstall
# path keys off SUB_MODE directly above.
MODE="$SUB_MODE"

# ── §3.1 mode-dependent path setup (set once, after parsing).
if [ "$INSTALL_MODE" = local ]; then
  OMP_LOCAL_HOME="$PWD/.elon-ko"        # absolute; $PWD has no trailing slash
  # §5.2 PI_CONFIG_DIR derivation (R1): path.join(os.homedir(), PI_CONFIG_DIR)
  # must equal $OMP_LOCAL_HOME. omp joins with NO validation, so an absolute
  # value would nest (not override) — the outside-$HOME case climbs with "../".
  LOCAL_OUTSIDE_HOME=0
  case "$PWD" in
    "$HOME"|"$HOME"/*)
      # PWD is $HOME or inside it → clean subpath, no ".."
      sub="${PWD#"$HOME"}"          # "" if PWD==$HOME, else "/github/elon-ko"
      sub="${sub#/}"                # "" or "github/elon-ko"
      if [ -n "$sub" ]; then
        PI_CONFIG_DIR="$sub/.elon-ko"
      else
        PI_CONFIG_DIR=".elon-ko"    # PWD == $HOME
      fi
      ;;
    *)
      # PWD is outside $HOME → climb out of $HOME one "../" per segment, then the
      # target. path.join() normalizes the ".." on omp's side (RESEARCH F2).
      LOCAL_OUTSIDE_HOME=1
      warn "LOCAL install mode: project lives outside \$HOME — PI_CONFIG_DIR will use leading '..' (works only because omp does not validate it; see SPEC R-B)."
      dots=""
      seg="$HOME"
      while [ "$seg" != "/" ] && [ -n "$seg" ]; do
        dots="../$dots"
        seg="${seg%/*}"
      done
      rel="${OMP_LOCAL_HOME#/}"     # strip leading slash for a clean join
      PI_CONFIG_DIR="${dots}${rel}"
      ;;
  esac
  export PI_CONFIG_DIR
  # Dual-knob (§5.4): XDG_DATA_HOME relocates omp's NATIVE module + the data
  # category (plugins/), which PI_CONFIG_DIR alone does NOT move. omp's native
  # loader (node_modules/@oh-my-pi/pi-natives/native/loader-state.js:51-57
  # getNativesDir) IGNORES PI_CONFIG_DIR and only honors XDG_DATA_HOME, gated on
  # fs.existsSync($XDG_DATA_HOME/omp). That gate dir is pre-created in L1; without
  # it omp silently falls back to ~/.omp/natives/ (D1 root cause). Side benefit:
  # cleanupStaleNativeVersions now runs against the LOCAL natives dir, so a LOCAL
  # run can no longer prune the global omp's native versions.
  export XDG_DATA_HOME="$OMP_LOCAL_HOME"
  export BUN_INSTALL="$OMP_LOCAL_HOME"
  export PI_INSTALL_DIR="$OMP_LOCAL_HOME/bin"
  export PATH="$OMP_LOCAL_HOME/bin:$PATH"
  PRERELEASE_BASE="$OMP_LOCAL_HOME/prerelease"     # §3.1 LOCAL ignores OMP_PRERELEASE_DIR (cache is project-local)
  MARKER_PATH="$OMP_LOCAL_HOME/.install.json"
else
  PRERELEASE_BASE="${OMP_PRERELEASE_DIR:-$HOME/.omp-prerelease}"   # unchanged
  # Installers drop their binaries in these dirs; put them on PATH up front so the
  # rest of THIS script can call omp/bun in the same invocation.
  export PATH="$HOME/.local/bin:$HOME/.bun/bin:$PATH"
  MARKER_PATH="$HOME/.omp/elon-ko.install.json"
fi

# §6.3 trapped-HOME: run an installer subprocess with HOME=$OMP_LOCAL_HOME so any
# rc edit (~/.zshrc etc.) or ~/.bun write lands inside the project tree and is
# discarded. BUN_INSTALL/PI_INSTALL_DIR override the install dir regardless of
# HOME. Used only by the LOCAL install flow (L4/L5).
rc_guard() { env HOME="$OMP_LOCAL_HOME" BUN_INSTALL="$OMP_LOCAL_HOME" PI_INSTALL_DIR="$OMP_LOCAL_HOME/bin" "$@"; }

# §8.2 atomic marker writer (shared by both modes). Args:
#   mode marker_path marketplace_source omp_home bin_dir ref sub_mode
write_marker() {
  local mode="$1" mpath="$2" mkt="$3" omp_home="$4" bin_dir="$5" ref="$6" sub="$7"
  local tmp="${mpath}.tmp.$$"
  mkdir -p "$(dirname "$mpath")"
  cat > "$tmp" <<EOF
{
  "schema": "elon-ko.install/1",
  "mode": "$mode",
  "sub_mode": "$sub",
  "ref": "$ref",
  "marketplace_source": "$mkt",
  "installed_at": "$(date -u +%Y-%m-%dT%H:%M:%SZ)",
  "paths": {
    "omp_home": "$omp_home",
    "bin": "$bin_dir"
  }
}
EOF
  mv -f "$tmp" "$mpath"
}

# §3 — scaffold deploy (both modes). Deploys <cwd>-relative project-context files that
# omp discovers by cwd-walk, NOT from the omp home (so identical in GLOBAL and LOCAL).
# AGENTS.md is the ONLY omp-auto-loaded scaffold file (agents-md.ts:21-59) — fetch failure
# is fatal. PROTO.md is doc-only — fetch failure is non-fatal. APPEND_SYSTEM.md is NOT
# deployed (D-S2): already load-bearing via Plugin A's bundled default; override is
# documented, not copied.
deploy_scaffold() {                       # arg 1 = deploy ref ($REF)
  local ref="$1" dest tmp
  say "Deploying project-context files to the current directory ($PWD)"
  # AGENTS.md — load-bearing; OVERWRITE ALWAYS (D-S1). Atomic write: tmp + mv.
  tmp="$PWD/.AGENTS.md.tmp.$$"
  if curl -fsSL "https://raw.githubusercontent.com/${REPO}/${ref}/scaffold/AGENTS.md" -o "$tmp"; then
    mv -f "$tmp" "$PWD/AGENTS.md"
    ok "AGENTS.md deployed → $PWD/AGENTS.md (overwrite-always; omp auto-loads it via walk-up from cwd)"
  else
    rm -f "$tmp" 2>/dev/null || true
    die "failed to fetch AGENTS.md from ${REPO}@${ref}. This is the one omp-auto-loaded steering \
file (discovery/agents-md.ts:21-59) — without it the orchestrator context is missing from this \
project. Check the ref/tag and your network, then re-run."
  fi
  # PROTO.md — doc-only (no omp auto-load); OVERWRITE ALWAYS (§3.3) for ref-resolution.
  tmp="$PWD/.PROTO.md.tmp.$$"
  if curl -fsSL "https://raw.githubusercontent.com/${REPO}/${ref}/scaffold/PROTO.md" -o "$tmp"; then
    mv -f "$tmp" "$PWD/PROTO.md"
    ok "PROTO.md deployed → $PWD/PROTO.md (doc-only; read on demand; never omp-auto-loaded)"
  else
    rm -f "$tmp" 2>/dev/null || true
    warn "PROTO.md could not be fetched from ${REPO}@${ref} — 'see PROTO.md' cross-refs will not resolve. Non-fatal (PROTO.md is doc-only)."
  fi
}

# ── uninstall mode (mode-scoped, §9) ──────────────────────────────────────────
# Removes everything elon-ko-specific. LOCAL uninstall scopes to $OMP_LOCAL_HOME
# only; GLOBAL uninstall scopes to the global omp home. Both are tolerant no-ops
# when the target is already gone, and both leave omp/bun runtimes and the
# per-project opt-in markers (.omp/elon.json, user data) untouched.
if [ "$SUB_MODE" = "uninstall" ]; then
  if [ "$INSTALL_MODE" = local ]; then
    # §9.1 LOCAL uninstall — scope: $OMP_LOCAL_HOME only; MUST NOT touch $HOME.
    say "Uninstalling elon-ko LOCAL install (./.elon-ko/)"
    if [ ! -d "$OMP_LOCAL_HOME" ]; then
      printf '  No LOCAL install found at ./.elon-ko/; nothing to do.\n'
      exit 0
    fi
    # Best-effort omp-registry cleanup against the LOCAL home, so a running omp
    # (if any) drops its in-memory entries. Each step tolerant (|| true). PI_CONFIG_DIR
    # is already exported, so these calls resolve to $OMP_LOCAL_HOME.
    if [ -x "$OMP_LOCAL_HOME/bin/omp" ]; then
      export PATH="$OMP_LOCAL_HOME/bin:$PATH"
      omp plugin uninstall elon-ko-gate                >/dev/null 2>&1 || true
      omp plugin uninstall elon-ko-agents              >/dev/null 2>&1 || true
      omp plugin uninstall elon-ko-agents@elon-ko      >/dev/null 2>&1 || true
      omp plugin uninstall omp-agent-gate              >/dev/null 2>&1 || true
      omp plugin uninstall orchestrator-agents         >/dev/null 2>&1 || true
      omp plugin uninstall orchestrator-agents@omp-agent-template >/dev/null 2>&1 || true
      omp plugin marketplace remove elon-ko            >/dev/null 2>&1 || true
      omp plugin marketplace remove omp-agent-template >/dev/null 2>&1 || true
    fi
    # Removes plugins, marketplace registry, vendored bins, agent state, prerelease
    # cache, marker, env.sh — the whole relocated home (incl. the marker itself).
    rm -rf "$OMP_LOCAL_HOME"
    cat <<EOF

============================================================
  elon-ko LOCAL install removed (./.elon-ko/).

  Removed — the whole relocated omp home under ./.elon-ko/ (plugins, marketplace
  registry, vendored omp/bun binaries, agent state, prerelease cache, marker,
  env.sh).

  The GLOBAL install (~/.omp/), if any, is untouched. Shared runtimes (a global
  omp/bun) outside the project are left in place. Per-project opt-in markers
  (.omp/elon.json) are user data and are left untouched.
  Project-context files (AGENTS.md, PROTO.md) in the current directory are left in
  place — remove them manually if desired.
============================================================
EOF
    exit 0
  else
    # §9.2 GLOBAL uninstall — byte-identical to the pre-change uninstall, plus
    # (1) GLOBAL marker removal and (2) a courtesy notice if a LOCAL install
    # coexists. MUST NOT touch ./.elon-ko.
    say "Uninstalling elon-ko (current + pre-v2.0.0 branding)"
    if ! have omp; then
      warn "omp not found — nothing to uninstall (the plugins require omp)."
      exit 0
    fi
    # current names (v2.0.0+)
    omp plugin uninstall elon-ko-gate                >/dev/null 2>&1 || true
    omp plugin uninstall elon-ko-agents              >/dev/null 2>&1 || true
    omp plugin uninstall elon-ko-agents@elon-ko      >/dev/null 2>&1 || true
    # pre-v2.0.0 branding (omp-agent-template → elon-ko)
    omp plugin uninstall omp-agent-gate              >/dev/null 2>&1 || true
    omp plugin uninstall orchestrator-agents         >/dev/null 2>&1 || true
    omp plugin uninstall orchestrator-agents@omp-agent-template >/dev/null 2>&1 || true
    # marketplaces (current + legacy)
    omp plugin marketplace remove elon-ko            >/dev/null 2>&1 || true
    omp plugin marketplace remove omp-agent-template >/dev/null 2>&1 || true
    # pre-release source cache (elon-ko-only; orphaned once the marketplace is gone)
    if [ -n "${PRERELEASE_BASE:-}" ] && [ -d "$PRERELEASE_BASE" ]; then
      rm -rf "$PRERELEASE_BASE"
      ok "removed pre-release source cache ($PRERELEASE_BASE)"
    fi
    # (1) GLOBAL mode marker (FR-9/D4) — elon-ko-only, removed with the install.
    rm -f "$HOME/.omp/elon-ko.install.json" 2>/dev/null || true
    cat <<EOF

============================================================
  elon-ko uninstalled.

  Removed — current names (v2.0.0+):
    • elon-ko-gate, elon-ko-agents, marketplace @elon-ko
  Removed — pre-v2.0.0 branding:
    • omp-agent-gate, orchestrator-agents, marketplace @omp-agent-template
  Removed — pre-release source cache (if present):
    • ${PRERELEASE_BASE:-~/.omp-prerelease}

  Anything that was never installed was a silent no-op. oh-my-pi (omp) and
  bun are left in place — they are shared runtimes, not elon-ko-specific.
  Per-project opt-in markers (.omp/elon.json) are left untouched (user data).
  Project-context files (AGENTS.md, PROTO.md) in the current directory are left in
  place — remove them manually if desired.
============================================================
EOF
    # (2) courtesy notice if a LOCAL install coexists (NOT removed; §9.2).
    if [ -f "./.elon-ko/.install.json" ] || [ -d "./.elon-ko" ]; then
      printf '\n  Note: a LOCAL elon-ko install still exists at ./.elon-ko/ (unaffected).\n  Remove it with: bash elon_ko.sh -local uninstall\n'
    fi
    exit 0
  fi
fi

# ── unzip (required by the bun installer) ────────────────────────────────────
# Both install paths below pull in bun — omp.sh (--source) and bun.sh — and
# bun's installer shells out to `unzip` to extract its archive. A truly minimal
# box (fresh container/VM) may lack unzip, which fails the WHOLE install with
# "error: unzip is required to install bun". Detect it up front and install it
# via the system package manager when that can be done non-interactively (root,
# or passwordless sudo); otherwise fail with a clear, actionable message rather
# than letting bun's installer fail opaquely mid-stream. (macOS ships unzip.)
say "Checking for unzip (required by the bun installer)"
if have unzip; then
  ok "unzip present"
else
  warn "unzip not found — attempting to install via the system package manager"
  unzip_ok=0
  if [ "$(id -u)" -eq 0 ]; then
    # root (container/VM) — no sudo needed
    if   have apt-get; then apt-get update -qq && apt-get install -y unzip && unzip_ok=1 || true
    elif have dnf;     then dnf install -y unzip && unzip_ok=1 || true
    elif have yum;     then yum install -y unzip && unzip_ok=1 || true
    elif have apk;     then apk add --no-cache unzip && unzip_ok=1 || true
    fi
  elif command -v sudo >/dev/null 2>&1 && sudo -n true 2>/dev/null; then
    # passwordless sudo (a non-interactive `curl|bash` can't type a sudo password)
    if   have apt-get; then sudo apt-get update -qq && sudo apt-get install -y unzip && unzip_ok=1 || true
    elif have dnf;     then sudo dnf install -y unzip && unzip_ok=1 || true
    elif have yum;     then sudo yum install -y unzip && unzip_ok=1 || true
    elif have apk;     then sudo apk add --no-cache unzip && unzip_ok=1 || true
    fi
  elif have brew; then
    # macOS/Homebrew user-local install — no sudo
    brew install unzip && unzip_ok=1 || true
  fi
  if [ "$unzip_ok" -ne 1 ] || ! have unzip; then
    die "unzip is required (the bun installer needs it to extract its archive) and could not be installed automatically. Install it manually and re-run, e.g.:
  apt-get install -y unzip   |   dnf install -y unzip   |   apk add unzip   |   brew install unzip"
  fi
  ok "unzip installed"
fi

GH_A="github:${REPO}${REF:+#$REF}"       # Plugin A source (always pinned to REF)

if [ "$INSTALL_MODE" = local ]; then
  # ── LOCAL install flow (§4.2, FR-2/NFR-4) ──────────────────────────────────
  # Everything below lands under $OMP_LOCAL_HOME (PI_CONFIG_DIR + XDG_DATA_HOME
  # + BUN_INSTALL + PI_INSTALL_DIR exported above). Nothing under $HOME is
  # touched (§6.3 guard + the dual-knob natives relocation, §5.4).

  # L0: precondition — writable cwd (tar/curl already required by this script).
  [ -w "$PWD" ] || die "LOCAL install mode requires a writable current directory ($PWD)."

  # L1: create the local tree. The `omp` subdir is the XDG gate dir: omp's
  # native loader (loader-state.js:51-57) AND its DirResolver data-category
  # branch both relocate ONLY when fs.existsSync($XDG_DATA_HOME/omp) is true,
  # else they fall back to ~/.omp. Pre-creating it makes the dual-knob take
  # effect; without it the fix silently fails (D1). plugins/ and natives/ are
  # then created by omp itself under $OMP_LOCAL_HOME/omp/.
  mkdir -p "$OMP_LOCAL_HOME/bin" "$OMP_LOCAL_HOME/prerelease" "$OMP_LOCAL_HOME/omp"

  # L4: bun — PATH-SCOPED presence (NOT `have bun`, which would find a global
  # bun and skip install — §6.2), wrapped in the rc-guard (§6.3) so the real
  # ~/.zshrc / ~/.bun are never touched.
  if [ -x "$OMP_LOCAL_HOME/bin/bun" ]; then
    ok "bun present (local: $OMP_LOCAL_HOME/bin/bun)"
  else
    warn "bun not found locally — installing into $OMP_LOCAL_HOME (BUN_INSTALL set)…"
    curl -fsSL https://bun.sh/install | rc_guard bash || die "bun installer failed — see https://bun.sh"
    [ -x "$OMP_LOCAL_HOME/bin/bun" ] || die "bun installed but not at $OMP_LOCAL_HOME/bin/bun"
    ok "bun installed (local)"
  fi

  # L5: omp — PATH-SCOPED presence; --binary primary (so omp's install_bun() —
  # which force-sets BUN_INSTALL=$HOME/.bun, RESEARCH F6 — never runs), --source
  # fallback (bun is already present locally, so install_bun() is skipped). Both
  # rc-guarded. omp.sh/install honors PI_INSTALL_DIR for the binary location.
  if [ -x "$OMP_LOCAL_HOME/bin/omp" ]; then
    ok "omp present (local: $OMP_LOCAL_HOME/bin/omp)"
  else
    warn "omp not found locally — installing via omp.sh (--binary)…"
    if curl -fsSL https://omp.sh/install | rc_guard sh -s -- --binary; then :; else
      warn "--binary failed; retrying --source (bun already present locally)…"
      curl -fsSL https://omp.sh/install | rc_guard sh -s -- --source || die "omp installer failed — see https://omp.sh"
    fi
    [ -x "$OMP_LOCAL_HOME/bin/omp" ] || die "omp installed but not at $OMP_LOCAL_HOME/bin/omp"
    ok "omp installed (local)"
  fi

  # §6.3: discard any stray rc/.bun the trapped-HOME installers wrote inside the
  # local tree (bun.sh/install edits $HOME/.zshrc etc. only when -w; with HOME
  # trapped these are $OMP_LOCAL_HOME/.zshrc — created only if they pre-existed,
  # which they never do here. Tolerant regardless.)
  rm -f "$OMP_LOCAL_HOME/.zshrc" "$OMP_LOCAL_HOME/.bashrc" "$OMP_LOCAL_HOME/.profile" "$OMP_LOCAL_HOME/.zprofile" "$OMP_LOCAL_HOME/.bash_profile" 2>/dev/null || true
  rm -rf "$OMP_LOCAL_HOME/.bun" 2>/dev/null || true

  # L6: PI_CONFIG_DIR self-check (§5.3) — MUST pass before any omp plugin call,
  # else die to prevent a silent global write.
  if [ -x "$OMP_LOCAL_HOME/bin/bun" ]; then RUNTIME="$OMP_LOCAL_HOME/bin/bun"
  elif have node; then RUNTIME=node
  else RUNTIME=""
  fi
  if [ -n "$RUNTIME" ]; then
    resolved="$("$RUNTIME" -e \
      'process.stdout.write(require("path").join(require("os").homedir(),process.env.PI_CONFIG_DIR||".omp"))' \
      2>/dev/null || true)"
    if [ -z "$resolved" ] || [ "$resolved" != "$OMP_LOCAL_HOME" ]; then
      die "PI_CONFIG_DIR misconfiguration: omp would resolve its home to '${resolved:-<unset>}' \
(expected '$OMP_LOCAL_HOME'). Aborting BEFORE any omp plugin call to avoid a global write. \
Re-run from the project root, or report this if the project lives outside \$HOME."
    fi
  fi
  ok "PI_CONFIG_DIR relocates omp home → $OMP_LOCAL_HOME"

  # LOCAL pre-release sub-mode (or stable): resolve the marketplace source. In
  # pre-release this is the "local marketplace" sense (a kept source tarball);
  # stable uses the GitHub default-branch catalog. Output names BOTH senses when
  # both are active (LOCAL install mode + local marketplace registration, §1).
  if [ "$MODE" = "pre-release" ]; then
    say "LOCAL install mode: fetching pre-release '${TAG}' (local marketplace registration — pins Plugin A AND Plugin B to this tag)"
    have tar || die "'tar' is required for a pre-release install"
    extract_dir="$PRERELEASE_BASE/$TAG"
    tarball_url="https://github.com/${REPO}/archive/${TAG}.tar.gz"
    rm -rf "$extract_dir"
    mkdir -p "$extract_dir"
    curl -fsSL "$tarball_url" | tar -xz -C "$extract_dir" \
      || die "failed to fetch pre-release '${TAG}' from ${tarball_url} — does the tag exist?"
    # GitHub's archive extracts to a single top-level dir; resolve it dynamically
    # (its name depends on the ref — e.g. v2.3.1 → elon-ko-2.3.1).
    MKT_SOURCE="$(find "$extract_dir" -mindepth 1 -maxdepth 1 -type d | head -n1)"
    [ -n "$MKT_SOURCE" ] && [ -f "$MKT_SOURCE/.omp-plugin/marketplace.json" ] \
      || die "pre-release '${TAG}' tarball has no marketplace (.omp-plugin/marketplace.json)"
    ok "pre-release extracted (local marketplace) → ${MKT_SOURCE}"
  else
    MKT_SOURCE="${REPO}"                  # github owner/repo → tracks default branch
  fi

  # L7: marketplace registration (commands unchanged). PI_CONFIG_DIR relocates
  # configRoot, so marketplaces.json → $OMP_LOCAL_HOME/marketplaces.json (§5.3
  # proof). R6: no --scope project / link.
  say "Registering marketplace '${MARKETPLACE}' (${MODE}, local omp home)"
  omp plugin marketplace remove "${MARKETPLACE}" >/dev/null 2>&1 || true
  omp plugin marketplace add "${MKT_SOURCE}" || die "marketplace add failed for '${MKT_SOURCE}'"
  ok "marketplace registered (${MKT_SOURCE})"
  if [ "$MODE" = "stable" ]; then
    omp plugin marketplace update "${MARKETPLACE}" >/dev/null 2>&1 \
      || warn "marketplace update failed — catalog may be stale; re-run elon_ko.sh"
  fi

  # L8: Plugin A (commands unchanged) → $OMP_LOCAL_HOME/omp/plugins/ (data
  # category, redirected by XDG_DATA_HOME + the gate dir created in L1).
  say "Installing Plugin A: elon-ko-gate"
  omp plugin uninstall elon-ko-gate >/dev/null 2>&1 || true
  omp plugin install "${GH_A}" --force || die "Plugin A install failed"
  ok "elon-ko-gate installed (${GH_A})"

  # L9: Plugin B (commands unchanged; --force = idempotent) → $OMP_LOCAL_HOME/omp/plugins/.
  say "Installing Plugin B: ${PLUGIN_B}"
  omp plugin install "${PLUGIN_B}@${MARKETPLACE}" --force || die "Plugin B install failed"
  ok "${PLUGIN_B} installed"

  # §3.2 — deploy scaffold project-context files to <cwd> (both modes identical;
  # cwd-relative, omp-home-independent). Runs after plugins install, before env.sh.
  deploy_scaffold "$REF"

  # L10: emit env.sh (§7.1 exact template; <…> are install-time literals; the
  # PATH line keeps a literal $PATH tail so it composes on source).
  cat > "$OMP_LOCAL_HOME/env.sh" <<EOF
# Generated by elon_ko.sh LOCAL install.
# Source this file from the project root to activate the project-local omp home:
#   source ./.elon-ko/env.sh
# BOTH PI_CONFIG_DIR and XDG_DATA_HOME are REQUIRED. PI_CONFIG_DIR relocates
# omp's config root (marketplaces.json, agent/); XDG_DATA_HOME relocates the
# native module + data category (omp/plugins/, omp/natives/). Without
# XDG_DATA_HOME a later bare \`omp\` loads natives from ~/.omp/natives/ AND runs
# cleanupStaleNativeVersions there, deleting the global omp's native versions.
# Do not edit by hand; re-run \`bash elon_ko.sh -local\` to regenerate.
export PI_CONFIG_DIR='$PI_CONFIG_DIR'
export XDG_DATA_HOME='$OMP_LOCAL_HOME'
export PATH='$OMP_LOCAL_HOME/bin:\$PATH'
export BUN_INSTALL='$OMP_LOCAL_HOME'
export PI_INSTALL_DIR='$OMP_LOCAL_HOME/bin'
EOF

  # L11: write the LOCAL mode marker (D4/FR-9, §8.2).
  write_marker local "$MARKER_PATH" "$MKT_SOURCE" "$OMP_LOCAL_HOME" "$OMP_LOCAL_HOME/bin" "$REF" "$SUB_MODE"

  # L13: LOCAL summary (§7.2). Disambiguates "LOCAL install mode" from any
  # "local marketplace" (pre-release) registration; surfaces activation + auth
  # isolation. L12 coexistence notice is emitted inside the block if a GLOBAL
  # install marker coexists.
  cat <<EOF

============================================================
  elon-ko installed — LOCAL install mode (./.elon-ko/).

  Plugins (installed into the project-local omp home):
    • elon-ko-gate      — gate + Definition-of-Done rule
EOF
  if [ "$MODE" = "pre-release" ]; then
    printf "    • elon-ko-agents    — 8 agents + 9 skills (pinned to tag '%s')\n" "$TAG"
    printf "\n  Plugin B was registered as a local marketplace (pre-release tarball) under:\n    %s/prerelease/%s\n" "$OMP_LOCAL_HOME" "$TAG"
  else
    printf '    • elon-ko-agents    — 8 agents + 9 skills (always latest)\n'
  fi
  cat <<'EOF'

  Project-context files deployed to the current directory:
    • AGENTS.md   — omp auto-loads this (walks up from your cwd). Overwritten on every install.
    • PROTO.md    — the orchestrator protocol doc (read on demand; never auto-loaded).
  APPEND_SYSTEM.md is already active (bundled with elon-ko-gate). To customize Elon's framing,
  create .omp/APPEND_SYSTEM.md in this project (it replaces the default).

  Activate this install in your shell (REQUIRED before running omp here):
    source ./.elon-ko/env.sh
  (Quick PATH-only line, NOT sufficient on its own — PI_CONFIG_DIR is needed too:
    export PATH="$PWD/.elon-ko/bin:$PATH")

  The gate is dormant until a project opts in:
    echo '{"enabled": true}' > .omp/elon.json

  NOTE: omp's auth is NOT shared with your global omp. The first `omp` run in this
  project will need to authenticate (or copy credentials from ~/.omp/agent).
EOF
  # L12: coexistence notice (exactly one line, §10.2) if a GLOBAL install exists.
  if [ -f "$HOME/.omp/elon-ko.install.json" ]; then
    printf '\n  Note: a GLOBAL elon-ko install also exists at ~/.omp/ (unaffected).\n'
  fi
  printf '============================================================\n'

else
  # ── GLOBAL install flow — byte-identical to the pre-change script (§4.1),
  # plus two additive FR-mandated items at the end (marker write + coexistence
  # notice). On a clean machine (no ./.elon-ko) output is byte-identical to today.

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
# (its name depends on the ref — e.g. v2.3.1 → elon-ko-2.3.1).
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
  # Stable mode tracks the repo's default branch, so force-refresh the catalog
  # after add: `omp plugin marketplace add` reuses a previously-cached clone
  # instead of re-fetching, which silently serves a STALE marketplace (e.g. an
  # older agents roster missing a newly-published agent like `wrapper`). `update`
  # re-pulls HEAD so the install reflects the current source tree.
  # Pre-release mode deliberately skips this — `update` would pull the default
  # branch and overwrite the pinned tag with latest.
  if [ "$MODE" = "stable" ]; then
    omp plugin marketplace update "${MARKETPLACE}" >/dev/null 2>&1 \
      || warn "marketplace update failed — catalog may be stale; re-run elon_ko.sh"
  fi

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

  # §3.2 — deploy scaffold project-context files to <cwd> (both modes identical).
  deploy_scaffold "$REF"

  # ── summary ──────────────────────────────────────────────────────────────────
  if [ "$MODE" = "pre-release" ]; then
    cat <<EOF

============================================================
  elon-ko installed — PRE-RELEASE '${TAG}'.

  Both plugins are pinned to tag '${TAG}':
    • elon-ko-gate         — gate + Definition-of-Done rule
    • elon-ko-agents    — 8 agents + 9 skills (from the tag, not latest)

  Plugin B was registered as a LOCAL marketplace from:
    ${MKT_SOURCE}
  (kept under ${PRERELEASE_BASE}; omp references it in place.)

  To return to the latest STABLE release, re-run without a tag:
    bash elon_ko.sh

  Project-context files deployed to the current directory:
    • AGENTS.md   — omp auto-loads this (walks up from your cwd). Overwritten on every install.
    • PROTO.md    — the orchestrator protocol doc (read on demand; never auto-loaded).
  APPEND_SYSTEM.md is already active (bundled with elon-ko-gate). To customize Elon's framing,
  create .omp/APPEND_SYSTEM.md in this project (it replaces the default).

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
    • elon-ko-agents    — 8 agents + 9 skills (always latest)

  Project-context files deployed to the current directory:
    • AGENTS.md   — omp auto-loads this (walks up from your cwd). Overwritten on every install.
    • PROTO.md    — the orchestrator protocol doc (read on demand; never auto-loaded).
  APPEND_SYSTEM.md is already active (bundled with elon-ko-gate). To customize Elon's framing,
  create .omp/APPEND_SYSTEM.md in this project (it replaces the default).

  The gate is dormant until a project opts in:
    echo '{"enabled": true}' > .omp/elon.json

  If 'omp'/'bun' aren't found in a NEW shell, add to your PATH:
    export PATH="\$HOME/.local/bin:\$HOME/.bun/bin:\$PATH"
============================================================
EOF
  fi

  # FR-9/D4 (additive 1): write the GLOBAL mode marker. ~ already exists (populated
  # by the install above); this adds one FILE under an existing global dir, not a
  # new global directory (AC-1 "no new global paths" = no new DIRS).
  write_marker global "$MARKER_PATH" "$MKT_SOURCE" "$HOME/.omp" "$HOME/.local/bin" "$REF" "$SUB_MODE"

  # §10.2/D5 (additive 2): courtesy notice if a LOCAL install coexists. Exactly
  # one line; on a clean machine (no ./.elon-ko) nothing is printed (byte-identical).
  if [ -f "./.elon-ko/.install.json" ]; then
    printf '\n  Note: a LOCAL elon-ko install also exists at ./.elon-ko/ (unaffected).\n'
  fi
fi
