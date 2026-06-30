# RESEARCH — Can `omp` install plugins to a PROJECT-LOCAL home?

> **Type:** Mechanism feasibility study (RESEARCH-phase deliverable for the
> `elon_ko.sh` LOCAL/GLOBAL install-modes feature).
> **Investigator:** DrPe · **Date:** 2026-06-30 · **Access date for all
> upstream omp sources below: 2026-06-30.**
> **Anchored to:** `.app/REQ.md` (LOCAL layout D1, NFR-4, AC-2, AC-12,
> RESEARCH Dependency §151–159). This report answers OQ-1 / AC-12.
> **Upstream:** omp = `can1357/oh-my-pi` (a published variant of
> `earendil-works/pi`); all plugin/config path code lives in
> `packages/utils/src/dirs.ts` and `packages/coding-agent/src/extensibility/plugins/**`.

---

## Scope

Determine definitively whether `omp` can install **Plugin A**
(`elon-ko-gate`, extension-package) and **Plugin B** (`elon-ko-agents`,
marketplace) into a **project-local** `./.elon-ko/plugins/` with **nothing**
written under `~/.omp/`, and whether the omp/bun **binaries** can be vendored
into `./.elon-ko/bin/`. Dimensions: (1) the exact mechanism omp reads to
resolve its plugin/config directory; (2) whether any env var / flag / config
relocates it cleanly; (3) where each `omp plugin …` write actually lands and
whether it can be forced project-local; (4) bin-vendoring knobs in the omp
and bun installers; (5) side effects on omp's other global state; (6) the
least-invasive fallback if no clean relocation exists.

Sources consulted (all read in full, not snippet-cited): the omp source files
`packages/utils/src/dirs.ts`, `…/plugins/manager.ts` (via the plumbing doc),
`…/plugins/marketplace/registry.ts`, `…/plugins/marketplace/cache.ts`; the omp
docs `environment-variables.md`, `plugin-manager-installer-plumbing.md`,
`marketplace.md`, `coding-agent/DEVELOPMENT.md`; the omp installer
`scripts/install.sh` (served at `https://omp.sh/install`); the bun installer
`https://bun.sh/install`; `earendil-works/pi` issue #534 (the
`PI_CONFIG_DIR` semantics thread); plus the in-repo `elon_ko.sh`, `CHANGELOG.md`,
and the prior `.app/RESEARCH.md`.

---

## TL;DR — direct answer (Q1)

**PARTIAL — and not in the shape REQ's per-mode table implies.**

- omp has **NO `OMP_HOME`**, **NO `--plugin-dir` / `--prefix` flag**, **NO
  config-file key**, and **NO full-path plugin-home override.** The single
  mechanism omp reads to resolve its plugin directory is `getPluginsDir()` in
  `packages/utils/src/dirs.ts`, which computes
  `path.join(configRoot, "plugins")`, where
  `configRoot = getBaseConfigRoot() = path.join(os.homedir(), PI_CONFIG_DIR || ".omp")`.
  Plugins are therefore **always a subdir of the config root**, and the config
  root is **always `$HOME` + a dirname suffix**.

