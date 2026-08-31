import { useEffect, useId, useState } from "react";
import { useResolvedTheme } from "#/components/theme/useResolvedTheme.ts";
import { themeStylesheet } from "#/lib/diff/highlightStylesheet.ts";
import {
	HIGHLIGHT_THEMES,
	readHighlightTheme,
	writeHighlightTheme,
} from "#/lib/diff/highlightThemes.ts";
import styles from "./HighlightThemeSelect.module.css";

/** The one `<link>` the picker owns, created the first time it is needed. */
const LINK_ID = "highlight-theme";

/**
 * Which highlight.js theme the code is coloured with.
 *
 * The stylesheet is a `<link>` rather than inlined text: the browser caches it,
 * and swapping themes is then one attribute write. The picker is deliberately a
 * native `<select>` — twenty-three options is a list to scan, and the platform's
 * own is better at that on every device than anything we would build.
 */
export function HighlightThemeSelect() {
	const id = useId();
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

	function choose(value: string) {
		setTheme(value);
		writeHighlightTheme(value);
	}

	return (
		<div className={styles.picker}>
			<label className={styles.label} htmlFor={id}>
				Theme:
			</label>
			<select
				className={styles.select}
				// Before the stored choice is known there is nothing to choose from
				// yet — an enabled select would offer to change a value it is not
				// showing.
				disabled={theme === null}
				id={id}
				onChange={(event) => choose(event.target.value)}
				value={theme ?? ""}
			>
				{HIGHLIGHT_THEMES.map(({ value, label }) => (
					<option key={value} value={value}>
						{label}
					</option>
				))}
			</select>
		</div>
	);
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
