# Technical Specification — `elon_ko.sh` LOCAL / GLOBAL install modes

| | |
|---|---|
| **Phase** | SPEC (design only — no code changes in this phase) |
| **Status** | REVISED (RESOLVE c1: D1 dual-knob — §5.4 lifts the §12/§17 XDG ban for LOCAL mode) |
| **Date** | 2026-06-30 |
| **Author** | LeadDev (SPEC phase) |
| **Anchored to** | `.app/REQ.md` (GRILL COMPLETE; D1–D5 final; 12 ACs; FR-1..FR-15; NFR-1..NFR-5), `.app/RESEARCH.md` (DrPe GO verdict; R1–R6 binding; F1–F8) |
| **Primary file changed** | `elon_ko.sh` (the repo's install script — note: real filename uses an underscore, `elon_ko.sh`, **not** `elon-ko.sh`) |
| **Downstream consumers** | DEVELOP (MidDev implements from this spec), VALIDATE (Validator audits against §14) |

> **Reading order for implementers:** §2 (CLI) → §4.2 (LOCAL flow) → §5 (PI_CONFIG_DIR) →
> §5.4 (dual-knob / D1 resolution) → §6 (binaries) → §7 (env.sh) → §15 (file:line change map). For validators: jump to §14.

---

## 0. Authority & what this spec locks

**Locked inputs — NOT re-openable by DEVELOP or VALIDATE:**

- **GRILL decisions D1–D5** (`REQ.md` §"Resolved Decisions") — user intent is final.
- **Research findings R1–R6** (`RESEARCH.md` §"Recommendations") — binding mechanism choices.
- **NFR-1..NFR-5** and **FR-1..FR-15** (`REQ.md`).

This spec's job is to make those decisions *implementable and falsifiable*: it fixes exact
strings, algorithms, file paths, ordering, and the AC→section mapping. Where REQ said "SPEC's
prerogative" (e.g. the exact marker field set), this spec decides. Where RESEARCH said "SPEC
should…", this spec does it.

**The single mechanism decision this spec makes (no alternative retained):** LOCAL mode relocates
omp's state into `./.elon-ko/` via a **dual-knob** — `PI_CONFIG_DIR` (relocates the config root:
`marketplaces.json`, `agent/`, `install-id`) **and** `XDG_DATA_HOME=$OMP_LOCAL_HOME` (relocates the
native module + the `data` category: `omp/plugins/`, `omp/natives/`). Both are exported at L2 and
re-exported by `./.elon-ko/env.sh` on every subsequent run (R3). omp offers no plugins-only flag
(`RESEARCH.md` F1, F8); the dual-knob is the only path that satisfies the user's literal "nothing
global" (NFR-4/AC-2), because omp's native loader (`pi-natives/native/loader-state.js:51-57`)
**ignores `PI_CONFIG_DIR`** and only honors `XDG_DATA_HOME` (D1 evidence, §5.4). **This overrides
the prior R6/F4-derived XDG ban (old §12/§17):** that ban rested on the false assumption that
`PI_CONFIG_DIR` relocates natives — disproven by the loader source and the empirical re-proof
(§5.4). User-approved at RESOLVE cycle 1.

---

## 1. Glossary & naming distinction (load-bearing)

The word **"local"** is overloaded in this codebase. The spec and all user-facing output MUST
keep these two senses disambiguated at all times:

| Term | Means | Introduced where |
|---|---|---|
| **LOCAL install mode** (NEW) | *Where artifacts land on disk*: everything under `./.elon-ko/`, nothing under `$HOME`. Selected by `-local`/`--local`. | This feature |
| **local marketplace** (PRE-EXISTING) | *How a pre-release Plugin B is sourced*: a source tarball registered in place, because omp marketplaces cannot be ref-pinned. | `elon_ko.sh:20-22,191-193,261-263` |

**Naming rules (enforced in §2 messages and §7/§4.2 output):**

- A `-local` **stable** install MUST NOT invoke the pre-release tarball path. It installs
  Plugin B from the GitHub default-branch catalog into the LOCAL omp home.
- A **global pre-release** install (`elon_ko.sh <tag>`) STILL registers a "local marketplace"
  under `$OMP_PRERELEASE_DIR` (default `~/.omp-prerelease`) — unaffected by the absence of `-local`.
- When both senses are active at once (LOCAL **and** pre-release: `elon_ko.sh -local <tag>`),
  output must say both explicitly, e.g. *"LOCAL install mode"* **and** *"local marketplace
  registration (pre-release tarball)"*. Never use bare "local" to mean either one.

---

## 2. CLI parsing contract

### 2.1 What changes

The current parser (`elon_ko.sh:47-58`) reads exactly one positional (`ARG="${1:-}"`) and has no
notion of flags. It is replaced by a multi-argument parser that separates a **mode flag** from
at most one **positional**, in any order.

### 2.2 Grammar

```
elon_ko.sh [-local | --local] [POSITIONAL]   # flag and positional in any order
POSITIONAL := uninstall | <pre-release-tag> | <empty>
```

- **Mode flag** `-local` (canonical) and `--local` (alias) → `INSTALL_MODE=local`.
  Absence of the flag → `INSTALL_MODE=global` (the default). **There is no `-global`/`--global`
  flag** (D3). Global is expressed solely by the absence of `-local`.
- **Positional** is at most **one** non-flag argument:
  - `uninstall` → `SUB_MODE=uninstall`
  - any other non-empty non-flag token → `SUB_MODE=pre-release`, `REF=<token>`
  - absent → `SUB_MODE=stable`, `REF=${OMP_AGENT_REF:-v2.3.1}` (unchanged from `elon_ko.sh:57`)
- **Position-agnostic**: `… -local uninstall` ≡ `… uninstall -local`; `… -local <tag>` ≡ `… <tag> -local`.
- **Composition**: `OMP_AGENT_REF=<ref>` env var composes with either mode (orthogonal to the flag).
- **Duplicate known flags** (`-local -local`) are accepted harmlessly (idempotent boolean).
- **≥2 positionals** → `die` with usage (tightening from "ignore extra args"; no documented
  workflow passes >1 positional, so NFR-1 is preserved).
- **Unknown flag** (any token matching `-?*` that is not `-local`/`--local`, e.g. `-foo`,
  `--global`, `-l`) → `die` with usage (NFR-5, strict). Note `-l` is **not** an alias.

### 2.3 Parser algorithm (reference, POSIX sh)

```sh
INSTALL_MODE=global
SUB_MODE=stable
REF="${OMP_AGENT_REF:-v2.3.1}"
POSITIONAL=""
for arg in "$@"; do
  case "$arg" in
    -local|--local) INSTALL_MODE=local ;;
    -?*)            die "<usage>" ;;          # unknown flag (NFR-5)
    *)
      if [ -n "$POSITIONAL" ]; then die "<usage>"; fi   # >1 positional
      POSITIONAL="$arg"
      ;;
  esac
done
case "$POSITIONAL" in
  "")           : ;;                          # stable
  uninstall)    SUB_MODE=uninstall ;;
  *)            SUB_MODE=pre-release; REF="$POSITIONAL" ;;
esac
```

`MODE` (used throughout the current script) becomes a derived composite used only by the
install path: `MODE="$SUB_MODE"` for install flow selection (stable/pre-release), independent of
`INSTALL_MODE`. The uninstall branch keys off `SUB_MODE=uninstall` × `INSTALL_MODE`.

### 2.4 Usage / error message (exact text emitted on `die` for usage-class errors)

```
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
```

