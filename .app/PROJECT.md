# PROJECT — elon-ko.sh local/global install modes — DONE

## Request (verbatim)
local = local to current project/folder, nothing global. global = opposite. default = global; switch to local via -local.

NOTE: actual repo file is elon_ko.sh (underscore).

## Classification
FULL — two distinct install modes via CLI flag.

## Workflow Path (COMPLETE)
REQUEST -> GRILL -> RESEARCH -> SPEC -> DEVELOP -> VALIDATE(FAIL D1) -> RESOLVE c1 (user=d) -> SPEC-rev+FIX -> re-VALIDATE(PASS 12/12) -> DocWorm -> DONE

## Phase Status
- VALIDATE: PASS 12/12 ACs (0 deviations, 0 new issues).
- DocWorm: done (README.md + CHANGELOG.md).
- Doc commit: b180e70.
- DONE: complete. HEAD=b180e70.

## Final feature (validated + documented)
- Two modes: GLOBAL (default, byte-identical to prior) + LOCAL (`-local`/`--local`).
- LOCAL: everything under ./.elon-ko/{bin, omp/natives/<ver>/, omp/plugins/, marketplaces.json, env.sh, .install.json}; NOTHING under $HOME (proven: isolated-HOME whole-~/.omp enumeration returned exactly the seed).
- Dual-knob: LOCAL exports PI_CONFIG_DIR (config) + XDG_DATA_HOME=$OMP_LOCAL_HOME (omp data: natives+plugins), pre-mkdir ./.elon-ko/omp (loader XDG gate).
- Activation: `source ./.elon-ko/env.sh` (5 vars).
- Mode-scoped uninstall: `-local uninstall` / `uninstall`.
- Coexistence + one-line cross-mode notice. Pre-release per mode.
- Cross-mode pruning hazard ELIMINATED (LOCAL omp prunes only its own natives dir).
- Latent global pre-release TAG-unbound crash fixed (behavior-neutral for stable).

## Key decision surfaced to user
D1: omp hardcodes natives to ~/.omp/natives/ (PI_CONFIG_DIR can't relocate; DrPe/SPEC had looked at an unused code path). User chose (d) dual-knob = only path to literal "nothing global". Overrode locked SPEC §12 XDG ban (evidence-justified, user-approved).

## Caveats (documented in README)
R-C auth isolation (separate agent.db); R-F XDG shell-scope (LOCAL-only); R-E baked paths; O1 macOS symlink cosmetic.

## Commit chain
[PROTO] d8c180a (GRILL), 909c0c3 (RESEARCH), f0d4bf9 (SPEC), e1beac5 (re-VALIDATE).
[IMPL] 8ca3d44, 3d0643f (initial LOCAL); d7eb160 (SPEC-rev), d3ca4dc (D1 fix).
[DOCS] b180e70 (HEAD).
