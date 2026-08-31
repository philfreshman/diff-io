import type { OpenFile } from "#/lib/session/diffSession.ts";
import type { FileDiff } from "#/lib/worker/protocol.ts";

/** A file the viewer can actually draw: one that has its diff. */
export interface ShownFile {
	path: string;
	diff: FileDiff;
}

/**
 * Which file the viewer keeps on screen, given the one the URL now names.
 *
 * A file being fetched has no diff yet, and swapping the one being read for a
 * spinner empties the pane and throws the reader's eye away from the place
 * they had got to — so the file they were reading stays, blurred, until the
 * next one is ready to take its place. Anything else (a file closed, a file
 * that failed, a new comparison) leaves nothing worth holding on to.
 */
export function shownFile(
	previous: ShownFile | null,
	open: OpenFile | null,
): ShownFile | null {
	if (open?.diff) return { path: open.path, diff: open.diff };

	return open?.status === "loading" ? previous : null;
}
