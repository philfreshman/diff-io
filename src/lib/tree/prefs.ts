/**
 * The tree panel's persisted preferences. Pure parsing here, so the pre-paint
 * script, the panel and the tests all agree on one set of rules — the same
 * split `theme.ts` uses.
 */

export const TREE_WIDTH_KEY = "tree_panel_width";
export const DEFAULT_TREE_WIDTH = 320;
export const MIN_TREE_WIDTH = 220;
export const MAX_TREE_WIDTH = 640;

/** Wide enough to read a path, narrow enough to leave the diff room. */
export function clampTreeWidth(width: number): number {
	return Math.min(MAX_TREE_WIDTH, Math.max(MIN_TREE_WIDTH, width));
}

/** Narrows whatever `localStorage` handed back, which is `string | null`. */
export function parseTreeWidth(raw: string | null): number {
	const parsed = raw === null ? Number.NaN : Number.parseInt(raw, 10);
	if (Number.isNaN(parsed)) return DEFAULT_TREE_WIDTH;

	return clampTreeWidth(parsed);
}

export const ONLY_MODIFIED_KEY = "tree_show_only_modified";

/**
 * On unless the visitor has turned it off — a comparison is about what changed,
 * and the unchanged files are context. The stored sense is inverted (only the
 * literal `"false"` disables it) because the key is a contract with visitors
 * who already have one from the old app.
 */
export function parseOnlyModified(raw: string | null): boolean {
	return raw !== "false";
}

/**
 * Reading and writing are kept apart from the parsing above so the panel can
 * change a preference without re-deriving it. Storage can throw (private mode,
 * blocked cookies); a visitor who cannot persist one should still get a working
 * panel for the session.
 */
export function readOnlyModified(): boolean {
	try {
		return parseOnlyModified(localStorage.getItem(ONLY_MODIFIED_KEY));
	} catch {
		return true;
	}
}

export function writeOnlyModified(onlyModified: boolean): void {
	try {
		localStorage.setItem(ONLY_MODIFIED_KEY, String(onlyModified));
	} catch {
		// Preference is not persisted; the panel still filters for the session.
	}
}

export function readTreeWidth(): number {
	try {
		return parseTreeWidth(localStorage.getItem(TREE_WIDTH_KEY));
	} catch {
		return DEFAULT_TREE_WIDTH;
	}
}

export function writeTreeWidth(width: number): void {
	try {
		localStorage.setItem(TREE_WIDTH_KEY, String(width));
	} catch {
		// Width is not persisted; the panel still resizes for the session.
	}
}

export const TREE_WIDTH_PROPERTY = "--tree-panel-width";

/**
 * The width lives in a custom property on `<html>` rather than in React state:
 * the pre-paint script writes it before hydration, and the drag rewrites it
 * without a render. One value, one owner, no flash.
 */
export function applyTreeWidth(doc: Document, width: number): void {
	doc.documentElement.style.setProperty(TREE_WIDTH_PROPERTY, `${width}px`);
}
