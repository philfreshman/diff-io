import type { CSSProperties, Ref } from "react";

/**
 * What the virtualiser needs from every row it places: where to put it, and a
 * handle to measure it with once it is there. Rows wrap, so the height the
 * list was estimated with is corrected by the row itself.
 */
export interface VirtualRowProps {
	index: number;
	style: CSSProperties;
	ref: Ref<HTMLTableRowElement>;
}
