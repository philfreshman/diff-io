import type { DiffRow } from "#/lib/diff/computeVisibility.ts";
import type { DiffLine } from "#/lib/diff/parseUnifiedDiff.ts";

/** One half of a split row, or nothing when that side has run out of lines. */
export type SplitSide = { index: number; line: DiffLine } | null;

/** One row of the split view: the old file on the left, the new on the right. */
export type SplitRow =
	| { kind: "pair"; left: SplitSide; right: SplitSide }
	| Extract<DiffRow, { kind: "collapsed" }>;

/**
 * The same rows, laid out in two columns.
 *
 * A run of removals and the additions that replaced it is one change, so the
 * two are set opposite each other rather than stacked — which is the whole
 * reason to look at a diff this way.
 */
export function pairSplitRows(rows: DiffRow[]): SplitRow[] {
	const split: SplitRow[] = [];
	let run: { left: SplitSide[]; right: SplitSide[] } | null = null;

	const closeRun = () => {
		if (!run) return;
		const { left, right } = run;
		run = null;
		for (let r = 0; r < Math.max(left.length, right.length); r++) {
			split.push({
				kind: "pair",
				left: left[r] ?? null,
				right: right[r] ?? null,
			});
		}
	};

	for (const row of rows) {
		if (row.kind === "collapsed") {
			closeRun();
			split.push(row);
			continue;
		}

		const side = { index: row.index, line: row.line };
		if (row.line.type === "unchanged") {
			closeRun();
			split.push({ kind: "pair", left: side, right: side });
			continue;
		}

		// The engine emits removals and additions interleaved rather than
		// grouped, so a run is collected by side as it arrives.
		run ??= { left: [], right: [] };
		(row.line.type === "removed" ? run.left : run.right).push(side);
	}
	closeRun();

	return split;
}
