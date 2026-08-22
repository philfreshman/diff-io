import { describe, expect, test } from "bun:test";
import { computeVisibility } from "#/lib/diff/computeVisibility.ts";
import type { DiffLine } from "#/lib/diff/parseUnifiedDiff.ts";
import {
	emptyMemory,
	fileView,
	withExpandAll,
	withRevealed,
	withScrollTop,
} from "#/lib/diff/viewMemory.ts";

/** A change at the top, then a long run of untouched lines to fold. */
const LINES: DiffLine[] = Array.from({ length: 60 }, (_, i) =>
	i === 0
		? { type: "removed", content: "gone", oldNumber: 1, newNumber: null }
		: {
				type: "unchanged",
				content: `line ${i + 1}`,
				oldNumber: i + 1,
				newNumber: i + 1,
			},
);

describe("viewMemory", () => {
	test("a file nothing has been opened in is shown folded", () => {
		const rows = computeVisibility(LINES, fileView(emptyMemory(), "index.js"));

		expect(rows.at(-1)?.kind).toBe("collapsed");
	});
});

describe("opening a fold", () => {
	test("reveals exactly the range the expander offered", () => {
		// The expander states the lines it would show; opening it shows those and
		// nothing else, so the count on the button is the count on the screen.
		const memory = withRevealed(emptyMemory(), "index.js", {
			direction: "down",
			start: 4,
			end: 23,
		});
		const rows = computeVisibility(LINES, fileView(memory, "index.js"));
		const shown = rows
			.filter((row) => row.kind === "line")
			.map((row) => row.index);

		expect(shown).toEqual([...range(0, 3), ...range(4, 23)]);
	});

	test("keeps what an earlier click opened", () => {
		const once = withRevealed(emptyMemory(), "index.js", {
			direction: "down",
			start: 4,
			end: 23,
		});
		const twice = withRevealed(once, "index.js", {
			direction: "down",
			start: 24,
			end: 43,
		});
		const rows = computeVisibility(LINES, fileView(twice, "index.js"));

		expect(rows.filter((row) => row.kind === "line")).toHaveLength(44);
	});

	test("opens folds in one file without opening them in another", () => {
		const memory = withRevealed(emptyMemory(), "index.js", {
			direction: "all",
			start: 4,
			end: 59,
		});

		expect(fileView(memory, "other.js").expanded.size).toBe(0);
	});
});

function range(start: number, end: number): number[] {
	return Array.from({ length: end - start + 1 }, (_, i) => start + i);
}

describe("expanding and folding a whole file", () => {
	test("expanding shows every line", () => {
		const memory = withExpandAll(emptyMemory(), "index.js", true);
		const rows = computeVisibility(LINES, fileView(memory, "index.js"));

		expect(rows.filter((row) => row.kind === "collapsed")).toHaveLength(0);
	});

	test("folding takes back what was opened by hand too", () => {
		// Fold-all means the file as it first arrived, not the file minus one
		// toggle — otherwise a fold the user opened would survive folding it.
		const opened = withRevealed(emptyMemory(), "index.js", {
			direction: "all",
			start: 4,
			end: 59,
		});
		const memory = withExpandAll(opened, "index.js", false);

		expect(fileView(memory, "index.js").expanded.size).toBe(0);
	});

	test("keeps the file where it was left scrolled to", () => {
		const memory = withExpandAll(
			withScrollTop(emptyMemory(), "index.js", 240),
			"index.js",
			false,
		);

		expect(fileView(memory, "index.js").scrollTop).toBe(240);
	});
});

describe("scroll memory", () => {
	test("remembers where each file was left, and starts a new one at the top", () => {
		const memory = withScrollTop(
			withScrollTop(emptyMemory(), "index.js", 240),
			"lib/router.js",
			90,
		);

		expect(fileView(memory, "index.js").scrollTop).toBe(240);
		expect(fileView(memory, "lib/router.js").scrollTop).toBe(90);
		expect(fileView(memory, "package.json").scrollTop).toBe(0);
	});
});
