/**
 * The viewer's persisted preference. Parsing is kept apart from storage so the
 * component and the tests agree on one set of rules — the split `theme.ts` and
 * `tree/prefs.ts` already use.
 */

export const SPLIT_VIEW_KEY = "split-view-preference";

/**
 * Unified unless the visitor asked for split. The key and its literal `"true"`
 * are the old app's, so a returning visitor's choice still stands.
 */
export function parseSplitView(raw: string | null): boolean {
	return raw === "true";
}

export function readSplitView(): boolean {
	try {
		return parseSplitView(localStorage.getItem(SPLIT_VIEW_KEY));
	} catch {
		return false;
	}
}

export function writeSplitView(split: boolean): void {
	try {
		localStorage.setItem(SPLIT_VIEW_KEY, String(split));
	} catch {
		// Not persisted; the viewer still shows what was asked for this session.
	}
}

export const IGNORE_WHITESPACE_KEY = "ignore-whitespace-preference";

/**
 * Whitespace-exact unless the visitor asked otherwise. Same literal `"true"`
 * as split view, so the two settings read and write alike.
 */
export function parseIgnoreWhitespace(raw: string | null): boolean {
	return raw === "true";
}

export function readIgnoreWhitespace(): boolean {
	try {
		return parseIgnoreWhitespace(localStorage.getItem(IGNORE_WHITESPACE_KEY));
	} catch {
		return false;
	}
}

export function writeIgnoreWhitespace(ignore: boolean): void {
	try {
		localStorage.setItem(IGNORE_WHITESPACE_KEY, String(ignore));
	} catch {
		// Not persisted; the diff still reads the way it was asked to this session.
	}
}