- The only env vars that move *any* omp path are `PI_CONFIG_DIR` (config-root
  **dirname under home**, *not* a full path), `PI_CODING_AGENT_DIR` (agent dir
  only — **does not touch plugins**), and the `XDG_*_HOME` set (Linux/macOS;
  relocates omp's whole `data` category, *not* selectively plugins). None is a
  clean "plugins → `./.elon-ko/plugins/` and leave `~/.omp/` untouched" knob.

- **However**, because `getBaseConfigRoot()` is a bare `path.join(os.homedir(),
  PI_CONFIG_DIR)` with **zero validation** on `PI_CONFIG_DIR`, setting
  `PI_CONFIG_DIR` to a value that resolves to `$PWD/.elon-ko` relocates the
  **entire omp home** (plugins + marketplaces.json + agent/ + everything) into
  `./.elon-ko/`. Plugins then land at **exactly `./.elon-ko/plugins/`**, which
  matches REQ D1. This is achievable and is the recommended mechanism — with
  documented caveats (whole-home blast radius; `..`-relpath when the project is
  outside `$HOME`; env must be re-exported every run).

- **Plugin B (marketplace) has one write that `XDG_DATA_HOME` alone CANNOT
  move:** `marketplaces.json` is written to `getConfigRootDir()` (raw
  `$HOME/PI_CONFIG_DIR`), *not* the XDG-redirected data tree. So an
  XDG-only strategy still leaks `~/.omp/marketplaces.json` under `$HOME`. Only
  relocating `configRoot` itself (via `PI_CONFIG_DIR`) closes this gap.

**Bottom line:** LOCAL plugin install is **achievable** via `PI_CONFIG_DIR`
whole-home relocation, **not** via a plugins-only flag. See Recommendations R1.

---

## Findings

### F1. How omp resolves its plugin directory (the exact mechanism)

`packages/utils/src/dirs.ts` (raw:
`https://raw.githubusercontent.com/can1357/oh-my-pi/main/packages/utils/src/dirs.ts`)
is the single source of truth. The relevant code, quoted verbatim:

```ts
export const CONFIG_DIR_NAME: string = ".omp";
…
export function getConfigDirName(): string {
    return process.env.PI_CONFIG_DIR || CONFIG_DIR_NAME;
}
…
function getBaseConfigRoot(): string {
    return path.join(os.homedir(), getConfigDirName());
}
…
export function getPluginsDir(home?: string): string {
    if (home !== undefined && home !== RESOLVER_HOME) {
        return path.join(home, getConfigDirName(), "plugins");   // test-only branch
    }
    return dirs.rootSubdir("plugins", "data");                    // production branch
}
```

and `DirResolver.rootSubdir`:

```ts
rootSubdir(subdir: string, xdg?: XdgCategory): string {
    const base = xdg ? this.#rootDirs[xdg] : this.configRoot;     // configRoot unless XDG
    const result = path.join(base, subdir);
    return result;
}
```

with `this.configRoot = getProfileConfigRoot(profile)` → `getBaseConfigRoot()`
(`path.join(os.homedir(), PI_CONFIG_DIR||".omp")`).

**Resolution chain (production, no XDG, default profile):**

```
getPluginsDir()
  = dirs.rootSubdir("plugins", "data")
  = path.join(configRoot, "plugins")
  = path.join( path.join(os.homedir(), process.env.PI_CONFIG_DIR || ".omp"), "plugins")
  = ~/.omp/plugins            (default)
```

- **Source:** `packages/utils/src/dirs.ts` (`getConfigDirName`, `getBaseConfigRoot`,
  `getPluginsDir`, `DirResolver` ctor, `rootSubdir`).
- **Confidence: High** — read directly from the runtime source; the env-vars doc
  corroborates: *"`PI_CONFIG_DIR` — Config root dirname under home (default
  `.omp`)"* (`docs/environment-variables.md` §6).

### F2. `PI_CONFIG_DIR` is a "dirname under home" suffix, NOT a full-path override

`getConfigDirName()` returns `process.env.PI_CONFIG_DIR` **raw, with no
validation** (contrast `normalizeProfileName`, which rejects `.`/`..` for
profiles — `PI_CONFIG_DIR` has no such guard). It is then fed into
`path.join(os.homedir(), …)`. Consequences of `path.join` semantics:

| `PI_CONFIG_DIR` value | `path.join(os.homedir(), value)` | Escapes `$HOME`? |
|---|---|---|
| `.omp` (default) | `~/.omp` | no |
| `.config/omp` | `~/.config/omp` | no (still under `$HOME`) |
| `github/elon-ko/.elon-ko` (project under `$HOME`) | `~/github/elon-ko/.elon-ko` = `$PWD/.elon-ko` | **no, but lands inside the project** |
| `../../tmp/proj/.elon-ko` (project outside `$HOME`) | `/tmp/proj/.elon-ko` | **yes, via `..` normalization** |
| `/abs/path` (absolute) | `~/abs/path` (leading slash stripped) | **no — appended, NOT an override** |

So: (a) an **absolute** `PI_CONFIG_DIR` does **not** override — it gets nested
under `$HOME`; (b) a **relative subpath** to a project that lives under
`$HOME` resolves to that project cleanly (no `..`); (c) a project **outside**
`$HOME` is reachable only via leading `..` segments.

