/**
 * mess-transport.ts — Cross-instance file-based messaging (C2).
 *
 * Adds an additional, GATED transport layer for delivering agent messages
 * across omp INSTANCES (separate processes sharing the same `<cwd>/.app/`
 * local disk). Co-located receivers keep using in-app (`IrcBus`); only when a
 * receiver is declared remote (different instance) — or unreachable in-app —
 * is a message written to `.app/mess/` and picked up by the receiver's
 * detection (turn scan + idle poll) and re-injected locally.
 *
 * Pure surface (provisioning, parse/serialize, store, claim, selection) uses
 * only node:fs/path/crypto and is unit-testable in isolation. The extension
 * shell (default export) wires that surface to omp events/tools via lazy
 * dynamic imports of the oh-my-pi registry/irc subpaths.
 *
 * Opt-in parity with enforce-orchestrator: ships DORMANT unless the project
 * opts in (`optedIn(ctx.cwd)`), so it imposes nothing by default.
 *
 * Loading note: every runtime VALUE from `@oh-my-pi/pi-coding-agent` is
 * obtained through a lazy `await import()` inside an impure function. A static
 * value import would make this module unloadable under `node --test`: Node v26
 * cannot strip types from `.ts` files under `node_modules` (the package's
 * `import` export condition points at raw `./src/*.ts`). The pure functions
 * exercised by the tests never trigger these imports. TYPES are imported with
 * top-level `import type` (erased at runtime).
 */

