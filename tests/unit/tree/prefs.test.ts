import { describe, expect, test } from "bun:test";
import {
	DEFAULT_TREE_WIDTH,
	MAX_TREE_WIDTH,
	MIN_TREE_WIDTH,
	parseOnlyModified,
	parseTreeWidth,
} from "#/lib/tree/prefs.ts";

describe("parseTreeWidth", () => {
	test("takes a stored width as it was left", () => {
		expect(parseTreeWidth("420")).toBe(420);
	});

	test("falls back to the default when nothing is stored", () => {
		expect(parseTreeWidth(null)).toBe(DEFAULT_TREE_WIDTH);
		expect(parseTreeWidth("wide please")).toBe(DEFAULT_TREE_WIDTH);
	});

	test("clamps a width that would leave the panel unusable", () => {
		// A stored value can come from an older build, a smaller screen, or a
		// hand-edited key; the panel has to stay readable and leave room for the
		// diff either way.
		expect(parseTreeWidth("40")).toBe(MIN_TREE_WIDTH);
		expect(parseTreeWidth("2000")).toBe(MAX_TREE_WIDTH);
	});
});

describe("parseOnlyModified", () => {
	test("is on for a visitor who has never turned it off", () => {
		// A comparison is about what changed; the unchanged files are context.
		expect(parseOnlyModified(null)).toBe(true);
	});

	test('only the literal "false" turns it off', () => {
		// The stored sense is inverted, and the old app's key is a contract with
		// visitors who already have one.
		expect(parseOnlyModified("false")).toBe(false);
		expect(parseOnlyModified("true")).toBe(true);
		expect(parseOnlyModified("nonsense")).toBe(true);
	});
});