The exact banner wording is implementer-adjustable, but it MUST name: both `-local`/`--local`,
the absence of `-global`, position-agnostic behavior, the two `uninstall` forms, and the env
vars. The first line of `die` output keeps the existing `✗` prefix (`elon_ko.sh:65`).

---

## 3. Mode selection & install-target paths

### 3.1 Derived state (set once, near the top, after arg parsing)

| Var | GLOBAL value | LOCAL value |
|---|---|---|
| `INSTALL_MODE` | `global` | `local` |
| `OMP_HOME` (config root omp resolves to) | `~/.omp` (omp default) | `$OMP_LOCAL_HOME` (via `PI_CONFIG_DIR`, §5) |
| `OMP_LOCAL_HOME` | (unused) | `$PWD/.elon-ko` (absolute) |
| `BIN_DIR` (where omp/bun binaries live for this install) | `$HOME/.local/bin` + `$HOME/.bun/bin` | `$OMP_LOCAL_HOME/bin` |
| `PRERELEASE_BASE` | `${OMP_PRERELEASE_DIR:-$HOME/.omp-prerelease}` (unchanged, `elon_ko.sh:45`) | `$OMP_LOCAL_HOME/prerelease` (LOCAL ignores `OMP_PRERELEASE_DIR`; the cache is project-local) |
| `MARKER_PATH` | `$HOME/.omp/elon-ko.install.json` | `$OMP_LOCAL_HOME/.install.json` |

### 3.2 Per-mode artifact targets (same five artifact classes — FR-8)

| Artifact | GLOBAL | LOCAL |
|---|---|---|
| `unzip` (host prerequisite, NFR-3) | system pkg manager (identical handling) | system pkg manager — **identical**; NOT vendored |
| `omp` binary | `$HOME/.local/bin/omp` | `$OMP_LOCAL_HOME/bin/omp` |
| `bun` binary | `$HOME/.bun/bin/bun` | `$OMP_LOCAL_HOME/bin/bun` |
| Plugin A `elon-ko-gate` | `~/.omp/plugins/` | `$OMP_LOCAL_HOME/omp/plugins/` |
| Plugin B `elon-ko-agents` | `~/.omp/` marketplace | `$OMP_LOCAL_HOME/omp/plugins/` (registry at `$OMP_LOCAL_HOME/marketplaces.json`) |
| omp native module (`pi_natives.<plat>.node`) | `~/.omp/natives/<ver>/` | `$OMP_LOCAL_HOME/omp/natives/<ver>/` (via `XDG_DATA_HOME`, §5.4) |
| Pre-release cache (pre-release sub-mode only) | `$HOME/.omp-prerelease/<tag>/` | `$OMP_LOCAL_HOME/prerelease/<tag>/` |
| Mode marker | `$HOME/.omp/elon-ko.install.json` | `$OMP_LOCAL_HOME/.install.json` |

LOCAL relocates; it never omits omp/bun (FR-8: "nothing global" precludes relying on a global omp/bun).

---

## 4. Per-mode install flow

### 4.1 GLOBAL — no-regression contract (FR-1, NFR-1, AC-1)

GLOBAL is the default and MUST be observably identical to the pre-change script. Concretely,
when `INSTALL_MODE=global`, the script executes the **unchanged** code paths:

| Step | Current code | Requirement |
|---|---|---|
| unzip check + system install | `elon_ko.sh:121-158` | byte-identical |
| omp: `have omp` else `omp.sh/install --source` | `elon_ko.sh:160-170` | byte-identical |
| bun: `have bun` else `bun.sh/install` | `elon_ko.sh:172-185` | byte-identical |
| PATH own-run export | `elon_ko.sh:67-69,167,182` | byte-identical |
| marketplace remove/add/update | `elon_ko.sh:213-231` | byte-identical |
| Plugin A uninstall+install `--force` | `elon_ko.sh:233-243` | byte-identical |
| Plugin B install `--force` | `elon_ko.sh:245-248` | byte-identical |
| pre-release tarball resolution | `elon_ko.sh:194-211` | byte-identical |
| summary (stable + pre-release) | `elon_ko.sh:250-289` | byte-identical **except** the additive allowances below |

**Two intentional, FR-mandated additive deviations in GLOBAL (not regressions):**

1. **Mode marker write (FR-9/D4).** A GLOBAL install now also writes
   `$HOME/.omp/elon-ko.install.json`. This is a *file* added under an **existing** global
   directory (`~/.omp`, which GLOBAL already populates). It is **not** a "new global *path*" —
   AC-1's "no new global paths introduced" refers to new *directories*. The marker is the
   single deliberate GLOBAL-side artifact addition; VALIDATE must treat its presence as
   conformant, not as an NFR-1 regression.
2. **Coexistence notice (FR-12/D5, AC-1 "modulo … notice").** If, at the end of a GLOBAL
   install, a LOCAL marker (`./.elon-ko/.install.json`) is detected, print **exactly one** notice
   line (§10.2). On a clean machine (no LOCAL install) GLOBAL output is byte-identical to today.

GLOBAL uses the **same** `omp plugin install`/`marketplace add` commands as today (R6: no
`--scope project`, no `omp plugin link` — those prohibitions apply to LOCAL but GLOBAL already
does the right thing).

### 4.2 LOCAL — full install flow (FR-2, NFR-4)

Ordered steps. Each `omp`/`bun` invocation in this flow runs in an environment where
`PI_CONFIG_DIR`, `BUN_INSTALL`, `PI_INSTALL_DIR`, and `PATH` (with `$OMP_LOCAL_HOME/bin` first)
are exported (set once in step L2, persist for the whole script run).

**L0. Argument/environment precondition.** `OMP_LOCAL_HOME="$PWD/.elon-ko"` (absolute; `$PWD`
has no trailing slash). Require `tar`, `curl` (already used today), and a writable cwd. If
`$PWD` is not writable → `die`.

**L1. Create the local tree.** `mkdir -p "$OMP_LOCAL_HOME"/bin "$OMP_LOCAL_HOME"/prerelease
"$OMP_LOCAL_HOME"/omp`. The `omp` subdir is the **XDG gate dir** (§5.4): omp's native loader and
its `DirResolver` data-category branch relocate only when `fs.existsSync($XDG_DATA_HOME/omp)` is
true; if it is absent, omp silently falls back to `~/.omp/` for natives+plugins and **the fix
fails** (D1 root cause). `omp/plugins/` and `omp/natives/<ver>/` are then created by omp itself
under it (do NOT pre-create those — their existence is the post-install relocation proof, §5.3).

**L2. Derive and export the dual-knob relocation environment (R1/R3 + §5.4).** Compute
`PI_CONFIG_DIR` per §5 and export BOTH relocation vars, along with the bin-vendoring vars:

```sh
export PI_CONFIG_DIR="<per §5>"          # relocates configRoot (marketplaces.json, agent/)
export XDG_DATA_HOME="$OMP_LOCAL_HOME"   # relocates natives + data category (omp/plugins/, omp/natives/)
export BUN_INSTALL="$OMP_LOCAL_HOME"
export PI_INSTALL_DIR="$OMP_LOCAL_HOME/bin"
export PATH="$OMP_LOCAL_HOME/bin:$PATH"
```

`PI_CONFIG_DIR` and `XDG_DATA_HOME` are BOTH required — see §5.4 for why neither alone suffices.

**L3. unzip (identical to GLOBAL, NFR-3).** Run the **unchanged** `elon_ko.sh:129-158` block.
`unzip` is a host prerequisite of the bun installer; LOCAL does NOT vendor it and does NOT
change host handling. If unzip is missing and cannot be system-installed → `die` with the same
message in both modes (`REQ.md` Error Cases row 1).

