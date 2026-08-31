import type { RefObject } from "react";
import { useCallback, useEffect, useRef, useState } from "react";
import {
	scrollForDrag,
	scrollForTrackClick,
	type Thumb,
	thumbMetrics,
} from "#/lib/diff/scrollbar.ts";

/** How long the scrollbar stays after the reader has stopped moving. */
const HIDE_DELAY = 600;

/** What the scrollbar needs to draw itself and to be driven. */
export interface DiffScrollbar {
	/** Where the thumb sits, or `null` while the file fits on screen. */
	thumb: Thumb | null;
	/** Whether it is currently on show. */
	shown: boolean;
	track: RefObject<HTMLDivElement | null>;
	onTrackMouseDown(event: React.MouseEvent): void;
	onThumbMouseDown(event: React.MouseEvent): void;
	onTrackMouseEnter(): void;
	onTrackMouseLeave(): void;
}

/**
 * The scrollbar's behaviour, over a scroller it does not own.
 *
 * The file is scrolled by setting `scrollTop`, never by moving the thumb
 * directly: the thumb is drawn from the scroll position, so there is one
 * source of truth and a scroll from the wheel, a drag and a click through the
 * file tree all put it in the same place.
 */
export function useDiffScrollbar(
	scroller: RefObject<HTMLElement | null>,
): DiffScrollbar {
	const [thumb, setThumb] = useState<Thumb | null>(null);
	const [shown, setShown] = useState(false);
	const track = useRef<HTMLDivElement>(null);

	// Held so the bar does not vanish out from under a pointer that is still on
	// it, or mid-drag — both are the reader using it, not ignoring it.
	const held = useRef({ hovering: false, dragging: false });
	const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

	const hideLater = useCallback(() => {
		if (timer.current) clearTimeout(timer.current);
		timer.current = setTimeout(() => {
			if (held.current.hovering || held.current.dragging) return;
			setShown(false);
		}, HIDE_DELAY);
	}, []);

	const measure = useCallback(() => {
		if (scroller.current) setThumb(thumbMetrics(scroller.current));
	}, [scroller]);

	// A scroll is what the scrollbar is about: it both moves the thumb and is
	// the reason to show it.
	useEffect(() => {
		const element = scroller.current;
		if (!element) return;

		const onScroll = () => {
			measure();
			setShown(true);
			hideLater();
		};

		element.addEventListener("scroll", onScroll, { passive: true });
		measure();

		// The file changes height under it — a fold opens, the window resizes,
		// a wrapped row remeasures — and each of those changes the thumb.
		const observer = new ResizeObserver(measure);
		observer.observe(element);
		const content = element.firstElementChild;
		if (content) observer.observe(content);

		return () => {
			element.removeEventListener("scroll", onScroll);
			observer.disconnect();
		};
	}, [scroller, measure, hideLater]);

	useEffect(
		() => () => {
			if (timer.current) clearTimeout(timer.current);
		},
		[],
	);

	const onThumbMouseDown = useCallback(
		(event: React.MouseEvent) => {
			const element = scroller.current;
			if (!element) return;
			// Otherwise the drag selects the file's text as it passes over it.
			event.preventDefault();
			event.stopPropagation();

			const startY = event.clientY;
			const startScrollTop = element.scrollTop;
			held.current.dragging = true;

			const onMove = (move: MouseEvent) => {
				element.scrollTop = scrollForDrag(
					element,
					startScrollTop,
					move.clientY - startY,
				);
			};

			const onUp = () => {
				held.current.dragging = false;
				document.removeEventListener("mousemove", onMove);
				document.removeEventListener("mouseup", onUp);
				hideLater();
			};

			document.addEventListener("mousemove", onMove);
			document.addEventListener("mouseup", onUp);
		},
		[scroller, hideLater],
	);

	const onTrackMouseDown = useCallback(
		(event: React.MouseEvent) => {
			const element = scroller.current;
			const rect = track.current?.getBoundingClientRect();
			if (!element || !rect) return;

			element.scrollTop = scrollForTrackClick(
				element,
				event.clientY - rect.top,
			);
		},
		[scroller],
	);

	const onTrackMouseEnter = useCallback(() => {
		held.current.hovering = true;
		setShown(true);
		if (timer.current) clearTimeout(timer.current);
	}, []);

	const onTrackMouseLeave = useCallback(() => {
		held.current.hovering = false;
		hideLater();
	}, [hideLater]);

	return {
		thumb,
		shown,
		track,
		onTrackMouseDown,
		onThumbMouseDown,
		onTrackMouseEnter,
		onTrackMouseLeave,
	};
}
