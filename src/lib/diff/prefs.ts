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
