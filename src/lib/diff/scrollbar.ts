import type { DiffRow } from "#/lib/diff/computeVisibility.ts";
import type { SplitRow } from "#/lib/diff/pairSplitRows.ts";

/** What the scrolling element measures, and all the geometry needs from it. */
export interface Viewport {
	scrollTop: number;
	scrollHeight: number;
	clientHeight: number;
}

/** Small enough not to crowd a short file, big enough to grab in a long one. */
const MIN_THUMB_HEIGHT = 24;

/** Where the thumb sits in the track, in pixels down from its top. */
export interface Thumb {
	top: number;
	height: number;
}

/**
 * The thumb, as a proportion of the file that is on screen, or `null` when the
 * file fits and there is nothing to scroll.
 *
 * The track is the height of the viewport, so both numbers are pixels in the
 * viewer's own coordinates and the component can use them without scaling.
 */
export function thumbMetrics(viewport: Viewport): Thumb | null {
	const { scrollTop, scrollHeight, clientHeight } = viewport;
	if (scrollHeight <= clientHeight) return null;

	const height = Math.max(
		MIN_THUMB_HEIGHT,
		(clientHeight / scrollHeight) * clientHeight,
	);
	// The thumb travels the track it is in, so its position is the scroll
	// expressed as a fraction of the way through the file, not in file pixels.
	const progress = scrollTop / (scrollHeight - clientHeight);

	return { top: progress * (clientHeight - height), height };
}

/**
 * Where a click at `offset` pixels down the track should leave the file.
 *
 * The thumb lands centred on the pointer, so the click reads as "put this part
 * of the file here" rather than as a page-worth of scrolling in that
 * direction.
 */
export function scrollForTrackClick(
	viewport: Viewport,
	offset: number,
): number {
	const thumb = thumbMetrics(viewport);
	if (!thumb) return viewport.scrollTop;

	return scrollForThumbTop(viewport, offset - thumb.height / 2, thumb.height);
}

/**
 * Where a drag of `deltaY` pixels, begun with the file at `startScrollTop`,
 * should leave it.
 *
 * It is measured from where the drag started rather than from the previous
 * frame, so rounding and clamping cannot accumulate into the thumb drifting
 * away from the pointer.
 */
export function scrollForDrag(
	viewport: Viewport,
	startScrollTop: number,
	deltaY: number,
): number {
	// Built out field by field rather than spread: the viewport is usually the
	// scrolling element itself, whose measurements are prototype getters and
	// would not survive a spread.
	const start = thumbMetrics({
		scrollTop: startScrollTop,
		scrollHeight: viewport.scrollHeight,
		clientHeight: viewport.clientHeight,
	});
	if (!start) return startScrollTop;

	return scrollForThumbTop(viewport, start.top + deltaY, start.height);
}

/** The inverse of `thumbMetrics`: a thumb position back into a scroll one. */
function scrollForThumbTop(
	viewport: Viewport,
	top: number,
	thumbHeight: number,
): number {
	const { scrollHeight, clientHeight } = viewport;
	const maxScrollTop = scrollHeight - clientHeight;
	const progress = top / (clientHeight - thumbHeight);

	// The track's ends are the file's ends: a position past either of them is
	// not somewhere the file can be scrolled to.
	return Math.min(Math.max(progress * maxScrollTop, 0), maxScrollTop);
}

/** A row of either view, as the minimap has to take both. */
type MarkableRow = DiffRow | SplitRow;

/** A change, as its share of the file: `0` is the top, `1` the bottom. */
export interface Marker {
	type: "added" | "removed" | "modified";
	start: number;
	end: number;
}

/** Where a row sits in the file, in the scroller's own pixels. */
export interface RowSpan {
	start: number;
	end: number;
}

/**
 * The file's changes as bands to paint down the track.
 *
 * Which rows changed comes from the row model rather than from the rendered
 * rows: the list is virtualised, so reading the DOM would only ever mark the
 * part of the file already on screen — which is the part that needs no
 * minimap.
 *
 * How far down the track each band lands comes from `spans`, the height the
 * rows actually measure. Rows wrap, so counting them instead would put a band
 * somewhere the thumb never goes: a minified file is a handful of rows and a
 * whole screen of scrolling.
 */
export function changeMarkers(
	rows: readonly MarkableRow[],
	spans: readonly RowSpan[],
): Marker[] {
	const height = spans[rows.length - 1]?.end ?? 0;
	if (!height) return [];

	const markers: Marker[] = [];
	let open: Marker | null = null;

	rows.forEach((row, index) => {
		const span = spans[index];
		const type = span && markerType(row);
		if (!span || !type) {
			open = null;
			return;
		}

		if (open && open.type === type) {
			open.end = span.end / height;
			return;
		}

		open = { type, start: span.start / height, end: span.end / height };
		markers.push(open);
	});

	return markers;
}

function markerType(row: MarkableRow): Marker["type"] | null {
	if (row.kind === "collapsed") return null;

	if (row.kind === "line") {
		return row.line.type === "unchanged" ? null : row.line.type;
	}

	// Side by side, a removal and the addition set opposite it are one change
	// seen twice, and a change with only one side is that side's alone.
	const left = row.left?.line.type === "removed";
	const right = row.right?.line.type === "added";
	if (left && right) return "modified";
	if (left) return "removed";

	return right ? "added" : null;
}