import type { ExtensionAPI, ExtensionContext } from "@oh-my-pi/pi-coding-agent";
import {
	appendFileSync,
	existsSync,
	mkdirSync,
	readFileSync,
	readdirSync,
	renameSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { basename, dirname, join } from "node:path";
import { randomUUID } from "node:crypto";
import { optedIn } from "./enforce-orchestrator.ts";

// ---------------------------------------------------------------------------
// Constants (SPEC §6)
// ---------------------------------------------------------------------------

/** Agents eligible to be a `to:` recipient (the 7 team agents + `main`). */
const TEAM = ["reqguru", "drpe", "leaddev", "validator", "docworm", "hr", "middev"] as const;

/** Addressable set (case-insensitive): TEAM plus the Main agent / Elon. */
const ADDRESSABLE: ReadonlySet<string> = new Set<string>([...TEAM, "main"]);

const MESS_TYPES = ["DELEGATION", "DELIVERABLE", "QUESTION_BATCH", "FAILURE", "HANDOFF"] as const;
const MESS_TYPE_SET: ReadonlySet<string> = new Set<string>(MESS_TYPES);

/** Idle-poll interval (default 2s, R5.3 bounded latency). */
const DETECTION_POLL_MS = Number(process.env.OMP_MESS_POLL_MS) || 2000;
/** A claim older than this is reaped so a crashed processor's message is recovered. */
const CLAIM_STALE_MS = Number(process.env.OMP_MESS_CLAIM_STALE_MS) || 300000;
/** After this many delivery failures a message is moved to arc/ with a FAILURE annotation. */
const FAIL_MAX = 3;

const NAME_RE = /^[A-Za-z0-9]+$/;

// ---------------------------------------------------------------------------
// Types (SPEC §5)
// ---------------------------------------------------------------------------

export type MessType = "DELEGATION" | "DELIVERABLE" | "QUESTION_BATCH" | "FAILURE" | "HANDOFF";

export interface Message {
	id: string;
	from: string;
	to: string;
	type: MessType;
	timestamp: string;
	inReplyTo: string | null;
	fromInstance?: string;
	toInstance?: string;
	attempts?: number;
	body: string;
}

export interface InstanceManifest {
	self: string;
	agents: Record<string, string>;
}

/** Filename grammar (SPEC §4.4): `<from>-<to>-<YYYYMMDDTHHMMSSZ>.md` with optional `-NN`. */
export const FILENAME_RE: RegExp = /^[A-Za-z0-9]+-[A-Za-z0-9]+-\d{8}T\d{6}Z(-\d{2,})?\.md$/;

// ---------------------------------------------------------------------------
// PURE — provisioning / manifest (SPEC §4.1, §4.2)
// ---------------------------------------------------------------------------

/**
 * This instance's stable id. Precedence: `OMP_INSTANCE_ID` (non-empty) ▸
 * persisted `<cwd>/.app/instances.json#self` ▸ generated `inst-<uuid>`,
 * persisted atomically on first read. Stable across restarts; distinct across
 * concurrent instances (UUID).
 */
export function getInstanceId(cwd: string): string {
	const env = process.env.OMP_INSTANCE_ID;
	if (env && env.length > 0) return env;

	const path = join(cwd, ".app", "instances.json");

	// Already persisted?
	try {
		const parsed: unknown = JSON.parse(readFileSync(path, "utf8"));
		if (
			parsed !== null &&
			typeof parsed === "object" &&
			"self" in parsed &&
			typeof parsed.self === "string" &&
			parsed.self.length > 0
		) {
			return parsed.self;
		}
	} catch {
		// absent / malformed → provision below
	}

	const id = `inst-${randomUUID()}`;
	persistSelf(path, id);
	return id;
}

/** Atomically write `instances.json`, preserving any existing keys (tolerant). */
function persistSelf(path: string, self: string): void {
	try {
		const dir = dirname(path);
		mkdirSync(dir, { recursive: true });
		const next: Record<string, unknown> = {};
		try {
			const parsed: unknown = JSON.parse(readFileSync(path, "utf8"));
			if (parsed !== null && typeof parsed === "object") {
				for (const [k, v] of Object.entries(parsed)) next[k] = v;
			}
		} catch {
			// absent / empty → start fresh
		}
		next.self = self;
		const tmp = join(dir, `.instances.${randomUUID()}.tmp`);
		writeFileSync(tmp, `${JSON.stringify(next, null, 2)}\n`);
		renameSync(tmp, path);
	} catch {
		// Best-effort persist; the in-memory id is still returned and stable for
		// this process. A transient fs failure must not crash provisioning.
	}
}

/**
 * Read `.app/instances.json` (tolerant of extra keys). Absent/malformed →
 * `{ self: getInstanceId(cwd), agents: {} }`.
 */
export function readManifest(cwd: string): InstanceManifest {
	const path = join(cwd, ".app", "instances.json");
	try {
		const parsed: unknown = JSON.parse(readFileSync(path, "utf8"));
		if (parsed === null || typeof parsed !== "object") throw new Error("manifest not an object");
		const self = "self" in parsed && typeof parsed.self === "string" ? parsed.self : getInstanceId(cwd);
		const agents: Record<string, string> = {};
		if ("agents" in parsed && parsed.agents !== null && typeof parsed.agents === "object") {
			for (const [k, v] of Object.entries(parsed.agents)) {
				if (typeof v === "string") agents[k] = v;
			}
		}
		return { self, agents };
	} catch {
		return { self: getInstanceId(cwd), agents: {} };
	}
}

/** Resolve an agent name to its hosting instance (absent → co-located = self). */
export function instanceOf(name: string, manifest: InstanceManifest): string {
	return manifest.agents[name] ?? manifest.agents[name.toLowerCase()] ?? manifest.self;
}

// ---------------------------------------------------------------------------
// PURE — timestamp
// ---------------------------------------------------------------------------

/** UTC compact `YYYYMMDDTHHMMSSZ` (used in filenames). */
export function compactUtc(d: Date = new Date()): string {
	const p = (n: number, w = 2): string => String(n).padStart(w, "0");
	return (
		`${d.getUTCFullYear()}${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}` +
		`T${p(d.getUTCHours())}${p(d.getUTCMinutes())}${p(d.getUTCSeconds())}Z`
	);
}

// ---------------------------------------------------------------------------
// PURE — message parse / serialize (SPEC §4.5)
// ---------------------------------------------------------------------------

/**
 * Strict frontmatter parser. Splits on the first two `---` lines, validates the
 * required scalar keys + the `type` enum, and returns null on ANY malformation
 * (never throws). `id` is taken from the filename stem.
 */
export function parseMessage(raw: string, filename: string): Message | null {
	try {
		const lines = raw.split("\n");
		let i = 0;
		while (i < lines.length && lines[i].trim() !== "---") i++;
		if (i >= lines.length) return null; // no opening fence
		const fmStart = i + 1;
		let j = fmStart;
		while (j < lines.length && lines[j].trim() !== "---") j++;
		if (j >= lines.length) return null; // no closing fence

		const kv: Record<string, string> = {};
		for (const line of lines.slice(fmStart, j)) {
			const ci = line.indexOf(":");
			if (ci === -1) continue;
			const key = line.slice(0, ci).trim();
			const val = line.slice(ci + 1).trim();
			if (key.length > 0) kv[key] = val;
		}

		const from = kv["from"];
		const to = kv["to"];
		const timestamp = kv["timestamp"];
		const type = kv["type"];
		const inReplyToRaw = kv["in-reply-to"];
		if (from === undefined || to === undefined || timestamp === undefined || type === undefined || inReplyToRaw === undefined) {
			return null; // required keys enforced
		}
		if (!MESS_TYPE_SET.has(type)) return null; // enum enforced

		const id = filename.endsWith(".md") ? filename.slice(0, -3) : filename;
		const msg: Message = {
			id,
			from,
			to,
			type: type as MessType,
			timestamp,
			inReplyTo: inReplyToRaw === "null" ? null : inReplyToRaw,
			body: lines.slice(j + 1).join("\n"),
		};
		if (kv["from-instance"] !== undefined) msg.fromInstance = kv["from-instance"];
		if (kv["to-instance"] !== undefined) msg.toInstance = kv["to-instance"];
		if (kv["attempts"] !== undefined) {
			const n = Number(kv["attempts"]);
			if (Number.isInteger(n)) msg.attempts = n;
		}
		return msg;
	} catch {
		return null;
	}
}

/** Emit `---` frontmatter + body. Round-trips through `parseMessage`. */
export function serializeMessage(msg: Message): string {
	const lines: string[] = ["---"];
	lines.push(`id: ${msg.id}`);
	lines.push(`from: ${msg.from}`);
	lines.push(`to: ${msg.to}`);
	if (msg.fromInstance !== undefined) lines.push(`from-instance: ${msg.fromInstance}`);
	if (msg.toInstance !== undefined) lines.push(`to-instance: ${msg.toInstance}`);
	lines.push(`timestamp: ${msg.timestamp}`);
	lines.push(`type: ${msg.type}`);
	lines.push(`in-reply-to: ${msg.inReplyTo === null ? "null" : msg.inReplyTo}`);
	if (msg.attempts !== undefined) lines.push(`attempts: ${msg.attempts}`);
	lines.push("---");
	return `${lines.join("\n")}\n${msg.body}`;
}

// ---------------------------------------------------------------------------
// PURE — store layout & write (SPEC §4.4, R6.2)
// ---------------------------------------------------------------------------

export function messDir(cwd: string): string {
	return join(cwd, ".app", "mess");
}

export function arcDir(cwd: string): string {
	return join(messDir(cwd), "arc");
}

/**
 * Atomically write a message under `.app/mess/`. Filename =
 * `<from>-<to>-<compactUtc>.md`, with a zero-padded `-NN` suffix probed on
 * same-second same-pair collision (R6.2). `msg.id` is set to the written stem.
 * Returns the final path. `arc/` is ensured at write time.
 */
export function writeMessage(cwd: string, msg: Message): string {
	const dir = messDir(cwd);
	mkdirSync(dir, { recursive: true });
	mkdirSync(arcDir(cwd), { recursive: true });

	const ts = compactUtc();
	let base = `${msg.from}-${msg.to}-${ts}.md`;
	if (existsSync(join(dir, base))) {
		let n = 1;
		for (;;) {
			const cand = `${msg.from}-${msg.to}-${ts}-${String(n).padStart(2, "0")}.md`;
			if (!existsSync(join(dir, cand))) {
				base = cand;
				break;
			}
			n++;
		}
	}

	msg.id = base.endsWith(".md") ? base.slice(0, -3) : base;
	const content = serializeMessage(msg);
	const tmp = join(dir, `${base}.tmp.${randomUUID()}`);
	writeFileSync(tmp, content);
	renameSync(tmp, join(dir, base));
	return join(dir, base);
}

// ---------------------------------------------------------------------------
// PURE — claim & lifecycle (SPEC §4.8, R5.4, R2.6, R2.7)
// ---------------------------------------------------------------------------

/** Read a claim's owner timestamp, or undefined if unreadable. */
function claimTs(claimDir: string): number | undefined {
	try {
		const ownerRaw: unknown = JSON.parse(readFileSync(join(claimDir, "owner.json"), "utf8"));
		if (ownerRaw === null || typeof ownerRaw !== "object") return undefined;
		if ("ts" in ownerRaw && typeof ownerRaw.ts === "number") return ownerRaw.ts;
		return undefined;
	} catch {
		return undefined;
	}
}

/** Write the owner record into a freshly-created (empty) claim dir. */
function stampOwner(claimDir: string, selfInst: string): { ok: true; token: string } {
	const token = randomUUID();
	writeFileSync(
		join(claimDir, "owner.json"),
		JSON.stringify({ token, instance: selfInst, ts: Date.now() }),
	);
	return { ok: true, token };
}

/**
 * Reap a stale claim (owner older than CLAIM_STALE_MS) and retry the mkdir
 * once; a non-stale or unreadable claim yields `{ok:false}`. Never throws.
 */
function reapIfStale(file: string, claimDir: string, selfInst: string): { ok: boolean; token?: string } {
	const ts = claimTs(claimDir);
	if (ts === undefined) return { ok: false }; // can't verify staleness → don't steal
	if (Date.now() - ts <= CLAIM_STALE_MS) return { ok: false }; // owned by another live processor
	try {
		rmSync(claimDir, { recursive: true, force: true });
	} catch {
		return { ok: false };
	}
	try {
		mkdirSync(claimDir);
	} catch (e) {
		// Lost the retry race → another processor reaped+claimed first.
		if (e instanceof Error && "code" in e && e.code === "EEXIST") return { ok: false };
		return { ok: false };
	}
	return stampOwner(claimDir, selfInst);
}

/**
 * Exclusive claim via atomic `mkdir`. Exactly one concurrent caller wins
 * (EEXIST race). On EEXIST, a stale claim is reaped and retried once; a
 * non-stale claim yields `{ok:false}`. Never throws on EEXIST.
 */
export function tryClaim(file: string, selfInst: string): { ok: boolean; token?: string } {
	const claimDir = `${file}.claim`;
	try {
		mkdirSync(claimDir);
	} catch (e) {
		if (e instanceof Error && "code" in e && e.code === "EEXIST") {
			return reapIfStale(file, claimDir, selfInst);
		}
		throw e;
	}
	return stampOwner(claimDir, selfInst);
}

/** Best-effort claim release (token accepted for API symmetry; removal is unconditional). */
export function releaseClaim(file: string, _token: string): void {
	try {
		rmSync(`${file}.claim`, { recursive: true, force: true });
	} catch {
		// best-effort
	}
}

/** Atomic same-volume move to `arc/`; removes any claim marker. Returns the arc path. */
export function moveToArc(file: string): string {
	// The file lives in <cwd>/.app/mess/; arc/ is its sibling (same volume → atomic).
	const arc = join(dirname(file), "arc");
	mkdirSync(arc, { recursive: true });
	const dest = join(arc, basename(file));
	renameSync(file, dest);
	try {
		rmSync(`${file}.claim`, { recursive: true, force: true });
	} catch {
		// best-effort
	}
	return dest;
}

/**
 * Increment `attempts` and rewrite the file in place. At `>= FAIL_MAX` move it
 * to `arc/` with a `## FAILURE` annotation (R2.7); otherwise drop the claim so
 * it is re-deliverable on the next scan. A null parse is a no-op.
 */
export function markFailed(file: string, reason: string): void {
	let raw: string;
	try {
		raw = readFileSync(file, "utf8");
	} catch {
		return;
	}
	const msg = parseMessage(raw, basename(file));
	if (!msg) return;

	const attempts = (msg.attempts ?? 0) + 1;
	msg.attempts = attempts;
	const updated = serializeMessage(msg);

	const tmp = `${file}.tmp.${randomUUID()}`;
	writeFileSync(tmp, updated);
	renameSync(tmp, file);

	if (attempts >= FAIL_MAX) {
		const arcPath = moveToArc(file);
		try {
			appendFileSync(arcPath, `\n\n## FAILURE\n- attempts: ${attempts}\n- last reason: ${reason}\n`);
		} catch {
			// best-effort annotation
		}
	} else {
		// stays in mess/, re-deliverable once the claim is dropped
		try {
			rmSync(`${file}.claim`, { recursive: true, force: true });
		} catch {
			// best-effort
		}
	}
}

// ---------------------------------------------------------------------------
// Impure — registry resolution (name → live CamelCase id)
// ---------------------------------------------------------------------------

// Lazy-cached registry module. Dynamic import is REQUIRED: a static value
// import from this subpath breaks `node --test` (Node cannot strip types from
// the package's `./src/*.ts` under node_modules). Runtime-only — omp's loader
// transforms the .ts at real runtime; the pure tests never reach here.
let registryMod:
	| Promise<typeof import("@oh-my-pi/pi-coding-agent/registry/agent-registry")>
	| undefined;

/**
 * Case-insensitive name → live registry id (e.g. `"middev"` → `"MidDev"`), or
 * null. Required because `IrcBus.send` → `registry.get(to)` is id-exact. Async
 * (it dynamic-imports the registry); returns null on any failure.
 */
export async function resolveAgentId(name: string): Promise<string | null> {
	try {
		registryMod ??= import("@oh-my-pi/pi-coding-agent/registry/agent-registry");
		const { AgentRegistry } = await registryMod;
		const lower = name.toLowerCase();
		for (const ref of AgentRegistry.global().list()) {
			if (ref.id.toLowerCase() === lower) return ref.id;
		}
		return null;
	} catch {
		return null;
	}
}

// ---------------------------------------------------------------------------
// PURE — transport selection (SPEC §4.3) with injectable collaborators
// ---------------------------------------------------------------------------

export interface MessSendInput {
	from: string;
	to: string;
	type: MessType;
	body: string;
	inReplyTo?: string | null;
}

export interface MessSendResult {
	transport: "in-app" | "file";
	fallback?: boolean;
	outcome?: string;
	path?: string;
	reason?: string;
	to: string;
	ackedId?: string;
}

export interface MessCollaborators {
	selfInstance: string;
	manifest: InstanceManifest;
	resolveToId: (name: string) => Promise<string | null>;
	ircSend: (m: { from: string; to: string; body: string; replyTo?: string | null }) => Promise<{ outcome: string }>;
}

/** Build a storable Message for the file path (writeMessage sets `id` from the filename). */
function buildFileMessage(input: MessSendInput, collab: MessCollaborators, toInst: string): Message {
	return {
		id: "",
		from: input.from,
		to: input.to,
		type: input.type,
		timestamp: new Date().toISOString(),
		inReplyTo: input.inReplyTo ?? null,
		fromInstance: collab.selfInstance,
		toInstance: toInst,
		attempts: 0,
		body: input.body,
	};
}

/**
 * Reply/ack side-effect (R6.4): if `inReplyTo` references an in-flight message
 * addressed to `from`, mark it PROCESSED (atomic move to arc/) and return its
 * id. Returns undefined otherwise (including when inReplyTo is absent).
 */
function maybeAckReply(cwd: string, input: MessSendInput): string | undefined {
	if (!input.inReplyTo) return undefined;
	const dir = messDir(cwd);
	let entries: string[];
	try {
		entries = readdirSync(dir);
	} catch {
		return undefined;
	}
	for (const name of entries) {
		if (!name.endsWith(".md")) continue;
		const stem = name.slice(0, -3);
		if (stem !== input.inReplyTo) continue;
		const full = join(dir, name);
		try {
			const msg = parseMessage(readFileSync(full, "utf8"), name);
			if (msg && msg.to.toLowerCase() === input.from.toLowerCase()) {
				moveToArc(full);
				return msg.id;
			}
		} catch {
			// skip unreadable
		}
	}
	return undefined;
}

/**
 * Select the transport and deliver (SPEC §4.3 steps 1–7):
 *  1. validate `from`/`to` + addressable set;
 *  2. resolve `toInst`;
 *  3. known-remote → file (no in-app);
 *  4. co-located + live → in-app;
 *  5. null id or `failed` receipt → file fallback;
 *  6. reply side-effect (ack).
 */
export async function selectAndDeliver(
	cwd: string,
	input: MessSendInput,
	collab: MessCollaborators,
): Promise<MessSendResult> {
	if (!NAME_RE.test(input.from)) throw new Error(`mess-send: invalid "from" name "${input.from}"`);
	if (!NAME_RE.test(input.to)) throw new Error(`mess-send: invalid "to" name "${input.to}"`);
	if (!ADDRESSABLE.has(input.to.toLowerCase())) {
		throw new Error(`mess-send: "${input.to}" is not addressable (must be a registered agent or "main")`);
	}

	const toInst = instanceOf(input.to, collab.manifest);
	const ackedId = maybeAckReply(cwd, input);

	// Known-remote (R4.1): manifest declares a different instance.
	if (toInst !== collab.selfInstance) {
		const path = writeMessage(cwd, buildFileMessage(input, collab, toInst));
		const result: MessSendResult = { transport: "file", fallback: false, path, to: input.to };
		if (ackedId !== undefined) result.ackedId = ackedId;
		return result;
	}

	// Co-located, live (R4.1): receiver hosted in this registry.
	const toId = await collab.resolveToId(input.to);
	if (toId !== null) {
		const receipt = await collab.ircSend({
			from: input.from,
			to: toId,
			body: input.body,
			replyTo: input.inReplyTo ?? null,
		});
		if (receipt.outcome !== "failed") {
			const result: MessSendResult = { transport: "in-app", outcome: receipt.outcome, to: input.to };
			if (ackedId !== undefined) result.ackedId = ackedId;
			return result;
		}
	}

	// Fallback to file (R4.2): not hosted here, or in-app failed.
	const path = writeMessage(cwd, buildFileMessage(input, collab, toInst));
	const result: MessSendResult = {
		transport: "file",
		fallback: true,
		reason: "receiver not reachable in-app",
		path,
		to: input.to,
	};
	if (ackedId !== undefined) result.ackedId = ackedId;
	return result;
}

// ---------------------------------------------------------------------------
// Extension shell (impure) — SPEC §4.7, §4.8
// ---------------------------------------------------------------------------

interface DeliveredRec {
	id: string;
	from: string;
	to: string;
	type: string;
}

/** Idle-poll interval handle (cleared on session_shutdown). */
let pollHandle: NodeJS.Timeout | undefined;
/** Messages delivered during the current main-agent turn (for the session_stop continuation). */
let deliveredThisTurn: DeliveredRec[] = [];

/** Locate an in-flight message file by id stem; returns its full path or null. */
function findInflightById(cwd: string, id: string): string | null {
	const dir = messDir(cwd);
	let entries: string[];
	try {
		entries = readdirSync(dir);
	} catch {
		return null;
	}
	for (const name of entries) {
		if (!name.endsWith(".md")) continue;
		if (name.slice(0, -3) === id) return join(dir, name);
	}
	return null;
}

/**
 * Detection scan (SPEC §4.7): for each in-flight file whose `to:` is hosted in
 * THIS registry, claim it and re-inject locally via the proven in-app path. A
 * Main recipient is delivered via `sendMessage` and treated PROCESSED on
 * delivery; a subagent recipient is delivered via `IrcBus.send` and left
 * CLAIMED until its `mess-done`. Wrapped end-to-end in try/catch — a transport
 * failure MUST NEVER break the session.
 */
async function scanAndDeliver(pi: ExtensionAPI, ctx: ExtensionContext): Promise<void> {
	try {
		if (!optedIn(ctx.cwd)) return;

		let hosted: Set<string>;
		let mainId: string;
		try {
			registryMod ??= import("@oh-my-pi/pi-coding-agent/registry/agent-registry");
			const { AgentRegistry, MAIN_AGENT_ID } = await registryMod;
			hosted = new Set(AgentRegistry.global().list().map((r) => r.id.toLowerCase()));
			mainId = MAIN_AGENT_ID;
		} catch {
			return;
		}

		const dir = messDir(ctx.cwd);
		let entries: string[];
		try {
			entries = readdirSync(dir);
		} catch {
			return;
		}

		for (const name of entries) {
			if (!name.endsWith(".md") || !FILENAME_RE.test(name)) continue;
			const full = join(dir, name);

			let msg: Message | null;
			try {
				msg = parseMessage(readFileSync(full, "utf8"), name);
			} catch {
				continue;
			}
			if (!msg) continue;
			if (!hosted.has(msg.to.toLowerCase())) continue; // not for this instance

			const claim = tryClaim(full, getInstanceId(ctx.cwd));
			if (!claim.ok || !claim.token) continue;

			const toId = await resolveAgentId(msg.to);
			if (toId === null) {
				releaseClaim(full, claim.token);
				continue;
			}

			const injectedBody = `[:mess-id=${msg.id} from=${msg.from} type=${msg.type}]\n${msg.body}`;
			try {
				if (toId === mainId) {
					pi.sendMessage(
						{
							customType: "omp-mess:deliver",
							content: injectedBody,
							display: false,
							attribution: "user",
						},
						{ deliverAs: "nextTurn", triggerTurn: true },
					);
					moveToArc(full); // PROCESSED on delivery
					deliveredThisTurn.push({ id: msg.id, from: msg.from, to: msg.to, type: msg.type });
				} else {
					const { IrcBus } = await import("@oh-my-pi/pi-coding-agent/irc/bus");
					const receipt = await IrcBus.global().send({
						from: msg.from,
						to: toId,
						body: injectedBody,
						replyTo: msg.inReplyTo ?? undefined,
					});
					if (receipt.outcome === "failed") {
						releaseClaim(full, claim.token); // re-deliverable on next scan
					} else {
						// left CLAIMED — awaits the receiver's mess-done
						deliveredThisTurn.push({ id: msg.id, from: msg.from, to: msg.to, type: msg.type });
					}
				}
			} catch (err) {
				pi.logger.debug(`mess-transport: delivery failed for ${msg.id}`, {
					error: err instanceof Error ? err.message : String(err),
				});
			}
		}
	} catch (err) {
		try {
			pi.logger.debug("mess-transport: scan error", {
				error: err instanceof Error ? err.message : String(err),
			});
		} catch {
			// never break the session
		}
	}
}

/**
 * Default omp extension factory. Dormant unless the project opts in. Registers
 * the `mess-send` / `mess-fail` tools and the detection hooks (turn scan +
 * idle poll + session_stop continuation).
 */
export default function messTransport(pi: ExtensionAPI): void {
	pi.setLabel("Cross-instance file transport (opt-in)");
	const z = pi.zod;

	// --- mess-send: the canonical send primitive (SPEC §4.3) -----------------
	pi.registerTool({
		name: "mess-send",
		label: "Cross-instance message send",
		description:
			"Send a message to an agent. Delivers in-app when the receiver is co-located and live; " +
			"otherwise writes a file under .app/mess/ for cross-instance delivery. " +
			"Returns the chosen transport ({transport: 'in-app'|'file'}), the file path when file, " +
			"and any acked message id (a reply marks its referenced message PROCESSED).",
		approval: "write",
		parameters: z.object({
			from: z.string(),
			to: z.string(),
			type: z.enum(MESS_TYPES),
			body: z.string(),
			inReplyTo: z.string().nullable().optional(),
		}),
		async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
			try {
				if (!optedIn(ctx.cwd)) {
					return {
						content: [{ type: "text", text: "mess-send: transport not opted in for this project" }],
					};
				}
				const collab: MessCollaborators = {
					selfInstance: getInstanceId(ctx.cwd),
					manifest: readManifest(ctx.cwd),
					resolveToId: resolveAgentId,
					// Dynamic import is REQUIRED — static value import from this
					// subpath breaks `node --test` (node_modules .ts stripping).
					ircSend: async (m) => {
						const { IrcBus } = await import("@oh-my-pi/pi-coding-agent/irc/bus");
						const receipt = await IrcBus.global().send({
							from: m.from,
							to: m.to,
							body: m.body,
							replyTo: m.replyTo ?? undefined,
						});
						return { outcome: receipt.outcome };
					},
				};
				const result = await selectAndDeliver(ctx.cwd, params as MessSendInput, collab);
				return { content: [{ type: "text", text: JSON.stringify(result) }] };
			} catch (err) {
				const msg = err instanceof Error ? err.message : String(err);
				return {
					content: [{ type: "text", text: `mess-send failed: ${msg}` }],
					isError: true,
				};
			}
		},
	});

	// --- mess-fail: increment attempts / arc+annotate at FAIL_MAX (SPEC §4.8) -
	pi.registerTool({
		name: "mess-fail",
		label: "Mark message failed",
		description:
			"Mark a received message as failed (increments attempts). After 3 attempts the message is " +
			"moved to arc/ with a ## FAILURE annotation; otherwise it stays in .app/mess/ for re-delivery.",
		approval: "write",
		parameters: z.object({
			id: z.string(),
			reason: z.string(),
		}),
		async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
			try {
				if (!optedIn(ctx.cwd)) {
					return {
						content: [{ type: "text", text: "mess-fail: transport not opted in for this project" }],
					};
				}
				const file = findInflightById(ctx.cwd, params.id);
				if (!file) {
					return {
						content: [{ type: "text", text: `mess-fail: no in-flight message with id "${params.id}"` }],
						isError: true,
					};
				}
				markFailed(file, params.reason);
				return {
					content: [{ type: "text", text: JSON.stringify({ id: params.id, marked: true }) }],
				};
			} catch (err) {
				const msg = err instanceof Error ? err.message : String(err);
				return {
					content: [{ type: "text", text: `mess-fail failed: ${msg}` }],
					isError: true,
				};
			}
		},
	});

	// --- Idle poll (R5.2/R5.3): scan only when truly idle & opted in ---------
	// The poll needs an ExtensionContext for cwd/isIdle; capture it here and
	// drive the interval from a closure that has the real ctx.
	const startPoll = (ctx: ExtensionContext): void => {
		if (pollHandle) return;
		pollHandle = setInterval(() => {
			try {
				if (!ctx.isIdle() || ctx.hasPendingMessages()) return;
				if (!optedIn(ctx.cwd)) return;
				void scanAndDeliver(pi, ctx);
			} catch {
				// never break the session
			}
		}, DETECTION_POLL_MS);
	};

	pi.on("turn_start", () => {
		deliveredThisTurn = [];
	});
	pi.on("turn_start", async (_event, ctx) => {
		try {
			if (!optedIn(ctx.cwd)) return;
			await scanAndDeliver(pi, ctx);
		} catch {
			// never break the session
		}
	});
	pi.on("agent_start", async (_event, ctx) => {
		try {
			if (!optedIn(ctx.cwd)) return;
			await scanAndDeliver(pi, ctx);
		} catch {
			// never break the session
		}
	});
	pi.on("session_start", (_event, ctx) => {
		startPoll(ctx);
	});
	pi.on("session_shutdown", () => {
		if (pollHandle) {
			clearInterval(pollHandle);
			pollHandle = undefined;
		}
	});

	// Continuation injection (R5.3): if anything was delivered this turn, take
	// a continuation turn so the main agent can act on it.
	pi.on("session_stop", () => {
		try {
			const recs = deliveredThisTurn;
			deliveredThisTurn = [];
			if (recs.length === 0) return;
			const summary = recs
				.map((r) => `[:mess-id=${r.id} from=${r.from} to=${r.to} type=${r.type}]`)
				.join("; ");
			return {
				continue: true,
				additionalContext: `mess-transport delivered ${recs.length} cross-instance message(s): ${summary}`,
			};
		} catch {
			// never break the session
		}
	});
}
