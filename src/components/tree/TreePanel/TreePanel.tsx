import type { ReactNode } from "react";
import { useEffect, useMemo, useRef, useState } from "react";
import { FileTree } from "#/components/tree/FileTree/FileTree.tsx";
import { TreeFilter } from "#/components/tree/TreeFilter/TreeFilter.tsx";
import {
	applyTreeWidth,
	clampTreeWidth,
	DEFAULT_TREE_WIDTH,
	MAX_TREE_WIDTH,
	MIN_TREE_WIDTH,
	readOnlyModified,
	readTreeWidth,
	writeOnlyModified,
	writeTreeWidth,
} from "#/lib/tree/prefs.ts";
import { visibleRows } from "#/lib/tree/visibility.ts";
import type { DiffFileEntry } from "#/lib/worker/protocol.ts";
import styles from "./TreePanel.module.css";

const EMPTY: ReadonlySet<string> = new Set();

export interface TreePanelProps {
	tree: DiffFileEntry | null;
	selectedPath: string;
	onOpenFile(path: string): void;
	/**
	 * What the tree amounts to, stated at its foot — the count belongs to the
	 * list it counts, so it sits under it rather than over the whole body.
	 */
	footer?: ReactNode;
}

/**
 * The left panel: how the comparison is navigated. It owns what the tree shows
 * — the filter, only-modified, and which folders the user has opened or closed
 * by hand — and hands `visibleRows` the whole of that state at once.
 */
export function TreePanel({
	tree,
	selectedPath,
	onOpenFile,
	footer,
}: TreePanelProps) {
	const [filter, setFilter] = useState("");
	// A stored preference cannot be read during render — the server has no
	// `localStorage`, and reading it in the first client render is the same
	// mismatch. The default is what SSR shows; the effect corrects it.
	const [onlyModified, setOnlyModified] = useState(true);
	useEffect(() => setOnlyModified(readOnlyModified()), []);

	const [expandedKeys, setExpandedKeys] = useState<ReadonlySet<string>>(
		() => new Set(),
	);
	const [collapsedKeys, setCollapsedKeys] = useState<ReadonlySet<string>>(
		() => new Set(),
	);

	const rows = useMemo(
		() =>
			visibleRows(tree, { filter, onlyModified, expandedKeys, collapsedKeys }),
		[tree, filter, onlyModified, expandedKeys, collapsedKeys],
	);

	/** Opening or closing a folder is a choice, and it outranks auto-expansion. */
	function toggleFolder(path: string, expanded: boolean) {
		setExpandedKeys((keys) => withKey(keys, path, expanded));
		setCollapsedKeys((keys) => withKey(keys, path, !expanded));
	}

	/**
	 * Narrowing the tree clears the folders closed by hand: they were closed
	 * against a fuller tree, and holding them shut would hide the very rows the
	 * user just asked to see.
	 */
	function narrow(change: () => void) {
		setCollapsedKeys(EMPTY);
		change();
	}

	// The width is a custom property on `<html>`, written before paint and
	// rewritten by the drag; keeping it out of React state is what stops the
	// panel flashing at its default width on every load. The state copy below
	// exists only so the handle can announce where it is.
	const panelRef = useRef<HTMLDivElement>(null);
	const [width, setWidth] = useState(DEFAULT_TREE_WIDTH);
	useEffect(() => setWidth(readTreeWidth()), []);

	function resizeTo(next: number) {
		const clamped = clampTreeWidth(next);
		applyTreeWidth(document, clamped);
		setWidth(clamped);

		return clamped;
	}

	function startResize(event: React.PointerEvent<HTMLDivElement>) {
		event.preventDefault();
		const startX = event.clientX;
		const startWidth = panelRef.current?.getBoundingClientRect().width ?? width;
		let last = startWidth;

		function onMove(move: PointerEvent) {
			last = resizeTo(startWidth + move.clientX - startX);
		}

		function onUp() {
			window.removeEventListener("pointermove", onMove);
			window.removeEventListener("pointerup", onUp);
			writeTreeWidth(last);
		}

		window.addEventListener("pointermove", onMove);
		window.addEventListener("pointerup", onUp);
	}

	/** The same resize, for anyone who is not holding a mouse. */
	function nudge(event: React.KeyboardEvent<HTMLDivElement>) {
		const step =
			event.key === "ArrowRight" ? 16 : event.key === "ArrowLeft" ? -16 : 0;
		if (!step) return;
		event.preventDefault();
		writeTreeWidth(resizeTo(width + step));
	}

	return (
		<div className={styles.panel} ref={panelRef} data-testid="tree-panel">
			<TreeFilter
				filter={filter}
				onFilterChange={(next) => narrow(() => setFilter(next))}
				onlyModified={onlyModified}
				onOnlyModifiedChange={(next) =>
					narrow(() => {
						setOnlyModified(next);
						writeOnlyModified(next);
					})
				}
			/>
			<FileTree
				rows={rows}
				selectedPath={selectedPath}
				onOpenFile={onOpenFile}
				onToggleFolder={toggleFolder}
			/>
			{footer && <div className={styles.foot}>{footer}</div>}
			{/* biome-ignore lint/a11y/useSemanticElements: an <hr> cannot be dragged */}
			<div
				className={styles.resizer}
				role="separator"
				aria-label="Resize file tree"
				aria-orientation="vertical"
				aria-valuenow={width}
				aria-valuemin={MIN_TREE_WIDTH}
				aria-valuemax={MAX_TREE_WIDTH}
				tabIndex={0}
				onPointerDown={startResize}
				onKeyDown={nudge}
			/>
		</div>
	);
}

function withKey(
	keys: ReadonlySet<string>,
	path: string,
	present: boolean,
): ReadonlySet<string> {
	const next = new Set(keys);
	if (present) next.add(path);
	else next.delete(path);

	return next;
}
