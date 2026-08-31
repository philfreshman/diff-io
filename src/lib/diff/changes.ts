import type { DiffRow } from "#/lib/diff/computeVisibility.ts";
import type { SplitRow } from "#/lib/diff/pairSplitRows.ts";
import type { DiffLine } from "#/lib/diff/parseUnifiedDiff.ts";

/**
 * What the toolbar counts and what its arrows step through: a *difference* is
 * one run of touched lines, not one touched line.
 *
 * A removal and the addition that replaced it are read as a single edit — they
 * are one row apart in the unified view and opposite each other in the split
 * one — so a run ends only where the file goes back to being unchanged.
 */
export function countDifferences(lines: readonly DiffLine[]): number {
	let count = 0;
	let inRun = false;

	for (const line of lines) {
		const changed = line.type !== "unchanged";
		if (changed && !inRun) count++;
		inRun = changed;
	}

	return count;
}

/** A row of either layout: both are navigated the same way. */
type NavigableRow = DiffRow | SplitRow;

/**
 * The first row of each difference, in the rows actually on screen.
 *
 * It is taken from the rows rather than from the lines because that is what
 * the arrows scroll to: folds and split pairing both change which row a given
 * line ended up in, and a stale index would scroll to the wrong place.
 */
export function differenceRows(rows: readonly NavigableRow[]): number[] {
	const starts: number[] = [];
	let inRun = false;

	rows.forEach((row, index) => {
		const changed = isChanged(row);
		if (changed && !inRun) starts.push(index);
		inRun = changed;
	});

	return starts;
}

/**
 * The next difference after `index`, stepping `direction`, or `undefined` at
 * the end of the file — the arrows stop there rather than wrapping, so paging
 * through a file has an end the reader can feel.
 */
export function stepDifference(
	starts: readonly number[],
	index: number,
	direction: 1 | -1,
): number | undefined {
	if (direction === 1) return starts.find((start) => start > index);

	for (let i = starts.length - 1; i >= 0; i--) {
		const start = starts[i];
		if (start !== undefined && start < index) return start;
	}

	return undefined;
}

function isChanged(row: NavigableRow): boolean {
	if (row.kind === "collapsed") return false;
	if (row.kind === "line") return row.line.type !== "unchanged";

	// Side by side, a pair is a change when either side is one; an unchanged
	// line is set opposite itself, so neither side is.
	const left = row.left?.line.type;
	const right = row.right?.line.type;

	return (
		(left ?? "unchanged") !== "unchanged" ||
		(right ?? "unchanged") !== "unchanged"
	);
}
