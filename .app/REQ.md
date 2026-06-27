# Requirements Document — FULL Rebrand: `omp-agent-template` → `elon_ko`

> **Phase:** GRILL COMPLETE → REQ synthesis (input to LeadDev SPEC). All decisions below are USER-LOCKED; do not re-open. This document is the *what* (requirements + lockstep constraints), not the *how* (design/impl is LeadDev's).
> **Synthesizer:** ReqGuru (`WriteReqMd`). **Date:** 2026-06-27.
> **Source of truth for citations:** every `file:line` below was re-verified by `read`/`search` against the current repo at synthesis time (commit at v1.8.0). `package-lock.json` lines are stale (v1.5.0) and will auto-regenerate.

---

## 1. Scope Statement (one line)

Rebrand the entire project from `omp-agent-template` to brand **`elon_ko`** (underscore everywhere — repo slug, dir, catalog, npm, marketplace, plugin names), renaming all four identity strings + both wire-protocol customTypes, bumping to **v2.0.0**, renaming the GitHub repo `rokicool/omp-agent-template` → `rokicool/elon_ko`, while leaving shipped CHANGELOG history and frozen `.app/` artifacts untouched (banner only).

---

## 2. Exact Old → New Name Table

> **CORRECTION (authoritative):** the original draft of this table used underscore new-names (`elon_ko`, `elon_ko_gate`, `elon_ko_agents`). omp's marketplace/catalog/plugin-ID `NAME_RE` (`/^[a-z0-9]([a-z0-9.-]*[a-z0-9])?$/`) **rejects underscores** (DrPe finding `agent://VerifyNpmAndUnderscore`). All omp-registered new names therefore use **hyphens**. The table below supersedes the underscore draft; the authoritative mirror is `.app/SPEC.md §2`. The installer FILENAME `elon_ko.sh` is the only underscore survivor (an OS path, not omp-validated).

| # | Identity string | OLD | NEW | Role |
|---|---|---|---|---|
| 1 | repo/dir/catalog name | `omp-agent-template` | `elon-ko` | repo slug, local dir, marketplace **catalog** name (`marketplace.json#name`) |
| 2 | GitHub owner/repo path | `rokicool/omp-agent-template` | `rokicool/elon-ko` | clone/raw/homepage URLs; installer `REPO` var |
| 3 | Plugin A (npm key + omp dep key) | `omp-agent-gate` | `elon-ko-gate` | `package.json#name`; the omp dependency-resolution key |
| 4 | Plugin B (marketplace plugin entry) | `orchestrator-agents` | `elon-ko-agents` | `marketplace.json#plugins[].name` |
| 5 | marketplace catalog id | `@omp-agent-template` | `@elon-ko` | install id suffix: `orchestrator-agents@omp-agent-template` → `elon-ko-agents@elon-ko` |
| 6 | customType (wire-protocol) | `omp-agent-gate:dot-agreement` | `elon-ko-gate:dot-agreement` | `src/dot-agreement.ts:29` |
| 7 | customType (wire-protocol) | `omp-agent-gate:append-system` | `elon-ko-gate:append-system` | `src/enforce-orchestrator.ts:140` |

**Installer filename:** KEEP `elon_ko.sh` as-is (already brand-aligned; only its internal vars + banner text change). The optional local-dir rename `~/github/omp-agent-template` → `~/github/elon-ko` is a user-side `mv`, git-irrelevant.

**Resulting install ids (post-rebrand):**
- Plugin A source: `github:rokicool/elon-ko#v2.0.0`
- Plugin B install: `omp plugin install elon-ko-agents@elon-ko`

---

## 3. Categorized Rename Surface

All occurrences below are **in-scope** (non-historical). Counts are complete match-lists from exhaustive `search` of the full repo (`gitignore=false`). File:line verified.

### 3a. Git / remote / repo identity (`rokicool` + repo-slug literals)
~14 `rokicool` literals, all of form `rokicool/omp-agent-template`:
- **README.md:50,57,72,87** — `raw.githubusercontent.com/rokicool/omp-agent-template/...`
- **README.md:95,100,181** — `github:rokicool/omp-agent-template#v1.8.0`; `omp plugin marketplace add rokicool/omp-agent-template`
- **elon_ko.sh:13,14,25** — raw-URL examples in comment header
- **elon_ko.sh:33** — `REPO="rokicool/omp-agent-template"` (**SOURCE-OF-TRUTH var**)
- **.DEVREADME.md:244,271,306** — install examples + DependencyLoop note
- **marketplace.json:18** — `"homepage":"https://github.com/rokicool/omp-agent-template"`

**Auto-tracking (NO edit needed):** `release.yml:101` and `prerelease.yml:77,86` use `${{ github.repository }}`, which emits the new slug automatically after the GitHub repo rename. Verified: `prerelease.yml` has **zero** hardcoded identity literals.

### 3b. npm package name (Plugin A: `omp-agent-gate` → `elon_ko_gate`)
- **package.json:2** — `"name":"omp-agent-gate"` (**SOURCE OF TRUTH** — the omp dependency key)
- **package-lock.json:2,8** — stale v1.5.0; **auto-regenerates** from `package.json` on bump (not a manual rename target)
- No `repository`/`homepage`/`bugs`/`publishConfig`/`.npmrc` fields exist (verified) — `name` is the only npm-identity field.

### 3c. Marketplace plugin/catalog (Plugin B + catalog)
- **marketplace.json:3** — catalog `"name":"omp-agent-template"` → `elon_ko`
- **marketplace.json:4** — `"owner":{ "name":"omp-agent-template" }` → `elon_ko`
- **marketplace.json:12** — `"name":"orchestrator-agents"` (plugin entry) → `elon_ko_agents`
- **marketplace.json:18** — homepage (see 3a)
- **marketplace.json:7,16** — `version` fields (see §6)

### 3d. Code namespaces — customTypes + their tests (MUST change together, see §4d)
- **src/dot-agreement.ts:29** — `const DOT_CUSTOM_TYPE = "omp-agent-gate:dot-agreement"`
- **src/enforce-orchestrator.ts:140** — `customType: "omp-agent-gate:append-system"`
- **src/enforce-orchestrator.ts:26,45** — comments naming `orchestrator-agents` / `omp-agent-gate` (doc; update for consistency)
- **src/dot-agreement.test.ts:86,215** — `equal(msg!.customType, "omp-agent-gate:dot-agreement")` (both assertions)
- **src/append-system.default.md:39,43** — bundled Elon framing naming `omp-agent-gate` + `orchestrator-agents` (injected every session — user-visible)

### 3e. Docs / URLs (README, .DEVREADME, scaffold — all shipped to consumers)
- **README.md:** :1 (H1 title), :19,:20 (plugin table), :39,:53,:94,:97,:100,:101,:185,:215,:224 + the `rokicool` URLs at :50,:57,:72,:87,:95,:100,:181
- **.DEVREADME.md:** :10,:14,:15,:122,:233,:234,:244,:271,:295,:297,:306
- **scaffold/AGENTS.md:7,8** — names both plugins (shipped to downstream projects)
- **scaffold/APPEND_SYSTEM.md:39,43** — names both plugins
- **scaffold/PROTO.md:5** — names `orchestrator-agents`

### 3f. CI workflows (`.github/workflows/*`) — see §4a, §4b for lockstep
- **ci.yml:4,5** (identity header comment), **:68,:70,:71** (Plugin B smoke-test install/uninstall/remove), **:81** (Plugin A uninstall), **:124,:127,:128,:129** (Plugin A jq assertion + msgs), **:131,:132,:133** (Plugin B jq id assertion + msgs)
- **release.yml:8,9** (header comment), **:62** (step name), **:69,75,76** (build + checksum), **:89,98,102,109,110,114,115** (release-notes body + `files:` list)
- **prerelease.yml** — auto-tracks via `github.repository`; **no edit**.

### 3g. Installer internals (`elon_ko.sh`)
- **:3,6,7,13,14,25** — comment header (names + raw URLs)
- **:33** — `REPO=` var (see 3a)
- **:34** — `MARKETPLACE="omp-agent-template"` → `elon_ko` (comment: "value of marketplace.json#name")
- **:35** — `PLUGIN_B="orchestrator-agents"` → `elon_ko_agents`
- **:44** — `REF="${OMP_AGENT_REF:-v1.8.0}"` → default tag (see §6)
- **:103** — comment re: archive extract-dir name (`omp-agent-template-1.8.0`; auto-derived from slug → becomes `elon_ko-2.0.0`)
- **:123,124,130,131,133** — Plugin A banner + `uninstall omp-agent-gate` key + `install` + ok msg (see §4c)
- **:135** — Plugin B banner (uses `${PLUGIN_B}` var → auto-tracks)
- **:145,148,149,166,169,170** — summary banners (pre-release + stable) naming `omp-agent-template`/`omp-agent-gate`/`orchestrator-agents`

### 3h. Other
- **scripts/validate-plugins.sh:6,7,33,35,71,74** — header comments + echo labels naming both plugins
- **`.omp/elon.json`** — `{"enabled":true}`; contains NO identity string; OUT OF SCOPE (brand-adjacent only).

---

## 4. CRITICAL LOCKSTEP Constraints

A rename is a coupled change. Each pair below MUST land together in the same commit/PR or the pipeline breaks.

### 4a. ci.yml jq assertions (coupled to surviving names)
ci.yml's final "Assert both plugins installed" step hardcodes the exact registry/list shape; `npm pack` + `omp plugin list --json` emit whatever `package.json#name` and `marketplace.json` declare. Therefore:
- **ci.yml:127** — `.name == "omp-agent-gate"` → `"elon_ko_gate"`
- **ci.yml:131** — `.id == "orchestrator-agents@omp-agent-template"` → `"elon_ko_agents@elon_ko"`
- **ci.yml:124,128,129,132,133** — echo/error/ok message strings naming the plugins
- **ci.yml:68,70** — `omp plugin install/uninstall orchestrator-agents@omp-agent-template` → `elon_ko_agents@elon_ko`
- **ci.yml:71** — `omp plugin marketplace remove omp-agent-template` → `elon_ko`
- **ci.yml:81** — `omp plugin uninstall omp-agent-gate` → `elon_ko_gate`

**Failure mode if decoupled:** CI's `jq -e` returns non-zero → job fails on `select(...)` (length 0).

### 4b. release.yml artifact filenames
- **Plugin A tarball is GENERATED** by `npm pack` from `package.json#name` → after bump the file is `elon_ko_gate-<ver>.tgz`. The **hardcoded** references that must match it: **release.yml:75** (`sha256sum "omp-agent-gate-..."`), **:109** (artifacts table), **:114** (`files:` list), **:8** (comment). → all become `elon_ko_gate`.
- **Plugin B tarball is EXPLICIT** — `tar -czf "orchestrator-agents-<ver>.tar.gz"` at **release.yml:69** → change the literal to `elon_ko_agents`; mirror at **:76** (checksum), **:110** (table), **:115** (`files:`), **:9** (comment).

**Failure mode if decoupled:** `sha256sum` fails (file not found) → release job dies before publishing; or a release ships with missing/misnamed artifacts.

### 4c. `elon_ko.sh` DependencyLoop logic (uninstall/install keys)
`omp` resolves Plugin A's dependency under its **package name**. Once `package.json#name` = `elon_ko_gate`, the installed plugin registers under that key, so the pre-install uninstall must target the SAME key or it silently no-ops and a stale ref triggers `bun DependencyLoop`:
- **elon_ko.sh:131** — `omp plugin uninstall omp-agent-gate` → `omp plugin uninstall elon_ko_gate` (**HARD KEY**)
- Plugin B install at **:137** uses `${PLUGIN_B}@${MARKETPLACE}` → auto-tracks once :34/:35 vars change → resolves to `elon_ko_agents@elon_ko`.

**Failure mode if decoupled:** upgrade installs leave the old `omp-agent-gate` ref locked → `bun install` aborts `DependencyLoop` on every run on drifted machines.

### 4d. customType strings (src + tests together)
Two wire-protocol discriminators are produced by src and asserted by tests:
- `omp-agent-gate:dot-agreement`: **src/dot-agreement.ts:29** ⇄ **src/dot-agreement.test.ts:86, :215**
- `omp-agent-gate:append-system`: **src/enforce-orchestrator.ts:140** (no dedicated test asserting this exact string, but it shares the `omp-agent-gate:` prefix — rename for consistency).

**Failure mode if decoupled:** `dot-agreement.test.ts` asserts the old customType while src emits the new → `npm test` fails (2 assertions).

---

## 5. GitHub Repo Rename Step

Run **after** the rename work lands on `main` (so the renamed checkout's `origin` tracks the new slug), **before** tagging v2.0.0:
```
gh repo rename elon_ko   # in repo rokicool/omp-agent-template → rokicool/elon_ko
```
- **Exact new slug:** `rokicool/elon_ko` (underscore, per NAMING decision).
- **GitHub auto-redirects** old `rokicool/omp-agent-template` URLs → existing `#v1.8.0` tag links and the v1.x release tarballs keep resolving during/after transition (this is why shipped CHANGELOG URLs are left intact — they still work).
- `${{ github.repository }}` (release.yml:101, prerelease.yml:77,86) then emits `rokicool/elon_ko` automatically.
- Update the ~14 hardcoded `rokicool` literals (§3a) + `marketplace.json:18` homepage so the *source* matches the new identity (redirects are a safety net, not a substitute).
- **Local remote refresh:** `git remote set-url origin https://github.com/rokicool/elon_ko.git` (post-rename).

---

## 6. Version Bump to 2.0.0

Rationale: the catalog-id change `@omp-agent-template` → `@elon_ko` (and both plugin-name changes) is a **breaking public-API change** for existing `orchestrator-agents@omp-agent-template` installs → semver **MAJOR**. Bump these together:
- **package.json:3** — `"version":"1.8.0"` → `"2.0.0"`
- **marketplace.json:7** (`metadata.version`) and **:16** (`plugins[].version`) → `2.0.0`
- **elon_ko.sh:44** — default `OMP_AGENT_REF` → `v2.0.0`
- **All `#v1.8.0` doc pins** → `#v2.0.0`: README.md:57,:95,:181; .DEVREADME.md:244,:306; elon_ko.sh:14 (comment example)
- **CHANGELOG.md** — add a new `## [v2.0.0] - <date>` section (insert above `## [v1.8.0]`, newest-first; the `[v2.0.0]` section documents the rebrand + migration). Then tag `git tag v2.0.0` and push (triggers `release.yml`).

---

## 7. HISTORY Policy (LEAVE + BANNER; do NOT rewrite)

**OUT OF SCOPE for rename** — leave AS-IS as true historical record:
- **Shipped CHANGELOG.md entries** `[v1.0]`…`[v1.8.0]` — they reference `omp-agent-gate`/`orchestrator-agents`/`omp-agent-template` extensively (e.g. CHANGELOG.md:118,158,160,167,174,177,181,182). Rewriting falsifies what shipped.
- **Frozen `.app/` subagent-panel protocol artifacts** — `.app/REQ.md` (current file overwritten by THIS spec; the prior one), `.app/RESEARCH.md:15,16,17`, `.app/SPEC.md:5,160,165,166`, `.app/PROJECT.md:37`. These are point-in-time records of the v1.8.0 `subagent-panel` feature and must not be rewritten.
- **`package-lock.json`** — regenerates on bump, not a historical-edit target.

**IN SCOPE (additive only):**
- A **"Project renamed" banner** at the very top of `CHANGELOG.md` (after the `# Changelog` intro, before `## [v1.8.0]`) stating the project was renamed `omp-agent-template` → `elon_ko` at v2.0.0, old names remain valid as historical record, and old GitHub URLs redirect.
- A **Migration section** inside the `[v2.0.0]` CHANGELOG entry (D8): uninstall old names, reinstall new; note repo rename + redirect; mirror `elon_ko.sh`'s DependencyLoop handling.

---

## 8. PENDING VERIFICATION (gating SPEC / DEVELOP) — delegate to DrPe, parallel

Two unknowns must be resolved before SPEC/DEVELOP can finalize. Both are factual lookups; run concurrently:

1. **Is `omp-agent-gate` published to the public npm registry?**
   - *Repo evidence (inference, F<0.8):* NO — distribution is git-ref-based; release artifacts are `npm pack` tarballs attached to GitHub Releases (`release.yml`), not `npm publish`; no `publishConfig`/`.npmrc`/`prepublishOnly`.
   - **If YES (verified via `npm view omp-agent-gate`):** add a **deprecate + republish sub-plan** — `npm deprecate omp-agent-gate@* "renamed to elon_ko_gate"` and publish `elon_ko_gate@2.0.0` (requires npm owner access + an `npm publish` step, currently absent from CI).
   - **If NO:** no-op; the npm-key rename is purely an omp dependency-resolution change.
   - **Gate:** SPEC must include the sub-plan if YES; DEVELOP must not ship a rename that strands a published package.

2. **Does `omp` accept underscore (`_`) in plugin names and marketplace catalog names?**
   - *Risk:* underscore everywhere is unconventional (npm/GitHub/marketplace names are usually hyphenated). If `omp` rejects `_` in a plugin name or catalog id, the install/uninstall/jq assertions fail at runtime even with correct lockstep.
   - **If NO:** **ESCALATE to Elon** — the NAMING decision (underscore everywhere) may need revisiting to SPLIT (brand/CLI=`elon_ko`, slugs=`elon-ko`). This is the one locked decision that empirical evidence can override.
   - **If YES:** proceed as-is.
   - **Gate:** DEVELOP cannot begin the plugin-name rename until confirmed; otherwise CI smoke-tests will fail opaquely.

---

## 9. Acceptance Criteria

Observable, testable conditions — the SPEC/DEVELOP/VALIDATE loop is complete when ALL hold:

1. **Zero residual old-name occurrences** in non-historical files: a repo-wide `search` for `omp-agent-template`, `omp-agent-gate`, `orchestrator-agents`, `rokicool/omp-agent-template`, and `omp-agent-gate:dot-agreement`/`omp-agent-gate:append-system` returns matches ONLY inside shipped CHANGELOG entries (v1.0–v1.8.0) and frozen `.app/{REQ,RESEARCH,SPEC,PROJECT}.md`. (The `elvon_ko.sh` filename is `elon_ko.sh` — not an old name.)
2. **`npm run typecheck` passes** (tsc --noEmit) — confirms the customType rename is type-clean.
3. **`npm test` passes** — specifically `src/dot-agreement.test.ts:86,215` assertions on `elon_ko_gate:dot-agreement`.
4. **CI name-assertions match new names** — green CI run where `ci.yml:127` asserts `elon_ko_gate` and `ci.yml:131` asserts `elon_ko_agents@elon_ko`; the Plugin A/B smoke-test install/uninstall paths use the new ids.
5. **`release.yml` artifacts are named `elon_ko_gate-2.0.0.tgz` and `elon_ko_agents-2.0.0.tar.gz`** and all four cross-references (build/checksum/table/files) agree.
6. **`elon_ko.sh` runs end-to-end** on a clean machine AND a drifted machine: `omp plugin uninstall elon_ko_gate` resolves (no stray `omp-agent-gate` key), both plugins register, `omp plugin install elon_ko_agents@elon_ko` succeeds.
7. **Version 2.0.0 is consistent** across `package.json:3`, `marketplace.json:7,:16`, `elon_ko.sh:44`, and all `#v2.0.0` doc pins.
8. **`v2.0.0` is tagged and released** (`git tag v2.0.0` → `release.yml` publishes the GitHub Release with correctly-named artifacts + SHA256SUMS).
9. **GitHub repo renamed** to `rokicool/elon_ko` (`gh repo rename elon_ko`); `git remote` points at the new slug; `${{ github.repository }}` emits `rokicool/elon_ko`.
10. **Old URLs redirect:** `https://github.com/rokicool/omp-agent-template` and its `raw`/`archive` paths resolve (HTTP redirect) to `rokicool/elon_ko` — including the v1.x tag tarballs.
11. **HISTORY preserved:** shipped CHANGELOG entries (v1.0–v1.8.0) and frozen `.app/` artifacts are byte-identical to pre-rebrand (verified by diff); the "Project renamed" banner + `[v2.0.0]` Migration section are the only CHANGELOG additions.

---

## Open Questions

- **[BLOCKER, §8.2]** Does `omp` accept underscore plugin/marketplace names? (If NO → NAMING decision reopens → escalate to Elon.) Pending DrPe.
- **[GATING, §8.1]** Is `omp-agent-gate` on public npm? (If YES → SPEC adds a deprecate+republish sub-plan.) Pending DrPe.

All other decision branches are LOCKED (user-confirmed). No further grill rounds required.