- **Source:** `dirs.ts` (`getConfigDirName`, no validation); `path.join`
  semantics (Node `node:path`); `docs/environment-variables.md` §6 ("dirname
  under home").
- **Corroborating:** `earendil-works/pi` issue #534 (omp's upstream)
  establishes `PI_CONFIG_DIR` is *the* config-location escape hatch and is a
  dirname-under-home, not XDG-compliant by itself:
  `https://github.com/earendil-works/pi/issues/534`.
- **Confidence: High.**

### F3. Where each `omp plugin …` write actually lands (the write map)

From `…/plugins/marketplace/registry.ts` (raw path under
`packages/coding-agent/src/extensibility/plugins/marketplace/registry.ts`)
and `…/marketplace/cache.ts`, plus `docs/plugin-manager-installer-plumbing.md`
and `docs/marketplace.md`:

| Operation | What is written | Path helper | Default location | XDG-redirectable? |
|---|---|---|---|---|
| **Plugin A** `omp plugin install github:…` (npm/git) | `package.json`, `node_modules/<pkg>`, `omp-plugins.lock.json` | `getPluginsDir()` (`bun install` run there) | `~/.omp/plugins/` | **Yes** (`data` category) |
| **Plugin B** `omp plugin marketplace add` | **`marketplaces.json`** (catalog registry) | `getConfigRootDir()` | `~/.omp/marketplaces.json` | **NO** — `configRoot` is raw `$HOME/PI_CONFIG_DIR` |
| **Plugin B** `omp plugin install X@Y` (user scope) | `installed_plugins.json` | `getPluginsDir()` | `~/.omp/plugins/installed_plugins.json` | **Yes** |
| **Plugin B** `omp plugin install X@Y --scope project` | `installed_plugins.json` (**manifest only**) | `getProjectAgentDir(cwd)` = `<cwd>/.omp/plugins/installed_plugins.json` | already project-local | n/a |
| **Plugin B** cached plugin files (both scopes) | `<mkt>___<plugin>___<ver>/` | `getPluginsCacheDir()` = `getPluginsDir()/cache/plugins` | `~/.omp/plugins/cache/plugins/…` | **Yes** |

Key code from `registry.ts`:

```ts
export function getMarketplacesRegistryPath(): string {
    return path.join(getConfigRootDir(), "marketplaces.json");   // ← configRoot, NOT XDG
}
export function getInstalledPluginsRegistryPath(): string {
    return path.join(getPluginsDir(), "installed_plugins.json");
}
export function getMarketplacesCacheDir(): string { return path.join(getPluginsDir(), "cache", "marketplaces"); }
export function getPluginsCacheDir(): string    { return path.join(getPluginsDir(), "cache", "plugins"); }
```

**Critical implication:** `--scope project` does **not** make Plugin B
project-local in *files* — only the *manifest* (`<cwd>/.omp/plugins/installed_plugins.json`)
moves; the actual cached plugin directory and `marketplaces.json` stay global
under `~/.omp/`. And `marketplaces.json` is written to `getConfigRootDir()`,
which **no `XDG_*` var touches** — only `PI_CONFIG_DIR` moves it.

- **Sources:** `marketplace/registry.ts` (path helpers), `marketplace/cache.ts`
  (`cachePlugin` → `getPluginsCacheDir`), `docs/marketplace.md` ("Scopes" +
  "On-disk layout"), `docs/plugin-manager-installer-plumbing.md` ("On-disk
  model" + "Link flow").
- **Confidence: High.**

### F4. XDG is a real but *blunt* relocation (whole `data` category, Linux/macOS)

In the `DirResolver` constructor (`dirs.ts`), on Linux/macOS with the default
profile, if `$XDG_DATA_HOME/omp` **exists on disk** (`fs.existsSync`), the
entire `data` category (which includes `plugins/`, `node_modules`, the plugin
cache, `agent.db`, `sessions`, `history.db`, `blobs`, `models.db`, …) redirects
to `$XDG_DATA_HOME/omp/`:

```ts
if ((process.platform === "linux" || process.platform === "darwin") && isDefault) {
    const resolveIf = (envVar: string) => {
        const value = process.env[envVar]; if (!value) return undefined;
        const appRoot = path.join(value, APP_NAME);           // $XDG_DATA_HOME/omp
        if (fs.existsSync(appRoot)) { return appRoot; }        // ← existence gate
    };
    xdgData = resolveIf("XDG_DATA_HOME"); …
}
```

`getPluginsDir()` is `rootSubdir("plugins","data")`, so under XDG plugins become
`$XDG_DATA_HOME/omp/plugins/`. A migration command exists:
`omp config init-xdg` is a registered action
(`packages/coding-agent/src/commands/config.ts` → `ACTIONS = […, "init-xdg"]`).

**Why XDG is inferior to `PI_CONFIG_DIR` for LOCAL mode:**
1. It does **not** move `marketplaces.json` (configRoot, F3) → still leaks
   `~/.omp/marketplaces.json` under `$HOME` → **violates NFR-4**.
2. It moves *all* data-category state (sessions, auth db, history), not just
   the elon-ko plugins — large blast radius.
3. `XDG_DATA_HOME` is a system-wide convention; exporting it globally breaks
   every other XDG-aware tool, so it can only be a per-invocation export —
   meaning every `omp` run in the project must re-source it, and a bare `omp`
   without it reads `~/.omp` again (plugins vanish).
4. Requires pre-`mkdir $XDG_DATA_HOME/omp` (the `existsSync` gate).

- **Sources:** `dirs.ts` `DirResolver` XDG block + header comment;
  `commands/config.ts` (`init-xdg` action); `docs/environment-variables.md` §6.
- **Confidence: High.**

### F5. `PI_CONFIG_DIR` whole-home relocation is the cleanest achievable LOCAL mechanism

Because **every** omp path (configRoot, plugins, agent dir, marketplaces.json,
install-id, all `rootSubdir`/`agentSubdir` outputs) derives from the single
`configRoot = path.join(os.homedir(), PI_CONFIG_DIR)`, exporting
`PI_CONFIG_DIR` so that `configRoot` resolves to `$PWD/.elon-ko` relocates the
**entire omp home** into the project in one knob:

- `getPluginsDir()` → `$PWD/.elon-ko/plugins` ✅ (matches REQ D1 exactly)
- `getMarketplacesRegistryPath()` → `$PWD/.elon-ko/marketplaces.json` ✅ (the F3 leak is closed)
- `getPluginsCacheDir()` → `$PWD/.elon-ko/plugins/cache/plugins` ✅
- `getInstallId()` → `$PWD/.elon-ko/install-id` (writes there via `getBaseConfigRoot`)
- `getAgentDir()` → `$PWD/.elon-ko/agent` (agent.db, sessions, history move too — see F7)

**Deriving `PI_CONFIG_DIR` for an arbitrary `$PWD`:** it must be a path that,
when joined to `os.homedir()`, yields `$PWD/.elon-ko`.
- If `$PWD` is under `$HOME` (the common case, e.g. `~/github/elon-ko`):
  `PI_CONFIG_DIR` = the subpath of `$PWD` below `$HOME` + `/.elon-ko`
  (e.g. `github/elon-ko/.elon-ko`) — clean, no `..`.
- If `$PWD` is outside `$HOME`: `PI_CONFIG_DIR` needs leading `..` segments to
  climb out of `$HOME` (e.g. `../../tmp/proj/.elon-ko`). Works today because
  `getConfigDirName` does no validation and `path.join` normalizes `..`, but
  this is **undocumented usage** and carries forward-compat risk if omp ever
  validates the value (it validates profiles but not `PI_CONFIG_DIR`).

`PI_CONFIG_DIR` must be set **before omp starts** (it is read once at module
load into the `DirResolver` singleton). The `source ./.elon-ko/env.sh` activation
that REQ D2 already plans is the natural place to export it — **every** `omp`
invocation in that shell then uses the local home (and a bare `omp` without
sourcing reads `~/.omp` and sees nothing local).

- **Sources:** `dirs.ts` (`getConfigRootDir`, `getPluginsDir`, `getInstallId`,
  all `rootSubdir`/`agentSubdir`); F2; F3.
- **Confidence: High** that the relocation works as described; **Medium** on
  long-term stability of the `..`-escape form (undocumented).

### F6. omp/bun binary vendoring is cleanly supported (REQ RESEARCH item #2)

- **bun installer** (`https://bun.sh/install`) honors `BUN_INSTALL`; default
  `~/.bun`. `BUN_INSTALL=$PWD/.elon-ko` → bun at `$PWD/.elon-ko/bin/bun`.
- **omp installer** (`scripts/install.sh`, served at `https://omp.sh/install`):
  ```sh
  INSTALL_DIR="${PI_INSTALL_DIR:-$HOME/.local/bin}"
  ```
  `PI_INSTALL_DIR=$PWD/.elon-ko/bin` + `--binary` mode downloads the omp binary
  to `$PWD/.elon-ko/bin/omp` (no `$HOME` write). **Gotcha:** `--source` mode's
  `install_bun()` **force-sets `export BUN_INSTALL="$HOME/.bun"`** and runs
  `bun install -g`, so a `--source` install with bun missing writes `~/.bun`
  (NFR-4 violation). Therefore LOCAL must either (a) install bun first with
  `BUN_INSTALL=$PWD/.elon-ko` and pass `--source` (bun already present →
  `install_bun()` skipped → `BUN_INSTALL` honored → omp at
  `$PWD/.elon-ko/bin/omp`), or (b) use `--binary` + `PI_INSTALL_DIR`.

- **Sources:** omp `scripts/install.sh` (`INSTALL_DIR`, `install_bun`,
  `install_binary`); bun installer (`BUN_INSTALL`).
- **Confidence: High.**

### F7. Side effects of relocating the omp home (Q4)

Relocating `configRoot` via `PI_CONFIG_DIR` moves **all** omp state into
`./.elon-ko/`, not only the two elon-ko plugins. Concrete side effects:

1. **`marketplaces.json` + marketplace registration** move to the local
   configRoot → LOCAL and GLOBAL installs have **disjoint** marketplace
   registries. This *helps* REQ D5 (coexistence): the two modes cannot collide
   on marketplace names. Removing one mode's tree cannot corrupt the other's
   registry. ✅
2. **`install-id`** (`getInstallId` → `<configRoot>/install-id`) becomes
   per-project. Telemetry/dedup id is no longer machine-global. Neutral;
   worth documenting.
3. **`agent/` state** — `agent.db` (settings + **auth credentials**),
   `sessions/`, `history.db`, `models.db`, `blobs/`, `memories/` — all move to
   `$PWD/.elon-ko/agent/`. **Material consequence: the user's omp auth
   (provider API keys / OAuth) is NOT shared with a LOCAL project** — they must
   authenticate separately, or copy credentials. This is either a feature
   (full project isolation) or a friction point. SPEC must surface it.
4. **Gate opt-in marker `.omp/elon.json` is UNAFFECTED.** It is resolved via
   `getProjectAgentDir(cwd) = path.join(cwd, CONFIG_DIR_NAME)` with the
   **hardcoded** `CONFIG_DIR_NAME=".omp"` (not `PI_CONFIG_DIR`). So the opt-in
   marker is always `<cwd>/.omp/elon.json` in both modes — REQ's "no changes to
   the opt-in marker" (out-of-scope) holds, and LOCAL activation still works by
   writing `./.omp/elon.json`. ✅ **But** the project will contain **two**
   omp-related trees: `./.elon-ko/` (relocated home) **and** `./.omp/`
   (project-scoped agent dir, for opt-in + project plugin-overrides). REQ D1
   lists only `.elon-ko`; SPEC should note `.omp` coexists.
5. **`XDG` combo (F4) would leave configRoot in `$HOME`** → `marketplaces.json`
   + `install-id` stay global → partial relocation, conflicts with NFR-4. This
   is why R1 prefers `PI_CONFIG_DIR` over XDG.
6. **No `path.resolve`-style trap found:** all reads/writes go through the
   `DirResolver` singleton fed by `configRoot`; with `PI_CONFIG_DIR` set at
   process start there is **no stray write to `~/.omp/`**.

- **Sources:** `dirs.ts` (`getInstallId`, `getProjectAgentDir`,
  `getAgentDir`/agent subdirs, `CONFIG_DIR_NAME`); `registry.ts`; F3; F5.
- **Confidence: High.**

### F8. Fallback options evaluated (Q3-fallback)

| Option | Mechanism | Honors NFR-4? | Verdict |
|---|---|---|---|
| **(a)** Vendor plugins as plain dirs + `omp plugin link <path>` | `PluginManager.link()` symlinks into **`getPluginsDir()/node_modules/<name>`** (still `$HOME`-rooted) + writes lockfile there | **No** — link target entry + lockfile are global | Reject |
| **(a′)** `omp plugin install ./local-pkg` | local path → `PluginManager.link()` (same as above) | **No** | Reject |
| **(b)** Symlink farm: `~/.omp` → `$PWD/.elon-ko` | Make `~/.omp` a symlink | **No** — creating `~/.omp` is itself a `$HOME` write; also **global** (one symlink redirects *all* omp usage machine-wide) → **breaks D5 coexistence** and NFR-1 | Reject |
| **(c)** Per-invocation env shim exporting `PI_CONFIG_DIR` (+ PATH, BUN_INSTALL, PI_INSTALL_DIR) via `./.elon-ko/env.sh` | F5 mechanism | **Yes** | **Recommended (= R1)** |
| **(d)** Patch omp source | fork/patch `dirs.ts` | Yes | Last resort — high maintenance, breaks `omp` upstream updates; unnecessary given (c) works |
| **(e)** `XDG_DATA_HOME` only | F4 | **No** — `marketplaces.json` leaks | Reject as primary; could combine but inferior to (c) |

- **Sources:** `docs/plugin-manager-installer-plumbing.md` ("Link flow" — link
  writes into `~/.omp/plugins/node_modules`); F3; F4; F5; F7.
- **Confidence: High.**

---

## Recommendations

### R1 (PRIMARY — adopt). Relocate the **whole omp home** via `PI_CONFIG_DIR`.

`elon_ko.sh` LOCAL mode should, before invoking any `omp plugin …`:

1. `OMP_LOCAL_HOME="$PWD/.elon-ko"`; `mkdir -p "$OMP_LOCAL_HOME"/{bin,prerelease}`.
2. Compute `PI_CONFIG_DIR` so that
   `path.join(os.homedir(), PI_CONFIG_DIR) == "$OMP_LOCAL_HOME"`:
   - If `$PWD` is under `$HOME`: `PI_CONFIG_DIR="${PWD#$HOME/}/.elon-ko"` (clean subpath, no `..`).
   - Else: derive a `..`-relative path from `$HOME` to `$OMP_LOCAL_HOME` (e.g. via
     `realpath --relative-to="$HOME" "$OMP_LOCAL_HOME"` where available, else a
     portable awk/sed fallback). Flag this branch as the "outside-`$HOME`" case.
3. `export PI_CONFIG_DIR` (and `PATH`, `BUN_INSTALL`, `PI_INSTALL_DIR` — see R2)
   for **every** `omp plugin …` call in the script.
4. Write the same exports into `./.elon-ko/env.sh` so a later `source` keeps
   subsequent `omp` runs local.

**Why R1:** it is the *only* mechanism that (i) lands plugins at exactly
`./.elon-ko/plugins/` (F1, F5), (ii) also relocates `marketplaces.json` so
**nothing** lands under `~/.omp/` (F3, F7), and (iii) is a single, already-shipped
omp env var (`PI_CONFIG_DIR`) rather than a source patch. Supporting findings:
F1, F2, F3, F5, F7, F8.

### R2. Vendor the binaries with `BUN_INSTALL` + `PI_INSTALL_DIR`, and pre-install bun.

- bun: `BUN_INSTALL="$OMP_LOCAL_HOME" curl -fsSL https://bun.sh/install | …`
  → `$OMP_LOCAL_HOME/bin/bun` (F6).
- omp: install bun **first** (above), then `PI_INSTALL_DIR="$OMP_LOCAL_HOME/bin"`
  omp `--source` (bun present → `install_bun()` skipped → `BUN_INSTALL` honored),
  **or** `--binary` + `PI_INSTALL_DIR` (cleanest, no bun-version dance). Either
  avoids the `install_bun()` force-set of `BUN_INSTALL="$HOME/.bun"` (F6).
- Supporting findings: F6.

### R3. `env.sh` must export the **omp relocation env**, not just `PATH` (expand REQ D2).

REQ D2 currently specifies only `export PATH="$PWD/.elon-ko/bin:$PATH"`. For omp
to actually *read* the local home on subsequent runs, `env.sh` must **also**
export `PI_CONFIG_DIR` (R1) — otherwise a later bare `omp` reads `~/.omp` and
the project-local plugins are invisible. SPEC should expand D2/FR-7 to include
the `PI_CONFIG_DIR` export (and optionally `BUN_INSTALL`/`PI_INSTALL_DIR` for
the vendored binaries). Supporting findings: F5, F7.

### R4. Scope AC-2's `$HOME` snapshot to the **enumerated global paths**, not a raw `$HOME` diff.

A literal "no new/modified entries under `$HOME`" is **unsatisfiable when the
project itself is under `$HOME`**: FR-9 *requires* creating
`./.elon-ko/.install.json`, which is then a child of `$HOME`. The snapshot must
assert no changes to the **enumerated** global footprint — `~/.omp`,
`~/.local/bin`, `~/.bun`, `~/.omp-prerelease`, `~/.zshrc`, `~/.bashrc` — and
exclude the project tree (or be run with the project outside `$HOME`). NFR-4's
*intent* (no global omp/bun writes) is fully achievable via R1+R2; only AC-2's
*measurement wording* needs this precision. Supporting findings: F5, F7.

### R5. Document the additional omp state dirs under `./.elon-ko/` and the auth-isolation consequence.

`./.elon-ko/` will contain more than `{bin,plugins,prerelease}/`: omp will also
create `marketplaces.json`, `install-id`, and an `agent/` tree (agent.db,
sessions, history, …). SPEC should (a) state these are expected (not bugs),
(b) note that LOCAL omp auth is **not shared** with the user's global omp
(re-auth or credential copy required), and (c) note the coexisting `./.omp/`
project-scoped dir (F7-4). Supporting findings: F3, F7.

### R6. Keep `--scope project` and `omp plugin link` **out** of the LOCAL mechanism.

Neither satisfies NFR-4: `--scope project` moves only the manifest, not the
cache (F3); `link` writes into the global `node_modules` (F8). Do not rely on
them for LOCAL. Supporting findings: F3, F8.

---

## Impact Assessment

**Verdict: EXPAND** (with one precision **CONTRADICT** on AC-2's measurement
wording).

**Affected requirements:**

- **D2 / FR-7 (LOCAL PATH handling) — EXPAND.** `env.sh` must export
  `PI_CONFIG_DIR` in addition to `PATH`, or subsequent `omp` runs do not see the
  local plugins. (R3.) This does not contradict the resolved decision that no
  shell-rc is edited — it expands *what* the emitted `env.sh` carries.
- **D1 (LOCAL target layout) — EXPAND.** `./.elon-ko/` will hold omp's whole
  home (`marketplaces.json`, `install-id`, `agent/`, …) in addition to
  `{bin,plugins,prerelease}/`. The three dirs REQ lists are the *minimum*,
  not the exhaustive contents. (R5.) The user intent ("single hidden root,
  nothing dumped in cwd root") is preserved.
- **NFR-4 / AC-2 — precision CONTRADICT (measurement only).** NFR-4's enumerated
  global-path prohibitions are fully satisfiable; AC-2's literal "nothing new
  under `$HOME`" snapshot is not, when project⊆`$HOME`, because the project's own
  `.elon-ko` is a child of `$HOME`. (R4.) Intent is achievable; the AC's snapshot
  scope must be narrowed to the enumerated paths / project tree excluded.
- **AC-12 (research-gated) — RESOLVED GO.** DrPe confirms relocation **is
  feasible** (R1), so AC-2/AC-7 for the LOCAL plugin tree are achievable as
  specified; no fallback scoping of AC-12 is needed. (The fallbacks in F8 exist
  but are inferior and not required.)
- **D5 (coexistence) — reinforced, not affected.** Disjoint configRoots give
  disjoint `marketplaces.json`/registries, so cross-mode interference is
  impossible by construction. (F7-1.)

**Explanation:** omp provides **no plugins-only relocation**; the only
achievable LOCAL plugin mechanism (`PI_CONFIG_DIR`) relocates the *whole* omp
home. That expands `./.elon-ko/`'s contents and demands that the activation
script carry the relocation env var on every run — both are SPEC-actionable
expansions, not user-intent changes. The resolved GRILL decisions (D1–D5) all
stand; none is contradicted. The single hard discrepancy is AC-2's snapshot
*wording*, which must be scoped to the enumerated global footprint (R4).

**Recommendation for the workflow: PROCEED to SPEC.** No new GRILL round is
warranted — the expansions above are mechanism/precision details LeadDev can
resolve in the SPEC (expand D2's `env.sh` contents, document the extra omp
state dirs + auth isolation, narrow AC-2's snapshot scope). User intent is
final and unambiguous; only the LOCAL *mechanism* was open, and it is now
confirmed (R1).

---

## Sources Consulted (all accessed 2026-06-30)

1. **`packages/utils/src/dirs.ts`** — omp path resolver (single source of truth
   for config root, plugins dir, agent dir, install-id, project dir, XDG logic).
   `https://raw.githubusercontent.com/can1357/oh-my-pi/main/packages/utils/src/dirs.ts`
2. **`…/plugins/marketplace/registry.ts`** — `marketplaces.json`/`installed_plugins.json`/cache path helpers.
   `https://raw.githubusercontent.com/can1357/oh-my-pi/main/packages/coding-agent/src/extensibility/plugins/marketplace/registry.ts`
3. **`…/plugins/marketplace/cache.ts`** — cached plugin dir layout under `getPluginsCacheDir()`.
   `…/plugins/marketplace/cache.ts`
4. **`docs/environment-variables.md`** — official `PI_CONFIG_DIR` / `PI_CODING_AGENT_DIR` / XDG semantics (§6).
   `https://raw.githubusercontent.com/can1357/oh-my-pi/main/docs/environment-variables.md`
5. **`docs/plugin-manager-installer-plumbing.md`** — on-disk model, `PluginManager.install`/`link`, scope behavior.
   `https://raw.githubusercontent.com/can1357/oh-my-pi/main/docs/plugin-manager-installer-plumbing.md`
6. **`docs/marketplace.md`** — scopes (user/project), on-disk layout, `--scope project` manifest-only behavior.
   `https://raw.githubusercontent.com/can1357/oh-my-pi/main/docs/marketplace.md`
7. **`packages/coding-agent/DEVELOPMENT.md`** — source map locating the plugin/marketplace modules.
8. **`packages/coding-agent/src/commands/config.ts`** — confirms `omp config init-xdg` action.
9. **`scripts/install.sh`** (served at `https://omp.sh/install`) — `PI_INSTALL_DIR`, `install_bun()` force-set of `BUN_INSTALL`, `--binary`/`--source` modes.
   `https://raw.githubusercontent.com/can1357/oh-my-pi/main/scripts/install.sh`
10. **bun installer** (`https://bun.sh/install`) — `BUN_INSTALL` install-dir override; corroborated by `https://bun.com/docs/installation`.
11. **`earendil-works/pi` issue #534** — establishes `PI_CONFIG_DIR` as the config-location escape hatch, dirname-under-home semantics, and the XDG discussion.
    `https://github.com/earendil-works/pi/issues/534`
12. **In-repo `.app/REQ.md`** — requirements baseline (D1–D5, NFR-4, AC-2, AC-12, RESEARCH Dependency §151–159).
13. **In-repo `elon_ko.sh`** — current install flow (`omp plugin install`/`marketplace add`, `--source`, prerelease, PATH export).
14. **In-repo `CHANGELOG.md`** — `[v1.2.2]` DependencyLoop note confirming plugins resolve under `~/.omp/plugins/`.
15. **Prior `.app/RESEARCH.md`** (opt-s diagnostic) — confirmed installed plugin files live under `~/.omp/plugins/{package.json,node_modules,installed_plugins.json,omp-plugins.lock.json}`.

---

## GO/NO-GO

**GO.** The user-chosen LOCAL layout (D1: `./.elon-ko/{bin,plugins,prerelease}/`) is achievable as specified — plugins land at `./.elon-ko/plugins/` and **nothing** is written under `~/.omp/` (or `~/.local/bin`, `~/.bun`, `~/.omp-prerelease`, shell rc) — provided SPEC adopts `PI_CONFIG_DIR` whole-home relocation (R1), vendors binaries via `BUN_INSTALL`/`PI_INSTALL_DIR` with bun pre-installed (R2), makes `env.sh` export `PI_CONFIG_DIR` (R3), and narrows AC-2's snapshot scope to the enumerated global paths (R4).
