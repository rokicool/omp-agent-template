# RESEARCH — `opt-s` (Option+S / Alt+S) failure in elon-ko v2.1.2 on ghostty 1.3.1

> **Type:** Installation diagnostic (not a library survey). This report
> supersedes the prior frozen `.app/RESEARCH.md` snapshot.
> **Investigator:** DrPe · **Date:** 2026-06-28 · **Machine:** macOS, Apple
> Silicon (arm64), ghostty 1.3.1.

---

## Scope

Diagnose why `opt-s` does not work after installing `elon-ko`
(`elon-ko-gate` + `elon-ko-agents`) at **v2.1.2** on macOS under
**ghostty 1.3.1**. Dimensions covered: (1) authoritative definition of what
`opt-s` is supposed to trigger; (2) the actual local install — version,
paths, manifests, and whether the v2.1.2 "Option+S fix" is really present;
(3) how the v2.1.2 fix is wired in source; (4) the terminal factor
(ghostty 1.3.1 Option-key encoding); (5) ranked root-cause hypotheses with
evidence; (6) what could not be verified. Sources: local plugin/manifest
reads, the elon-ko source tree + CHANGELOG/README, ghostty 1.3.0/1.3.1
release notes, the ghostty config reference, and corroborating community
reports of the same macOS-Option problem class.

---

## Findings

### What `opt-s` is supposed to do (DEFINITION)

`opt-s` = **Option+S on macOS** (= Alt+S), and it is a **keyboard
keybinding**, not a CLI/slash command. It toggles the
**`subagent-panel` full-table overlay** — a scrollable, on-demand list of
every running subagent with per-agent stats — provided by the
`subagent-panel` extension shipped in **Plugin A (`elon-ko-gate`)**.

- **README.md** ("Subagent observability panel", available since v1.8.0):
  *"an on-demand **`Alt+S`** full-table overlay … `Alt+S`, `Esc`, or `q`
  close it."* Config knob `OMP_SUBAGENT_PANEL_KEY` (default `Alt+S`)
  changes the chord.
- **CHANGELOG.md `[v1.8.0]`** (2026-06-27): *"A compact panel above the
  editor streams per-subagent stats … `Alt+S` opens a full scrollable
  table of every agent."*
- **Source**, `src/subagent-panel.ts:52-54`:
  `TOGGLE_KEY_DISPLAY = "Alt+S"`, `TOGGLE_KEY = "alt+s"`. Registered via
  `pi.registerShortcut(TOGGLE_KEY, …)` at `src/subagent-panel.ts:743-749`.
- **Not gated by the orchestrator opt-in** (README): the extension "loads
  wherever Plugin A is installed, and activates in any **interactive TUI
  session** — it no-ops when `ctx.hasUI` is false." So `.omp/elon.json` /
  `OMP_ENABLE_ORCHESTRATOR` do **not** affect whether the binding loads.

**Confidence: High.** Multiple independent repo sources agree.

### Installed version & location (CONFIRMED 2.1.2 — but a messy dual install)

The installed plugin files live under `~/.omp/plugins/`. The current
plugins are genuinely **v2.1.2**, **but stale pre-rebrand plugins are also
installed and enabled alongside them.**

- `~/.omp/plugins/package.json` → deps include
  `"elon-ko-gate": "github:rokicool/elon-ko#v2.1.2"` ✓
  **and** a stale `"omp-agent-gate": "github:rokicool/omp-agent-template#v1.6.0"`.
- `~/.omp/plugins/bun.lock` → `elon-ko-gate` resolved at commit
  **`74f7082`**; `omp-agent-gate` at `46c7edb`.
- `~/.omp/plugins/installed_plugins.json` →
  `elon-ko-agents@elon-ko` **v2.1.2**, installPath
  `/Users/roki/.omp/plugins/cache/plugins/elon-ko___elon-ko-agents___2.1.2`;
  **and** stale `orchestrator-agents@omp-agent-template` **v1.7.0**.
- `~/.omp/plugins/omp-plugins.lock.json` → **both** sets enabled:
  `elon-ko-gate` 2.1.2 + `elon-ko-agents` 2.1.2 **enabled:true**, **and**
  `omp-agent-gate` 1.6.0 + `orchestrator-agents` 1.7.0 **enabled:true**.
- Installed gate source tree:
  `/Users/roki/.omp/plugins/node_modules/elon-ko-gate/` (the whole repo
  tarball). Its `package.json#version` = **`2.1.2`** ✓.

