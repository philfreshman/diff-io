import type { DiffLine } from "#/lib/diff/parseUnifiedDiff.ts";

/** One row of the viewer: a line of the file, or a fold standing in for many. */
export type DiffRow =
	| { kind: "line"; index: number; line: DiffLine }
	| {
			kind: "collapsed";
			start: number;
			end: number;
			count: number;
			expanders: Expander[];
	  };

/**
 * A way to open part of a fold, and the lines it would reveal. The range lives
 * here so the button is a button — it does no arithmetic of its own.
 */
export interface Expander {
	direction: "up" | "down" | "all";
	start: number;
	end: number;
}

/** What the user has done to this file that changes how much of it shows. */
export interface DiffView {
	/** Line indices revealed by hand, which outrank folding. */
	expanded: ReadonlySet<number>;
	expandAll: boolean;
}

/** Untouched lines kept either side of a change so it can be read in place. */
const CONTEXT_LINES = 3;

/** How much of a fold one arrow takes. */
const EXPAND_STEP = 20;

/**
 * The file as rows to render: the changes, the context around them, and one
 * fold per run of everything else.
 */
export function computeVisibility(
	lines: DiffLine[],
	view: DiffView,
): DiffRow[] {
	const shown = visibleFlags(lines, view);
	const rows: DiffRow[] = [];
	let foldStart: number | null = null;

	const closeFold = (end: number) => {
		if (foldStart === null) return;
		rows.push({
			kind: "collapsed",
			start: foldStart,
			end,
			count: end - foldStart + 1,
			expanders: expandersFor(foldStart, end, lines.length),
		});
		foldStart = null;
	};

	for (const [index, line] of lines.entries()) {
		if (!shown[index]) {
			foldStart ??= index;
			continue;
		}

		closeFold(index - 1);
		rows.push({ kind: "line", index, line });
	}
	closeFold(lines.length - 1);

	return rows;
}

function visibleFlags(lines: DiffLine[], view: DiffView): boolean[] {
	// A file nothing happened to is being read rather than reviewed, and folding
	// it would leave the viewer showing one fold and nothing else.
	const unchangedFile = lines.every((line) => line.type === "unchanged");
	if (view.expandAll || unchangedFile) {
		return new Array<boolean>(lines.length).fill(true);
	}

	const shown = new Array<boolean>(lines.length).fill(false);

	for (const [index, line] of lines.entries()) {
		// Opening a fold is a request for a counted number of lines, so a line
		// revealed by hand brings no context of its own — otherwise every click
		// would reveal more than the count it offered.
		if (view.expanded.has(index)) shown[index] = true;
		if (line.type === "unchanged") continue;

		shown[index] = true;
		for (let step = 1; step <= CONTEXT_LINES; step++) {
			if (index - step >= 0) shown[index - step] = true;
			if (index + step < lines.length) shown[index + step] = true;
		}
	}

	return shown;
}

/**
 * A fold in the body of the file can be walked inward from either end. One
 * against the top or bottom cannot — there is no file beyond it to walk
 * toward, and a partial reveal would leave a sliver pinned to the edge — so it
 * offers only to open whole.
 */
function expandersFor(start: number, end: number, total: number): Expander[] {
	const whole: Expander = { direction: "all", start, end };
	if (start === 0 || end === total - 1) return [whole];

	return [
		{ direction: "down", start, end: Math.min(start + EXPAND_STEP - 1, end) },
		{ direction: "up", start: Math.max(start, end - EXPAND_STEP + 1), end },
		whole,
	];
}
