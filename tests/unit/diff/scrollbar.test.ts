import { describe, expect, test } from "bun:test";
import type { DiffRow } from "#/lib/diff/computeVisibility.ts";
import type { SplitRow } from "#/lib/diff/pairSplitRows.ts";
import type { DiffLine } from "#/lib/diff/parseUnifiedDiff.ts";
import {
	changeMarkers,
	type RowSpan,
	scrollForDrag,
	scrollForTrackClick,
	thumbMetrics,
} from "#/lib/diff/scrollbar.ts";

function line(type: DiffLine["type"]): DiffLine {
	return { type, content: "", oldNumber: null, newNumber: null };
}

function unified(types: DiffLine["type"][]): DiffRow[] {
	return types.map((type, index) => ({
		kind: "line",
		index,
		line: line(type),
	}));
}

/** What a file measures with nothing wrapped: every row one line tall. */
function evenSpans(count: number): RowSpan[] {
	return Array.from({ length: count }, (_, index) => ({
		start: index,
		end: index + 1,
	}));
}

describe("thumbMetrics", () => {
	test("sizes the thumb by how much of the file is showing", () => {
		// A quarter of the file on screen is a quarter-height thumb, sitting at
		// the top because that is where the scroll is.
		expect(
			thumbMetrics({ scrollTop: 0, scrollHeight: 4000, clientHeight: 1000 }),
		).toEqual({ top: 0, height: 250 });
	});

	test("rests the thumb against the bottom of the track at the end of the file", () => {
		// The thumb travels the track, not the file: scrolled to the end it is
		// flush with the bottom rather than 3000px down a 1000px track.
		expect(
			thumbMetrics({ scrollTop: 3000, scrollHeight: 4000, clientHeight: 1000 }),
		).toEqual({ top: 750, height: 250 });
	});

	test("keeps the thumb grabbable in a very long file", () => {
		// Proportionally this thumb would be 2px tall — too small to aim at, so
		// it stops shrinking and still ends the track flush with the bottom.
		const long = { scrollHeight: 100_000, clientHeight: 500 };

		expect(thumbMetrics({ ...long, scrollTop: 0 })?.height).toBe(24);
		expect(thumbMetrics({ ...long, scrollTop: 99_500 })).toEqual({
			top: 476,
			height: 24,
		});
	});

	test("has no thumb for a file that fits", () => {
		// Nothing to scroll, nothing to show: the scrollbar is absent rather
		// than a full-height thumb that cannot move.
		expect(
			thumbMetrics({ scrollTop: 0, scrollHeight: 400, clientHeight: 1000 }),
		).toBeNull();
	});
});

describe("scrollForTrackClick", () => {
	const viewport = { scrollTop: 0, scrollHeight: 4000, clientHeight: 1000 };

	test("jumps to the clicked part of the file, thumb centred on the pointer", () => {
		// Half way down a 1000px track, with a 250px thumb: the thumb's top
		// lands at 375, which is half its 750px of travel — half the file.
		expect(scrollForTrackClick(viewport, 500)).toBe(1500);
	});

	test("stays inside the file at either end of the track", () => {
		// Centring the thumb on a click at the very top would put it above the
		// track; the file has no such position, so the click means "the top".
		expect(scrollForTrackClick(viewport, 0)).toBe(0);
		expect(scrollForTrackClick(viewport, 1000)).toBe(3000);
	});
});

describe("scrollForDrag", () => {
	const viewport = { scrollTop: 0, scrollHeight: 4000, clientHeight: 1000 };

	test("moves the file by as far as the thumb was dragged", () => {
		// Half the thumb's 750px of travel is half the file, and the drag is
		// measured from where it started rather than from the last frame, so a
		// dropped mousemove cannot make the thumb drift from the pointer.
		expect(scrollForDrag(viewport, 0, 375)).toBe(1500);
	});

	test("takes its measurements off the live element it is handed", () => {
		// The viewport passed in is the scrolling element, which keeps its
		// measurements on the prototype — reading them by copying the object
		// would come back with nothing.
		const element = Object.create({
			scrollTop: 0,
			scrollHeight: 4000,
			clientHeight: 1000,
		}) as typeof viewport;

		expect(scrollForDrag(element, 0, 375)).toBe(1500);
	});

	test("does not run past the end of the file when the pointer does", () => {
		expect(scrollForDrag(viewport, 3000, 400)).toBe(3000);
		expect(scrollForDrag(viewport, 0, -400)).toBe(0);
	});
});

describe("changeMarkers", () => {
	test("marks a run of changed rows as one band down the file", () => {
		// Four rows of one line each, the middle two added: one marker over
		// the middle half of the file. Which rows changed is the row model's
		// to say — the list is virtualised, so most rows have never been
		// rendered and the DOM could not answer.
		const rows = unified(["unchanged", "added", "added", "unchanged"]);

		expect(changeMarkers(rows, evenSpans(4))).toEqual([
			{ type: "added", start: 0.25, end: 0.75 },
		]);
	});
	test("marks a replaced line in split view as one change, not two", () => {
		// Side by side, a removal and the addition opposite it are the same
		// change seen twice — two bands would double-count it.
		const rows: SplitRow[] = [
			{
				kind: "pair",
				left: { index: 0, line: line("removed") },
				right: { index: 1, line: line("added") },
			},
			{
				kind: "pair",
				left: { index: 2, line: line("unchanged") },
				right: { index: 2, line: line("unchanged") },
			},
		];

		expect(changeMarkers(rows, evenSpans(2))).toEqual([
			{ type: "modified", start: 0, end: 0.5 },
		]);
	});

	test("does not join two changes across the fold between them", () => {
		// A fold stands for the unchanged run between two changes, so the two
		// are separate bands with a gap — the same as they look in the file.
		const rows: DiffRow[] = [
			{ kind: "line", index: 0, line: line("added") },
			{ kind: "collapsed", start: 1, end: 8, count: 8, expanders: [] },
			{ kind: "line", index: 9, line: line("added") },
		];

		expect(changeMarkers(rows, evenSpans(3))).toEqual([
			{ type: "added", start: 0, end: 1 / 3 },
			{ type: "added", start: 2 / 3, end: 1 },
		]);
	});

	test("sizes a band by how tall its rows are, not how many there are", () => {
		// A minified file: one enormous wrapped line, then a one-line change.
		// By count the change is half the file; down the track it is the last
		// quarter, which is where the thumb puts it.
		const rows = unified(["unchanged", "added"]);
		const spans = [
			{ start: 0, end: 750 },
			{ start: 750, end: 1000 },
		];

		expect(changeMarkers(rows, spans)).toEqual([
			{ type: "added", start: 0.75, end: 1 },
		]);
	});

	test("has no bands while the file measures nothing", () => {
		// A viewer that is not on screen measures zero, and a share of a file
		// of no height is a division by zero — which the browser draws as a
		// band pinned to the top of the track rather than as nothing.
		expect(changeMarkers(unified(["added"]), [{ start: 0, end: 0 }])).toEqual(
			[],
		);
	});
});