**L4. Install bun (R2).** Scope the presence check to the **local** path (NOT `have bun`, which
would find a global bun and skip install — see §6.2):

```sh
if [ -x "$OMP_LOCAL_HOME/bin/bun" ]; then
  ok "bun present (local: $(...) )"
else
  warn "bun not found locally — installing into $OMP_LOCAL_HOME (BUN_INSTALL set)…"
  curl -fsSL https://bun.sh/install | bash || die "bun installer failed — see https://bun.sh"
  [ -x "$OMP_LOCAL_HOME/bin/bun" ] || die "bun installed but not at $OMP_LOCAL_HOME/bin/bun"
  ok "bun installed (local)"
fi
```

**RC-MITIGATION (mandatory, see §6.3 + residual risk R-A):** the bun installer may append a
`BUN_INSTALL`/`PATH` export to `~/.zshrc`/`~/.bashrc`/`~/.profile`. Wrap step L4 (and L5) in the
rc-guard defined in §6.3 so no shell rc is modified and nothing is written under the real
`$HOME` by the installer subprocesses.

**L5. Install omp (R2).** Presence-scoped to the local path; use `--binary` + `PI_INSTALL_DIR`
(primary) so omp's `install_bun()` is never invoked (avoids its force-set of
`BUN_INSTALL=$HOME/.bun`, `RESEARCH.md` F6):

```sh
if [ -x "$OMP_LOCAL_HOME/bin/omp" ]; then
  ok "omp present (local: $(...) )"
else
  warn "omp not found locally — installing via omp.sh (--binary)…"
  curl -fsSL https://omp.sh/install | sh -s -- --binary || die "omp installer failed — see https://omp.sh"
  [ -x "$OMP_LOCAL_HOME/bin/omp" ] || die "omp installed but not at $OMP_LOCAL_HOME/bin/omp"
  ok "omp installed (local)"
fi
```

(Alternative mechanism DEVELOP MAY use if `--binary` is unavailable for a target platform: bun
already installed in L4 → run `--source`; because bun is present, omp's `install_bun()` is
skipped and `BUN_INSTALL` is honored. Either way the §6.3 rc-guard + the §5.3 post-install
assertion that `~/.bun` was NOT created are mandatory.)

**L6. PI_CONFIG_DIR self-check (mandatory in LOCAL, §5.3).** Using the now-available
`$OMP_LOCAL_HOME/bin/bun` (or `node` if present), assert `path.join(os.homedir(), PI_CONFIG_DIR)
=== $OMP_LOCAL_HOME`. Mismatch → `die` (prevents a silent global write). Place this AFTER L5,
BEFORE the first `omp plugin …` call.

**L7. Marketplace registration (commands unchanged; land in local home via PI_CONFIG_DIR).**
Identical command sequence to `elon_ko.sh:213-231`:
`omp plugin marketplace remove "$MARKETPLACE"` (tolerant) → `omp plugin marketplace add "$MKT_SOURCE"`
→ if `SUB_MODE=stable`, `omp plugin marketplace update "$MARKETPLACE"` (tolerant). Because
are exported, `marketplaces.json` is written to `$OMP_LOCAL_HOME/marketplaces.json`
(configRoot, relocated by `PI_CONFIG_DIR` — `RESEARCH.md` F3, F5). R6: do NOT add `--scope project`.

**L8. Plugin A (commands unchanged).** Identical to `elon_ko.sh:240-243`:
`omp plugin uninstall elon-ko-gate` (tolerant) → `omp plugin install "$GH_A" --force`. Lands in
`$OMP_LOCAL_HOME/omp/plugins/` (the `data` category, redirected by `XDG_DATA_HOME` + the L1 gate dir).

**L9. Plugin B (commands unchanged).** Identical to `elon_ko.sh:246-248`:
`omp plugin install "$PLUGIN_B@$MARKETPLACE" --force`. Lands in `$OMP_LOCAL_HOME/omp/plugins/`.

**Pre-release sub-mode only (LOCAL + `<tag>`):** the tarball resolution (`elon_ko.sh:194-211`)
runs with `extract_dir="$OMP_LOCAL_HOME/prerelease/$TAG"` (i.e. `PRERELEASE_BASE` from §3.1),
so the local marketplace is registered from `$OMP_LOCAL_HOME/prerelease/<tag>/<topdir>`. Output
disambiguates both "local" senses (§1).

**L10. Emit `./.elon-ko/env.sh` (D2/R3, §7).** Write the activation file (exact contents §7.1).

**L11. Write the mode marker (D4/FR-9, §8).** Write `$OMP_LOCAL_HOME/.install.json`.

**L12. Coexistence notice (D5/FR-12, §10.2).** If a GLOBAL marker
(`$HOME/.omp/elon-ko.install.json`) exists, print exactly one notice line.

**L13. Summary (LOCAL block, §7.2).** Print the LOCAL summary: the `source ./.elon-ko/env.sh`
instruction (PRIMARY, because PATH alone is insufficient — R3), the quick `export PATH=…` line,
the auth-isolation note (R5), and the coexistence notice if applicable.

---

## 5. `PI_CONFIG_DIR` derivation (R1)

### 5.1 Requirement

`PI_CONFIG_DIR` must satisfy
`path.join(os.homedir(), PI_CONFIG_DIR) === "$OMP_LOCAL_HOME"` (absolute), because omp computes
`configRoot = path.join(os.homedir(), PI_CONFIG_DIR || ".omp")` with **no validation** on the
value (`RESEARCH.md` F1, F2). An absolute value does NOT override — it gets nested — so the
outside-`$HOME` case MUST use leading `..` segments, not an absolute path.

### 5.2 Reference algorithm (POSIX sh; `$PWD` and `$HOME` are absolute, no trailing slash)

```sh
OMP_LOCAL_HOME="$PWD/.elon-ko"
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
    # PWD is outside $HOME → climb out of $HOME with one "../" per segment, then the target.
    # path.join() normalizes the ".." on omp's side (RESEARCH.md F2).
    LOCAL_OUTSIDE_HOME=1
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
```

Worked examples (all verified against Node `path.join` semantics):

| `$HOME` | `$PWD` | `OMP_LOCAL_HOME` | derived `PI_CONFIG_DIR` | `path.join(homedir, …)` |
|---|---|---|---|---|
| `/Users/alice` | `/Users/alice/github/elon-ko` | `/Users/alice/github/elon-ko/.elon-ko` | `github/elon-ko/.elon-ko` | `/Users/alice/github/elon-ko/.elon-ko` ✓ |
| `/Users/alice` | `/Users/alice` | `/Users/alice/.elon-ko` | `.elon-ko` | `/Users/alice/.elon-ko` ✓ |
| `/Users/alice` | `/tmp/proj` | `/tmp/proj/.elon-ko` | `../../tmp/proj/.elon-ko` | `/tmp/proj/.elon-ko` ✓ |

### 5.3 Mandatory self-check (LOCAL only)

After L5 (binaries available), before the first `omp plugin …` call:

```sh
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
```

This is the **primary** guard against a silent global write. The **secondary** (always
available, no runtime needed) post-install assertions are: after L9,
[ -f "$OMP_LOCAL_HOME/marketplaces.json" ] (proves configRoot relocated — `marketplaces.json`
is written to configRoot, `RESEARCH.md` F3), [ -d "$OMP_LOCAL_HOME/omp/plugins" ] (proves the
`data` category relocated via `XDG_DATA_HOME`), and — the D1-specific proof — the local native
module exists at `$OMP_LOCAL_HOME/omp/natives/<ver>/pi_natives.<platform>.node` (§5.4), AND the
enumerated global paths are unchanged incl. `~/.omp/natives/` (§14 AC-2). The natives check is
load-bearing: if the L1 gate dir were missing, natives would land in `~/.omp/natives/` instead.

