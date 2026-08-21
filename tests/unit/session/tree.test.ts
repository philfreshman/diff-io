import { describe, expect, test } from "bun:test";
import { findFile, flattenFiles } from "#/lib/session/tree.ts";
import type { DiffFileEntry } from "#/lib/worker/protocol.ts";

const TREE: DiffFileEntry = {
	path: "",
	type: "directory",
	status: "modified",
	children: [
		{
			path: "lib",
			type: "directory",
			status: "modified",
			children: [
				{ path: "lib/index.js", type: "file", status: "modified" },
				{
					path: "lib/router.js",
					oldPath: "lib/routes.js",
					type: "file",
					status: "renamed",
				},
			],
		},
		{ path: "package.json", type: "file", status: "modified" },
	],
};

describe("flattenFiles", () => {
	test("lists the leaves in tree order, without the directories", () => {
		expect(flattenFiles(TREE).map((entry) => entry.path)).toEqual([
			"lib/index.js",
			"lib/router.js",
			"package.json",
		]);
	});

	test("has nothing to list before a comparison has run", () => {
		expect(flattenFiles(null)).toEqual([]);
	});

	test("counts an empty directory as no files rather than crashing", () => {
		const empty: DiffFileEntry = {
			path: "",
			type: "directory",
			status: "unchanged",
		};

		expect(flattenFiles(empty)).toEqual([]);
	});
});

describe("findFile", () => {
	test("finds a file nested anywhere in the tree", () => {
		expect(findFile(TREE, "lib/index.js")?.status).toBe("modified");
	});

	test("carries the old path of a renamed file", () => {
		// The URL only ever holds the new path; the engine needs both to diff it
		// against its former self.
		expect(findFile(TREE, "lib/router.js")?.oldPath).toBe("lib/routes.js");
	});

	test("does not find a directory", () => {
		expect(findFile(TREE, "lib")).toBeUndefined();
	});

	test("does not find a path this comparison has never had", () => {
		expect(findFile(TREE, "lib/gone.js")).toBeUndefined();
	});
});
