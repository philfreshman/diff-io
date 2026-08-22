import { useCallback, useEffect, useState } from "react";
import type { Expander } from "#/lib/diff/computeVisibility.ts";
import { readSplitView } from "#/lib/diff/prefs.ts";
import {
	emptyMemory,
	type FileView,
	fileView,
	withExpandAll,
	withRevealed,
	withScrollTop,
} from "#/lib/diff/viewMemory.ts";

export interface DiffViewControls {
	view: FileView;
	split: boolean;
	setSplit(split: boolean): void;
	reveal(expander: Expander): void;
	setExpandAll(expandAll: boolean): void;
	rememberScroll(scrollTop: number): void;
}

/**
 * How much of each file is open, and which of the two layouts they are shown
 * in — held above the viewer, because the viewer is mounted per file and this
 * is exactly what has to outlive that.
 *
 * The memory is one comparison's: a new pair of versions is a new set of
 * files, and what had been opened in the old ones means nothing in them.
 */
export function useDiffView(
	comparisonKey: string | null,
	path: string,
): DiffViewControls {
	const [memory, setMemory] = useState(emptyMemory);
	// Dropping the memory as the comparison changes is an adjustment to a prop,
	// not a side effect of one: doing it in an effect would leave one render
	// showing the previous comparison's folds against this comparison's files.
	const [remembering, setRemembering] = useState(comparisonKey);
	if (remembering !== comparisonKey) {
		setRemembering(comparisonKey);
		setMemory(emptyMemory());
	}

	// A stored preference cannot be read during render — the server has no
	// `localStorage`, and reading it in the first client render is the same
	// mismatch. Unified is what SSR shows; the effect corrects it.
	const [split, setSplit] = useState(false);
	useEffect(() => setSplit(readSplitView()), []);

	return {
		view: fileView(memory, path),
		split,
		setSplit,
		reveal: useCallback(
			(expander: Expander) =>
				setMemory((it) => withRevealed(it, path, expander)),
			[path],
		),
		setExpandAll: useCallback(
			(expandAll: boolean) =>
				setMemory((it) => withExpandAll(it, path, expandAll)),
			[path],
		),
		rememberScroll: useCallback(
			(scrollTop: number) =>
				setMemory((it) => withScrollTop(it, path, scrollTop)),
			[path],
		),
	};
}
