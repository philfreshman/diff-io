import type { RefObject } from "react";
import { useDiffScrollbar } from "#/components/diff/useDiffScrollbar.ts";
import type { Marker } from "#/lib/diff/scrollbar.ts";
import styles from "./DiffScrollbar.module.css";

export interface DiffScrollbarProps {
	/** The element the bar scrolls; it is not the bar's to own. */
	scroller: RefObject<HTMLElement | null>;
	/** Every change in the file, as its share of the way down it. */
	markers: Marker[];
}

/**
 * The diff's own scrollbar, with a minimap of the file's changes down it.
 *
 * The native one cannot carry the markers, and there is nothing to gain from
 * showing both — so the scroller hides its own and this sits over it.
 */
export function DiffScrollbar({ scroller, markers }: DiffScrollbarProps) {
	const bar = useDiffScrollbar(scroller);

	return (
		<div
			className={styles.track}
			ref={bar.track}
			data-testid="diff-scrollbar"
			// The whole bar is a pointer affordance over content that is already
			// reachable by keyboard, so it says what it is doing rather than
			// offering a second way to do it.
			data-shown={bar.thumb ? bar.shown : false}
			aria-hidden="true"
			hidden={!bar.thumb}
			onMouseDown={bar.onTrackMouseDown}
			onMouseEnter={bar.onTrackMouseEnter}
			onMouseLeave={bar.onTrackMouseLeave}
		>
			{markers.map((marker) => (
				<span
					className={styles.marker}
					data-testid="diff-marker"
					data-type={marker.type}
					key={`${marker.type}-${marker.start}`}
					style={{
						top: `${marker.start * 100}%`,
						height: `${(marker.end - marker.start) * 100}%`,
					}}
				/>
			))}
			{bar.thumb ? (
				<div
					// Hidden along with the track it is in: the file it scrolls is
					// reachable without it.
					aria-hidden="true"
					className={styles.thumb}
					data-testid="diff-scrollbar-thumb"
					onMouseDown={bar.onThumbMouseDown}
					style={{ top: bar.thumb.top, height: bar.thumb.height }}
				/>
			) : null}
		</div>
	);
}
