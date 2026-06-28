# Technical Specification — Hardening the `opt-s` (Option+S / Alt+S) Subagent-Panel Toggle Against Terminal Key-Encoder Drift

**Status:** SPEC (LeadDev) — design only; awaiting Elon approval before DEVELOP.
**Author:** LeadDev (delegated by Elon), specialty: plugin keybinding hardening.
**Date:** 2026-06-28
**Inputs:** `.app/RESEARCH.md` (DrPe diagnostic, 2026-06-28), the installed omp runtime declarations, `~/.omp/plugins/omp-plugins.lock.json`, `src/subagent-panel.ts`, `src/subagent-panel.test.ts`.
**Scope:** A permanent, minimal, backward-compatible fix to the `Alt+S` overlay-toggle keybinding in Plugin A (`elon-ko-gate`) so it fires regardless of which byte encoding a terminal emits for Option+S. **Design only this turn — no code edits.** Pseudocode/TS appears only where it pins a contract.

---

## 1. Situation

`opt-s` = **Option+S on macOS** (= Alt+S). It is a **keyboard keybinding** (not a slash command), registered by the `subagent-panel` extension in Plugin A, that toggles a full-table overlay of live subagents. It is **not** gated by the orchestrator opt-in (`OMP_ENABLE_ORCHESTRATOR` / `.omp/elon.json`); it activates in any interactive TUI session (`ctx.hasUI`).

The v2.1.2 release shipped a fix for this binding: a raw-input fallback that matches the composed `ß` byte (U+00DF) macOS emits for Option+S. That fix is **present and correctly wired** in the installed copy, yet the binding still does not fire on **ghostty 1.3.1**. DrPe's diagnosis (`RESEARCH.md`) establishes with High confidence that the root cause is **ghostty 1.3.0 issue #9406** ("Modify other keys state 2 no longer encodes option as alt on macOS"), unreverted in 1.3.1: under the `modifyOtherKeys`-level-2 protocol that TUIs (including omp) enable, Option+S is no longer delivered as the literal `ß` byte the v2.1.2 fallback matches, nor as an `Alt+S` sequence omp's `registerShortcut` matcher recognizes. The single unverified detail is the **exact failing byte sequence** (DrPe: Medium/Inferred — no live capture rig) — this SPEC designs around that uncertainty by matching the *family* of Option+S encodings rather than one guessed byte string, and folds empirical confirmation into the test plan.

This SPEC covers: (1) an encoding-agnostic matcher; (2) verification of the omp runtime API surface the fix depends on; (3) resolution of the live-session / dual-install question; (4) a minimal, backward-compatible change with a test plan covering all three encodings.

---

## 2. Verified facts (ground truth, with file:line)

These were established by reading the real source and the installed omp runtime declarations in this session — not from memory.

### 2.1 The binding today (`src/subagent-panel.ts`)

- Toggle constants — `src/subagent-panel.ts:52-54`: `TOGGLE_KEY_DISPLAY = process.env.OMP_SUBAGENT_PANEL_KEY || "Alt+S"`; `TOGGLE_KEY = "alt+s"`.
- Primary (source of truth) — `src/subagent-panel.ts:743-749`: `pi.registerShortcut(TOGGLE_KEY, { description, handler: c => toggleOverlay(c) })`, registered once per process (`shortcutRegistered` guard).
- v2.1.2 raw-input fallback — `src/subagent-panel.ts:759-771`:
  ```ts
  const composedToggle = macosOptionComposedFor(TOGGLE_KEY); // -> "ß"
  if (composedToggle !== undefined) {
    unsubFns.push(
      ctx.ui.onTerminalInput(data => {
        if (!active) return undefined;
        if (data === composedToggle) {        // STRICT === "ß"  <-- the brittle line
          toggleOverlay(ctx);
          return { consume: true };
        }
        return undefined;
      }),
    );
  }
  ```
