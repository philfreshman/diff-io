import { type RefObject, useEffect, useRef } from "react";

/**
 * Where the reader had got to in this file, handed back on the way out.
 *
 * Returns the ref the scroller writes its position into. Keeping it out of
 * render is what stops a scroll costing a re-render of the whole list — and
 * following it in a ref rather than reading the element on the way out is
 * what makes it a position at all: by the time an unmount cleanup runs, the
 * scroller is off the document and a detached element reports zero.
 *
 * The viewer is mounted per path, so this reports once per file.
 */
export function useScrollMemory(
	scrollTop: number,
	onScrolled: (scrollTop: number) => void,
): RefObject<number> {
	const remember = useRef(onScrolled);
	remember.current = onScrolled;

	const at = useRef(scrollTop);
	useEffect(() => () => remember.current(at.current), []);

	return at;
}
