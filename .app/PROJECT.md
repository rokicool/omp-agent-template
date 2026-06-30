# PROJECT — elon-ko.sh local/global install modes

## Request (verbatim)
I like your team to work on the installation script elon-ko.sh and support two types of installation:
- local
- global

local installation is supposed to be local to the current project/folder and nothing is installed globally.

global installation is the opposite of local. everything is installed into the global folder and available across all the projects on the same maching.

by default it should be global installation. to switch to 'local' one should provide '-local' as a parameter.

NOTE: actual repo file is elon_ko.sh (underscore). Spec + impl target the real file.

## Classification
FULL — new feature: two distinct install modes (local/global) selected by a CLI flag, affecting user-facing install behavior and target directories.

## Workflow Path
FULL -> REQUEST(done) -> GRILL(done) -> RESEARCH(done) -> SPEC(done) -> DEVELOP(in_progress) -> VALIDATE(pending) -> DONE(pending)

## Phase Status
- REQUEST: done
- GRILL: done -> .app/REQ.md (12 ACs)
- RESEARCH: done -> .app/RESEARCH.md (GO verdict). PI_CONFIG_DIR relocates whole omp home.
- SPEC: done -> .app/SPEC.md (~800 lines, 17 sections; R1-R6 addressed; 12 ACs mapped; AC-2 narrowed per R4; AC-12 GO)
- DEVELOP: in_progress (LeadDev implements elon_ko.sh per SPEC)
- VALIDATE: pending
- DONE: pending

## Resolved decisions (GRILL, user-accepted)
- Q1 LOCAL layout: ./.elon-ko/{bin,plugins,prerelease}/; PI_CONFIG_DIR relocation.
- Q2 LOCAL PATH: print export PATH + emit sourced ./.elon-ko/env.sh (exports PI_CONFIG_DIR + PATH). No shell-rc edits.
- Q3 CLI: -local position-agnostic mode flag; --local alias; no -global (default=global). Distinct from local marketplace.
- Q4: mode-scoped uninstall + mode/ref marker files.
- Q5: LOCAL+GLOBAL coexist (disjoint dirs); cross-mode install = one-line notice.

## RESEARCH findings (R1-R6, in SPEC)
- R1 PI_CONFIG_DIR whole-home relocation. R2 vendor bins, bun-before-omp ordering. R3 env.sh exports PI_CONFIG_DIR. R4 narrow AC-2 to enumerated global paths. R5 whole-home contents + auth isolation + ./.omp coexistence. R6 no --scope project / no omp plugin link.

## Residual risks
- R-A (HIGHEST): bun.sh/install appends BUN_INSTALL/PATH to ~/.zshrc/~/.bashrc by default -> violates LOCAL nothing-global. SPEC §6.3 MANDATES mitigation (trapped-HOME preferred, else rc snapshot+restore); AC-4 (rc byte-identical) + AC-2 (~/.bun untouched) are hard Validator gates. DEVELOP must empirically confirm on macOS+Linux.

## Pending Asks
(none)
