import { describe, expect, test } from "bun:test";
import { treeCommand } from "#/lib/tree/keymap.ts";
import type { TreeRow } from "#/lib/tree/visibility.ts";

function row(
	path: string,
	depth: number,
	folder?: { expanded: boolean },
): TreeRow {
	return {
		entry: { path, type: folder ? "directory" : "file", status: "modified" },
		depth,
		expanded: folder?.expanded ?? false,
		hasChildren: folder !== undefined,
	};
}

/**
 * The shape every case below is read against:
 *
 * ```
 * 0  lib               open
 * 1    lib/router      shut
 * 2    lib/index.js
 * 3  package.json
 * ```
 *
 * One open folder, one shut folder inside it, a leaf beside the shut folder,
 * and a leaf back at the top — which is every position ← and → distinguish.
 */
const ROWS: readonly TreeRow[] = [
	row("lib", 0, { expanded: true }),
	row("lib/router", 1, { expanded: false }),
	row("lib/index.js", 1),
	row("package.json", 0),
];

describe("↑ ↓ Home End", () => {
	test("walk the flat row list a row at a time", () => {
		expect(treeCommand("ArrowDown", ROWS, 1)).toEqual({
			kind: "focus",
			index: 2,
		});
		expect(treeCommand("ArrowUp", ROWS, 1)).toEqual({
			kind: "focus",
			index: 0,
		});
	});

	test("stop at the ends rather than wrapping round", () => {
		expect(treeCommand("ArrowUp", ROWS, 0)).toEqual({
			kind: "focus",
			index: 0,
		});
		expect(treeCommand("ArrowDown", ROWS, 3)).toEqual({
			kind: "focus",
			index: 3,
		});
	});

	test("Home and End go the whole way", () => {
		expect(treeCommand("Home", ROWS, 2)).toEqual({ kind: "focus", index: 0 });
		expect(treeCommand("End", ROWS, 0)).toEqual({ kind: "focus", index: 3 });
	});
});

describe("Enter and Space", () => {
	test("activate whatever the tab stop is on, folder or file", () => {
		// The row decides what activating it means — the key does not.
		expect(treeCommand("Enter", ROWS, 3)).toEqual({
			kind: "activate",
			index: 3,
		});
		expect(treeCommand(" ", ROWS, 0)).toEqual({ kind: "activate", index: 0 });
	});
});

describe("→", () => {
	test("opens a folder that is shut", () => {
		expect(treeCommand("ArrowRight", ROWS, 1)).toEqual({
			kind: "toggle",
			index: 1,
			expanded: true,
		});
	});

	test("steps inside a folder that is already open", () => {
		expect(treeCommand("ArrowRight", ROWS, 0)).toEqual({
			kind: "focus",
			index: 1,
		});
	});

	test("does nothing on a leaf, rather than walking to the next sibling", () => {
		// `package.json` is last; `lib/index.js` has a sibling row after it, and
		// stepping to it would be ↓ wearing → as a disguise.
		expect(treeCommand("ArrowRight", ROWS, 2)).toBeUndefined();
		expect(treeCommand("ArrowRight", ROWS, 3)).toBeUndefined();
	});

	test("does nothing on an open folder showing nothing", () => {
		const empty = [row("lib", 0, { expanded: true })];

		expect(treeCommand("ArrowRight", empty, 0)).toBeUndefined();
	});
});

describe("←", () => {
	test("shuts a folder that is open", () => {
		expect(treeCommand("ArrowLeft", ROWS, 0)).toEqual({
			kind: "toggle",
			index: 0,
			expanded: false,
		});
	});

	test("goes up to the folder holding a leaf", () => {
		expect(treeCommand("ArrowLeft", ROWS, 2)).toEqual({
			kind: "focus",
			index: 0,
		});
	});

	test("goes up from a folder that is already shut", () => {
		expect(treeCommand("ArrowLeft", ROWS, 1)).toEqual({
			kind: "focus",
			index: 0,
		});
	});

	test("does nothing at the top level, where there is nothing above", () => {
		expect(treeCommand("ArrowLeft", ROWS, 3)).toBeUndefined();
	});
});

describe("everything else", () => {
	test("is left to the page: a key the tree does not answer to asks nothing", () => {
		expect(treeCommand("a", ROWS, 0)).toBeUndefined();
		expect(treeCommand("Tab", ROWS, 0)).toBeUndefined();
		expect(treeCommand("Escape", ROWS, 0)).toBeUndefined();
	});

	test("an empty tree answers nothing at all", () => {
		expect(treeCommand("ArrowDown", [], 0)).toBeUndefined();
		expect(treeCommand("Home", [], -1)).toBeUndefined();
	});
});
