# PROJECT — elon-ko.sh local/global install modes

## Request (verbatim)
I like your team to work on the installation script elon-ko.sh and support two types of installation:
- local
- global

local installation is supposed to be local to the current project/folder and nothing is installed globally.

global installation is the opposite of local. everything is installed into the global folder and available across all the projects on the same maching.

by default it should be global installation. to switch to 'local' one should provide '-local' as a parameter.

## Classification
FULL — new feature: two distinct install modes (local/global) selected by a CLI flag, affecting user-facing install behavior and target directories.

## Workflow Path
FULL -> REQUEST(done) -> GRILL(done) -> RESEARCH(done) -> SPEC(in_progress) -> DEVELOP(pending) -> VALIDATE(pending) -> DONE(pending)

## Phase Status
- REQUEST: done
- GRILL: done -> .app/REQ.md (12 ACs)
- RESEARCH: done -> .app/RESEARCH.md (GO verdict). Mechanism: PI_CONFIG_DIR relocates whole omp home -> plugins at ./.elon-ko/plugins/.
- SPEC: in_progress (LeadDev)
- DEVELOP: pending
- VALIDATE: pending
- DONE: pending

## Resolved decisions (GRILL, user-accepted)
- Q1 LOCAL layout: ./.elon-ko/{bin,plugins,prerelease}/; relocate omp plugin home via PI_CONFIG_DIR.
- Q2 LOCAL PATH: print export PATH + emit sourced ./.elon-ko/env.sh (exports PI_CONFIG_DIR + PATH). No shell-rc edits.
- Q3 CLI: -local position-agnostic mode flag; --local alias; no -global (default=global). Distinct from local marketplace.
- Q4: mode-scoped uninstall + mode/ref marker files (GLOBAL->~/.omp/elon-ko.install.json, LOCAL->./.elon-ko/.install.json).
- Q5: LOCAL+GLOBAL coexist (disjoint dirs); cross-mode install = one-line notice.

## RESEARCH findings carried into SPEC (DrPe R1-R6)
- R1 PI_CONFIG_DIR relocation is the LOCAL mechanism (whole omp home moves into ./.elon-ko).
- R2 Vendor bin to ./.elon-ko/bin; pre-install bun there before omp (install_bun() force-sets BUN_INSTALL=$HOME/.bun otherwise).
- R3 env.sh exports PI_CONFIG_DIR + PATH (PI_CONFIG_DIR required, not just PATH).
- R4 Narrow AC-2 to enumerated global paths (~/.omp, ~/.local/bin, ~/.bun, ~/.omp-prerelease, shell rc); raw $HOME diff unsatisfiable when project under $HOME.
- R5 Document ./.elon-ko holds whole omp home (marketplaces.json, install-id, agent/); LOCAL auth isolated; project has BOTH ./.elon-ko and ./.omp.
- R6 Do NOT use --scope project or omp plugin link for LOCAL.

## Pending Asks
(none)
