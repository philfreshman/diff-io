import { useMemo } from "react";
import { differenceRows } from "#/lib/diff/changes.ts";
import {
	computeVisibility,
	type DiffRow,
} from "#/lib/diff/computeVisibility.ts";
import { detectLanguage } from "#/lib/diff/highlight.ts";
import { pairSplitRows, type SplitRow } from "#/lib/diff/pairSplitRows.ts";
import {
	type DiffLine,
	parseUnifiedDiff,
} from "#/lib/diff/parseUnifiedDiff.ts";
import type { FileView } from "#/lib/diff/viewMemory.ts";
import type { FileDiff } from "#/lib/worker/protocol.ts";
import { useBenchFirstRows } from "./useBenchFirstRows.ts";

/** Everything the viewer draws, worked out before a single row exists. */
export interface DiffModel {
	/** Every line the file has, folds and all — what the gutter is sized from. */
	lines: DiffLine[];
	/** What the file was taken to be written in. */
	language: string | null;
	/** The rows on screen: folded, and paired into two columns when split. */
	rows: DiffRow[] | SplitRow[];
	/** The rows the toolbar's difference arrows stop at. */
	stops: number[];
}

/**
 * The file as a model, derived in one place so the viewer is left with only
 * putting rows on screen.
 *
 * Kept as a chain of separate memos rather than one: folding does not change
 * what language the file is in, and switching to split view does not refold
 * it, so each step is recomputed only when what it reads has actually moved.
 */
export function useDiffModel(
	path: string,
	file: FileDiff,
	view: FileView,
	split: boolean,
): DiffModel {
	const lines = useMemo(() => parseUnifiedDiff(file), [file]);
	// Decided once for the whole file: per line it would be both slower and
	// inconsistent, since a line like `}` tells a highlighter nothing.
	const language = useMemo(() => detectLanguage(path, lines), [path, lines]);
	const unified = useMemo(() => computeVisibility(lines, view), [lines, view]);
	// Split view is the same rows in two columns, so the folds survive it as
	// full-width rows rather than being paired against anything.
	const rows = useMemo(
		() => (split ? pairSplitRows(unified) : unified),
		[split, unified],
	);

	// The same rows again, as the places the toolbar's arrows stop: folding and
	// split pairing both move a change to a different row, so where a
	// difference *is* has to be recomputed alongside them.
	const stops = useMemo(() => differenceRows(rows), [rows]);

	// [BENCH] Instrumentation only — see philfreshman/diffpack#148.
	useBenchFirstRows(rows.length);

	return { lines, language, rows, stops };
}
