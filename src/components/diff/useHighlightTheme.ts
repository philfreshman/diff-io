import { useEffect, useState } from "react";
import { useResolvedTheme } from "#/components/theme/useResolvedTheme.ts";
import { themeStylesheet } from "#/lib/diff/highlightStylesheet.ts";
import {
	readHighlightTheme,
	writeHighlightTheme,
} from "#/lib/diff/highlightThemes.ts";

/** The one `<link>` the picker owns, created the first time it is needed. */
const LINK_ID = "highlight-theme";

export interface HighlightThemeControls {
	/** The theme in force, or `null` before the stored choice has been read. */
	theme: string | null;
	choose(theme: string): void;
}

/**
 * Which highlight.js theme the code is coloured with, and the stylesheet that
 * does the colouring.
 *
 * The stylesheet is a `<link>` rather than inlined text: the browser caches it,
 * and swapping themes is then one attribute write. Held here rather than in the
 * control that changes it, because what the code looks like is not the menu's
 * property — the menu is only where it is chosen.
 */
export function useHighlightTheme(): HighlightThemeControls {
	const pageTheme = useResolvedTheme();
	// Null until mounted: the stored choice cannot be read on the server, and
	// guessing at it in the first client render is a hydration mismatch.
	const [theme, setTheme] = useState<string | null>(null);

	// Re-read on a page-theme change as well as on mount, so a visitor who has
	// never chosen follows light/dark — and one who has keeps what they chose.
	useEffect(() => {
		if (!pageTheme) return;
		setTheme(readHighlightTheme(pageTheme));
	}, [pageTheme]);

	useEffect(() => {
		if (!theme) return;
		const href = themeStylesheet(theme);
		if (href) stylesheetLink().href = href;
	}, [theme]);

	return {
		theme,
		choose(next: string) {
			setTheme(next);
			writeHighlightTheme(next);
		},
	};
}

function stylesheetLink(): HTMLLinkElement {
	const existing = document.getElementById(LINK_ID);
	if (existing instanceof HTMLLinkElement) return existing;

	const link = document.createElement("link");
	link.id = LINK_ID;
	link.rel = "stylesheet";
	document.head.append(link);

	return link;
}
