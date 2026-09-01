/**
 * Theme resolution as pure functions. The DOM-touching part lives in
 * `applyTheme`; everything above it is data in, data out, so the pre-paint
 * script, the toggle and the tests all agree on one set of rules.
 */

export type ThemeSelection = "light" | "dark" | "system";
export type ResolvedTheme = "light" | "dark";

/** What an unconfigured visitor gets — diffpack is dark by default. */
export const DEFAULT_SELECTION: ThemeSelection = "dark";

const SELECTIONS: readonly ThemeSelection[] = ["light", "dark", "system"];

function isSelection(value: string): value is ThemeSelection {
	return (SELECTIONS as readonly string[]).includes(value);
}

/** Narrows whatever `localStorage` handed back, which is `string | null`. */
export function parseSelection(raw: string | null): ThemeSelection {
	if (raw !== null && isSelection(raw)) return raw;
	return DEFAULT_SELECTION;
}

/**
 * `prefersDark` is passed in rather than read from `matchMedia` so this stays
 * usable from the server, the tests and the pre-paint script alike.
 */
export function resolveTheme(
	selection: ThemeSelection,
	prefersDark: boolean,
): ResolvedTheme {
	if (selection !== "system") return selection;
	return prefersDark ? "dark" : "light";
}

/** The toggle's cycle order, matching the icon it shows for each state. */
export function nextSelection(selection: ThemeSelection): ThemeSelection {
	const index = SELECTIONS.indexOf(selection);
	return SELECTIONS[(index + 1) % SELECTIONS.length] ?? DEFAULT_SELECTION;
}

/**
 * Tints the mobile browser chrome (iOS Safari status/toolbar) so it blends with
 * the page instead of falling back to its default grey. These two values are
 * the literal `--color-background` tokens; they cannot be read from CSS here
 * because the pre-paint script runs before the stylesheet is applied.
 */
export function themeColor(resolved: ResolvedTheme): string {
	return resolved === "light" ? "#ffffff" : "#0a0a0a";
}

const SELECTION_ATTRIBUTE = "data-theme-selection";
const THEME_ATTRIBUTE = "data-theme";

/**
 * The one impure function here: writes the resolved theme onto `<html>` and
 * keeps the `theme-color` meta in step. `data-theme` is what the token layer
 * switches on; `data-theme-selection` records the light/dark/system choice the
 * toggle cycles through.
 */
export function applyTheme(doc: Document, selection: ThemeSelection): void {
	const prefersDark = doc.defaultView
		? doc.defaultView.matchMedia("(prefers-color-scheme: dark)").matches
		: false;
	const resolved = resolveTheme(selection, prefersDark);

	doc.documentElement.setAttribute(THEME_ATTRIBUTE, resolved);
	doc.documentElement.setAttribute(SELECTION_ATTRIBUTE, selection);

	let meta = doc.head?.querySelector('meta[name="theme-color"]');
	if (!meta) {
		meta = doc.createElement("meta");
		meta.setAttribute("name", "theme-color");
		doc.head?.appendChild(meta);
	}
	meta.setAttribute("content", themeColor(resolved));
}

/**
 * The theme currently on the document, which the pre-paint script writes before
 * React exists. Anything that has to *render* differently per theme reads it
 * from here rather than resolving the preference a second time.
 */
export function readAppliedTheme(doc: Document): ResolvedTheme {
	return doc.documentElement.getAttribute(THEME_ATTRIBUTE) === "light"
		? "light"
		: "dark";
}

export const THEME_STORAGE_KEY = "theme";

/**
 * Reading and writing are separated from `applyTheme` so a caller can change the
 * stored choice without touching the DOM, and vice versa. Storage can throw
 * (private mode, blocked cookies); a visitor who cannot persist a preference
 * should still get a working toggle for the session.
 */
export function readSelection(): ThemeSelection {
	try {
		return parseSelection(localStorage.getItem(THEME_STORAGE_KEY));
	} catch {
		return DEFAULT_SELECTION;
	}
}

export function writeSelection(selection: ThemeSelection): void {
	try {
		localStorage.setItem(THEME_STORAGE_KEY, selection);
	} catch {
		// Preference is not persisted; the in-page theme still changes.
	}
}

// deliberate CI redness probe — reverted immediately
export const PROBE: number = "not a number";