### 5.4 The dual-knob: why `XDG_DATA_HOME` is also required (D1 resolution)

**D1 root cause (empirically proven, RESOLVE cycle 1).** omp's native module —
`pi_natives.<platform>.node`, ~130 MB — is resolved by a loader that lives in
`@oh-my-pi/pi-natives/native/loader-state.js`, NOT by `dirs.ts`. That loader's `getNativesDir()`
(loader-state.js:51-57) is:

```js
function getNativesDir() {
    const xdgDataHome = process.env.XDG_DATA_HOME;
    if (xdgDataHome && fs.existsSync(path.join(xdgDataHome, "omp"))) {
        return path.join(xdgDataHome, "omp", "natives");
    }
    return path.join(os.homedir(), ".omp", "natives");
}
```

It **ignores `PI_CONFIG_DIR` entirely** and honors only `XDG_DATA_HOME`, gated on
`$XDG_DATA_HOME/omp` existing on disk. The `getNativesDir()` in `pi-utils/src/dirs.ts:624`
(`dirs.rootSubdir("natives","cache")`, which DOES honor `PI_CONFIG_DIR`) is a **different, unused
function** — it misled RESEARCH F1 and the original SPEC §11/§12. The loader also calls
`cleanupStaleNativeVersions({ nativesDir, currentVersion })` (loader-state.js:189-209, invoked at
:652) which `rm -rf`s every sibling version dir under `nativesDir` except the current one.

**Consequence for LOCAL mode:** with `PI_CONFIG_DIR` alone, every `omp` invocation in the project
still stages its native module to `~/.omp/natives/<ver>/` and prunes the global omp's other native
versions — a direct NFR-4/AC-2 violation AND a cross-mode pruning hazard. This is defect D1.

**Resolution (user-approved option (d), dual-knob).** Export `XDG_DATA_HOME=$OMP_LOCAL_HOME` AND
pre-create `$OMP_LOCAL_HOME/omp` (L1) so the loader's `existsSync` gate passes. Then:

- natives → `$OMP_LOCAL_HOME/omp/natives/<ver>/pi_natives.<platform>.node`
- `cleanupStaleNativeVersions` runs against `$OMP_LOCAL_HOME/omp/natives/` → the global
  `~/.omp/natives/` is never pruned (bonus: the pruning hazard is **eliminated**, not just avoided).

The SAME `$XDG_DATA_HOME/omp` gate (with `APP_NAME="omp"`) also drives omp's `DirResolver`
data-category branch (`dirs.ts` F4), so the `data` category — including `plugins/` — relocates to
`$OMP_LOCAL_HOME/omp/` under the same knob. One pre-created dir satisfies both gates.

**`env.sh` MUST re-export `XDG_DATA_HOME`** (not just at install time): the loader runs on EVERY
`omp` start, so a later bare `omp` without `XDG_DATA_HOME` would load+prune `~/.omp/natives/` again.

**Accepted cost (overrides old §12/§17).** `XDG_DATA_HOME` is a system-wide convention; sourcing
`env.sh` redirects the `data` category of *every* XDG-aware tool in that shell, not only omp. The
prior R6/F4-derived XDG ban is **lifted for LOCAL mode** on this evidence-justified, user-approved
basis. GLOBAL mode is unaffected (never exports `XDG_DATA_HOME`). Surfaced as residual risk R-F.

---

## 6. Binary vendoring & installer ordering (R2)

### 6.1 Ordering (binding)

LOCAL MUST install in this order — **bun before omp** — and both MUST see the L2 exports:

1. mkdir tree incl. the `omp` XDG gate dir (L1)
2. export `PI_CONFIG_DIR`, `XDG_DATA_HOME=$OMP_LOCAL_HOME`, `BUN_INSTALL=$OMP_LOCAL_HOME`,
   `PI_INSTALL_DIR=$OMP_LOCAL_HOME/bin`, `PATH` with local bin first (L2)
3. unzip (L3)
4. **bun** install (L4) — `BUN_INSTALL` honored → bun at `$OMP_LOCAL_HOME/bin/bun`
5. **omp** install (L5) — `--binary` + `PI_INSTALL_DIR` → omp at `$OMP_LOCAL_HOME/bin/omp`
   (install_bun() never runs; the `BUN_INSTALL=$HOME/.bun` force-set trap is sidestepped)
6. PI_CONFIG_DIR self-check (L6)
7. omp plugin/marketplace calls (L7–L9) — all writes resolve to `$OMP_LOCAL_HOME`

### 6.2 Presence checks are PATH-SCOPED, not PATH-searched (critical correctness rule)

GLOBAL uses `have omp`/`have bun` (`elon_ko.sh:162,177`) — a PATH search. **LOCAL MUST NOT.**
On a machine with a global omp/bun already installed, `have omp` would return true and the
global omp would be used → plugins written to `~/.omp` → **NFR-4 violated**. LOCAL presence
checks MUST test the exact local path: `[ -x "$OMP_LOCAL_HOME/bin/omp" ]` and
`[ -x "$OMP_LOCAL_HOME/bin/bun" ]`. Combined with `$OMP_LOCAL_HOME/bin` being first on `PATH`
(L2), even unqualified `omp`/`bun` invocations in L7–L9 resolve to the local copies.

### 6.3 RC-mutation guard (mandatory; see residual risk R-A)

`bun.sh/install` (and historically `omp.sh/install`) may append a `BUN_INSTALL`/`PATH` export to
the user's shell rc files. This is **unresearched by DrPe** (R2 confirmed only the install *dir*,
not rc behavior) and would silently violate NFR-4/AC-4. Two acceptable mitigations; DEVELOP picks
one and VALIDATE enforces the outcome via AC-4 (rc byte-identical) + AC-2 (no `~/.bun`):

- **(preferred) Trapped-HOME for the installer subprocesses.** Run the L4 and L5 installer pipes
  with `HOME` temporarily set to `$OMP_LOCAL_HOME` for that subprocess only:
  `env HOME="$OMP_LOCAL_HOME" BUN_INSTALL="$OMP_LOCAL_HOME" PI_INSTALL_DIR="$OMP_LOCAL_HOME/bin"
  sh -c '<installer pipe>'`. Any rc edit / `~/.bun` write then lands *inside* the project tree
  (harmless; clean up `$OMP_LOCAL_HOME/.zshrc`, `.bashrc`, `.profile`, `.bun` afterward).
  Safe because: (a) `BUN_INSTALL`/`PI_INSTALL_DIR` override the install dir regardless of `HOME`;
  (b) the omp `--binary` installer does not invoke omp's configRoot logic; (c) the **real** `HOME`
  and the derived `PI_CONFIG_DIR` are restored for L7–L9 (omp plugin calls), which is where
  configRoot resolution actually matters.
- **(fallback) Snapshot + restore.** Before L4, copy each enumerated rc
  (`~/.zshrc`, `~/.bashrc`, `~/.profile`, `~/.zprofile`, `~/.bash_profile`) to a tmp if it exists;
  after L5, restore (overwrite) each from its snapshot and `rm -f ~/.bun` if the installer created
  it. Tolerant of absent files.

