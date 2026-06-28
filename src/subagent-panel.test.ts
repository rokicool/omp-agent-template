// subagent-panel.test.ts — focused regression test for the macOS Option+S
// panel toggle, using Node's built-in test runner. Mirrors dot-agreement.test.ts.
//
// Root cause under test: on default macOS terminals (Ghostty / Terminal.app,
// Option NOT treated as Alt), Option+S emits the *composed* char "ß" (U+00DF).
// pi-tui's parseKey() returns null for that byte, so CustomEditor.handleInput
// sets canonical=undefined and skips the ENTIRE extension-shortcut dispatch
// block — registerShortcut("alt+s") can therefore never fire for it and the
// panel stays unreachable (the recurring "still not available" bug). The fix
// adds a raw terminal-input listener (ctx.ui.onTerminalInput) that catches the
// composed byte and toggles the overlay directly.
//
// These tests pin (a) the pure helper, (b) the parseKey root cause, and
// (c) the end-to-end "ß -> overlay opens" behavior through a stub ExtensionAPI.

import { test } from "node:test";
import { equal, ok } from "node:assert";
import { parseKey } from "@oh-my-pi/pi-tui";

import type { ExtensionAPI, ExtensionContext } from "@oh-my-pi/pi-coding-agent";
import subagentPanel, { macosOptionComposedFor } from "./subagent-panel.ts";

// ---------------------------------------------------------------------------
// Pure helper
// ---------------------------------------------------------------------------

test("macosOptionComposedFor: default Alt+S resolves to the macOS composed ß", () => {
	// The plugin's TOGGLE_KEY is the lowercased display chord ("Alt+S" -> "alt+s").
	equal(macosOptionComposedFor("alt+s"), "ß");
	equal(macosOptionComposedFor("Alt+S".toLowerCase()), "ß");
	// Other single-letter alt toggles resolve to their macOS glyph...
	equal(macosOptionComposedFor("alt+p"), "π");
	// ...dead-key letters (e/i/k/n/u emit combining marks) are intentionally omitted...
	equal(macosOptionComposedFor("alt+e"), undefined);
	// ...and modifier combos / named keys have no single composed byte.
	equal(macosOptionComposedFor("ctrl+alt+s"), undefined);
	equal(macosOptionComposedFor("escape"), undefined);
});

// ---------------------------------------------------------------------------
// Root cause: the shortcut path is structurally blind to the composed byte
// ---------------------------------------------------------------------------

test("root cause: parseKey(ß) is null — registerShortcut cannot match Option+S on default macOS", () => {
	// parseKey returning null means CustomEditor.handleInput computes canonical=
	// undefined and skips the WHOLE `if (canonical !== undefined)` block, which is
	// the only place extension shortcuts (#customMatchKeys) are consulted. No
	// registerShortcut keyId — not "alt+s", not "ß" itself — can ever fire here.
	equal(parseKey("ß"), null);
});

// ---------------------------------------------------------------------------
// Behavioral fixture
// ---------------------------------------------------------------------------

interface Fixture {
	api: ExtensionAPI;
	ctx: ExtensionContext;
	startHandler?: (e: unknown, ctx: ExtensionContext) => void;
	shutdownHandler?: () => void;
	terminalInputHandler?: (data: string) => unknown;
	customCalls: number;
	registeredKey?: string;
}

function makeFixture(): Fixture {
	const f: Fixture = { api: undefined as never, ctx: undefined as never, customCalls: 0 };
	f.api = {
		setLabel: () => {},
		on: (event: string, handler: (...a: unknown[]) => unknown) => {
			if (event === "session_start") f.startHandler = handler as Fixture["startHandler"];
			if (event === "session_shutdown") f.shutdownHandler = handler as Fixture["shutdownHandler"];
		},
		registerShortcut: (key: string) => {
			f.registeredKey = key;
		},
		events: { on: () => () => {} },
	} as unknown as ExtensionAPI;
	f.ctx = {
		hasUI: true,
		cwd: "/tmp",
		ui: {
			onTerminalInput: (handler: (data: string) => unknown) => {
				f.terminalInputHandler = handler;
				return () => {
					f.terminalInputHandler = undefined;
				};
			},
			custom: () => {
				f.customCalls++;
				return Promise.resolve(undefined);
			},
			setWidget: () => {},
			setStatus: () => {},
		},
	} as unknown as ExtensionContext;
	return f;
}

// ---------------------------------------------------------------------------
// Behavioral: activate wires BOTH the alt-shortcut AND the macOS listener
// ---------------------------------------------------------------------------

test("activate wires both the alt-shortcut and the macOS composed-byte listener", () => {
	const f = makeFixture();
	subagentPanel(f.api);
	try {
		ok(f.startHandler, "session_start handler registered");
		f.startHandler!(undefined, f.ctx);
		// Alt-aware terminals (ESC+s / Kitty alt) still get the shortcut.
		equal(f.registeredKey, "alt+s");
		// macOS default terminals get the raw-input fallback.
		ok(f.terminalInputHandler, "onTerminalInput listener installed");
	} finally {
		f.shutdownHandler?.(); // clears the 1s sweep interval so the run exits
	}
});

// ---------------------------------------------------------------------------
// Behavioral: the Option+S byte (ß) opens the overlay and is consumed
// ---------------------------------------------------------------------------

test("Option+S byte (ß) opens the overlay and is consumed; other input passes through", () => {
	const f = makeFixture();
	subagentPanel(f.api);
	try {
		f.startHandler!(undefined, f.ctx);

		const before = f.customCalls;
		// The exact string a default macOS terminal delivers for Option+S.
		const result = f.terminalInputHandler!("ß");
		equal(JSON.stringify(result), JSON.stringify({ consume: true }), "ß is consumed");
		equal(f.customCalls, before + 1, "overlay (ctx.ui.custom) opened on ß");

		// Plain "s" and empty input must pass through untouched.
		equal(f.terminalInputHandler!("s"), undefined);
		equal(f.terminalInputHandler!(""), undefined);
	} finally {
		f.shutdownHandler?.();
	}
});
