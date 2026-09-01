import { describe, expect, test } from "bun:test";
import { parseIgnoreWhitespace, parseSplitView } from "#/lib/diff/prefs.ts";

describe("parseSplitView", () => {
	test("is unified for a first-time visitor", () => {
		expect(parseSplitView(null)).toBe(false);
	});

	test("is split only for a visitor who chose it", () => {
		// The stored sense is the old app's — only the literal "true" is split —
		// because the key is a contract with visitors who already have one.
		expect(parseSplitView("true")).toBe(true);
		expect(parseSplitView("false")).toBe(false);
		expect(parseSplitView("yes")).toBe(false);
	});
});

describe("parseIgnoreWhitespace", () => {
	test("is exact for a first-time visitor", () => {
		expect(parseIgnoreWhitespace(null)).toBe(false);
	});

	test("ignores whitespace only for a visitor who asked", () => {
		expect(parseIgnoreWhitespace("true")).toBe(true);
		expect(parseIgnoreWhitespace("false")).toBe(false);
		expect(parseIgnoreWhitespace("1")).toBe(false);
	});
});