Either way, **after L5 assert** (mandatory): `~/.zshrc`, `~/.bashrc` byte-identical to pre-run
(AC-4) and `~/.bun` not created/modified (AC-2).

---

## 7. PATH / env export contract for LOCAL (D2 + R3)

### 7.1 `./.elon-ko/env.sh` — exact contents (template; `<…>` are install-time literals)

```sh
# Generated by elon_ko.sh LOCAL install.
# Source this file from the project root to activate the project-local omp home:
#   source ./.elon-ko/env.sh
# BOTH PI_CONFIG_DIR and XDG_DATA_HOME are REQUIRED. PI_CONFIG_DIR relocates omp's
# config root (marketplaces.json, agent/); XDG_DATA_HOME relocates the native module
# + data category (omp/plugins/, omp/natives/). Without XDG_DATA_HOME a later bare
# `omp` loads natives from ~/.omp/natives/ AND prunes it (cleanupStaleNativeVersions).
# Do not edit by hand; re-run `bash elon_ko.sh -local` to regenerate.
export PI_CONFIG_DIR='<PI_CONFIG_DIR>'
export XDG_DATA_HOME='<OMP_LOCAL_HOME>'
export PATH='<OMP_LOCAL_HOME>/bin:$PATH'
export BUN_INSTALL='<OMP_LOCAL_HOME>'
export PI_INSTALL_DIR='<OMP_LOCAL_HOME>/bin'
```

- `<OMP_LOCAL_HOME>` = the **absolute** `$PWD/.elon-ko` captured at install time (so `env.sh`
  works sourced from any cwd, not only the project root).
