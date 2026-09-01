/**
 * Fails if the checked-in `diff-wasm` declaration has drifted from the one
 * wasm-pack generates.
 *
 * `tsconfig.json` points `paths` at `wasm/diff-wasm/types/diff-wasm.d.ts` so
 * that `bun run typecheck` works without a Rust toolchain (see the header of
 * that file). The cost is that the hand-written declaration can fall behind
 * `wasm/diff-wasm/src/lib.rs`; this catches that.
 *
 * Needs `wasm/diff-wasm/pkg/` on disk, so it runs in CI after `bun run
 * build:wasm` — never in the pre-commit hook, which must work toolchain-less.
 *
 *   bun run build:wasm && bun run check:wasm-types
 */

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const GENERATED = "wasm/diff-wasm/pkg/diff_wasm.d.ts";
const DECLARED = "wasm/diff-wasm/types/diff-wasm.d.ts";

/**
 * Exports the declaration deliberately omits: wasm-bindgen boilerplate that
 * nothing in the app imports. Anything else appearing in the generated file is
 * a new binding that needs declaring.
 */
const UNUSED_BOILERPLATE = new Set(["initSync"]);

/** `export function f(a: string): void;` → `{ f: "(a: string): void" }`. */
function readSignatures(file) {
	let source;
	try {
		source = readFileSync(path.join(rootDir, file), "utf8");
	} catch {
		return null;
	}
	const pattern =
		/export\s+(default\s+)?function\s+(\w+)\s*\(([\s\S]*?)\)\s*:\s*([^;]+);/g;
	const signatures = new Map();
	for (const [, , name, parameters, returnType] of source.matchAll(pattern)) {
		signatures.set(name, `(${collapse(parameters)}): ${collapse(returnType)}`);
	}
	return signatures;
}

/** Line breaks, trailing commas and leading union pipes are formatting, not API. */
function collapse(text) {
	return text
		.replace(/\s+/g, " ")
		.replace(/,\s*$/, "")
		.replace(/([:(])\s*\|/g, "$1")
		.trim();
}

const generated = readSignatures(GENERATED);
if (generated === null) {
	console.error(
		`Cannot read ${GENERATED}. Run \`bun run build:wasm\` first — this check needs a Rust toolchain.`,
	);
	process.exit(1);
}

const declared = readSignatures(DECLARED);
if (declared === null) {
	console.error(`Cannot read ${DECLARED}.`);
	process.exit(1);
}

const problems = [];

for (const [name, signature] of generated) {
	if (UNUSED_BOILERPLATE.has(name)) continue;
	const ours = declared.get(name);
	if (ours === undefined) {
		problems.push(`${name}: exported by the module, missing from ${DECLARED}`);
	} else if (ours !== signature) {
		problems.push(
			`${name}:\n    generated ${signature}\n    declared  ${ours}`,
		);
	}
}

for (const name of declared.keys()) {
	if (!generated.has(name)) {
		problems.push(
			`${name}: declared in ${DECLARED}, not exported by the module`,
		);
	}
}

if (problems.length > 0) {
	console.error(
		`${DECLARED} has drifted from ${GENERATED}:\n\n${problems.map((problem) => `  ${problem}`).join("\n")}\n\nUpdate the declaration to match, then re-run.`,
	);
	process.exit(1);
}

console.log(`${DECLARED} matches ${GENERATED}.`);
