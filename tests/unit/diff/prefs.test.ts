import { describe, expect, test } from "bun:test";
import { parseSplitView } from "#/lib/diff/prefs.ts";

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
