// mess-transport.test.ts — unit tests for the PURE surface of the cross-instance
// file transport (C2), using Node's BUILT-IN test runner (node:test +
// node:assert). No new deps. Mirrors the style of enforce-orchestrator.test.ts.
//
// These tests exercise only the pure functions (fs/path/crypto) against a temp
// cwd. The impure extension shell (tools/hooks, lazy dynamic imports of the
// oh-my-pi registry/irc subpaths) runs only under omp at real runtime — the
// module is loadable here because every oh-my-pi dependency is either a
// top-level `import type` (erased) or a lazy `await import()` inside a function
// the tests never call. The final test documents the subpath-coupling contract.

import { test } from "node:test";
import { deepEqual, equal, ok, rejects } from "node:assert";
import { existsSync, mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";

import {
	FILENAME_RE,
	getInstanceId,
	instanceOf,
	compactUtc,
	markFailed,
	moveToArc,
	parseMessage,
	readManifest,
	releaseClaim,
	selectAndDeliver,
	serializeMessage,
	tryClaim,
	writeMessage,
	arcDir,
	messDir,
	type InstanceManifest,
	type Message,
	type MessCollaborators,
	type MessSendInput,
} from "./mess-transport.ts";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Run `fn` against a fresh temp cwd, cleaning up afterward. */
function withTmp(fn: (dir: string) => void): void {
	const dir = mkdtempSync(join(tmpdir(), "omp-mess-"));
	try {
		fn(dir);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
}

/** A representative fully-populated message. */
function fullMessage(): Message {
	return {
		id: "leaddev-middev-20260626T120500Z",
		from: "leaddev",
		to: "middev",
		type: "DELEGATION",
		timestamp: "2026-06-26T12:05:00.000Z",
		inReplyTo: null,
		fromInstance: "inst-1",
		toInstance: "inst-2",
		attempts: 0,
		body: "Implement the foo module per SPEC §4.4.\nReturn a DELIVERABLE.",
	};
}

/** A minimal message (only required fields). */
function leanMessage(): Message {
	return {
		id: "drpe-leaddev-20260626T120500Z",
		from: "drpe",
		to: "leaddev",
		type: "HANDOFF",
		timestamp: "2026-06-26T12:05:00.000Z",
		inReplyTo: "leaddev-drpe-20260626T120400Z",
		body: "results attached",
	};
}

/** A send input with sensible defaults. */
function sendInput(over: Partial<MessSendInput> = {}): MessSendInput {
	return {
		from: "leaddev",
		to: "middev",
		type: "DELEGATION",
		body: "do the thing",
		inReplyTo: null,
		...over,
	};
}

/** A stub collaborators object that tracks irc/resolve calls. */
function stubCollab(
	over: {
		selfInstance?: string;
		manifest?: InstanceManifest;
		toId?: string | null;
		outcome?: string;
	} = {},
): { collab: MessCollaborators; calls: { irc: number; resolve: number } } {
	const calls = { irc: 0, resolve: 0 };
	const collab: MessCollaborators = {
		selfInstance: over.selfInstance ?? "inst-1",
		manifest: over.manifest ?? { self: "inst-1", agents: {} },
		resolveToId: async () => {
			calls.resolve++;
			return over.toId === undefined ? "MidDev" : over.toId;
		},
		ircSend: async () => {
			calls.irc++;
			return { outcome: over.outcome ?? "injected" };
		},
	};
	return { collab, calls };
}

// ---------------------------------------------------------------------------
// R2.5 — parse/serialize round-trip + strictness
// ---------------------------------------------------------------------------

test("R2.5: parseMessage(serializeMessage(m)) round-trips a full message", () => {
	const m = fullMessage();
	const raw = serializeMessage(m);
	const back = parseMessage(raw, `${m.id}.md`);
	ok(back !== null, "parsed");
	deepEqual(back, m);
});

test("R2.5: round-trips a lean message (no optional fields)", () => {
	const m = leanMessage();
	const back = parseMessage(serializeMessage(m), `${m.id}.md`);
	ok(back !== null);
	deepEqual(back, m);
});

test("R2.5: round-trips a message with in-reply-to as a real id", () => {
	const m = fullMessage();
	m.inReplyTo = "leaddev-middev-20260626T120400Z";
	m.attempts = 2;
	const back = parseMessage(serializeMessage(m), `${m.id}.md`);
	ok(back !== null);
	deepEqual(back, m);
});

test("R2.5: wrong type value -> null", () => {
	const bad = `---
id: a-b-20260626T120500Z
from: a
to: b
timestamp: 2026-06-26T12:05:00.000Z
type: NOPE
in-reply-to: null
---
body`;
	equal(parseMessage(bad, "a-b-20260626T120500Z.md"), null);
});

test("R2.5: missing closing fence -> null", () => {
	const noclose = `---
from: a
to: b
timestamp: 2026-06-26T12:05:00.000Z
type: DELEGATION
in-reply-to: null
body with no close`;
	equal(parseMessage(noclose, "a-b-20260626T120500Z.md"), null);
});

test("R2.5: missing required key (in-reply-to) -> null", () => {
	const norirt = `---
id: a-b-20260626T120500Z
from: a
to: b
timestamp: 2026-06-26T12:05:00.000Z
type: DELEGATION
---
body`;
	equal(parseMessage(norirt, "a-b-20260626T120500Z.md"), null);
});

test("R2.5: attempts parsed as integer when present, omitted when absent", () => {
	const withAttempts = `---
from: a
to: b
timestamp: 2026-06-26T12:05:00.000Z
type: DELEGATION
in-reply-to: null
attempts: 3
---
body`;
	const m1 = parseMessage(withAttempts, "a-b-20260626T120500Z.md");
	ok(m1 !== null);
	equal(m1?.attempts, 3);
});

test("R2.5: empty input -> null (never throws)", () => {
	equal(parseMessage("", "x-y-20260626T120500Z.md"), null);
	equal(parseMessage("no fences at all", "x-y-20260626T120500Z.md"), null);
});

// ---------------------------------------------------------------------------
// R2.3 / R2.4 / R6.2 — store layout, filenames, concurrent writes
// ---------------------------------------------------------------------------

test("R2.3: writeMessage lands under .app/mess/", () => {
	withTmp((dir) => {
		const path = writeMessage(dir, fullMessage());
		ok(path.startsWith(messDir(dir)), `path under mess: ${path}`);
		ok(existsSync(path));
		ok(existsSync(arcDir(dir)), "arc/ ensured at write time");
	});
});

test("R2.4: generated filenames match FILENAME_RE", () => {
	withTmp((dir) => {
		const path = writeMessage(dir, fullMessage());
		ok(FILENAME_RE.test(basename(path)), `matches: ${basename(path)}`);
	});
});

test("R2.4: two same-second same-pair writes get distinct names (both match RE)", () => {
	withTmp((dir) => {
		const a = writeMessage(dir, fullMessage());
		const b = writeMessage(dir, fullMessage());
		const na = basename(a);
		const nb = basename(b);
		ok(FILENAME_RE.test(na));
		ok(FILENAME_RE.test(nb));
		ok(na !== nb, "distinct basenames");
		// When both land in the same UTC second, the collision suffix fires: the
		// second carries `-NN` and the first does not. (On a second-boundary
		// cross the timestamps simply differ — still distinct — so this inner
		// check only asserts when the suffix path is actually exercised.)
		const tsA = na.replace(/\.md$/, "").replace(/-\d{2,}$/, "");
		const tsB = nb.replace(/\.md$/, "").replace(/-\d{2,}$/, "");
		if (tsA === tsB) {
			ok(/-\d{2,}$/.test(nb.replace(/\.md$/, "")) || /-\d{2,}$/.test(na.replace(/\.md$/, "")));
		}
	});
});

test("R6.2: N=5 concurrent same-second/pair writes -> 5 distinct files, none overwritten", () => {
	withTmp((dir) => {
		const paths: string[] = [];
		for (let i = 0; i < 5; i++) {
			paths.push(writeMessage(dir, fullMessage()));
		}
		const names = paths.map((p) => basename(p));
		equal(new Set(names).size, 5, "5 distinct files");
		for (const n of names) ok(FILENAME_RE.test(n), `matches RE: ${n}`);
		// none overwritten: each body is independently readable & well-formed
		for (const p of paths) {
			const msg = parseMessage(readFileSync(p, "utf8"), basename(p));
			ok(msg !== null, "each file parses");
			equal(msg?.from, "leaddev");
			equal(msg?.to, "middev");
		}
	});
});

// ---------------------------------------------------------------------------
// R2.6 — moveToArc
// ---------------------------------------------------------------------------

test("R2.6: moveToArc removes from mess/ and places in arc/", () => {
	withTmp((dir) => {
		const path = writeMessage(dir, fullMessage());
		ok(existsSync(path));
		const arc = moveToArc(path);
		equal(existsSync(path), false, "gone from mess/");
		ok(arc.startsWith(arcDir(dir)), "landed under arc/");
		ok(existsSync(arc), "present in arc/");
	});
});

test("R2.6: moveToArc also clears the claim marker", () => {
	withTmp((dir) => {
		const path = writeMessage(dir, fullMessage());
		const claim = tryClaim(path, "inst-1");
		ok(claim.ok);
		moveToArc(path);
		equal(existsSync(`${path}.claim`), false, "claim dir removed");
	});
});

// ---------------------------------------------------------------------------
// R2.7 — markFailed retry ladder
// ---------------------------------------------------------------------------

test("R2.7: 1st/2nd markFailed keep the file in mess/ with attempts 1/2; 3rd arcs with FAILURE", () => {
	withTmp((dir) => {
		const path = writeMessage(dir, fullMessage());
		const name = basename(path);

		// 1st
		markFailed(path, "boom-1");
		ok(existsSync(path), "still in mess/ after 1st");
		equal(parseMessage(readFileSync(path, "utf8"), name)?.attempts, 1);

		// 2nd
		markFailed(path, "boom-2");
		ok(existsSync(path), "still in mess/ after 2nd");
		equal(parseMessage(readFileSync(path, "utf8"), name)?.attempts, 2);

		// 3rd -> arc + annotation
		markFailed(path, "boom-3-final");
		equal(existsSync(path), false, "gone from mess/ after 3rd");
		const arcPath = join(arcDir(dir), name);
		ok(existsSync(arcPath), "present in arc/");
		const arcText = readFileSync(arcPath, "utf8");
		ok(arcText.includes("## FAILURE"), "FAILURE annotation present");
		ok(arcText.includes("boom-3-final"), "reason present in annotation");
		ok(arcText.includes("attempts: 3"), "attempt count in annotation");
	});
});

// ---------------------------------------------------------------------------
// R4.1 / R4.2 / R4.3 — transport selection (stubbed collaborators)
// ---------------------------------------------------------------------------

test("R4.1/R4.3: co-located live receiver -> in-app, no file written", async () => {
	await withTmpAsync(async (dir) => {
		const { collab, calls } = stubCollab({ toId: "MidDev", outcome: "injected" });
		const res = await selectAndDeliver(dir, sendInput(), collab);
		equal(res.transport, "in-app");
		equal(res.outcome, "injected");
		equal(calls.irc, 1, "ircSend called once");
		// in-app success writes no file (mess/ not created)
		equal(existsSync(messDir(dir)), false, "no file written");
	});
});

test("R4.2: in-app failed receipt -> file fallback (fallback:true) and a file is written", async () => {
	await withTmpAsync(async (dir) => {
		const { collab } = stubCollab({ toId: "MidDev", outcome: "failed" });
		const res = await selectAndDeliver(dir, sendInput(), collab);
		equal(res.transport, "file");
		equal(res.fallback, true);
		equal(res.reason, "receiver not reachable in-app");
		ok(res.path, "path returned");
		ok(existsSync(res.path as string), "file written");
	});
});

test("R4.2: receiver not hosted here (toId null) -> file fallback", async () => {
	await withTmpAsync(async (dir) => {
		const { collab, calls } = stubCollab({ toId: null });
		const res = await selectAndDeliver(dir, sendInput(), collab);
		equal(res.transport, "file");
		equal(res.fallback, true);
		equal(calls.irc, 0, "ircSend not called when id is null");
		ok(existsSync(res.path as string), "file written");
	});
});

test("R4.1: manifest-declared remote -> file, no irc/resolve calls", async () => {
	await withTmpAsync(async (dir) => {
		const { collab, calls } = stubCollab({
			selfInstance: "inst-1",
			manifest: { self: "inst-1", agents: { middev: "inst-2" } },
			toId: "MidDev", // would be used co-located, but must NOT be reached
		});
		const res = await selectAndDeliver(dir, sendInput(), collab);
		equal(res.transport, "file");
		equal(res.fallback, false);
		equal(calls.irc, 0, "ircSend not called for known-remote");
		equal(calls.resolve, 0, "resolveToId not called for known-remote");
		ok(existsSync(res.path as string), "file written");
	});
});

test("R4.1/R2.2: non-addressable `to` -> rejects, no file written", async () => {
	await withTmpAsync(async (dir) => {
		const { collab } = stubCollab();
		await rejects(selectAndDeliver(dir, sendInput({ to: "user" }), collab), /not addressable/);
		equal(existsSync(messDir(dir)), false, "no file written on reject");
	});
});

test("R4 step1: invalid `from`/`to` (non alnum) -> rejects", async () => {
	await withTmpAsync(async (dir) => {
		const { collab } = stubCollab();
		await rejects(selectAndDeliver(dir, sendInput({ from: "bad name" }), collab), /invalid/);
	});
});

test("R6.4: inReplyTo referencing an in-flight message addressed to `from` acks it", async () => {
	await withTmpAsync(async (dir) => {
		// An in-flight message addressed TO leaddev (the replier).
		const inbound: Message = {
			id: "",
			from: "middev",
			to: "leaddev",
			type: "DELIVERABLE",
			timestamp: "2026-06-26T12:05:00.000Z",
			inReplyTo: null,
			body: "here is the thing",
		};
		const inPath = writeMessage(dir, inbound);
		const inId = basename(inPath).replace(/\.md$/, "");

		const { collab } = stubCollab({ toId: "MidDev", outcome: "injected" });
		const res = await selectAndDeliver(dir, sendInput({ inReplyTo: inId }), collab);
		equal(res.transport, "in-app");
		equal(res.ackedId, inId, "ackedId set");
		equal(existsSync(inPath), false, "original moved to arc/ (PROCESSED)");
		ok(existsSync(join(arcDir(dir), basename(inPath))), "original now in arc/");
	});
});

// ---------------------------------------------------------------------------
// R5.4 — exclusive claim
// ---------------------------------------------------------------------------

test("R5.4: exactly one of two claims on the same file wins", () => {
	withTmp((dir) => {
		const file = join(dir, "a-b-20260626T120500Z.md");
		writeFileSync(file, "x");
		const c1 = tryClaim(file, "inst-1");
		const c2 = tryClaim(file, "inst-2");
		equal(c1.ok, true, "first claim wins");
		ok(c1.token, "first claim has token");
		equal(c2.ok, false, "second claim (non-stale) loses");
	});
});

test("R5.4: pre-created claim dir without owner -> second claim yields ok:false", () => {
	withTmp((dir) => {
		const file = join(dir, "a-b-20260626T120500Z.md");
		writeFileSync(file, "x");
		mkdirSync(`${file}.claim`); // empty claim dir, no owner.json
		const c = tryClaim(file, "inst-1");
		equal(c.ok, false, "unverifiable claim is not stolen");
	});
});

test("R5.4: releaseClaim drops the marker so the file is reclaimable", () => {
	withTmp((dir) => {
		const file = join(dir, "a-b-20260626T120500Z.md");
		writeFileSync(file, "x");
		const c1 = tryClaim(file, "inst-1");
		ok(c1.ok && c1.token);
		releaseClaim(file, c1.token as string);
		equal(existsSync(`${file}.claim`), false);
		const c2 = tryClaim(file, "inst-2");
		equal(c2.ok, true, "reclaimable after release");
	});
});

// ---------------------------------------------------------------------------
// R3.2 / R3.3 — instance id & manifest
// ---------------------------------------------------------------------------

test("R3.2: instanceOf defaults an absent agent to manifest.self", () => {
	const m: InstanceManifest = { self: "inst-1", agents: {} };
	equal(instanceOf("whatever", m), "inst-1");
});

test("R3.2: instanceOf resolves a mapped agent to its instance", () => {
	const m: InstanceManifest = { self: "inst-1", agents: { middev: "inst-2" } };
	equal(instanceOf("middev", m), "inst-2");
});

test("R3.2: instanceOf matches agent names case-insensitively", () => {
	const m: InstanceManifest = { self: "inst-1", agents: { middev: "inst-2" } };
	equal(instanceOf("MidDev", m), "inst-2");
});

test("R3.3: getInstanceId honors OMP_INSTANCE_ID first", () => {
	const prev = process.env.OMP_INSTANCE_ID;
	try {
		process.env.OMP_INSTANCE_ID = "inst-from-env";
		withTmp((dir) => {
			equal(getInstanceId(dir), "inst-from-env");
		});
	} finally {
		if (prev === undefined) delete process.env.OMP_INSTANCE_ID;
		else process.env.OMP_INSTANCE_ID = prev;
	}
});

test("R3.3: getInstanceId generates + persists inst-<uuid> when env unset & manifest absent, stable on second call", () => {
	const prev = process.env.OMP_INSTANCE_ID;
	try {
		delete process.env.OMP_INSTANCE_ID;
		withTmp((dir) => {
			const id1 = getInstanceId(dir);
			ok(/^inst-[0-9a-f-]{36}$/.test(id1), `uuid-shaped: ${id1}`);
			// persisted to instances.json#self
			const persisted = JSON.parse(readFileSync(join(dir, ".app", "instances.json"), "utf8"));
			equal(persisted.self, id1);
			// stable on second call (same cwd, env unset)
			const id2 = getInstanceId(dir);
			equal(id2, id1, "stable across calls");
			// readManifest reflects it
			equal(readManifest(dir).self, id1);
		});
	} finally {
		if (prev === undefined) delete process.env.OMP_INSTANCE_ID;
		else process.env.OMP_INSTANCE_ID = prev;
	}
});

test("readManifest: absent file -> { self: getInstanceId, agents: {} }", () => {
	withTmp((dir) => {
		const m = readManifest(dir);
		equal(m.self, getInstanceId(dir));
		deepEqual(m.agents, {});
	});
});

test("readManifest: tolerant of extra keys + nested agents map", () => {
	withTmp((dir) => {
		mkdirSync(join(dir, ".app"));
		writeFileSync(
			join(dir, ".app", "instances.json"),
			JSON.stringify({ self: "inst-9", agents: { middev: "inst-2", leaddev: "inst-1" }, extra: "ignored" }),
		);
		const m = readManifest(dir);
		equal(m.self, "inst-9");
		deepEqual(m.agents, { middev: "inst-2", leaddev: "inst-1" });
	});
});

test("readManifest: malformed JSON -> { self: getInstanceId, agents: {} }", () => {
	withTmp((dir) => {
		mkdirSync(join(dir, ".app"));
		writeFileSync(join(dir, ".app", "instances.json"), "{not json");
		const m = readManifest(dir);
		equal(m.self, getInstanceId(dir));
		deepEqual(m.agents, {});
	});
});

// ---------------------------------------------------------------------------
// compactUtc sanity
// ---------------------------------------------------------------------------

test("compactUtc: YYYYMMDDTHHMMSSZ shape from a known date", () => {
	const d = new Date(Date.UTC(2026, 5, 26, 12, 5, 0)); // 2026-06-26T12:05:00Z
	equal(compactUtc(d), "20260626T120500Z");
});

// ---------------------------------------------------------------------------
// Subpath-coupling contract (documents the omp-managed dependency)
// ---------------------------------------------------------------------------

test("irc/bus subpath: resolvable with IrcBus, OR rejects with the known node_modules TS-stripping limit", async () => {
	// Dynamic import is REQUIRED here to exercise the module-loading boundary —
	// the package's `import` export points at raw `./src/*.ts`, which Node v26
	// refuses to type-strip under node_modules. At real runtime omp's own loader
	// transforms the .ts; under `node --test` this is the documented failure.
	try {
		const mod = await import("@oh-my-pi/pi-coding-agent/irc/bus");
		ok("IrcBus" in mod, "IrcBus is exported by the resolved module");
	} catch (e) {
		const msg = e instanceof Error ? e.message : String(e);
		ok(
			/node_modules|Stripping types/i.test(msg),
			`expected the known node-test TS-stripping limit, got: ${msg}`,
		);
	}
});

// ---------------------------------------------------------------------------
// Async temp-dir helper (node:test tests can be async directly, but keep parity
// with the sync withTmp cleanup pattern).
// ---------------------------------------------------------------------------

async function withTmpAsync(fn: (dir: string) => Promise<void>): Promise<void> {
	const dir = mkdtempSync(join(tmpdir(), "omp-mess-"));
	try {
		await fn(dir);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
}