- Close path — `src/subagent-panel.ts:633`: `matchesKey(data, TOGGLE_KEY) || matchesKey(data,"escape") || matchesKey(data,"q")` inside `handleOverlayInput` (the focused overlay component's input handler).
- Guards — `activate` early-returns unless `ctx.hasUI` (`src/subagent-panel.ts:704`); `toggleOverlay` early-returns unless `active && ctx.hasUI` (`src/subagent-panel.ts:656`); `toggleOverlay` **closes** if already open (`overlayCloser` set) else opens — i.e. it is direction-agnostic (`src/subagent-panel.ts:651-679`).
- Composition helper — `src/subagent-panel.ts:81-96`: `MACOS_OPTION_COMPOSE` maps `s → "ß"` (and `p → "π"`, etc.); `macosOptionComposedFor("alt+s") → "ß"`.
- **Only call site:** grep across `src/` confirms `onTerminalInput`, `composedToggle`, and `registerShortcut` appear nowhere else — the diff is localized to this one file.

### 2.2 omp runtime API surface (requirement #2 — VERIFIED)

The omp runtime is a **native binary** `~/.omp/natives/16.2.2/pi_natives.darwin-arm64.node` (runtime version **16.2.2**, satisfying the plugin's `@oh-my-pi/pi-coding-agent@^16.0.5`). The TypeScript declarations ship in `node_modules/@oh-my-pi/` and are the authoritative surface:

- **`ctx.ui.onTerminalInput` EXISTS** with the assumed signature — `node_modules/@oh-my-pi/pi-coding-agent/dist/types/extensibility/extensions/types.d.ts:103-104`:
  ```ts
  /** Listen to raw terminal input (interactive mode only). Returns an unsubscribe function. */
  onTerminalInput(handler: TerminalInputHandler): () => void;
  ```
  and the handler type at `types.d.ts:76-80` / `src/extensibility/extensions/types.ts:151-152`:
  ```ts
  /** Raw terminal input listener for extensions. */
  export type TerminalInputHandler =
    (data: string) => { consume?: boolean; data?: string } | undefined;
  ```
  → The v2.1.2 fallback's `return { consume: true }` is **API-correct**. DrPe hypothesis #2 ("API absent/renamed") is **refuted**: the surface is present. The headless stub at `src/extensibility/extensions/runner.ts:179` (`onTerminalInput: () => () => {}`) confirms it no-ops cleanly when there is no UI, so it cannot throw inside `activate()`.
- **`pi.registerShortcut`** — `types.d.ts:658-662` / `src/.../types.ts:1037-1042`:
  ```ts
  registerShortcut(shortcut: KeyId, options: {
    description?: string;
    handler: (ctx: ExtensionContext) => Promise<void> | void;
  }): void;
  ```
- **omp's tui key parser already decodes BOTH structured protocols natively** — `node_modules/@oh-my-pi/pi-tui/src/keys.ts`:
  - `decodePrintableKey = decodeKittyPrintable ?? decodeModifyOtherKeysPrintable` (`keys.ts:503-505`) — Kitty CSI-u tried first, then xterm modifyOtherKeys.
  - Kitty CSI-u regex `keys.ts:300`: `const KITTY_CSI_U_PATTERN = /^\x1b\[(\d+)(?::(\d*))?(?::(\d+))?(?:;(\d+))?(?::(\d+))?(?:;([\d:]*))?u$/;` — **group 1 = codepoint**, the `;N`/`:N` groups carry shifted-key / modifier / text fields.
  - xterm modifyOtherKeys regex `keys.ts:307`: `const MODIFY_OTHER_KEYS_PATTERN = /^\x1b\[27;(\d+);(\d+)~$/;` — **group 1 = modifier (1-indexed), group 2 = codepoint** (docstring `keys.ts:465-468`: "CSI 27 ; modifiers ; keycode ~").
  - Modifier bitmask `keys.ts:301-306`: `SHIFT=1, ALT=2, CTRL=4, SUPER=8, NUM_LOCK=128`, `KITTY_LOCK_MASK = 64 + 128` (Caps+NumLock). Wire modifier value is 1-indexed; effective bits = `(value - 1) & ~KITTY_LOCK_MASK`.
  - `matchesKey(data, keyId) = matchesKeypadKey(data,keyId) ?? matchesKeyNative(data, keyId, kittyProtocolActive)` (`keys.ts:547-549`); `parseKey` likewise delegates to a native parser (`keys.ts:559-561`).
- **Verified root-cause test already in the repo** — `src/subagent-panel.test.ts:44-50` pins `parseKey("ß") === null`, proving `registerShortcut` is structurally blind to the composed byte (it never canonicalizes to `"alt+s"`). The same file stubs `ctx.ui.onTerminalInput` and captures the handler (`subagent-panel.test.ts:82-87`) — this is the exact seam the test plan uses to feed each encoding.

### 2.3 Dual install (requirement #3 — VERIFIED)

`~/.omp/plugins/omp-plugins.lock.json` shows **both** plugin pairs installed and enabled simultaneously:

| plugin | version | enabled |
|---|---|---|
| `elon-ko-gate` | 2.1.2 | true |
| `elon-ko-agents` | 2.1.2 | true |
| `omp-agent-gate` (stale) | 1.6.0 | true |
| `orchestrator-agents@omp-agent-template` (stale) | 1.7.0 | true |

`~/.omp/plugins/installed_plugins.json` corroborates the stale `orchestrator-agents@omp-agent-template@1.7.0` installPath. Consequences:
- The `subagent-panel` extension (and thus the `Alt+S` binding) lives **only** in `elon-ko-gate` — the stale `omp-agent-gate@1.6.0` predates it (panel added in v1.8.0) and registers **no** `Alt+S`, so it does not directly collide with this feature.
- The dual install is unclean-migration hygiene and a *potential* load-conflict risk, not the functional cause of the opt-s failure. The session advisory itself shows the dual load: this session's Elon preamble is injected twice — once attributing the bundle to `elon-ko-gate`, once to the stale `omp-agent-gate`.

---

## 3. Root-cause mechanism (why v2.1.2 doesn't survive ghostty 1.3.x)

Two facts combine (`RESEARCH.md` "terminal factor", High confidence on the *change*, Medium on the exact byte form):

1. omp is a TUI that enables an extended-key protocol (`modifyOtherKeys`-2 and/or Kitty) to read modifier combos. Under that protocol, Option+S is sent as a **structured sequence**, not the raw composed `ß` char — EXCEPT on terminals where Option still composes.
2. ghostty 1.3.0 `#9406` ("modifyOtherKeys state 2 no longer encodes option as alt on macOS"), carried into 1.3.1, removed the **Alt modifier bit** from Option's structured encoding. So under ghostty ≥1.3.0 in structured mode, Option+S is delivered as a structured sequence carrying **no Alt modifier**.

Neither v2.1.2 path matches that sequence:
- `registerShortcut("alt+s")` relies on omp canonicalizing the byte to `"alt+s"`. With the Alt bit gone, omp canonicalizes to a key **without** Alt → no match.
- The fallback requires `data === "ß"` (the literal two-byte UTF-8 string `0xC3 0x9F`). A structured CSI sequence is never that literal string → no match.

**Most-consistent failing byte form (design assumption, to be confirmed empirically in the test plan):** under `modifyOtherKeys`-2, the structured encoding carries the **codepoint of the glyph the keystroke resolves to**. On a US layout Option+S resolves to `ß` (U+00DF = **codepoint 223**). Therefore the failing byte is most likely the structured encoding of codepoint 223, i.e. **`ESC[27;<mod>;223~`** (xterm modifyOtherKeys, `<mod>` with no Alt) or **`ESC[223;<mod>u`** (Kitty CSI-u). This interpretation is fully consistent with the observed failure: the codepoint is 223 (so `data === "ß"` fails — it is a CSI, not the char) and there is no Alt (so `"alt+s"` fails). It is also collision-free to match (see §5.2).

> **Design stance:** because the exact byte form is not yet empirically captured (DrPe: Medium/Inferred; LeadDev cannot browse the web to read #9406 directly), the matcher is built to match the **family** of Option+S encodings, not one guessed sequence. It is grounded in omp's own verified parser constants (§2.2), so it matches exactly the structured shapes omp recognizes. The test plan captures the real ghostty 1.3.1 bytes and confirms which interpretation holds.

---

## 4. Architecture Overview

```
                                 Option+S pressed
                                        │
                                        ▼
                  ┌──────────── ghostty / terminal encodes ────────────┐
                  │ one of:                                             │
                  │   (F1) raw composed char  "ß"   (U+00DF)            │
                  │   (F2) structured CSI for codepoint 223 (ß)         │
                  │         e.g. ESC[27;<mod>;223~  /  ESC[223;<mod>u   │
                  │   (F3) alt-prefix  ESC s        (\x1b s)            │
                  │   (F4) structured CSI for codepoint 115 (s) + ALT   │
                  └───────────────────────┬───────────────────────────┘
                                          │ raw `data` string
                                          ▼
   ┌──────────────── omp interactive-mode input dispatch ────────────────┐
   │                                                                     │
   │  PRIMARY (source of truth, UNCHANGED):                              │
   │   pi.registerShortcut("alt+s") → omp parseKey/matchesKey            │
   │     • fires for F3 (ESC s) and F4 (115+alt) when omp decodes alt    │
   │     • DOES NOT fire for F1 (parseKey("ß")===null, pinned by test)   │
   │     • DOES NOT fire for F2 (codepoint 223, no alt → not "alt+s")    │
   │                                                                     │
   │  FALLBACK (THIS SPEC — hardened): ctx.ui.onTerminalInput(data)      │
   │     matchesOptionSToggle(data)  ◄── new shared pure matcher         │
   │       true for F1, F2, F3, F4  →  toggleOverlay(ctx) + consume      │
   │       false otherwise            →  pass through (inert)            │
   │   toggleOverlay is direction-agnostic: opens when closed,           │
   │   closes when open → the SAME matcher handles CLOSE too.            │
   │                                                                     │
   │  DEFENSIVE CLOSE (focused overlay): handleOverlayInput(data)        │
   │   adds matchesOptionSToggle(data) alongside matchesKey("alt+s")     │
   │   (only if test shows the global listener doesn't fire under the    │
   │    overlay — see §8, open question OQ-2)                            │
   └─────────────────────────────────────────────────────────────────────┘
```

**Design principles:**
- `registerShortcut` stays the **source of truth** for the encodings omp already decodes (F3/F4). It is left **untouched**.
- The raw-input fallback is **broadened** from a single strict `=== "ß"` to a family matcher `matchesOptionSToggle(data)`. It remains the only place that catches the encodings omp cannot decode (F1/F2).
- The matcher keys on the **composed-glyph codepoint (223 = ß)** for F1/F2 — the invariant signature of Option+S on a US layout — which is **collision-free** with a plain `s` keystroke (codepoint 115). See §5.2.
- `toggleOverlay`'s existing open/close idempotency means one matcher handles **both** toggle directions; no second registration is needed for close (subject to OQ-2).

---

## 5. Design — exact change in `src/subagent-panel.ts`

### 5.1 New pure helper (insert after `macosOptionComposedFor`, ~`src/subagent-panel.ts:96`)

Add a **pure, exportable** predicate that recognizes every byte encoding of the configured toggle. It is parameterized by the configured composed glyph (so the same hardening covers `OMP_SUBAGENT_PANEL_KEY=Alt+P` → `π`, etc.), not hard-coded to `ß`.

```ts
// Regexes mirror omp's own parser constants (pi-tui/src/keys.ts:300, :307).
// Inlined because those constants are module-private in pi-tui.
const KITTY_CSI_U_RE   = /^\x1b\[(\d+)(?::(\d*))?(?::(\d+))?(?:;(\d+))?(?::(\d+))?(?:;[\d:]*)?u$/;
const MODIFY_OTHER_RE  = /^\x1b\[27;(\d+);(\d+)~$/;
const KITTY_LOCK_MASK  = 64 + 128;            // pi-tui keys.ts:306 (Caps+NumLock)
const MOD_ALT          = 2;                    // pi-tui keys.ts:302
const MOD_SHIFT        = 1;                    // pi-tui keys.ts:301

/** True if `modValue` (1-indexed wire value) carries the Alt modifier. */
function wireModHasAlt(modValue: number | undefined): boolean {
  if (modValue === undefined) return false;
  return ((((modValue - 1) || 0) & ~KITTY_LOCK_MASK) & MOD_ALT) !== 0;
}

/**
 * Recognize EVERY byte encoding of the configured Option+<letter> toggle:
 *   F1  raw composed glyph, e.g. "ß"
 *   F2  structured encoding of that glyph's codepoint (modifyOtherKeys / Kitty CSI-u),
 *       with any modifier — this is the ghostty 1.3.x #9406 case (Alt bit dropped,
 *       glyph codepoint carried structurally). Collision-free: the glyph codepoint
 *       (e.g. 223 for ß) never equals a plain letter keystroke.
 *   F3  alt-prefix "ESC <letter>", e.g. "\x1bs"  (macos-option-as-alt=true)
 *   F4  structured encoding of the plain letter codepoint WITH Alt — redundant with
 *       registerShortcut for parsers that honor Alt, included so the fallback is
 *       authoritative regardless of which path omp dispatches first.
 *
 * `composed` is the precomposed glyph for the letter (from MACOS_OPTION_COMPOSE),
 * `letter` is the bare lowercase letter (e.g. "s"). Both undefined for non alt+letter
 * toggles, in which case only the structured-with-alt (F4) and ESC-prefix (F3) forms
 * apply.
 */
export function matchesOptionToggle(
  data: string,
  letter: string,
  composed: string | undefined,
): boolean {
  // F1 — raw composed glyph (existing v2.1.2 path, preserved exactly).
  if (composed !== undefined && data === composed) return true;

  // F3 — alt-prefix ESC + letter  (e.g. "\x1bs").
  if (data === `\x1b${letter}`) return true;

  // Derive codepoints once.
  const letterCP = letter.charCodeAt(0);                       // 's' -> 115
  const composedCP = composed !== undefined ? composed.codePointAt(0) : undefined; // 'ß' -> 223

  // F2 — Kitty CSI-u for the COMPOSED glyph codepoint, any modifier.
  let m = data.match(KITTY_CSI_U_RE);
  if (m) {
    const cp = Number.parseInt(m[1] ?? "", 10);
    if (composedCP !== undefined && cp === composedCP) return true;          // e.g. ESC[223;<mod>u
    // F4 — Kitty CSI-u for the plain letter codepoint WITH Alt.
    if (cp === letterCP && wireModHasAlt(m[4] !== undefined ? Number.parseInt(m[4], 10) : undefined)) return true;
    return false;
  }

  // F2/F4 — xterm modifyOtherKeys:  ESC[27;<mod>;<codepoint>~
  m = data.match(MODIFY_OTHER_RE);
  if (m) {
    const modValue = Number.parseInt(m[1] ?? "", 10);
    const cp = Number.parseInt(m[2] ?? "", 10);
    if (composedCP !== undefined && cp === composedCP) return true;          // F2: e.g. ESC[27;<mod>;223~
    if (cp === letterCP && wireModHasAlt(modValue)) return true;             // F4: ESC[27;<mod>;115~ with Alt
    return false;
  }

  return false;
}
```

Rationale for the regex inlines: `KITTY_CSI_U_PATTERN` and `MODIFY_OTHER_KEYS_PATTERN` are **module-private** in `@oh-my-pi/pi-tui/src/keys.ts` (not exported), so the plugin cannot import them. The inlined forms are byte-for-byte mirrors of `keys.ts:300` and `keys.ts:307` (cited), so they match exactly the structured shapes omp's own parser accepts.

### 5.2 Why this is collision-free (the pivotal safety argument)

The risky failure mode for any structured matcher is firing on a **plain `s`** keystroke. The design avoids it by construction:

- A plain `s` is codepoint **115**. In Kitty "text mode" a terminal *can* deliver a plain letter as `ESC[115;1u` (omp handles this via `decodeKittyPrintable`, `keys.ts:388-404`). Matching codepoint 115 with **any** modifier would therefore collide with plain `s`.
- This matcher matches codepoint 115 **only when Alt is present** (F4) — and a plain `s` carries no Alt, so it never matches. (This is precisely omp's own rule at `keys.ts:404`: printable only when no Alt/Ctrl/Super.)
- The #9406 case (F2) is matched on the **composed-glyph codepoint 223**, not 115. Codepoint 223 (`ß`) is produced by Option+S on a US layout — it is never the encoding of a plain `s`. So F2 cannot collide with plain `s` regardless of modifier.
- Residual, pre-existing, accepted risk: a user could type/paste a literal `ß` intending text. This is the **same** risk the v2.1.2 `data === "ß"` matcher already accepts; the hardening adds no new collision surface.

### 5.3 Wire the helper into the fallback (`src/subagent-panel.ts:759-771`, minimal swap)

Replace the strict equality with the family matcher. The surrounding structure (guard, subscribe, teardown) is unchanged:

```ts
// src/subagent-panel.ts:759  — replace the body of the onTerminalInput handler
const composedToggle = macosOptionComposedFor(TOGGLE_KEY);            // "ß"
const letter = /^alt\+([a-z])$/.exec(TOGGLE_KEY)?.[1] ?? "";          // "s"
if (composedToggle !== undefined || letter) {
  unsubFns.push(
    ctx.ui.onTerminalInput(data => {
      if (!active) return undefined;
      if (matchesOptionToggle(data, letter, composedToggle)) {        // was: data === composedToggle
        toggleOverlay(ctx);
        return { consume: true };
      }
      return undefined;
    }),
  );
}
```

Because `toggleOverlay` closes when already open (`src/subagent-panel.ts:651-655`), this single listener handles **both** open and close, as long as omp dispatches raw input to extension listeners while the overlay is focused (see OQ-2).

### 5.4 Defensive close path (`src/subagent-panel.ts:633`) — conditional

`handleOverlayInput` currently closes on `matchesKey(data, TOGGLE_KEY)`. Add the same matcher so the overlay also closes on the structured/`ß` encodings when focused:

```ts
// src/subagent-panel.ts:633
if (
  matchesKey(data, "escape") ||
  matchesKey(data, TOGGLE_KEY) ||
  matchesKey(data, "q") ||
  matchesOptionToggle(data, letter, composedToggle)   // NEW
) { if (overlayCloser) overlayCloser(); return; }
```

`letter`/`composedToggle` are computed once at module top-level (next to `TOGGLE_KEY`) so both call sites share them. **This addition is made ONLY if the test plan (§8, TC-6) proves the global `onTerminalInput` listener does not receive bytes while the overlay is focused** — otherwise it is redundant and is omitted to keep the diff minimal. Rationale: avoids any chance of double-toggle (open-then-close) from two paths both firing.

### 5.5 What does NOT change

- `registerShortcut(TOGGLE_KEY, …)` — untouched (stays the source of truth for F3/F4 via omp's parser).
- `MACOS_OPTION_COMPOSE` and `macosOptionComposedFor` — untouched (the new helper reuses the latter's output).
- All guards, teardown, event subscriptions, render logic, env knobs.
- Net diff: one new pure helper (~40 lines incl. comments/regex) + one swapped condition + at most one added condition. Backward-compatible: `ß` still matches via F1.

---

## 6. Interface contracts

### 6.1 `matchesOptionToggle(data, letter, composed)` (NEW, exported)

| aspect | contract |
|---|---|
| **Signature** | `(data: string, letter: string, composed: string \| undefined) => boolean` |
| **Preconditions** | `letter` is a single lowercase ASCII letter (or `""` for non alt+letter toggles); `composed` is the precomposed glyph for `letter` or `undefined`. `data` is one stdin-delivered terminal sequence (omp's StdinBuffer splits batched input first — `pi-tui/src/terminal.ts:618-651`). |
| **Postconditions** | Returns `true` iff `data` is a recognized encoding of Option+`letter` (forms F1–F4 in §5.1). Pure: no I/O, no globals, deterministic. |
| **Error modes** | Never throws — all `Number.parseInt` results are `Number.isFinite`-guarded by the regex shape; malformed CSI returns `false`. |
| **Collision invariant** | Never returns `true` for a plain `letter` keystroke (codepoint 115 for `s`) unless Alt is present. See §5.2. |

### 6.2 Existing contracts preserved (unchanged)

- `macosOptionComposedFor(keyId)` (`src/subagent-panel.ts:93-96`) — unchanged.
- `toggleOverlay(ctx)` — unchanged (direction-agnostic open/close).
- `pi.registerShortcut` / `ctx.ui.onTerminalInput` usage — signatures unchanged per §2.2.

---

## 7. Acceptance criteria

Each is testable; maps to a REQUIREMENT from the delegation.

- **AC-1 (Req #1, F1 — regression):** Feeding `"ß"` to the captured `onTerminalInput` handler toggles the overlay (preserves v2.1.2 behavior). → TC-1.
- **AC-2 (Req #1, F2 — the actual fix):** Feeding the structured codepoint-223 sequences `"\x1b[27;1;223~"` and `"\x1b[223;1u"` (and the Alt-stripped modifier variants `;2;223~`, `;223;2u`, etc.) toggles the overlay. → TC-2, TC-3.
- **AC-3 (Req #1, F3):** Feeding `"\x1bs"` (ESC+s) toggles the overlay via the fallback. → TC-4.
- **AC-4 (Req #1, F4):** Feeding `"\x1b[27;3;115~"` and `"\x1b[115;3u"` (codepoint 115 + Alt) toggles the overlay. → TC-5.
- **AC-5 (Req #4, no regression / collision):** Feeding `"s"`, `"\x1b[115;1u"` (plain s, Kitty text mode), `"a"`, and `"\x1b[A"` (up-arrow) does **not** toggle. → TC-7.
- **AC-6 (Req #4, backward-compat):** `registerShortcut("alt+s")` registration is unchanged; the existing `parseKey("ß")===null` pin still holds; existing `macosOptionComposedFor` tests pass unmodified. → TC-8.
- **AC-7 (Req #2, API):** Build/typecheck against the installed `@oh-my-pi/pi-coding-agent@^16` / `@oh-my-pi/pi-tui` passes; `onTerminalInput` and `registerShortcut` resolve to the declarations cited in §2.2. → §8 build step.
- **AC-8 (Req #1, close path):** With the overlay open, the same encodings close it. → TC-6 (also decides §5.4).
- **AC-9 (generalization):** With `OMP_SUBAGENT_PANEL_KEY=Alt+P`, the matcher recognizes `π` (codepoint 960) raw + structured, not `ß`. → TC-9.

---

## 8. Test plan

The repo already uses Node's built-in test runner and a stub `ExtensionAPI`/`ExtensionContext` fixture (`src/subagent-panel.test.ts`). The fixture captures the `onTerminalInput` handler into `f.terminalInputHandler` (`subagent-panel.test.ts:82-87`) and counts `ctx.ui.custom` calls into `f.customCalls`. All new tests extend this harness.

### 8.1 Unit tests for the pure matcher (`matchesOptionToggle`)

Driven directly (no plugin activation needed):

| ID | input `data` | letter | composed | expect | form |
|---|---|---|---|---|---|
| TC-1 | `"ß"` | `"s"` | `"ß"` | `true` | F1 (regression) |
| TC-2a | `"\x1b[27;1;223~"` | `"s"` | `"ß"` | `true` | F2 modifyOtherKeys |
| TC-2b | `"\x1b[27;2;223~"` | `"s"` | `"ß"` | `true` | F2, shift "mod" |
| TC-3 | `"\x1b[223;1u"` | `"s"` | `"ß"` | `true` | F2 Kitty CSI-u |
| TC-3b | `"\x1b[223;3u"` | `"s"` | `"ß"` | `true` | F2 Kitty, alt "mod" (still ß codepoint) |
| TC-4 | `"\x1bs"` | `"s"` | `"ß"` | `true` | F3 ESC-prefix |
| TC-5a | `"\x1b[27;3;115~"` | `"s"` | `"ß"` | `true` | F4 modifyOtherKeys 115+alt |
| TC-5b | `"\x1b[115;3u"` | `"s"` | `"ß"` | `true` | F4 Kitty 115+alt |
| TC-7a | `"s"` | `"s"` | `"ß"` | `false` | plain letter (no collision) |
| TC-7b | `"\x1b[115;1u"` | `"s"` | `"ß"` | `false` | plain s Kitty text-mode (no collision) |
| TC-7c | `"\x1b[115u"` | `"s"` | `"ß"` | `false` | plain s, default mod (no collision) |
| TC-7d | `"a"` / `"\x1b[A"` | `"s"` | `"ß"` | `false` | unrelated |
| TC-9a | `"π"` | `"p"` | `"π"` | `true` | generalization F1 |
| TC-9b | `"\x1b[27;1;960~"` | `"p"` | `"π"` | `true` | generalization F2 (π=960) |

### 8.2 End-to-end tests through the fixture (overlay actually toggles)

Reuse `makeFixture()`; after `session_start`, drive the captured handler and assert `f.customCalls` increments (overlay opened) and the handler returns `{ consume: true }`:
- TC-1e: `f.terminalInputHandler("ß")` → opens; `consume:true`.
- TC-2e: `f.terminalInputHandler("\x1b[27;1;223~")` → opens; `consume:true`. **This is the ghostty-1.3.x #9406 simulation.**
- TC-4e: `f.terminalInputHandler("\x1bs")` → opens.
- **TC-6 (decides §5.4):** open the overlay, then call the handler again with the same `data`. Assert it closes (overlay closer invoked). Also assert whether the *focused-overlay* path receives the byte: if the fixture shows the global listener is NOT dispatched while a `ctx.ui.custom({overlay:true})` component is focused, implement §5.4; otherwise omit it. (In the unit fixture both paths are observable; in the real TUI the dispatch order is an omp runtime fact — confirm via the empirical probe in §8.4 on a real ghostty session.)

### 8.3 How to *simulate* ghostty 1.3.x structured input (no ghostty required)

The matcher operates on the raw `data` string omp already delivers after its StdinBuffer splits input (`pi-tui/src/terminal.ts:618-651`). So simulation = feeding those exact strings to the captured handler, as in TC-2e. This is byte-faithful: whatever ghostty emits, omp forwards it to `onTerminalInput` as one `data` string per sequence; the unit tests assert the matcher recognizes each plausible sequence. This proves the matcher is correct **given** the form; it does not prove which form ghostty emits — that is §8.4.

### 8.4 Empirical capture on real ghostty 1.3.1 (confirm the failing byte form)

Because DrPe could not capture the actual byte and LeadDev cannot browse, DEVELOP must include a one-shot probe (not shipped) to record what ghostty 1.3.1 actually delivers, confirming interpretation (F2/codepoint-223) vs. alternatives:

- Minimal throwaway omp extension that, in `session_start`, registers `ctx.ui.onTerminalInput(data => console.error("[probe] " + JSON.stringify(data) + " hex=" + Buffer.from(data,"utf8").toString("hex")))`, then run `omp` interactively in ghostty 1.3.1 and press Option+S. Read the printed line. Expected under this SPEC's assumption: `"\x1b[27;1;223~"` (or the Kitty `"\x1b[223;1u"` variant).
- If the probe instead shows a literal `"s"` with no structure (interpretation "A": Alt fully stripped → indistinguishable from plain `s`), then byte-matching is **impossible** without colliding with plain `s`, and the only remedy is the user-side workaround (§10). The SPEC's family matcher still correctly handles the other encodings; this one case is documented as out-of-code-scope.
- Cross-check: `OMP_SUBAGENT_PANEL_KEY` value, the user's `~/.config/ghostty/config` `macos-option-as-alt` setting, and the active macOS input source (US layout assumed).

### 8.5 Build/typecheck/lint gate (AC-7)

- `bun run typecheck` (or `tsc --noEmit` via the repo's `.bin/tsc`) against the installed `@oh-my-pi/*` declarations — must pass with no new errors.
- `bun test src/subagent-panel.test.ts` — all existing + new tests green.
- Repo lint/format (whichever the project runs) clean on the changed file.

---

## 9. Integration / DONE steps (NOT executed in this SPEC turn)

These are recorded for the DEVELOP/DONE phases and for Elon's commit gates:

1. **Implement §5** in `src/subagent-panel.ts`; add the §8 tests; run the §8.5 gate.
2. **Run the §8.4 empirical probe** on a real ghostty 1.3.1 session to confirm the failing byte form; update the CHANGELOG/test comments with the captured sequence.
3. **Stale-plugin cleanup — requirement #3 (DO NOT execute while a stale plugin gates the live session):**
   - The fix ships in `elon-ko-gate`'s `src/subagent-panel.ts`. For it to take effect in a **live** session, the session must load `elon-ko-gate`'s panel extension.
   - Remove the stale `omp-agent-gate@1.6.0` and `orchestrator-agents@omp-agent-template@1.7.0` from `~/.omp/plugins/` (package.json, bun.lock, installed_plugins.json, omp-plugins.lock.json) so only `elon-ko-gate` + `elon-ko-agents` (2.1.2) remain — matching the v2.0.0 migration notes.
   - **Guardrail:** perform the removal only when the active session is confirmed to be gated by `elon-ko-gate` (not the stale `omp-agent-gate`). The panel extension exists only in `elon-ko-gate`, so removing the stale gate cannot break opt-s; the guardrail is about not leaving the orchestrator enforcement momentarily un-registered during a live session. After removal, restart omp so the panel re-loads with the hardened binding.
4. **Does the fix take effect in the current session?** Only after the session runs under `elon-ko-gate` **and** the hardened `src/subagent-panel.ts` is the loaded copy. Until the stale plugins are removed and omp is restarted, the live session may still be loading the old/stale gate; the fix is confirmed live only by the §8.4 probe showing the toggle firing on a real Option+S.
5. **CHANGELOG** entry under a new `[v2.1.3]` (PATCH): "macOS Option+S subagent-panel toggle hardened against terminal key-encoder drift (ghostty 1.3.0 #9406) — now recognizes the composed glyph, its modifyOtherKeys/Kitty CSI-u structured encodings, and the ESC+s alt-prefix form."

---

## 10. User-side workaround (interim, documented not coded)

Pending the code fix, macOS users on ghostty ≥1.3.0 can restore the toggle by adding to `~/.config/ghostty/config`:
```
macos-option-as-alt = true
```
This makes Option+S arrive as `ESC s`, which omp's `registerShortcut("alt+s")` already decodes (form F3 — handled without any code change). This is a **workaround**, not a repair: the plugin should not require terminal reconfiguration, and it does not help users who cannot change their terminal config. (Same fix the Claude-Code community uses for the Option+P→π problem class; `RESEARCH.md` Recommendation #3.)

---

## 11. Risks & open questions

- **RQ-1 / OQ-1 — exact failing byte form unconfirmed.** The matcher is a *family* matcher precisely because the exact ghostty-1.3.1 byte is Medium/Inferred (`RESEARCH.md` "Could not verify"). The §8.4 probe resolves it. If the real byte is a bare `"s"` with no structure and no Alt (full strip), no byte-matcher can distinguish it from plain `s` — that single sub-case falls back to the §10 workaround; all other encodings are still fixed. **Likelihood of the bad sub-case: Low** (it would also type a stray `s` into the prompt, which the bug report does not mention).
- **OQ-2 — does omp dispatch raw input to extension `onTerminalInput` listeners while a `ctx.ui.custom({overlay:true})` component is focused?** Determines whether §5.4 is needed. Resolved by TC-6 / the §8.4 probe. Either outcome yields a working close path; the only cost is a few extra lines if §5.4 is required.
- **R-3 — non-US input source.** The `MACOS_OPTION_COMPOSE` `s→ß` mapping is US-layout. If the user's active macOS input source differs, Option+S may compose to a different glyph (or none). Out of scope to remap; the matcher still works for any single-glyph composition because it is parameterized by `composed`/`letter`. Worth a one-line note in the CHANGELOG.
- **R-4 — regex drift in future omp.** The inlined `KITTY_CSI_U_RE` / `MODIFY_OTHER_RE` mirror `pi-tui/src/keys.ts:300,307` at runtime 16.2.2. If a future omp changes those wire formats, the inlined regexes would need updating. Mitigation: the test suite pins representative sequences, so a drift would surface as a failing test. A code comment cross-references the source lines.
- **R-5 — double-toggle risk.** If both the global fallback and the focused-overlay close path fire for the same byte, `toggleOverlay` could open-then-close. Mitigated by §5.4 being added only when OQ-2 proves it necessary, and by the fallback consuming the byte (`{consume:true}`).

---

## 12. Out of scope

- **Commit-hash / release-hygiene nit** (`bun.lock` resolved `#v2.1.2` to `74f7082` while the release record says `e7d5871`, `RESEARCH.md` "Could not verify"). Noted only; not addressed by this SPEC.
- **The stale dual-install removal itself** is a DONE step (§9.3), not part of the code change.
- **Remapping `MACOS_OPTION_COMPOSE` for non-US layouts** — out of scope; the matcher is layout-agnostic via parameters.
- **Changing omp's extended-key-protocol negotiation** (e.g., forcing/disabling modifyOtherKeys) — omp runtime behavior, not the plugin's to change.
- **Any change to `registerShortcut`, event subscriptions, render logic, env knobs, or the persistent-widget behavior.**

---

## 13. Summary of key architectural decisions (for Elon sign-off)

1. **Family matcher, not a guessed byte.** `matchesOptionToggle` recognizes the composed glyph (F1), its structured codepoint-223 encodings (F2 — the #9406 fix), the ESC+s alt-prefix (F3), and codepoint-115+alt (F4). Grounded in omp's own parser regexes (`pi-tui/src/keys.ts:300,307`).
2. **Collision-free by construction** — F2 keys on the `ß` glyph codepoint (223), never on plain `s` (115); F4 requires Alt. No new collision with ordinary typing (§5.2).
3. **`registerShortcut` stays the source of truth** — untouched; the raw-input fallback is broadened only where omp cannot decode (the composed/structured-`ß` forms).
4. **omp runtime API verified, not assumed** — `ctx.ui.onTerminalInput` and `pi.registerShortcut` confirmed present with exact signatures (`types.d.ts:103-104,658-662`); DrPe hypothesis #2 refuted.
5. **Dual install resolved** — panel only in `elon-ko-gate`; stale plugins removed as a guarded DONE step (§9.3).
6. **Generalizes beyond `s`** — the matcher is parameterized, so `OMP_SUBAGENT_PANEL_KEY=Alt+P` (→`π`) is hardened for free.
7. **One open question gated to DEVELOP** — OQ-2 (close-path dispatch) is resolved by a test, not a design fork; either outcome ships a working toggle.
