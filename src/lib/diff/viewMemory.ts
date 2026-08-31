import type { DiffView, Expander } from "#/lib/diff/computeVisibility.ts";

/**
 * What the viewer remembers about one file: how much of it has been opened,
 * and where it was left scrolled to.
 */
export interface FileView extends DiffView {
	scrollTop: number;
}

/** Every file starts folded, at the top. */
const CLOSED: FileView = {
	expanded: new Set<number>(),
	expandAll: false,
	scrollTop: 0,
};

/**
 * One comparison's worth of that, by path. Clicking through a tree and back is
 * the normal way to read a diff, and a file that forgot what had been opened
 * in it would make every return a fresh start.
 */
export type ViewMemory = ReadonlyMap<string, FileView>;

export function emptyMemory(): ViewMemory {
	return new Map();
}

export function fileView(memory: ViewMemory, path: string): FileView {
	return memory.get(path) ?? CLOSED;
}

/**
 * The lines an expander offered, now open. The expander carries its own range
 * (task 11), so this is the whole of what a click does — no arithmetic, and no
 * way for the button's count and the screen's to disagree.
 */
export function withRevealed(
	memory: ViewMemory,
	path: string,
	expander: Expander,
): ViewMemory {
	const view = fileView(memory, path);
	const expanded = new Set(view.expanded);
	for (let index = expander.start; index <= expander.end; index++) {
		expanded.add(index);
	}

	return withView(memory, path, { ...view, expanded });
}

function withView(
	memory: ViewMemory,
	path: string,
	view: FileView,
): ViewMemory {
	return new Map(memory).set(path, view);
}

/**
 * The whole file open, or back to how it arrived. Folding takes back the folds
 * opened by hand as well: "fold all" is a statement about the file, not the
 * undo of one toggle.
 */
export function withExpandAll(
	memory: ViewMemory,
	path: string,
	expandAll: boolean,
): ViewMemory {
	const view = fileView(memory, path);

	return withView(memory, path, {
		...view,
		expandAll,
		expanded: expandAll ? view.expanded : CLOSED.expanded,
	});
}

/** Where the file was left, so coming back to it lands where it was left. */
export function withScrollTop(
	memory: ViewMemory,
	path: string,
	scrollTop: number,
): ViewMemory {
	return withView(memory, path, { ...fileView(memory, path), scrollTop });
}
