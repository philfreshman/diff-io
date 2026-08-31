import { describe, expect, test } from "bun:test";
import { visibleRows } from "#/lib/tree/visibility.ts";
import type { DiffFileEntry } from "#/lib/worker/protocol.ts";

function file(path: string, status: DiffFileEntry["status"]): DiffFileEntry {
	return { path, type: "file", status };
}

const NESTED: DiffFileEntry = {
	path: "",
	type: "directory",
	status: "modified",
	children: [
		{
			path: "lib",
			type: "directory",
			status: "modified",
			children: [
				file("lib/index.js", "modified"),
				file("lib/util.js", "unchanged"),
			],
		},
		file("package.json", "modified"),
	],
};

const SHOW_ALL = {
	filter: "",
	onlyModified: false,
	expandedKeys: new Set<string>(),
	collapsedKeys: new Set<string>(),
};

describe("visibleRows", () => {
	test("a folder's contents appear only when it is open", () => {
		const rows = visibleRows(NESTED, SHOW_ALL).map((row) => row.entry.path);

		expect(rows).toEqual(["lib", "package.json"]);
	});

	test("opening a folder puts its contents under it, one level in", () => {
		const rows = visibleRows(NESTED, {
			...SHOW_ALL,
			expandedKeys: new Set(["lib"]),
		});

		expect(rows.map((row) => [row.entry.path, row.depth])).toEqual([
			["lib", 0],
			["lib/index.js", 1],
			["lib/util.js", 1],
			["package.json", 0],
		]);
		expect(rows[0]).toMatchObject({ expanded: true, hasChildren: true });
	});

	test("only-modified drops what did not change, and keeps what leads to it", () => {
		const rows = visibleRows(NESTED, {
			...SHOW_ALL,
			onlyModified: true,
			expandedKeys: new Set(["lib"]),
		});

		// `lib` itself is only here because something under it changed.
		expect(rows.map((row) => row.entry.path)).toEqual([
			"lib",
			"lib/index.js",
			"package.json",
		]);
	});

	test("the filter matches anywhere in a path, whatever the case", () => {
		const rows = visibleRows(NESTED, {
			...SHOW_ALL,
			filter: "UTIL",
			expandedKeys: new Set(["lib"]),
		});

		expect(rows.map((row) => row.entry.path)).toEqual(["lib", "lib/util.js"]);
	});

	test("a folder whose own name matches keeps everything under it", () => {
		// Filtering to a folder is asking for that folder, not for the files in
		// it whose names happen to repeat its own.
		const rows = visibleRows(NESTED, {
			...SHOW_ALL,
			filter: "lib",
			expandedKeys: new Set(["lib"]),
		});

		expect(rows.map((row) => row.entry.path)).toEqual([
			"lib",
			"lib/index.js",
			"lib/util.js",
		]);
	});

	test("filtering opens the folders on the way to a match", () => {
		// Nothing has been expanded by hand: a filter whose matches are all
		// buried would otherwise look like no matches at all.
		const rows = visibleRows(NESTED, { ...SHOW_ALL, filter: "index" });

		expect(rows.map((row) => row.entry.path)).toEqual(["lib", "lib/index.js"]);
	});

	test("only-modified opens the folders that have something to show", () => {
		const rows = visibleRows(NESTED, { ...SHOW_ALL, onlyModified: true });

		expect(rows.map((row) => row.entry.path)).toEqual([
			"lib",
			"lib/index.js",
			"package.json",
		]);
	});

	test("a folder closed by hand stays closed", () => {
		const rows = visibleRows(NESTED, {
			...SHOW_ALL,
			onlyModified: true,
			collapsedKeys: new Set(["lib"]),
		});

		expect(rows.map((row) => row.entry.path)).toEqual(["lib", "package.json"]);
	});

	test("a package that is one folder deep opens that folder", () => {
		// Otherwise the whole tree reads as a single unopened row.
		const single: DiffFileEntry = {
			path: "",
			type: "directory",
			status: "modified",
			children: [
				{
					path: "src",
					type: "directory",
					status: "modified",
					children: [file("src/index.js", "modified")],
				},
			],
		};

		const rows = visibleRows(single, SHOW_ALL);

		expect(rows.map((row) => row.entry.path)).toEqual(["src", "src/index.js"]);
	});

	test("has nothing to show before a comparison has run", () => {
		expect(visibleRows(null, SHOW_ALL)).toEqual([]);
	});

	test("lists the files of a flat tree, in tree order", () => {
		const index = file("index.js", "modified");
		const manifest = file("package.json", "added");
		const tree: DiffFileEntry = {
			path: "",
			type: "directory",
			status: "modified",
			children: [index, manifest],
		};

		expect(visibleRows(tree, SHOW_ALL)).toEqual([
			{ entry: index, depth: 0, expanded: false, hasChildren: false },
			{ entry: manifest, depth: 0, expanded: false, hasChildren: false },
		]);
	});
});
