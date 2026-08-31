import { describe, expect, test } from "bun:test";
import { gutterChars } from "#/lib/diff/gutter.ts";
import type { DiffLine } from "#/lib/diff/parseUnifiedDiff.ts";

function file(length: number): DiffLine[] {
	return Array.from({ length }, (_, i) => ({
		type: "unchanged" as const,
		content: "",
		oldNumber: i + 1,
		newNumber: i + 1,
	}));
}

describe("gutterChars", () => {
	test("is wide enough for the highest line number in the file", () => {
		// The width is the file's, not the visible rows' — a virtualised list
		// renders a new set of rows on every scroll, and a width derived from
		// them would shift the content sideways as the numbers grew.
		expect(gutterChars(file(1200))).toBe(4);
	});

	test("never narrows below three digits", () => {
		expect(gutterChars(file(9))).toBe(3);
	});

	test("counts a line that only exists in one of the two files", () => {
		const lines: DiffLine[] = [
			{ type: "removed", content: "", oldNumber: 1000, newNumber: null },
			{ type: "added", content: "", oldNumber: null, newNumber: 7 },
		];

		expect(gutterChars(lines)).toBe(4);
	});
});
