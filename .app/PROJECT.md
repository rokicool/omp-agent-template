# PROJECT — elon-ko.sh local/global install modes

## Request (verbatim)
I like your team to work on the installation script elon-ko.sh and support two types of installation:
- local
- global

local installation is supposed to be local to the current project/folder and nothing is installed globally.

global installation is the opposite of local. everything is installed into the global folder and available across all the projects on the same maching.

by default it should be global installation. to switch to 'local' one should provide '-local' as a parameter.

## Classification
FULL — new feature: two distinct installation modes (local/global) selected by a CLI flag, affecting user-facing install behavior and target directories.

## Workflow Path
FULL → REQUEST(done) → GRILL(done) → RESEARCH(in_progress) → SPEC(pending) → DEVELOP(pending) → VALIDATE(pending) → DONE(pending)

## Phase Status
- REQUEST: done
- GRILL: done → .app/REQ.md (19.8 KB, 13 sections, 12 acceptance criteria)
- RESEARCH: in_progress (DrPe — omp plugin-home relocation feasibility, gates AC-12)
- SPEC: pending
- DEVELOP: pending
- VALIDATE: pending
- DONE: pending

## Resolved decisions (from GRILL, user-accepted defaults)
- Q1 LOCAL layout: `./.elon-ko/{bin,plugins,prerelease}/` hidden root; relocate omp plugin home there.
- Q2 LOCAL PATH: print `export PATH="$PWD/.elon-ko/bin:…"` AND emit sourced `./.elon-ko/env.sh`. No shell-rc edits, no direnv auto-write.
- Q3 CLI: `-local` is an independent, position-agnostic mode flag; `--local` alias; no `-global` flag (default = global). Distinct from existing "local marketplace" (pre-release tarball) concept.
- Q4 uninstall + marker: mode-scoped uninstall (`… -local uninstall` → only `./.elon-ko/`); each install writes mode+ref marker (GLOBAL→~/.omp/elon-ko.install.json, LOCAL→./.elon-ko/.install.json).
- Q5 coexistence: LOCAL + GLOBAL allowed (disjoint dirs); cross-mode install prints a one-line notice, not an error.

## RESEARCH dependency (DrPe)
`omp plugin install` currently writes to fixed `~/.omp/plugins/` (repo RESEARCH.md:55-73, CHANGELOG.md:274). Confirm whether omp can relocate its plugin home to a project-local dir (env var / flag / config) so LOCAL installs literally nothing global. Gates AC-12. User intent is final regardless; fallback needed if relocation unsupported.

## Pending Asks
(none)
