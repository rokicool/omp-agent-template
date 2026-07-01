# PROJECT — elon-ko scaffold files load-bearing placement — DONE

## Request (verbatim)
AGENTS.md, APPEND_SYSTEM.md, PROTO.md, RULES.md only land in .omp/plugins/cache/marketplace/elon-ko/scaffold (download staging), never load-bearing. Research + redesign to place them load-bearing.

## Classification
FULL — research + redesign elon_ko.sh + Plugin A packaging.

## Workflow Path (COMPLETE)
REQUEST -> RESEARCH -> SPEC -> DEVELOP -> VALIDATE(PASS) -> DocWorm -> DONE

## Phase Status — ALL DONE
- RESEARCH: done (.app/RESEARCH-SCAFFOLD.md). SPEC: done (.app/SCAFFOLD-SPEC.md, AC-S1..S10).
- DEVELOP: done (e1d9c2a, ba92344). VALIDATE: PASS 10/10 ACs, 0 failed; AC-S3 LIVE-proven.
- DocWorm: done + committed (8bf4872). DONE. HEAD=8bf4872.

## Final result (validated)
- AGENTS.md -> <cwd>/AGENTS.md (overwrite-always, both modes); omp LOADS it (live sentinel proof). CORE DEFECT FIXED.
- PROTO.md -> <cwd>/PROTO.md (doc-only).
- APPEND_SYSTEM.md: already load-bearing via Plugin A; override <cwd>/.omp/APPEND_SYSTEM.md (documented, not copied).
- RULES.md -> Plugin A rules/ro-orchestrator-invariant.md (alwaysApply:true); scaffold/RULES.md deleted; AGENTS.md coherence.
- Uninstall leaves <cwd>/AGENTS.md + PROTO.md in place (notice printed).
- No regression to prior 12 install-mode ACs (AC-S6).
- IDEA-003 answered: agents[] = metadata only, not load-bearing; count not an omp field.

## Release-timing gap (OFFERED to user; not auto-done)
RULES move + AGENTS coherence are in working tree only. Published v2.3.1 lacks them; HEAD not pushed; elon_ko.sh $REF default v2.3.1. Stable consumers need: bump package.json version -> cut+push new tag -> bump elon_ko.sh:104 $REF. Pre-release/tag installs get fix now. Offered to cut release via wrapper.

## Commit chain (scaffold task)
[PROTO] c8f4fc3 (RESEARCH), d24856e (SPEC), c345209 (DEVELOP), 4d91497 (VALIDATE).
[IMPL] e1d9c2a (RULES move + AGENTS coherence), ba92344 (elon_ko.sh deploy step).
[DOCS] 8bf4872 (HEAD).

## Pending Asks
(none — release cut offered as optional follow-up)
