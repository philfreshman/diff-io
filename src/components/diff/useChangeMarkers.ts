import { useMemo } from "react";
import type { DiffRow } from "#/lib/diff/computeVisibility.ts";
import type { SplitRow } from "#/lib/diff/pairSplitRows.ts";
import {
	changeMarkers,
	type Marker,
	type RowSpan,
} from "#/lib/diff/scrollbar.ts";

/**
 * Where the scrollbar paints the file's changes.
 *
 * `spans` is the virtualiser's measurements — every row has one, an estimate
 * until the row has been drawn once — rather than its rendered items, which
 * cover only the rows on screen: the part of the file that needs no minimap.
 *
 * It takes measured heights rather than counting rows because rows wrap. A
 * minified file is a handful of rows and a whole screen of scrolling, so
 * dividing the track by the row count would put a band nowhere near where the
 * thumb takes the reader.
 *
 * It lives with the scrollbar rather than in `useDiffModel` for want of a
 * virtualiser — the model is what decides how many rows there are, so it is
 * derived before one exists — and next to the thumb's own geometry, which is
 * what the bands have to agree with.
 */
export function useChangeMarkers(
	rows: readonly (DiffRow | SplitRow)[],
	spans: readonly RowSpan[],
): Marker[] {
	return useMemo(() => changeMarkers(rows, spans), [rows, spans]);
}
