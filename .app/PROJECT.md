# PROJECT — elon-ko scaffold files load-bearing placement

## Request (verbatim)
AGENTS.md, APPEND_SYSTEM.md, PROTO.md, RULES.md only land in .omp/plugins/cache/marketplace/elon-ko/scaffold (download staging), never load-bearing. Research + redesign to place them load-bearing.

## Classification
FULL — omp-internals research (done) + redesign of elon_ko.sh + Plugin A packaging.

## Workflow Path
REQUEST -> RESEARCH(done) -> SPEC(done) -> DEVELOP(done) -> VALIDATE(in_progress) -> DONE

## Phase Status
- RESEARCH: done -> .app/RESEARCH-SCAFFOLD.md
- SPEC: done -> .app/SCAFFOLD-SPEC.md (AC-S1..S10)
- DEVELOP: done. Commits e1d9c2a (RULES->Plugin A rules/ + AGENTS coherence), ba92344 (elon_ko.sh deploy step +60). All 10 AC-S self-check PASS with real evidence.
- VALIDATE: in_progress (Validator — independent, LIVE agent-discovery for AC-S3)
- DONE: pending

## Implemented design
- elon_ko.sh: deploy_scaffold (L214-243) fetches AGENTS.md+PROTO.md from raw GitHub keyed to $REF -> <cwd>/, overwrite-always; AGENTS fatal / PROTO non-fatal on fetch fail; called in both LOCAL (L504) + GLOBAL (L666); summary notices; uninstall left-in-place notices (L287/L334).
- Plugin A: rules/ro-orchestrator-invariant.md NEW (alwaysApply:true; git-rename from scaffold/RULES.md); scaffold/RULES.md DELETED; scaffold/AGENTS.md coherence (+5/-2).
- package.json UNCHANGED (files includes 'rules').

## Key evidence (LeadDev, to re-verify independently)
- AGENTS/PROTO fetch 200, deployed byte-identical (sha 36f153d8...) both modes.
- AC-S8 failure semantics correct.
- AC-S5: rule ships (npm pack) + loads from local-path install at node_modules/elon-ko-gate/rules/.

## Residual / release caveat (surface to user)
- AC-S5: published tag v2.3.1 PREDATES the RULES move -> a real github:...#v2.3.1 stable install won't have the rule until a new Plugin A tag is cut AND elon_ko.sh default $REF bumped. Code correct; release-timing gap. Pre-release/tag installs DO get it.
- R-S1..R-S5 (LOW/MEDIUM, documented).

## Build-on (prior task FINAL)
LOCAL/GLOBAL install modes (12/12 ACs). Do NOT regress (AC-S6).

## Pending Asks
(none)
