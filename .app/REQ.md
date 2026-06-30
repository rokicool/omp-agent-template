# Requirements Document — `elon_ko.sh` local/global install modes

**Status:** GRILL COMPLETE — all decision branches resolved (user accepted recommended defaults).
**Date:** 2026-06-30
**Scope:** Add two installation modes (LOCAL / GLOBAL) to the `elon_ko.sh` one-line installer, selected by a CLI flag. Requirements only — no design, no implementation.
**Source evidence:** `elon_ko.sh` (full read, raw), `README.md`, `.DEVREADME.md`, `.app/RESEARCH.md`, `CHANGELOG.md`, `.app/PROJECT.md`. File:line citations inline.

---

## Overview

`elon_ko.sh` today performs a single, implicitly-global install: it ensures `unzip`, `omp`, and `bun` are present, then installs Plugin A (`elon-ko-gate`) and Plugin B (`elon-ko-agents`) into the user-global omp tree (`~/.omp/`, `~/.local/bin`, `~/.bun`). This feature adds a second, explicitly-**local** mode that installs the *same* artifact set entirely under the current project folder, touching nothing outside it. The default (no flag) remains the current global behavior, preserving backward compatibility. A `-local` flag switches to local.

---

## Confirmed Facts (locked, not re-litigated)

- **F1.** Two install modes: LOCAL and GLOBAL.
- **F2.** LOCAL installs ONLY under the current project/folder; NOTHING is written outside it (no global dirs, no shell-rc edits).
- **F3.** GLOBAL installs into a global location available across all projects on the same machine.
- **F4.** DEFAULT mode (no flag) = GLOBAL.
- **F5.** Switch to LOCAL by passing `-local` to `elon_ko.sh`.

---

## Resolved Decisions (user-accepted defaults)

| # | Decision | Resolution |
|---|---|---|
| D1 | LOCAL target layout | Single hidden root `./.elon-ko/{bin,plugins,prerelease}/`; omp's plugin home is relocated there. Dumping artifacts directly into cwd root is REJECTED. |
| D2 | LOCAL PATH handling | Print the exact `export PATH="$PWD/.elon-ko/bin:..."` line AND emit a sourced `./.elon-ko/env.sh`. NO shell-rc edits, NO `.envrc` auto-write. |
| D3 | `-local` CLI grammar | `-local` is an independent MODE FLAG, position-agnostic. `--local` accepted as alias. NO `-global` flag (default-no-flag = global). Composes with `uninstall`, `<tag>`, and `OMP_AGENT_REF`. Distinct from the existing "local marketplace" concept. |
| D4 | Mode-aware uninstall + marker | YES to both. `… -local uninstall` removes only `./.elon-ko/`; `… uninstall` removes only the global install. Each install writes a small mode+ref marker (GLOBAL → `~/.omp/elon-ko.install.json`, LOCAL → `./.elon-ko/.install.json`). |
| D5 | Cross-mode coexistence | ALLOW. Disjoint dirs do not interfere. Installing one mode while the other exists prints a one-line NOTICE, not an error/refusal. |

---

## Exact CLI Contract

The flag `-local` (or alias `--local`) is a **mode flag** parsed independently of the existing positional argument. The positional argument semantics (`uninstall` | `<pre-release-tag>` | empty=stable) are UNCHANGED from today (`elon_ko.sh:49-57`).

