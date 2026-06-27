# SPEC — FULL Rebrand: `omp-agent-template` → `elon-ko` (v2.0.0)

> **Author:** LeadDev (`RebrandDev`). **Date:** 2026-06-27.
> **Phase:** BUILD (SPEC + DEVELOP), **EDITS ONLY** — no git commit/push/tag, no `gh repo rename`, no release. The irreversible rename/release is a separate later step after independent VALIDATION.
> **Supersedes:** `.app/REQ.md §2`'s underscore draft. This SPEC (and REQ.md §2 as corrected below) is the **authoritative** name table.

---

## 1. Situation

The project is rebranded from `omp-agent-template` to brand **`elon_ko`**. The
repo slug, npm package name, marketplace catalog name, and marketplace plugin
names all move to **hyphen-form** (`elon-ko`, `elon-ko-gate`, `elon-ko-agents`):
omp's marketplace/catalog/plugin-ID validator (`NAME_RE` =
`/^[a-z0-9]([a-z0-9.-]*[a-z0-9])?$/`) **rejects underscores** (DrPe finding
`agent://VerifyNpmAndUnderscore`), so the original underscore draft is
unusable for omp-registered names. Only the installer **filename** `elon_ko.sh`
survives with an underscore (an OS path, not omp-validated). The version bumps
`1.8.0 → 2.0.0` because the catalog-id + plugin-name changes are a breaking
public-API change for existing installs.

This SPEC is a pure, lockstep-critical, mechanical rename. There is no new
module, interface, or data model — every change is a string substitution
governed by the table below and the lockstep constraints in §4.

---

## 2. Authoritative Old → New Name Table (hyphens)

| # | Identity string | OLD | NEW | Role / source of truth |
|---|---|---|---|---|
| 1 | repo/dir/catalog name | `omp-agent-template` | `elon-ko` | repo slug, local dir, marketplace **catalog** `name` (`marketplace.json#name`) |
| 2 | GitHub owner/repo path | `rokicool/omp-agent-template` | `rokicool/elon-ko` | clone/raw/homepage URLs; installer `REPO` var |
| 3 | Plugin A (npm key + omp dep key + customType namespace) | `omp-agent-gate` | `elon-ko-gate` | `package.json#name`; `omp` dependency-resolution key; `customType` prefix |
| 4 | Plugin B (marketplace plugin entry) | `orchestrator-agents` | `elon-ko-agents` | `marketplace.json#plugins[].name` |
| 5 | marketplace catalog id | `@omp-agent-template` | `@elon-ko` | install id suffix |
| 6 | customType (wire-protocol) | `omp-agent-gate:dot-agreement` | `elon-ko-gate:dot-agreement` | `src/dot-agreement.ts:29` |
| 7 | customType (wire-protocol) | `omp-agent-gate:append-system` | `elon-ko-gate:append-system` | `src/enforce-orchestrator.ts:140` |
| 8 | version | `1.8.0` | `2.0.0` | `package.json#version`, `marketplace.json` (×2), installer default `REF` |
| 9 | default tag pin | `v1.8.0` | `v2.0.0` | installer `REF`, live install examples |

**Resulting install ids (post-rebrand):**
- Plugin A source: `github:rokicool/elon-ko#v2.0.0`
- Plugin B install: `omp plugin install elon-ko-agents@elon-ko`

