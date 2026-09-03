import { useVirtualizer } from "@tanstack/react-virtual";
import type { CSSProperties, Ref } from "react";
import { useImperativeHandle, useMemo, useRef } from "react";
import { CollapsedRow } from "#/components/diff/CollapsedRow/CollapsedRow.tsx";
import { DiffRow } from "#/components/diff/DiffRow/DiffRow.tsx";
import { DiffScrollbar } from "#/components/diff/DiffScrollbar/DiffScrollbar.tsx";
import { SplitDiffRow } from "#/components/diff/SplitDiffRow/SplitDiffRow.tsx";
import { stepDifference as nextDifference } from "#/lib/diff/changes.ts";
import type { Expander } from "#/lib/diff/computeVisibility.ts";
import { gutterChars } from "#/lib/diff/gutter.ts";
import { changeMarkers } from "#/lib/diff/scrollbar.ts";
import type { FileView } from "#/lib/diff/viewMemory.ts";
import type { FileDiff } from "#/lib/worker/protocol.ts";
import styles from "./DiffView.module.css";
import { useCloseOnEscape } from "./useCloseOnEscape.ts";
import { useDiffModel } from "./useDiffModel.ts";
import { useScrollMemory } from "./useScrollMemory.ts";

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
 * gutter width are all computed before a row exists, in `useDiffModel` — so
 * this component is only ever about putting rows on screen and keeping the
 * scroll where the reader left it.
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
	const { lines, language, rows, stops } = useDiffModel(
		path,
		file,
		view,
		split,
	);

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

	// How tall the file is, and — as a side effect of asking — the virtualiser's
	// measurements brought up to date. The minimap is drawn from those rather
	// than from the row count: rows wrap, so in a minified file three rows are
	// a whole screen of scrolling and thirds of the track would be nowhere near
	// where the thumb takes the reader.
	const height = virtualizer.getTotalSize();
	// `measurementsCache` rather than the rendered items, which are only the
	// rows on screen — the part of the file that needs no minimap. Every index
	// has a span in it, an estimate until the row has been drawn once.
	const markers = useMemo(
		() => changeMarkers(rows, virtualizer.measurementsCache),
		[rows, virtualizer.measurementsCache],
	);

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
	// starts at it above, and it is handed back on the way out.
	const at = useScrollMemory(view.scrollTop, onScrolled);
	useCloseOnEscape(onClose);

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
				<table className={styles.sizer} aria-label={path} style={{ height }}>
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
