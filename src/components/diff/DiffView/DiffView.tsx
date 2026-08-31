import { useVirtualizer } from "@tanstack/react-virtual";
import type { CSSProperties, Ref } from "react";
import { useEffect, useImperativeHandle, useMemo, useRef } from "react";
import { CollapsedRow } from "#/components/diff/CollapsedRow/CollapsedRow.tsx";
import { DiffRow } from "#/components/diff/DiffRow/DiffRow.tsx";
import { DiffScrollbar } from "#/components/diff/DiffScrollbar/DiffScrollbar.tsx";
import { SplitDiffRow } from "#/components/diff/SplitDiffRow/SplitDiffRow.tsx";
import {
	differenceRows,
	stepDifference as nextDifference,
} from "#/lib/diff/changes.ts";
import {
	computeVisibility,
	type Expander,
} from "#/lib/diff/computeVisibility.ts";
import { gutterChars } from "#/lib/diff/gutter.ts";
import { detectLanguage } from "#/lib/diff/highlight.ts";
import { pairSplitRows } from "#/lib/diff/pairSplitRows.ts";
import { parseUnifiedDiff } from "#/lib/diff/parseUnifiedDiff.ts";
import { changeMarkers } from "#/lib/diff/scrollbar.ts";
import type { FileView } from "#/lib/diff/viewMemory.ts";
import type { FileDiff } from "#/lib/worker/protocol.ts";
import styles from "./DiffView.module.css";

/** What the toolbar can ask of the viewer once it is on screen. */
export interface DiffViewHandle {
	/** Scroll to the next difference down (`1`) or up (`-1`). */
	stepDifference(direction: 1 | -1): void;
}

export interface DiffViewProps {
	path: string;
	file: FileDiff;
	view: FileView;
	/** The old file beside the new one, rather than one after the other. */
	split: boolean;
	/** A fold opened: the expander carries the lines it offered. */
	onReveal(expander: Expander): void;
	/** Where the file was left, on the way out. */
	onScrolled(scrollTop: number): void;
	/** Escape: back to the comparison, with no file open. */
	onClose(): void;
	/**
	 * Another file has been asked for and this one is what is still on screen
	 * until it arrives.
	 */
	pending?: boolean;
	/** How the toolbar's difference arrows reach the scroller. */
	ref?: Ref<DiffViewHandle>;
}

/**
 * `--diff-line-height` in pixels: what an unwrapped row measures, and the
 * guess the virtualiser starts every row from.
 */
const ROW_HEIGHT = 24;

/**
 * The file, rendered.
 *
 * Everything it draws comes from the pure model — the lines, the folds and the
 * gutter width are all computed before a row exists — so this component is
 * only ever about putting rows on screen and keeping the scroll where the
 * reader left it.
 */