| Invocation | Mode | Sub-mode | Behavior |
|---|---|---|---|
| `elon_ko.sh` | GLOBAL | stable | Today's default behavior, verbatim. |
| `elon_ko.sh <tag>` | GLOBAL | pre-release | Today's pre-release behavior (pins both plugins to tag). |
| `elon_ko.sh -local` | LOCAL | stable | Local stable install. |
| `elon_ko.sh -local <tag>` | LOCAL | pre-release | Local pre-release (cache under `./.elon-ko/prerelease/<tag>/`). |
| `elon_ko.sh uninstall` | GLOBAL | uninstall | Removes only the GLOBAL install (today's behavior). |
| `elon_ko.sh -local uninstall` | LOCAL | uninstall | Removes only the LOCAL install (`./.elon-ko/`). |
| `OMP_AGENT_REF=vX elon_ko.sh [-local]` | (flag-dependent) | stable, Plugin A pinned | Env pin composes with either mode. |
| `elon_ko.sh --local …` | LOCAL | (as above) | `--local` is an accepted alias for `-local`. |

**Grammar rules:**
- The flag is **position-agnostic**: it may appear before or after the positional argument (`… -local uninstall` ≡ `… uninstall -local`).
- There is **no `-global` flag**. Global is expressed by the absence of `-local` (the default).
- A non-flag positional that is not `uninstall` is treated as a **pre-release tag** (unchanged from today).
- An **unknown flag** (anything matching `-X`/`--X` other than `-local`/`--local`) → `die` with a usage message (strict; consistent with `set -euo pipefail`).
- `uninstall` with no mode flag when no global install exists → tolerant no-op + notice (mirrors today's tolerant uninstall, `elon_ko.sh:76-118`). Same for `-local uninstall` with no local install.

---

## Naming Distinction (load-bearing)

The word "local" already has a DIFFERENT, pre-existing meaning in this script: a **"local marketplace"** is the in-place tarball registration used by pre-release installs (`elon_ko.sh:20-22`, `192-193`, `215-216`). The new **`-local` install MODE** is a separate concept (where artifacts land on disk). These two senses MUST remain distinct in code and user output:

- A `-local` **stable** install must NOT trigger pre-release tarball logic.
- A **global pre-release** install still uses a "local marketplace" registration under `~/.omp-prerelease/` — unaffected by the absence of `-local`.
- User-facing messages must disambiguate (e.g. "LOCAL install mode" vs "local marketplace registration").

---

## Per-Mode Install Target Paths

### GLOBAL (default; today's behavior — `elon_ko.sh:45,69,161-234`)

| Artifact | Target |
|---|---|
| `unzip` (host prerequisite; see NFR-3) | system package manager (apt/dnf/yum/apk/brew) |
| `omp` binary | `$HOME/.local/bin/omp` |
| `bun` binary | `$HOME/.bun/bin/bun` |
| Plugin A `elon-ko-gate` | `~/.omp/plugins/` (via `omp plugin install github:rokicool/elon-ko#<ref>`) |
| Plugin B `elon-ko-agents` | `~/.omp/` marketplace (via `omp plugin marketplace add` + `omp plugin install elon-ko-agents@elon-ko`) |
| Pre-release cache (pre-release sub-mode only) | `$HOME/.omp-prerelease/<tag>/` (`OMP_PRERELEASE_DIR` override honored) |
| Mode marker (NEW) | `~/.omp/elon-ko.install.json` |

### LOCAL (new)

| Artifact | Target |
|---|---|
| `unzip` (host prerequisite; see NFR-3) | system package manager — identical handling; NOT a project-local artifact |
| `omp` binary | `./.elon-ko/bin/omp` (vendored project-local copy) |
| `bun` binary | `./.elon-ko/bin/bun` (vendored project-local copy) |
| Plugin A `elon-ko-gate` | `./.elon-ko/plugins/` (omp's plugin home relocated here) |
| Plugin B `elon-ko-agents` | `./.elon-ko/plugins/` marketplace (local omp) |
| Pre-release cache (local pre-release only) | `./.elon-ko/prerelease/<tag>/` |
| Mode marker (NEW) | `./.elon-ko/.install.json` |

**Mode marker schema (both modes):** a small JSON object recording at minimum `{"mode": "global"|"local", "ref": "<tag-or-stable-pin>", "installed_at": "<ISO8601>"}`. Exact field set is SPEC's prerogative; REQ requires mode + ref at minimum.

---

## Per-Mode PATH Handling

### GLOBAL
- `export PATH="$HOME/.local/bin:$HOME/.bun/bin:$PATH"` for the script's OWN run only (`elon_ko.sh:69,167`).
- **NO shell-rc edit** (today's behavior; `elon_ko.sh:285-286`).
- Print the existing hint in the summary: `export PATH="$HOME/.local/bin:$HOME/.bun/bin:$PATH"`.

### LOCAL
- `export PATH` for the script's own run must prepend the project-local bin (`$PWD/.elon-ko/bin`) so the vendored omp/bun are used in-process.
- **Print** the exact activation line: `export PATH="$PWD/.elon-ko/bin:$PATH"` (project-relative; the user runs it from the project root).
- **Emit** a sourced helper at `./.elon-ko/env.sh` containing that export, so the user can `source ./.elon-ko/env.sh`.
- **NO shell-rc edit.** **NO `.envrc` auto-write** (direnv is not a stated dependency).

---

## Artifact Set Per Mode (same set, relocated)

Both modes install the SAME five artifact classes (`elon_ko.sh:122-228`); LOCAL only changes where they land:

1. `unzip` — host prerequisite (see NFR-3).
2. `omp` — the oh-my-pi runtime.
3. `bun` — required by Plugin A's `bun install`.
4. **Plugin A** `elon-ko-gate` — gate + DoD rule + dot-agreement/mess-transport/subagent-panel extensions.
5. **Plugin B** `elon-ko-agents` — 8 agents + 9 skills (marketplace).

LOCAL installs the SAME set; it does NOT omit omp/bun (they are vendored project-local, since "nothing global" precludes relying on a global omp/bun).

---

## Idempotency, Re-install & Coexistence

- **Same-mode re-run is idempotent** in both modes (unchanged discipline: Plugin A uninstalled-then-installed each run, marketplace removed-then-added; `elon_ko.sh:217-234`). A re-run over an existing same-mode install refreshes it in place with no duplicate registrations and no errors.
- **Cross-mode coexistence is ALLOWED.** GLOBAL (`~/.omp/`, `~/.local/bin`, `~/.bun`) and LOCAL (`./.elon-ko/`) use disjoint directory trees and do not interfere.
- **Installing one mode while the other exists** prints a single-line NOTICE (e.g. *"Note: a GLOBAL install also exists at ~/.omp/…"*) — NOT an error, NOT a refusal, and it does NOT remove the other mode.
- **Uninstall is mode-scoped** (D4): each `uninstall` variant touches only its own tree, identified by its mode marker; the other mode's tree is left untouched.
- **Tolerant no-ops** are preserved: uninstalling a mode that was never installed is a silent/notice no-op, not a failure (`elon_ko.sh:76-118` discipline).

---

## Non-Functional Requirements

- **NFR-1 (Backward compatibility).** The no-flag invocation (`elon_ko.sh`, `elon_ko.sh <tag>`, `elon_ko.sh uninstall`) MUST be byte-compatible in observable behavior with the pre-change script: same global paths, same artifacts, same summary text (modulo any added coexistence notice). No existing user workflow regresses.
- **NFR-2 (Platforms).** Same platform support as today: macOS and Linux. `set -euo pipefail` and the tolerant `|| true` uninstall discipline are preserved.
- **NFR-3 (unzip exception).** `unzip` is a HOST prerequisite of bun's installer, not an elon-ko artifact. Its (optional) system install is handled IDENTICALLY in both modes (`elon_ko.sh:122-160`) and is an explicit, documented exception to LOCAL's "nothing global" guarantee — LOCAL does not vendor unzip and does not change the host's unzip handling.
- **NFR-4 (No silent global writes in LOCAL).** A LOCAL run MUST NOT create or modify anything under `$HOME` (no `~/.local/bin`, `~/.bun`, `~/.omp`, `~/.omp-prerelease`, no `~/.zshrc`/`~/.bashrc`). Verified by filesystem snapshot before/after.
- **NFR-5 (Strictness).** Unknown flags `die` with a usage message. `set -euo pipefail` retained.

---

## RESEARCH Dependency (DrPe — gates LOCAL mechanism, not user intent)

**OMP plugin-home + installer relocation feasibility.** Every plugin install today routes through `omp plugin install` / `omp plugin marketplace add`, which write to a fixed user-global `~/.omp/plugins/` (`.app/RESEARCH.md:55-73`; `CHANGELOG.md:274`; `DEVREADME.md` troubleshooting). No `OMP_HOME` / plugin-dir / `--prefix` relocation knob is documented anywhere in this repo (grep of all `OMP_*` env vars surfaced only feature toggles: `BYPASS`/`ENABLE_ORCHESTRATOR`, `INSTANCE_ID`, `MESS_*`, `SUBAGENT_PANEL_*`, `IDEA_REMINDERS`, `AGENT_REF`, `PRERELEASE_DIR`).

DrPe MUST confirm, before SPEC commits a LOCAL mechanism:
1. Whether omp can be pointed at a **project-local plugin home** (env var, CLI flag, or config) so Plugin A+B land in `./.elon-ko/plugins/`.
2. Whether the **omp installer** (`omp.sh`) and the **bun installer** (`bun.sh`) can be directed to install their binaries into `./.elon-ko/bin/` instead of `~/.local/bin` / `~/.bun`.

**Assumed mechanism for REQ purposes:** relocation IS feasible (vendoring omp/bun locally + redirecting omp's plugin home). If DrPe finds it is NOT feasible for the plugin home, LOCAL cannot fully satisfy NFR-4 for plugins; SPEC must then choose and document a fallback (e.g. vendor omp locally but document a plugin-resolution limit, or scope LOCAL to a project-local wrapper + opt-in marker) and AC-12 below is re-scoped. This is the only open research item; user intent (D1–D5) is final regardless.

---

## Out of Scope

- **No new `update` subcommand.** None exists today; updating remains "re-run the installer" (idempotent).
- **No new `uninstall` subcommand.** The existing `uninstall` is made mode-scoped (D4); no new subcommand is added.
- **No changes to the gate opt-in marker** `.omp/elon.json` (user data the installer never created; `elon_ko.sh:71-72`).
- **No changes to the omp/bun external installers** themselves — only how `elon_ko.sh` invokes them and where their results land.
- **No direnv integration** (`.envrc` is not auto-written).
- **No cross-project linking** of a LOCAL install.
- **No `--global` flag** (D3 — default-no-flag already means global).
- **No version-pinning changes** beyond composing `OMP_AGENT_REF` and `<tag>` with the new mode flag (already covered by the CLI contract).

---

## Functional Requirements (each falsifiable)

- **FR-1.** `elon_ko.sh` with no flag performs a GLOBAL install identical in artifact set and target paths to the pre-change script (F1, F3, F4; `elon_ko.sh:49-57,161-234`).
- **FR-2.** `elon_ko.sh -local` performs a LOCAL install: all artifacts land under `./.elon-ko/{bin,plugins,prerelease}/` and nothing is written under `$HOME` (F2, D1, NFR-4).
- **FR-3.** `--local` is accepted as an alias and produces identical behavior to `-local` (D3).
- **FR-4.** The `-local`/`--local` flag is position-agnostic and composes with `uninstall`, `<tag>`, and `OMP_AGENT_REF` per the CLI contract table (D3).
- **FR-5.** There is no `-global`/`--global` flag; an unknown flag causes the script to `die` with a usage message (D3, NFR-5).
- **FR-6.** GLOBAL PATH handling is unchanged (own-run export + printed hint, no rc edit) (D2-global; `elon_ko.sh:69,167,285-286`).
- **FR-7.** LOCAL PATH handling prints the exact `export PATH="$PWD/.elon-ko/bin:..."` line and emits `./.elon-ko/env.sh`; it does NOT edit any shell rc and does NOT write `.envrc` (D2, NFR-4).
- **FR-8.** Both modes install the SAME five artifact classes (unzip, omp, bun, Plugin A, Plugin B); LOCAL relocates rather than omits (artifact-set section).
- **FR-9.** Each install writes a mode marker recording at minimum `mode` and `ref`: GLOBAL → `~/.omp/elon-ko.install.json`, LOCAL → `./.elon-ko/.install.json` (D4).
- **FR-10.** `elon_ko.sh uninstall` removes only the GLOBAL install; `elon_ko.sh -local uninstall` removes only `./.elon-ko/`. Each leaves the other mode's tree untouched (D4).
- **FR-11.** Same-mode re-run is idempotent (no duplicate registrations, no errors) in both modes (Idempotency section).
- **FR-12.** Installing one mode while the other exists succeeds and prints a one-line NOTICE; it does not error and does not remove the other mode (D5).
- **FR-13.** Pre-release works in both modes: `<tag>` → `~/.omp-prerelease/<tag>/` (global); `-local <tag>` → `./.elon-ko/prerelease/<tag>/` (local) (`elon_ko.sh:194-204`).
- **FR-14.** The "local marketplace" (pre-release tarball) concept and the "-local install mode" remain distinct: a `-local` stable install does not invoke pre-release tarball logic, and a global pre-release install is unaffected by the absence of `-local` (Naming Distinction section).
- **FR-15.** `unzip` handling is identical in both modes and is an explicit exception to LOCAL's "nothing global" guarantee (NFR-3; `elon_ko.sh:122-160`).

---

## Error Cases

| Case | Expected behavior |
|---|---|
| `unzip` missing and cannot be system-installed | `die` with the existing actionable message in BOTH modes (`elon_ko.sh:153-157`). LOCAL does not silently global-install; it fails the same way. |
| omp or bun installer fails | `die` in both modes (own-run PATH export preserved). |
| Unknown flag (not `-local`/`--local`) | `die` with usage (NFR-5). |
| `-local uninstall` with no local install | Tolerant no-op + notice; exit 0 (FR-10, mirrors `elon_ko.sh:76-118`). |
| `uninstall` with no global install | Tolerant no-op + notice; exit 0 (today's behavior). |
| omp plugin-home relocation infeasible (DrPe finding) | Not a runtime error in REQ; SPEC defines fallback. AC-12 re-scoped. |
| LOCAL run that would write under `$HOME` | MUST NOT happen (NFR-4). A violation is a defect. |

---

## Acceptance Criteria (for the Validator)

- **AC-1 (no-flag regression, FR-1/NFR-1).** Run `bash elon_ko.sh` on a clean env; the set and locations of installed artifacts and the summary output match the pre-change script (modulo any added coexistence notice). No new global paths introduced.
- **AC-2 (LOCAL writes nothing under $HOME, FR-2/NFR-4).** Snapshot `$HOME` (and `~/.zshrc`/`~/.bashrc`) before and after `bash elon_ko.sh -local` in a clean project dir; assert NO new/modified entries under `$HOME`. All artifacts exist under `./.elon-ko/{bin,plugins,prerelease}/`.
- **AC-3 (alias, FR-3).** `bash elon_ko.sh --local` produces the same `./.elon-ko/` tree and same output as `-local`.
- **AC-4 (LOCAL PATH, FR-7).** After a LOCAL install: `./.elon-ko/env.sh` exists and contains the project-local PATH export; the summary prints the exact `export PATH="$PWD/.elon-ko/bin:..."` line; `~/.zshrc` and `~/.bashrc` are byte-identical before/after.
- **AC-5 (CLI grammar, FR-4/FR-5).** All of these parse and behave per the contract table: `… -local`, `… -local <tag>`, `… -local uninstall`, `OMP_AGENT_REF=vX … -local`, `… uninstall -local` (position-agnostic), `--local`. An unknown flag (e.g. `-foo`) exits non-zero with a usage message.
- **AC-6 (markers, FR-9).** After a GLOBAL install, `~/.omp/elon-ko.install.json` exists with `mode=global` and the installed ref. After a LOCAL install, `./.elon-ko/.install.json` exists with `mode=local` and the installed ref.
- **AC-7 (mode-scoped uninstall, FR-10).** With both modes installed: `bash elon_ko.sh -local uninstall` removes `./.elon-ko/` entirely and leaves `~/.omp/` unchanged; `bash elon_ko.sh uninstall` removes the global install and leaves `./.elon-ko/` unchanged.
- **AC-8 (coexistence notice, FR-12/D5).** Install GLOBAL, then `bash elon_ko.sh -local`; the LOCAL run succeeds and prints exactly one notice line that a global install exists. Symmetric for the reverse order. Neither run errors.
- **AC-9 (same-mode idempotency, FR-11).** Run `… -local` twice (and `… ` global twice); the second run succeeds with no duplicate marketplace/plugin registrations and no errors.
- **AC-10 (pre-release per mode, FR-13).** `bash elon_ko.sh pr-dev-<tag>` extracts to `~/.omp-prerelease/<tag>/`; `bash elon_ko.sh -local pr-dev-<tag>` extracts to `./.elon-ko/prerelease/<tag>/`. Both pin Plugin A+B to the tag.
- **AC-11 (naming distinction, FR-14).** `bash elon_ko.sh -local` (stable) does NOT create any pre-release tarball cache and does NOT invoke the "local marketplace" tarball path; `bash elon_ko.sh <tag>` (global pre-release) still registers a local marketplace under `~/.omp-prerelease/`. Code paths and output messages keep the two "local" senses distinct.
- **AC-12 (research-gated, BLOCKED-ON-RESEARCH).** If DrPe confirms omp plugin-home + installer relocation is feasible: AC-2/AC-7 for the LOCAL plugin tree are achievable as specified. If DrPe finds the plugin home CANNOT be relocated: LOCAL cannot fully satisfy NFR-4 for plugins; SPEC must document the chosen fallback and this AC is re-scoped accordingly. The LOCAL bin vendoring (AC-2 for `./.elon-ko/bin/`) is achievable independently of the plugin-home question.

---

## Open Questions

- **OQ-1 (RESEARCH, not a user blocker).** Can omp install plugins into a project-local home, and can the omp/bun installers be directed at `./.elon-ko/bin/`? DrPe confirms in the RESEARCH phase. Assumed = YES. Affects only the LOCAL *mechanism*; user intent (D1–D5) is final. (See RESEARCH Dependency.)