**Naming convention (split, locked):**
- brand/CLI/installer-**filename** = `elon_ko` (underscore — matches the existing `elon_ko.sh`; a plain OS path, not omp-validated).
- repo slug + npm package + marketplace catalog + marketplace plugin names = `elon-ko` / `elon-ko-gate` / `elon-ko-agents` (hyphens — omp `NAME_RE`-valid; hyphens are also valid in omp's package-name regex).

**Installer filename:** KEEP `elon_ko.sh` as-is. Only its internal vars + banner text change.

---

## 3. Out of scope (HISTORY — leave untouched)

- **Shipped `CHANGELOG.md` entries `[v1.0]`…`[v1.8.0]`** — true record of what shipped under the old names. Rewriting falsifies history.
- **Frozen `.app/` subagent-panel protocol artifacts** — `.app/RESEARCH.md` and `.app/PROJECT.md` (point-in-time records of the v1.8.0 `subagent-panel` feature). Left byte-identical.
- `.app/REQ.md` is treated as frozen **except §2**, which is corrected to the hyphen table (this SPEC's §2 mirrors it). Its body prose (underscore new-names, pre-correction) is retained as historical analysis; §2 is authoritative.
- `package-lock.json` — regenerated from `package.json` via `npm install`, not hand-edited.
- The repo **rename itself** (`gh repo rename`), the `git tag v2.0.0`, the release, and `git remote set-url` are all deferred to the post-VALIDATION release step — NOT in this pass.
- `${{ github.repository }}` references in `release.yml`/`prerelease.yml` auto-track a GitHub rename — no edit needed.

---

## 4. CRITICAL LOCKSTEP constraints (each pair MUST land together)

### 4a. CI jq assertions ⇄ `package.json#name` ⇄ `marketplace.json` entry
`omp plugin list --json` emits whatever `package.json#name` and `marketplace.json`
declare, so `ci.yml`'s assertions must agree or the `jq -e` step fails:
- `ci.yml` `select(.name == "elon-ko-gate")` == `package.json#name` == Plugin A.
- `ci.yml` `.id == "elon-ko-agents@elon-ko"` == `<marketplace entry name>@<catalog name>`.

### 4b. `release.yml` artifact filenames ⇄ `package.json#name`
- Plugin A tarball is `npm pack`-**generated** from `package.json#name` → `elon-ko-gate-<ver>.tgz`. Every hardcoded ref (build comment, checksum, artifacts table, `files:` list) must read `elon-ko-gate`.
- Plugin B tarball is **explicit** (`tar -czf "elon-ko-agents-<ver>.tar.gz"`) + mirrors.

### 4c. `elon_ko.sh` uninstall key ⇄ `package.json#name`
`omp` resolves Plugin A under its package name, so the pre-install uninstall must
target the SAME key (`omp plugin uninstall elon-ko-gate`) or a stale ref triggers
a `bun install` `DependencyLoop` on drifted machines. Plugin B's install uses
`${PLUGIN_B}@${MARKETPLACE}` vars → auto-tracks to `elon-ko-agents@elon-ko`.

### 4d. customType strings (src ⇄ tests)
`src/dot-agreement.ts:29` emits `elon-ko-gate:dot-agreement`; `src/dot-agreement.test.ts:86,215`
assert it. `src/enforce-orchestrator.ts:140` emits `elon-ko-gate:append-system` (no
dedicated string assertion, shares the prefix). Rename src + tests together or the
test fails on 2 assertions.

### 4e. marketplace catalog name == installer `MARKETPLACE` var == `@elon-ko`
`marketplace.json#name` (`elon-ko`) == `elon_ko.sh` `MARKETPLACE` var (`elon-ko`)
== the `@elon-ko` suffix used everywhere in docs/CI.

---

## 5. Execution plan (per file) — as executed

| File | Changes |
|---|---|
| `package.json` | `name` → `elon-ko-gate`; `version` → `2.0.0`. |
| `.omp-plugin/marketplace.json` | catalog `name` + `owner.name` → `elon-ko`; plugin entry `name` → `elon-ko-agents`; `metadata.version` + `plugins[].version` → `2.0.0`; `homepage` → `rokicool/elon-ko`. |
| `src/dot-agreement.ts` | `DOT_CUSTOM_TYPE` → `elon-ko-gate:dot-agreement` (L29). |
| `src/enforce-orchestrator.ts` | comments L26 `orchestrator-agents`→`elon-ko-agents`, L45 `omp-agent-gate`→`elon-ko-gate`; `customType` L140 → `elon-ko-gate:append-system`. |
| `src/dot-agreement.test.ts` | customType assertions L86, L215 → `elon-ko-gate:dot-agreement` (lockstep with src). |
| `src/append-system.default.md` | L39 `omp-agent-gate`→`elon-ko-gate`, L43 `orchestrator-agents`→`elon-ko-agents` (LIVE user-visible framing). |
| `elon_ko.sh` | `REPO` L33→`rokicool/elon-ko`; `MARKETPLACE` L34→`elon-ko`; `PLUGIN_B` L35→`elon-ko-agents`; uninstall key L131→`elon-ko-gate`; default `REF` L44 + comment L14→`v2.0.0`; ALL banner/comment/URL old-name refs→new; extract-dir comment L103→`elon-ko-2.0.0`. **Filename stays `elon_ko.sh`.** |
| `README.md` | H1 L1→`elon-ko`; all `rokicool/omp-agent-template`→`rokicool/elon-ko`; raw URLs; marketplace/`omp plugin` refs; plugin-name mentions; `@omp-agent-template`→`@elon-ko`; live version pins `v1.8.0`→`v2.0.0`. (Subagent-panel "Available since v1.8.0" historical narrative: identity path updated, version left as historical.) |
| `.DEVREADME.md` | `Current version` L21→`2.0.0`; all live repo-path/plugin-name/version-pin refs→new (historical `1.2.1`/`v1.3.1`/`v1.8.0`-shipped notes left). |
| `scaffold/AGENTS.md` | L7 `omp-agent-gate`→`elon-ko-gate`, L8 `orchestrator-agents`→`elon-ko-agents`. |
| `scaffold/APPEND_SYSTEM.md` | L39 `omp-agent-gate`→`elon-ko-gate`, L43 `orchestrator-agents`→`elon-ko-agents`. |
| `scaffold/PROTO.md` | L5 `orchestrator-agents`→`elon-ko-agents`. |
| `scaffold/RULES.md` | (no identity literals — no change.) |
| `.github/workflows/ci.yml` | header comment L4-5; Plugin B smoke install/uninstall/remove L68,70,71; Plugin A uninstall L81; jq assertions + msgs L124,127-129,131-133. |
| `.github/workflows/release.yml` | header comment L8-9; step name L62; tar -czf L69; checksums L75-76; release-notes names L89,98,102; artifacts table L109-110; `files:` L114-115. |
| `.github/workflows/prerelease.yml` | (no hardcoded identity — `${{ github.repository }}` + `elon_ko.sh` filename only — NO change.) |
| `scripts/validate-plugins.sh` | comment/echo labels L6,7,33,35,71,74. |
| `CHANGELOG.md` | NEW top banner "Project renamed" + NEW `## [v2.0.0] - 2026-06-27` section (### Changed + ### Migration) above `[v1.8.0]`. Existing `v1.0`-`v1.8.0` entries untouched. |
| `package-lock.json` | regenerated via `npm install` (reflects `elon-ko-gate` + `2.0.0`). |

---

## 6. Acceptance criteria (verification gates)

1. `npm run typecheck` passes.
2. `dot-agreement` tests pass (renamed customType assertions).
3. Repo-wide residual search for the 4 old identity literals returns hits ONLY in: shipped CHANGELOG `v1.0`-`v1.8.0` entries, frozen `.app/{RESEARCH,PROJECT}.md` (and the rebrand's own `.app/{REQ,SPEC}.md` mapping records), and `package-lock.json`. Every other hit is a missed rename.
4. `marketplace.json` catalog + entry names match omp `NAME_RE` (`[a-z0-9.-]`, no underscore).
5. Lockstep checks 4a-4e all PASS.

Verification results are recorded in the final yield payload.