Two flags, neither by itself the root cause (see §"Could not verify"):
1. **Commit mismatch.** `bun.lock` resolved `#v2.1.2` to `74f7082`, but
   the project's own release record (`.app/PROJECT.md`) records the
   `v2.1.2` annotated tag at commit `e7d5871`. The two differ. Content-wise
   the installed copy is correct (see next finding), so this is a
   release-hygiene concern, not the functional cause.
2. **Dual install.** Both the new (`elon-ko-*`) and the legacy
   (`omp-agent-gate`/`orchestrator-agents`) plugins are present and
   enabled. The legacy `omp-agent-gate` **v1.6.0** predates
   `subagent-panel` entirely (that extension was added in v1.8.0;
   `subagent-tabs` was removed in v1.6.0), so it registers **no** `Alt+S`
   binding and does not directly collide with this feature — but it is a
   sign of an unclean migration and a potential load-conflict risk.

**Confidence: High** (read directly from on-disk manifests).

### The v2.1.2 "Option+S fix" IS present in the installed copy

CHANGELOG.md `[v2.1.2]` (2026-06-28) claims the fix:
> *"macOS `Option+S` subagent-panel toggle works again. Pressing
> `Option+S` on macOS emits the composed `ß` byte (U+00DF), which bypassed
> omp's `registerShortcut` matcher (it listened for a distinct `Alt+S`
> sequence) … The panel's keybinding now also recognizes the composed `ß`
> byte."*

Verified present in the **installed** source
(`/Users/roki/.omp/plugins/node_modules/elon-ko-gate/src/subagent-panel.ts`),
identical to the dev tree:

- Composition map `MACOS_OPTION_COMPOSE` (`subagent-panel.ts:81-85`)
  maps `s → "ß"` (and `a→å, b→∫, c→ç, … p→π …`).
- Helper `macosOptionComposedFor("alt+s") → "ß"` (`subagent-panel.ts:93-96`).
- The actual fix — a raw terminal-input fallback
  (`subagent-panel.ts:751-771`):

  ```
  const composedToggle = macosOptionComposedFor(TOGGLE_KEY); // "ß"
  if (composedToggle !== undefined) {
    unsubFns.push(
      ctx.ui.onTerminalInput(data => {
        if (!active) return undefined;
        if (data === composedToggle) {            // STRICT === "ß"
          toggleOverlay(ctx);
          return { consume: true };
        }
        return undefined;
      }),
    );
  }
  ```

- Opening path: `pi.registerShortcut("alt+s", …)` (`subagent-panel.ts:743-749`).
- Closing path: `matchesKey(data, TOGGLE_KEY)` (`subagent-panel.ts:633`).
- Guards: `activate` returns early unless `ctx.hasUI`
  (`subagent-panel.ts:704`); `toggleOverlay` returns early unless
  `active && ctx.hasUI` (`subagent-panel.ts:656`).

**Critical implication:** the v2.1.2 fix only ever fires when the raw
terminal input for Option+S is **exactly the string `"ß"`** (UTF-8
`0xC3 0x9F`). It does **not** match an `ESC s` (Alt/Esc-prefix) sequence,
nor any structured/`CSI u` encoded form, nor a plain `s` with the Alt bit
stripped. This narrow contract is the hinge of the failure (see next).

**Confidence: High** (read the installed source line-by-line).

### The terminal factor: ghostty 1.3.x changed macOS Option-key encoding (the decisive external change)

Two verified facts about ghostty:

1. **Default `macos-option-as-alt` = false → Option composes Unicode.**
   ghostty config reference / man page: *"On macOS by default, the option
   key plus a character will sometimes produce a Unicode character. For
   example, on US standard layouts option-b produces '∫'."* So on a default
   ghostty, **Option+S → `ß`** — exactly the byte the v2.1.2 fix listens
   for. (Corroborated by the well-known Claude-Code `Option+P → π` problem
   class, whose documented fix is to set `macos-option-as-alt`.)