- `<PI_CONFIG_DIR>` = the derived value from §5.2 (literal, install-time).
- `PATH` uses a literal `:$PATH` tail so it composes with the user's existing PATH on source.
- **R3 load-bearing point:** exporting `PATH` alone is INSUFFICIENT. `env.sh` MUST export BOTH
  `PI_CONFIG_DIR` (else a bare `omp` reads `~/.omp` and local plugins are invisible) AND
  `XDG_DATA_HOME` (else a bare `omp` loads+prunes `~/.omp/natives/`, violating NFR-4 and deleting
  the global omp's native versions — D1, §5.4). `BUN_INSTALL`/`PI_INSTALL_DIR` are included for
  consistency (so the vendored binaries remain the resolved ones in subsequent shells).

### 7.2 LOCAL summary block (template)

```
============================================================
  elon-ko installed — LOCAL install mode (./.elon-ko/).

  Plugins (installed into the project-local omp home):
    • elon-ko-gate      — gate + Definition-of-Done rule
    • elon-ko-agents    — 8 agents + 9 skills [<latest | pinned to tag TAG>]

  Activate this install in your shell (REQUIRED before running omp here):
    source ./.elon-ko/env.sh
  (Quick PATH-only line, NOT sufficient on its own — PI_CONFIG_DIR is needed too:
    export PATH="$PWD/.elon-ko/bin:$PATH")

  The gate is dormant until a project opts in:
    echo '{"enabled": true}' > .omp/elon.json

  NOTE: omp's auth is NOT shared with your global omp. The first `omp` run in this
  project will need to authenticate (or copy credentials from ~/.omp/agent).

  [<coexistence notice line if a GLOBAL install also exists — §10.2>]
============================================================
```

The **exact printed quick-PATH line** (D2) is: `export PATH="$PWD/.elon-ko/bin:$PATH"` (literal
`$PWD`, project-relative — the user is at the project root). **NO shell rc is edited. NO
`.envrc` is written** (D2; direnv is not a dependency).

---

## 8. Mode marker file (D4 / FR-9)

### 8.1 Paths

- GLOBAL: `$HOME/.omp/elon-ko.install.json`
- LOCAL: `$OMP_LOCAL_HOME/.install.json` (i.e. `./.elon-ko/.install.json`)

### 8.2 Schema (exact field set — REQ required `mode`+`ref` minimum; this spec fixes the rest)

```json
{
  "schema": "elon-ko.install/1",
  "mode": "global",
  "sub_mode": "stable",
  "ref": "v2.3.1",
  "marketplace_source": "rokicool/elon-ko",
  "installed_at": "2026-06-30T12:34:56Z",
  "paths": {
    "omp_home": "/Users/alice/.omp",
    "bin": "/Users/alice/.local/bin"
  }
}
```

Field rules:

- `schema` — constant `"elon-ko.install/1"` (forward-compat version tag).
- `mode` — `"global"` | `"local"`.
- `sub_mode` — `"stable"` | `"pre-release"`.
- `ref` — the Plugin A pin actually installed: `REF` (`v2.3.1`, or the `OMP_AGENT_REF`/tag).
- `marketplace_source` — `MKT_SOURCE` (`rokicool/elon-ko` for stable; the absolute local-tarball
  dir for pre-release).
- `installed_at` — `date -u +%Y-%m-%dT%H:%M:%SZ` (portable across BSD/GNU `date`).
- `paths.omp_home` — the config root this install resolves to (`~/.omp` global;
  `$OMP_LOCAL_HOME` local).
- `paths.bin` — the omp binary dir (`$HOME/.local/bin` global; `$OMP_LOCAL_HOME/bin` local).

LOCAL example:

```json
{
  "schema": "elon-ko.install/1",
  "mode": "local",
  "sub_mode": "stable",
  "ref": "v2.3.1",
  "marketplace_source": "rokicool/elon-ko",
  "installed_at": "2026-06-30T12:34:56Z",
  "paths": {
    "omp_home": "/Users/alice/github/elon-ko/.elon-ko",
    "bin": "/Users/alice/github/elon-ko/.elon-ko/bin"
  }
}
```

Write atomically (tmp file in the same dir, then `mv`) so a crash never leaves partial JSON. A
re-run of the same mode overwrites (refreshes `installed_at`) — never appends.

---

## 9. Mode-scoped uninstall (D4 / FR-10)

### 9.1 LOCAL uninstall — `elon_ko.sh -local uninstall`

Scope: **`$OMP_LOCAL_HOME` only.** Must NOT touch `~/.omp`, `~/.local/bin`, `~/.bun`,
`~/.omp-prerelease`, or any shell rc.

Flow:

1. If `[ ! -d "$OMP_LOCAL_HOME" ]` → tolerant no-op: print a one-line notice
   ("No LOCAL install found at `./.elon-ko/`; nothing to do.") and `exit 0` (FR-10 tolerant;
   mirrors `elon_ko.sh:81-84` discipline).
2. Else, best-effort omp-registry cleanup against the LOCAL home (so a running omp, if any,
   drops its in-memory entries), each `|| true`: set up the L2 env (PI_CONFIG_DIR +
   `$OMP_LOCAL_HOME/bin` on PATH) IF `$OMP_LOCAL_HOME/bin/omp` is executable, then run the
   **same** plugin/marketplace uninstall sequence as `elon_ko.sh:86-95` (current + pre-v2.0.0
   branding). If the local omp binary is absent, skip this sub-step (the `rm -rf` below fully
   removes the registry anyway).
3. `rm -rf "$OMP_LOCAL_HOME"` (removes plugins, marketplace registry, bins, agent state,
   prerelease cache, marker, env.sh — the whole relocated home).
4. Print the LOCAL uninstall summary: what was removed (`./.elon-ko/`), that the GLOBAL install
   (if any) is untouched, and that per-project opt-in markers (`./.omp/elon.json`, user data)
   are left in place. `exit 0`.

The marker `$OMP_LOCAL_HOME/.install.json` is removed by the `rm -rf` (no separate step).

### 9.2 GLOBAL uninstall — `elon_ko.sh uninstall`

**Byte-identical to `elon_ko.sh:79-119`** (current behavior), with two additions:

1. Remove the GLOBAL marker `$HOME/.omp/elon-ko.install.json` if present (`rm -f … || true`).
2. After the existing summary, if a LOCAL install exists (`[ -f ./​.elon-ko/.install.json ]` or
   `[ -d ./.elon-ko ]`), print **exactly one** courtesy notice:
   `"Note: a LOCAL elon-ko install still exists at ./.elon-ko/ (unaffected). Remove it with: bash elon_ko.sh -local uninstall"`
   — do NOT remove it.

Must NOT touch `./.elon-ko`. (The current script never references it, so this holds by
construction; the spec states it as an invariant for VALIDATE.)

### 9.3 Tolerant no-op matrix

| Invocation | State | Behavior |
|---|---|---|
| `uninstall` | no global install (no omp / nothing elon-ko under `~/.omp`) | tolerant no-op + notice, exit 0 (today's behavior, `elon_ko.sh:81-84`) |
| `-local uninstall` | no `./.elon-ko/` | tolerant no-op + notice, exit 0 |

---

## 10. Idempotency, re-install & coexistence (FR-11 / FR-12 / D5)

### 10.1 Same-mode re-run (idempotency, FR-11)

Both modes preserve the current discipline (`elon_ko.sh:214-248`): Plugin A is
uninstalled-then-installed each run; the marketplace is removed-then-added; Plugin B uses
`--force`. A re-run over an existing same-mode install refreshes in place — no duplicate
registrations, no errors. The marker is overwritten (refreshed `installed_at`). LOCAL re-run
re-derives `PI_CONFIG_DIR` from `$PWD` each time and rewrites `env.sh` + marker.

### 10.2 Cross-mode coexistence (D5 / FR-12)

GLOBAL and LOCAL use disjoint trees (`~/.omp/…` vs `./.elon-ko/…`) and, because `PI_CONFIG_DIR`
relocates the whole config root (`RESEARCH.md` F7-1), **disjoint marketplace registries** —
cross-mode name collision is impossible by construction. Installing one mode while the other
exists:

- succeeds (never errors, never refuses);
- prints **exactly one** notice line, detected via the *other* mode's marker:
  - LOCAL install (L12) with `$HOME/.omp/elon-ko.install.json` present →
    `"Note: a GLOBAL elon-ko install also exists at ~/.omp/ (unaffected)."`
  - GLOBAL install (§4.1 deviation 2) with `./.elon-ko/.install.json` present →
    `"Note: a LOCAL elon-ko install also exists at ./.elon-ko/ (unaffected)."`
- does NOT remove or modify the other mode.

---

## 11. Contents of `./.elon-ko/` & side effects (R5)

`./.elon-ko/` holds omp's **whole relocated home**, split across two roots by the dual-knob
(§5.4). The three dirs in D1 are the *minimum/primary* contents; omp also creates:

- **configRoot** (`./.elon-ko/` — relocated by `PI_CONFIG_DIR`): `marketplaces.json` (catalog
  registry), `install-id` (per-project, no longer machine-global), `agent/` — `agent.db`
  (**auth credentials + settings**), `sessions/`, `history.db`, `models.db`, `blobs/`, `memories/`.
- **data category** (`./.elon-ko/omp/` — relocated by `XDG_DATA_HOME`, gated on this dir existing):
  `omp/plugins/` — `installed_plugins.json`, `cache/`, `node_modules/`, `omp-plugins.lock.json`,
  `package.json` (Plugin A + Plugin B land here); and `omp/natives/<ver>/pi_natives.<platform>.node`
  — the ~130 MB native module (D1; §5.4).

**Layout split (load-bearing):** `marketplaces.json` is at configRoot (`./.elon-ko/`), while plugins
+ natives are under the data category (`./.elon-ko/omp/`). VALIDATE's AC-12-primary path is
`./.elon-ko/omp/plugins/` (not `./.elon-ko/plugins/`). These are all **expected, not bugs**; VALIDATE
must not flag them as stray global writes (they are inside the project tree).

**Pruning hazard eliminated (bonus, §5.4).** Because `cleanupStaleNativeVersions` now runs against
`./.elon-ko/omp/natives/` instead of `~/.omp/natives/`, a LOCAL run can no longer delete the global
omp's native versions. (Empirically re-proven: a pre-seeded `~/.omp/natives/16.2.7/` survives a
LOCAL run that loads 16.2.8.)

**Auth isolation (must surface in output + docs):** the user's omp auth (provider keys / OAuth)
is **not shared** with a LOCAL project — `agent.db` is per-project. The first `omp` run in the
project re-authenticates or requires a credential copy. Surfaced in the LOCAL summary (§7.2) and
flagged for DocWorm (§16 R-C).

**Coexistence with `./.omp/` (R5/F7-4):** the gate opt-in marker `.omp/elon.json` is resolved via
`getProjectAgentDir(cwd) = path.join(cwd, CONFIG_DIR_NAME)` with the **hardcoded**
`CONFIG_DIR_NAME=".omp"` — NOT `PI_CONFIG_DIR` (`RESEARCH.md` F7-4). So the project will contain
**two** omp-related trees: `./.elon-ko/` (relocated home) **and** `./.omp/` (project-scoped agent
dir for opt-in + project plugin overrides). `elon_ko.sh` LOCAL does NOT create `./.omp/` (it is
user data / created on opt-in, out of scope per `REQ.md`); but VALIDATE and docs must expect its
possible coexistence. It is inside the project, so it does not affect NFR-4 (the R4 enumeration
excludes the project tree).

---

## 12. Constraints carried from research (R6 + prohibitions)

- **R6:** LOCAL MUST use the same `omp plugin install`/`omp plugin marketplace add` commands as
  GLOBAL (just with `PI_CONFIG_DIR` exported). Do NOT use `omp plugin install --scope project`
  (moves only the manifest, not the cache — `RESEARCH.md` F3) and do NOT use `omp plugin link`
  (writes into global `node_modules` — `RESEARCH.md` F8). Both leak under `$HOME`.
- **XDG ban LIFTED for LOCAL mode (D1 resolution, user-approved).** The prior "No XDG" prohibition
  is rescinded FOR LOCAL MODE ONLY. It was derived from R6/F4 on the (false) assumption that
  `PI_CONFIG_DIR` relocates natives; the loader source (`loader-state.js:51-57`) disproves this
  (§5.4). LOCAL MUST export BOTH `PI_CONFIG_DIR` (configRoot) AND `XDG_DATA_HOME=$OMP_LOCAL_HOME`
  (natives + data category), and pre-create `$OMP_LOCAL_HOME/omp` (the XDG gate dir).
  `XDG_DATA_HOME` alone is still insufficient (it does not move `marketplaces.json`, F3) — BOTH
  knobs are required. GLOBAL mode never exports `XDG_DATA_HOME` (unchanged). The old "`PI_CONFIG_DIR`
  is the sole mechanism" line is superseded.
- **No symlink farm** (`~/.omp → $PWD/.elon-ko`) — creating `~/.omp` is itself a `$HOME` write and
  is machine-global, breaking D5/NFR-1 (`RESEARCH.md` F8-b).
- **No omp source patch** — unnecessary given `PI_CONFIG_DIR` works (`RESEARCH.md` F8-d).
- **No shell-rc edits, no `.envrc`** in either mode (D2; `elon_ko.sh:285-286` preserved).

---

## 13. Non-functional requirements (restated + LOCAL-specific)

- **NFR-1 (Backward compat).** No-flag invocations are observably identical to the pre-change
  script (same global paths, artifacts, summary) **modulo** the FR-9 marker file under existing
  `~/.omp` and the D5 coexistence notice (AC-1's "modulo" clauses). No new global *directories*.
- **NFR-2 (Platforms).** macOS + Linux. `set -euo pipefail` retained; tolerant `|| true`
  uninstall discipline preserved. The §5.2 algorithm and §6.3 guard are POSIX-sh portable (no
  GNU-only `realpath --relative-to`).
- **NFR-3 (unzip exception).** `unzip` is a host prerequisite (bun's installer needs it),
  handled identically in both modes; LOCAL does NOT vendor it and does NOT change host handling.
  Explicit, documented exception to LOCAL's "nothing global" guarantee.
- **NFR-4 (No silent global writes in LOCAL).** A LOCAL run MUST NOT create/modify anything under
  the enumerated global footprint: `~/.omp`, `~/.local/bin`, `~/.bun`, `~/.omp-prerelease`,
  `~/.zshrc`, `~/.bashrc`, `~/.profile`, `~/.zprofile`, `~/.bash_profile`. Verified by §6.3 guard +
  AC-2 (R4-scoped). The project tree (`./.elon-ko`, and possibly `./.omp`) is the legitimate
  write target and is excluded from the assertion.
- **NFR-5 (Strictness).** Unknown flags and >1 positional `die` with the §2.4 usage message.
  `set -euo pipefail` retained.
- **NFR-6 (LOCAL messaging clarity, NEW).** All LOCAL output disambiguates "LOCAL install mode"
  from "local marketplace"; surfaces the auth-isolation note; steers users to `source
  ./.elon-ko/env.sh` (not PATH-only).

---

## 14. Acceptance criteria (mapped to spec sections; "how Validator verifies")

AC-2 is **rewritten per R4**; AC-12 is **RESOLVED GO** (no fallback scoping needed).

| AC | Req ref | Satisfied by | How Validator verifies |
|---|---|---|---|
| **AC-1** (no-flag regression) | FR-1/NFR-1 | §4.1 | Run `bash elon_ko.sh` on a clean env; diff artifact set + summary vs. the pre-change script's output. Expect identical except the new `~/.omp/elon-ko.install.json` marker (FR-9) and absence of any coexistence notice (clean machine). No new global *dirs*. |
| **AC-2** (LOCAL writes nothing global — **R4-narrowed, now HOLDS for natives too**) | FR-2/NFR-4 | §4.2, §6.3, §11, §5.4 | Snapshot the **enumerated** global paths (`~/.omp` **incl. `natives/`**, `~/.local/bin`, `~/.bun`, `~/.omp-prerelease`, `~/.zshrc`, `~/.bashrc`, `~/.profile`) before/after `bash elon_ko.sh -local` in a clean project. Assert byte-identical (rc) / no new entries (dirs) — **now achievable including `~/.omp/natives/`**, because the dual-knob (§5.4) relocates natives to `./.elon-ko/omp/natives/`. A pre-seeded `~/.omp/natives/<other-ver>/` MUST survive (pruning-hazard proof). All artifacts exist under `./.elon-ko/{bin,prerelease,omp/{plugins,natives}}/` + configRoot files (`marketplaces.json`, `agent/`). |
| **AC-3** (alias) | FR-3 | §2.2 | `bash elon_ko.sh --local` produces the same `./.elon-ko/` tree and stdout as `-local`. |
| **AC-4** (LOCAL PATH/env) | FR-7 | §7 | After a LOCAL install: `./.elon-ko/env.sh` exists and exports `PI_CONFIG_DIR` **AND `XDG_DATA_HOME`** + PATH; summary prints the exact `export PATH="$PWD/.elon-ko/bin:$PATH"` line AND the `source ./.elon-ko/env.sh` instruction; `~/.zshrc` + `~/.bashrc` byte-identical before/after. (R3: assert env.sh contains BOTH `PI_CONFIG_DIR` and `XDG_DATA_HOME`, not PATH-only.) |
| **AC-5** (CLI grammar) | FR-4/FR-5 | §2 | All parse per §2.2 table: `… -local`, `… -local <tag>`, `… -local uninstall`, `OMP_AGENT_REF=vX … -local`, `… uninstall -local` (≡ `… -local uninstall`), `--local`. `… -foo` exits non-zero with the §2.4 usage message. `… -global` is rejected (unknown flag). `… <tag1> <tag2>` (>1 positional) exits non-zero. |
| **AC-6** (markers) | FR-9 | §8 | After GLOBAL: `~/.omp/elon-ko.install.json` exists with `mode=global` + the installed `ref`. After LOCAL: `./.elon-ko/.install.json` exists with `mode=local` + `ref`. Validate full §8.2 schema. |
| **AC-7** (mode-scoped uninstall) | FR-10 | §9 | With both modes installed: `bash elon_ko.sh -local uninstall` removes `./.elon-ko/` entirely and leaves `~/.omp/` (and `~/.local/bin`, `~/.bun`) unchanged; `bash elon_ko.sh uninstall` removes the global install and leaves `./.elon-ko/` unchanged. Snapshot both trees before/after. |
| **AC-8** (coexistence notice) | FR-12/D5 | §10.2 | Install GLOBAL then `bash elon_ko.sh -local`: succeeds, prints exactly ONE notice line (global exists). Symmetric (install LOCAL then GLOBAL). Neither run errors; neither removes the other. |
| **AC-9** (same-mode idempotency) | FR-11 | §10.1 | Run `… -local` twice and `…` (global) twice; second run succeeds, no duplicate marketplace/plugin registrations, no errors. Marker `installed_at` refreshed. |
| **AC-10** (pre-release per mode) | FR-13 | §3.2, §4.2 | `bash elon_ko.sh pr-dev-<tag>` → `$HOME/.omp-prerelease/<tag>/`; `bash elon_ko.sh -local pr-dev-<tag>` → `./.elon-ko/prerelease/<tag>/`. Both pin Plugin A+B to the tag. |
| **AC-11** (naming distinction) | FR-14 | §1, §4.2 | `bash elon_ko.sh -local` (stable) creates NO pre-release tarball cache and does NOT invoke the tarball code path; `bash elon_ko.sh <tag>` (global pre-release) still registers a local marketplace under `~/.omp-prerelease/`. Output messages keep the two "local" senses distinct. |
| **AC-12** (research-gated) | — | §5, §5.4, §6 | **RESOLVED GO.** DrPe confirms relocation is feasible (R1) + D1 dual-knob (§5.4). Validator confirms `$OMP_LOCAL_HOME/marketplaces.json` (configRoot), `$OMP_LOCAL_HOME/omp/plugins/` (data category), AND `$OMP_LOCAL_HOME/omp/natives/<ver>/pi_natives.<platform>.node` are populated after a LOCAL install, and `~/.omp` (incl. `natives/`) is untouched. |

---

## 15. Behavioral change map — `elon_ko.sh` file:line

What the spec changes at each region of the current script (for DEVELOP; line numbers are the
pre-change file):

| Lines | Current behavior | Change in this spec | Driven by |
|---|---|---|---|
| `40` | `set -euo pipefail` | Unchanged | NFR-2/NFR-5 |
| `42-45` | constants (`REPO`, `MARKETPLACE`, `PLUGIN_B`, `PRERELEASE_BASE`) | `PRERELEASE_BASE` becomes mode-dependent: GLOBAL keeps `${OMP_PRERELEASE_DIR:-$HOME/.omp-prerelease}`; LOCAL uses `$OMP_LOCAL_HOME/prerelease` (§3.1) | FR-13 |
| `47-58` | single-positional parser (`ARG="${1:-}"`) | **Replaced** by the §2.3 multi-arg parser (flag scan + ≤1 positional); sets `INSTALL_MODE` + `SUB_MODE` + `REF` | FR-3/FR-4/FR-5 |
| `60-65` | helpers (`have`,`say`,`ok`,`warn`,`die`) | Unchanged (reused by both modes) | — |
| `67-69` | `export PATH="$HOME/.local/bin:$HOME/.bun/bin:$PATH"` | **Branched**: GLOBAL keeps this verbatim; LOCAL instead exports `$OMP_LOCAL_HOME/bin` first + `PI_CONFIG_DIR`/`XDG_DATA_HOME`/`BUN_INSTALL`/`PI_INSTALL_DIR` (§4.2 L2, §5.4) | FR-6/FR-7 |
| `70-119` | uninstall (global only) | **Branched** by `INSTALL_MODE`×`SUB_MODE`: GLOBAL uninstall byte-identical + marker removal + cross-mode notice (§9.2); LOCAL uninstall path added (§9.1). Tolerant no-op for absent target (§9.3). | FR-10 |
| `121-158` | unzip check + system install | **Unchanged** in both modes (NFR-3) | FR-15 |
| `160-170` | omp: `have omp` else `--source` | **Branched**: GLOBAL unchanged; LOCAL path-scoped presence + `--binary`+`PI_INSTALL_DIR` (§4.2 L5, §6) | FR-2/R2 |
| `172-185` | bun: `have bun` else default | **Branched**: GLOBAL unchanged; LOCAL path-scoped presence + `BUN_INSTALL` + §6.3 rc-guard (§4.2 L4) | FR-2/R2 |
| `187` | `GH_A="github:${REPO}${REF:+#$REF}"` | Unchanged (mode-independent) | — |
| `189-211` | marketplace source (stable vs pre-release tarball) | Logic unchanged; LOCAL pre-release uses `$OMP_LOCAL_HOME/prerelease/<tag>` via §3.1 `PRERELEASE_BASE` | FR-13 |
| `213-248` | marketplace remove/add/update + Plugin A + Plugin B | Commands **unchanged**; in LOCAL they run with `PI_CONFIG_DIR` exported → land in `$OMP_LOCAL_HOME`. R6: no `--scope project`/`link`. | FR-2/R1/R6 |
| `250-289` | summary (stable + pre-release) | GLOBAL blocks byte-identical (modulo coexistence notice, §4.1); LOCAL summary block added (§7.2) + LOCAL marker write (§8) + env.sh emit (§7.1) inserted before summary | FR-7/FR-9/D2/R3 |

**New code added** (no current-line equivalent): §2.3 parser body, §5.2 `PI_CONFIG_DIR`
derivation, §5.3 self-check, §6.3 rc-guard, §7.1 env.sh writer, §8.2 marker writer, §9.1 LOCAL
uninstall, §10.2 coexistence-notice detection.

---

## 16. Residual risks (for Elon, before DEVELOP)

- **R-A (HIGHEST) — bun/omp installer rc-edit behavior is unresearched.** DrPe R2 confirmed the
  bun installer honors `BUN_INSTALL` for the install **dir** but did **not** analyze whether
  `bun.sh/install` (and `omp.sh/install --binary`) append a `BUN_INSTALL`/`PATH` export to
  `~/.zshrc`/`~/.bashrc`/`~/.profile`. bun's installer is widely known to do this by default. If
  it does so even with a custom `BUN_INSTALL`, a naive LOCAL install edits `~/.zshrc` → **violates
  NFR-4/AC-4**. **Mitigation is specified (§6.3: trapped-HOME or snapshot+restore) and made
  mandatory**, with AC-4 (rc byte-identical) + AC-2 (`~/.bun` untouched) as the hard
  Validator gates. DEVELOP must empirically pick the working mitigation on macOS + Linux before
  claiming LOCAL done. *Recommend Elon note this as the one item most likely to surface a
  DEVELOP⇄VALIDATE cycle.*
- **R-B (MEDIUM) — outside-`$HOME` project uses undocumented `..`-relpath.** When `$PWD` is
  outside `$HOME`, §5.2 derives a `PI_CONFIG_DIR` with leading `..` segments. This works today
  only because omp's `getConfigDirName()` does no validation (`RESEARCH.md` F2, F5); if omp ever
  validates the value (it already validates *profiles*), LOCAL-outside-`$HOME` breaks. The spec
  sets `LOCAL_OUTSIDE_HOME=1` and requires a one-line warning in that branch. Validator may not be
  able to exercise this if the test project must live under `$HOME`; AC-2's primary run is the
  under-`$HOME` case.
- **R-C (MEDIUM) — auth isolation is a UX surprise.** LOCAL omp `agent.db` is per-project; the
  user must re-auth or copy credentials (R5, §11). Not a defect, but a friction point that
  DocWorm must document and the LOCAL summary must surface (§7.2). Flag for the (conditional)
  DocWorm phase.
- **R-D (LOW) — `--binary` omp mode needs a prebuilt for the target.** If `omp.sh/install
  --binary` has no prebuilt for a platform/arch, DEVELOP falls back to `--source` + pre-installed
  bun (§4.2 L5 alternative). Both satisfy NFR-4 under the §6.3 guard.
- **R-E (LOW) — `env.sh` bakes install-time `PI_CONFIG_DIR`.** If the project directory is moved
  or renamed, the baked value is stale; the user must re-run `bash elon_ko.sh -local` to
  regenerate. Inherent to whole-home relocation (the physical home is at a fixed path); documented
  in `env.sh`'s header comment (§7.1).

- **R-F (MEDIUM) — `XDG_DATA_HOME` blast radius in `env.sh`.** Sourcing `./.elon-ko/env.sh` exports
  `XDG_DATA_HOME=$OMP_LOCAL_HOME`, which redirects the `data` category of EVERY XDG-aware tool in
  that shell (not only omp). This is the accepted cost of the dual-knob (§5.4): without it, a later
  bare `omp` loads+prunes `~/.omp/natives/` (D1). Mitigation: `env.sh` is sourced explicitly and
  scoped to the project shell; users running other XDG tools in the same shell should be aware.
  GLOBAL mode is unaffected. DocWorm must document this (sibling of R-C).

---

## 17. Out of scope (SPEC phase)

- **No code changes** — this is the SPEC phase; DEVELOP implements (`elon_ko.sh` only).
- **No re-opening** of any GRILL decision (D1–D5) or research finding (R1–R6).
- **No user-facing docs** — DocWorm phase, conditional on Elon routing it.
- **No new `update`/`uninstall` subcommands** — `uninstall` is made mode-scoped (D4); updating
  remains "re-run the installer" (idempotent).
- **No changes to the gate opt-in marker** `.omp/elon.json` (user data; `elon_ko.sh:71-72`,77-78).
- **No changes to the omp/bun external installers** — only how/where `elon_ko.sh` invokes them.
- **No direnv** (no `.envrc` auto-write). **No cross-project linking** of a LOCAL install.
- **No `--global` flag** (D3). **No version-pinning changes** beyond composing `OMP_AGENT_REF`/`<tag>` with the mode flag (already in §2).
- **No symlink farm, no omp source patch, no `--scope project`/`link`** (§12). (The "No XDG" prohibition was lifted for LOCAL mode — §12/§5.4, D1 resolution.)
