import { describe, expect, test } from "bun:test";
import { parseUnifiedDiff } from "#/lib/diff/parseUnifiedDiff.ts";

describe("parseUnifiedDiff", () => {
	test("numbers each line against the sides it exists on", () => {
		// A removal has no line in the new file and an addition none in the old,
		// so the two counters advance independently — this is what puts the
		// gutter numbers of a real diff out of step with each other.
		const lines = parseUnifiedDiff({
			isDiff: true,
			data: ["  one", "- two", "+ dos", "  three"].join("\n"),
		});

		expect(
			lines.map((line) => [line.type, line.oldNumber, line.newNumber]),
		).toEqual([
			["unchanged", 1, 1],
			["removed", 2, null],
			["added", null, 2],
			["unchanged", 3, 3],
		]);
	});

	test("the file's own header is not a line of it", () => {
		// The engine prefixes every diff with `--- from/x` / `+++ to/x`. Left in,
		// they would render as two lines and push every gutter number down by two.
		const lines = parseUnifiedDiff({
			isDiff: true,
			data: ["--- from/index.js", "+++ to/index.js", "  one"].join("\n"),
		});

		expect(lines).toEqual([
			{ type: "unchanged", content: "one", oldNumber: 1, newNumber: 1 },
		]);
	});

	test("a file that did not change is all of it, unmarked", () => {
		// The engine returns unchanged files as their own content — no markers, no
		// header — so slicing a prefix off would eat the first two characters of
		// every line, and `--- from/x` in a text file is text, not a header.
		const lines = parseUnifiedDiff({
			isDiff: false,
			data: ["const x = 1;", "--- from/README"].join("\n"),
		});

		expect(lines).toEqual([
			{
				type: "unchanged",
				content: "const x = 1;",
				oldNumber: 1,
				newNumber: 1,
			},
			{
				type: "unchanged",
				content: "--- from/README",
				oldNumber: 2,
				newNumber: 2,
			},
		]);
	});

	test("tells the marker apart from text that looks like one", () => {
		// Markdown list items and CLI flags start with the same characters the
		// engine marks with. Only the first two count, and an unchanged line is
		// marked with two spaces, so its own leading dash survives the strip.
		const lines = parseUnifiedDiff({
			isDiff: true,
			data: ["  - kept item", "- - dropped item", "+   indented"].join("\n"),
		});

		expect(lines.map((line) => [line.type, line.content])).toEqual([
			["unchanged", "- kept item"],
			["removed", "- dropped item"],
			["added", "  indented"],
		]);
	});
});