export function DiffView({
	path,
	file,
	view,
	split,
	onReveal,
	onScrolled,
	onClose,
	pending,
	ref,
}: DiffViewProps) {
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

	// From the rows rather than from the DOM: the list is virtualised, so
	// markers measured off rendered rows would only ever cover the part of the
	// file already on screen.
	const markers = useMemo(() => changeMarkers(rows), [rows]);

	// The same rows again, as the places the toolbar's arrows stop: folding and
	// split pairing both move a change to a different row, so where a
	// difference *is* has to be recomputed alongside them.
	const stops = useMemo(() => differenceRows(rows), [rows]);

	const scroller = useRef<HTMLDivElement>(null);
	const virtualizer = useVirtualizer({
		count: rows.length,
		getScrollElement: () => scroller.current,
		// Rows wrap, so the estimate is only a starting point; each rendered row
		// measures itself and the total height corrects.
		estimateSize: () => ROW_HEIGHT,
		overscan: 16,
		// Where the file was left. The virtualiser scrolls there itself on mount
		// — it is also what decides which rows to draw first, so restoring the
		// position by hand afterwards would draw the top of the file and then
		// jump.
		initialOffset: view.scrollTop,
	});

	// Stepping through the differences is the toolbar's button and the viewer's
	// scroller at once, so it is exposed rather than lifted: the offsets it
	// steps by are the virtualiser's, and they exist nowhere else.
	useImperativeHandle(
		ref,
		() => ({
			stepDifference(direction) {
				const element = scroller.current;
				if (!element) return;

				// Where the reader is, as a row: the row at the top of the
				// viewport, so "next" is the next difference they have not
				// reached rather than the one already under their eyes.
				const here =
					virtualizer.getVirtualItemForOffset(element.scrollTop)?.index ?? 0;
				const next = nextDifference(stops, here, direction);
				if (next === undefined) return;

				virtualizer.scrollToIndex(next, { align: "start" });
			},
		}),
		[virtualizer, stops],
	);

	// The scroll position is the file's, not the viewer's: the virtualiser
	// starts at it above, and it is handed back on the way out. Keeping it out
	// of render is what stops a scroll costing a re-render of the whole list —
	// the component is mounted per path, so this runs once per file.
	const remember = useRef(onScrolled);
	remember.current = onScrolled;
	// Followed in a ref rather than read off the element on the way out: by the
	// time an unmount cleanup runs, the scroller is off the document and a
	// detached element reports a scroll position of zero.
	const at = useRef(view.scrollTop);
	useEffect(() => () => remember.current(at.current), []);

	// Escape closes the file. It is read from the document rather than from the
	// viewer because the viewer is not what has focus while a file is being
	// read — but a field's Escape is the field's own (it closes a combobox's
	// list), so one typed into is left alone.
	const close = useRef(onClose);
	close.current = onClose;
	useEffect(() => {
		function onKeyDown(event: KeyboardEvent) {
			if (event.key !== "Escape" || isField(event.target)) return;
			event.preventDefault();
			close.current();
		}

		document.addEventListener("keydown", onKeyDown);

		return () => document.removeEventListener("keydown", onKeyDown);
	}, []);

	return (
		<div
			className={styles.viewer}
			data-testid="diff-view"
			data-path={path}
			// Set rather than styled inline: what it looks like to be waiting is
			// the stylesheet's business, and the state is readable from the DOM.
			data-pending={pending ? "" : undefined}
			// How much of the file is showing: rows, folds included.
			data-rows={rows.length}
			// What the file was taken to be written in — the one decision the
			// colouring of every row follows from.
			data-language={language ?? ""}
			style={
				{
					"--gutter-width": `calc(${gutterChars(lines)}ch + var(--space-4))`,
				} as CSSProperties
			}
		>
			{/* `hljs` is what the theme's stylesheet colours: it carries the
			    theme's background and base text colour, and the added and removed
			    surfaces paint over it. */}
			<div
				className={`${styles.scroller} hljs`}
				ref={scroller}
				data-testid="diff-scroller"
				onScroll={(event) => {
					at.current = event.currentTarget.scrollTop;
				}}
			>
				<table
					className={styles.sizer}
					aria-label={path}
					style={{ height: virtualizer.getTotalSize() }}
				>
					<tbody>
						{virtualizer.getVirtualItems().map((item) => {
							const row = rows[item.index];
							if (!row) return null;
							const placement = {
								index: item.index,
								ref: virtualizer.measureElement,
								style: { transform: `translateY(${item.start}px)` },
							};

							if (row.kind === "pair") {
								return (
									<SplitDiffRow
										key={item.key}
										language={language}
										left={row.left}
										right={row.right}
										{...placement}
									/>
								);
							}

							return row.kind === "line" ? (
								<DiffRow
									key={item.key}
									language={language}
									line={row.line}
									{...placement}
								/>
							) : (
								<CollapsedRow
									fold={row}
									key={item.key}
									onReveal={onReveal}
									{...placement}
								/>
							);
						})}
					</tbody>
				</table>
			</div>
			<DiffScrollbar markers={markers} scroller={scroller} />
		</div>
	);
}

function isField(target: EventTarget | null): boolean {
	if (!(target instanceof HTMLElement)) return false;

	return (
		target.isContentEditable ||
		["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName)
	);
}