2. **ghostty 1.3.0 changed the macOS Option→Alt encoding under the
   extended keyboard protocol.** From the **ghostty 1.3.0 release notes**
   (released **2026-03-09**), "Terminal Capabilities" section, verbatim:

   > *"vt: Modify other keys state 2 no longer encodes option as alt on
   > macOS. [#9406]"*

   "Modify other keys state 2" = xterm **`modifyOtherKeys` level 2** (the
   extended-key encoding TUIs enable to reliably read modifier combos).
   Before 1.3.0, in that mode Option+S was encoded carrying the **Alt**
   modifier (the very "Alt+S sequence" omp's `registerShortcut` was built
   to match). **From 1.3.0 onward, ghostty drops the Alt encoding for
   Option on macOS in that mode.** #9406 is the primary source; a
   community thread (neurocyte/flow #413) confirms #9406 is specifically
   about `modifyOtherKeys` + Option-as-Alt on macOS.

3. **ghostty 1.3.1 does NOT revert #9406.** The **1.3.1 release notes**
   (released **2026-03-13**) fix 1.3.0 regressions (phantom mouse events,
   window sizing, tab-title focus, system-keybind overrides like
   `super+h`, one-time-code passthrough, etc.) but **make no change to the
   Option/Alt keyboard encoding**. So in the user's version (1.3.1) the
   #9406 behavior is still in effect.

**Why this breaks the v2.1.2 fix (mechanism, partially INFERRED — see
"Could not verify"):** omp is a TUI that reads keys through a structured
parser (`parseKey`, referenced in the plugin's own comments). Under
`modifyOtherKeys`-level-2 + ghostty ≥1.3.0, Option+S is no longer emitted
as the literal raw `ß` byte that the plugin's `data === "ß"` strict check
requires, and is also no longer emitted as an `Alt+S` sequence that
`registerShortcut("alt+s")` would match. The keystroke arrives in a
different form (the Alt modifier bit is dropped in that encoding), so
**neither the primary `registerShortcut` path nor the v2.1.2 `ß` fallback
fires** — the overlay never opens. The v2.1.2 fix was authored and tested
against the pre-1.3.0 ghostty behavior and therefore does not survive the
1.3.0 default change.

**Confidence on the change:** **High** (direct, dated primary citation).
**Confidence on the exact failing byte form:** **Medium/Inferred** — I
could not empirically capture what ghostty 1.3.1 actually delivers to omp
on this machine (no live omp+ghostty test rig available to DrPe); the
conclusion that the delivered form is neither literal `ß` nor a matched
`Alt+S` is inferred from the release-note change + the strict equality in
source. This is the single most relevant verified external delta between
"v2.1.2 shipped as a fix" and "user on v2.1.2 + ghostty 1.3.1 reports it
broken."

### Ruled-out / lower-likelihood candidates

- **Plugin failed to load / wrong version installed.** Ruled out: version
  is genuinely 2.1.2 on disk and the `ß`-fix code is present in the
  installed copy. Not the cause.
- **Keybinding not registered.** Ruled out: `registerShortcut("alt+s")`
  plus the `ß` fallback are both wired in the installed source.
- **Orchestrator opt-in missing.** Ruled out as a cause for this feature:
  `subagent-panel` is explicitly **not** gated by `.omp/elon.json` /
  `OMP_ENABLE_ORCHESTRATOR` (README + source guard only checks `ctx.hasUI`).
- **Conflict with another binding.** Unlikely: the only other enabled gate
  (`omp-agent-gate` v1.6.0) predates this extension and binds no `Alt+S`.
- **`OMP_SUBAGENT_PANEL_KEY` override.** Possible only if the user set it;
  default is `Alt+S`. Worth a 10-second check, not a primary suspect.

---

## Root-Cause Diagnosis (ranked)

| # | Hypothesis | Likelihood | Evidence |
|---|---|---|---|
| **1** | **ghostty 1.3.0 `#9406` defeats the v2.1.2 binding.** In `modifyOtherKeys`-2 mode, Option+S is no longer emitted as a literal `ß` byte nor as a matched `Alt+S` sequence, so neither `registerShortcut("alt+s")` nor the v2.1.2 `data === "ß"` fallback fires. | **High** | ghostty 1.3.0 RN ("vt: Modify other keys state 2 no longer encodes option as alt on macOS. #9406", 2026-03-09); 1.3.1 RN does not revert it; strict-equality fallback in source `subagent-panel.ts:759-771`; default `macos-option-as-alt=false`. Exact failing byte form INFERRED. |
| 2 | `ctx.ui.onTerminalInput` not available/renamed in the installed omp runtime → the `ß` fallback never registers (and would throw inside `activate`, disabling the panel). | Medium | The fix depends on this surface existing on the running omp; DrPe could not read the installed omp runtime API version. **Needs LeadDev verification against the installed `omp`.** |
| 3 | Stale dual install (`omp-agent-gate` v1.6.0 + `orchestrator-agents` v1.7.0) causes a load conflict that prevents `elon-ko-gate`'s extensions (incl. the panel) from initializing cleanly. | Low–Medium | `omp-plugins.lock.json` shows both old+new enabled. Not proven to break *only* opt-s; flag as hygiene. |
| 4 | User has `macos-option-as-alt = true` → Option+S sends `ESC s` instead of `ß`, so the `ß` fallback can't fire. | Low | If set, `registerShortcut("alt+s")` would *more likely* work (ESC+s ≈ alt+s), so this would tend to *fix*, not break. Worth checking the user's `~/.config/ghostty/config`. |
| 5 | Non-US input source so Option+S ≠ `ß`. | Low | `ß` only holds for US layout; verify the active macOS input source. |
| 6 | Session not interactive (`ctx.hasUI` false) → overlay silently no-ops. | Low | User is in an interactive ghostty TUI; unlikely, but confirm omp is run interactively (not headless/RPC). |

**Headline:** The most probable cause is **#1** — an external terminal
regression (`ghostty` 1.3.0 `#9406`, present in 1.3.1) that changes how
macOS Option+S is encoded, defeating the exact byte the v2.1.2 fix listens
for. The plugin is installed correctly and the fix is present; it simply
does not match what ghostty 1.3.1 now delivers.

---

## Recommendations (for LeadDev — diagnosis only; no fix applied here)

1. **Harden the binding against the structured-key form (primary fix).**
   Do not rely solely on `data === "ß"`. Also recognize the `modifyOtherKeys`/
   Kitty-keyboard `CSI u` encoded form of Option+S (and the `ESC s`
   alt-prefix form), so the overlay toggles regardless of which encoding
   ghostty emits. Consider driving off omp's parsed key event
   (`registerShortcut`) as the source of truth and treating the raw-byte
   match purely as a fallback — and confirm omp's key parser is told (or
   can be told) to treat Option as Meta on macOS. *Supports Findings
   "What opt-s does", "v2.1.2 fix wiring", "ghostty 1.3.x change".*
2. **Verify the omp runtime API.** Confirm `ctx.ui.onTerminalInput` exists
   with the assumed signature in the installed `omp` (Finding 2). If it was
   renamed/removed, the v2.1.2 fallback silently never registers — and
   `activate()` may throw, taking the whole panel down. *Supports Finding 2.*
3. **Document a user-side workaround** pending the code fix: tell macOS
   users to add `macos-option-as-alt = true` (or `left`) to their ghostty
   config so Option+S is sent as an `Alt` sequence that
   `registerShortcut("alt+s")` can match (same fix the Claude-Code community
   uses for `Option+P`). Note this is a *workaround*, not a real repair —
   the plugin should not require terminal reconfiguration. *Supports
   "terminal factor".*
4. **Clean up the dual install.** Uninstall the legacy
   `omp-agent-gate` (v1.6.0) and `orchestrator-agents@omp-agent-template`
   (v1.7.0) so only `elon-ko-gate` + `elon-ko-agents` (2.1.2) remain,
   eliminating the load-conflict risk (Finding 3) and matching the
   `v2.0.0` migration notes. *Supports "Installed version & location".*
5. **Investigate the commit mismatch** (`74f7082` resolved vs `e7d5871`
   tagged) for release hygiene — confirm the `v2.1.2` tag still points at
   the released commit and was not retagged. *Supports "Installed version".*

---

## Could NOT verify (stated explicitly)

- **The exact bytes ghostty 1.3.1 delivers to omp for Option+S** on this
  machine (literal `ß` vs `CSI u` structured form vs plain `s` with the Alt
  bit stripped). DrPe has no live `omp` + ghostty 1.3.1 test rig and cannot
  run `showkey -a` inside the harness. The conclusion that the delivered
  form no longer matches either the `registerShortcut` path or the strict
  `=== "ß"` fallback is **inferred** from the #9406 default change and the
  source's strict equality — this is the strongest explanation but is not
  empirically confirmed at the byte level.
- **Whether `ctx.ui.onTerminalInput` exists / has the assumed signature in
  the installed `omp` runtime.** Could not read the omp runtime API surface
  (only the plugin source, which `import type`s `@oh-my-pi/pi-coding-agent`
  at `^16.0.5`). LeadDev should verify against the installed `omp` version.
- **The user's actual ghostty config** (`~/.config/ghostty/config`) and
  active macOS input source — not readable here. If
  `macos-option-as-alt` is already set, hypothesis #4/#5 shift.
- **Whether the user is running `omp` in a truly interactive TUI**
  (`ctx.hasUI` true). Assumed yes from the report context; not confirmed.
- **Why `#v2.1.2` resolved to `74f7082` while the release record says
  `e7d5871`.** Flagged, not resolved.

---

## Impact Assessment

- **Verdict:** **EXPAND** (with a PROCEED recommendation).
- **Affected requirement:** The delegation's baseline ("v2.1.2 was the
  Option+S fix; diagnose why it still fails") is materially expanded:
  the failure is **not** a mis-install or missing code — the fix is present
  and the version is correct. The real cause is an **interaction with an
  external default-behavior change in ghostty 1.3.0 (#9406, carried into
  1.3.1)** that the v2.1.2 fix was not designed for, plus a secondary
  dual-install hygiene problem.
- **Explanation:** Findings establish (a) opt-s = `Alt+S` overlay toggle
  (High confidence), (b) installed = real 2.1.2 with the `ß`-fix present
  (High), and (c) the decisive external delta = ghostty 1.3.0 `#9406`
  (High for the change; Medium/Inferred for the exact failing byte form).
  The fix therefore needs to be broadened beyond a literal-`ß` match, and
  the omp runtime API + terminal config must be confirmed. No requirement
  is *contradicted*; the picture simply expands from "check the plugin" to
  "plugin↔terminal-keyboard-protocol interaction."
- **Recommendation:** **PROCEED to SPEC/DEVELOP (LeadDev)** to implement
  Recommendations #1–#2 (robust binding + omp-API verification), with #3 as
  an interim user workaround and #4–#5 as cleanup. No GRILL loop needed —
  the delegation was unambiguous and the evidence is sufficient to design
  the fix.

---

## Sources Consulted

**Local (elon-ko, this machine):**
- `~/github/elon-ko/CHANGELOG.md` — `[v2.1.2]` "Option+S fix" description; `[v1.8.0]` panel introduction; `[v2.0.0]` rebrand/migration.
- `~/github/elon-ko/README.md` — `Alt+S` overlay docs; "not gated by opt-in"; `OMP_SUBAGENT_PANEL_KEY`.
- `~/github/elon-ko/src/subagent-panel.ts` — binding wiring (lines 52-54, 81-96, 633, 656, 704, 743-771).
- `~/.omp/plugins/package.json`, `bun.lock`, `installed_plugins.json`, `omp-plugins.lock.json` — installed versions/paths/dual-install.
- `~/.omp/plugins/node_modules/elon-ko-gate/package.json` + `src/subagent-panel.ts` — confirms installed gate is 2.1.2 and contains the `ß`-fix (lines 751-771).

**ghostty (primary, dated):**
- ghostty 1.3.0 release notes (2026-03-09), "Terminal Capabilities": *"vt: Modify other keys state 2 no longer encodes option as alt on macOS. #9406"* — https://ghostty.org/docs/install/release-notes/1-3-0
- ghostty 1.3.1 release notes (2026-03-13): 1.3.0-regression patch; does not revert #9406 — https://ghostty.org/docs/install/release-notes/1-3-1
- ghostty config reference / `ghostty(5)` man page: `macos-option-as-alt` default = false (Option composes Unicode) — https://ghostty.org/docs/config/reference · https://man.archlinux.org/man/ghostty.5
- ghostty issue #7131 (2025-04-18): prior macOS alt+key esc-prefix regression history — https://github.com/ghostty-org/ghostty/issues/7131
- ghostty issue #9406 (the #9406 change) — https://github.com/ghostty-org/ghostty/issues/9406

**Corroborating community (same macOS-Option problem class):**
- massy22, "Fixing Claude Code Option+P Shortcuts on macOS" (2025-12-17) — Option+P→π; fix = `macos-option-as-alt` — https://zenn.dev/massy22/articles/772ebefdb4e1d6?locale=en
- neurocyte/flow discussion #413 — confirms #9406 concerns `modifyOtherKeys` + Option-as-Alt on macOS — https://github.com/neurocyte/flow/discussions/413
