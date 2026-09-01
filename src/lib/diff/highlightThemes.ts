import type { ResolvedTheme } from "#/lib/theme.ts";

/**
 * The highlight.js themes the picker offers, and where each one's stylesheet
 * comes from.
 *
 * `value` is what gets persisted, and it is the old app's spelling — some of
 * these carry a `base16/` prefix and some do not, which is a wart, but the
 * stored value is a contract with visitors who already have one. `asset` is
 * where the stylesheet actually lives, which is what that wart was hiding: the
 * old picker found it by suffix-matching a recursive glob.
 */
export interface HighlightTheme {
	/** Persisted, and the `<option>` value. */
	value: string;
	label: string;
	/**
	 * A path under `highlight.js/styles/`, or an absolute URL of our own for a
	 * theme highlight.js does not ship.
	 */
	asset: string;
}

export const HIGHLIGHT_THEMES: readonly HighlightTheme[] = [
	{ value: "base16/3024", label: "3024", asset: "base16/3024.css" },
	{
		value: "atom-one-dark",
		label: "Atom One Dark",
		asset: "atom-one-dark.css",
	},
	{
		value: "atom-one-light",
		label: "Atom One Light",
		asset: "atom-one-light.css",
	},
	{ value: "default", label: "Default", asset: "default.css" },
	{ value: "base16/dracula", label: "Dracula", asset: "base16/dracula.css" },
	{ value: "base16/github", label: "GitHub", asset: "base16/github.css" },
	{ value: "github-dark", label: "GitHub Dark", asset: "github-dark.css" },
	{
		value: "github-dark-dimmed",
		label: "GitHub Dark Dimmed",
		asset: "github-dark-dimmed.css",
	},
	{ value: "material", label: "Material", asset: "base16/material.css" },
	{ value: "monokai", label: "Monokai", asset: "monokai.css" },
	{
		value: "monokai-sublime",
		label: "Monokai Sublime",
		asset: "monokai-sublime.css",
	},
	{ value: "night-owl", label: "Night Owl", asset: "night-owl.css" },
	// Not a highlight.js theme: ours, served from `public/`.
	{ value: "nightfall", label: "Nightfall", asset: "/nightfall.css" },
	{ value: "nord", label: "Nord", asset: "nord.css" },
	{ value: "onedark", label: "One Dark", asset: "base16/onedark.css" },
	{
		value: "stackoverflow-dark",
		label: "Stack Overflow Dark",
		asset: "stackoverflow-dark.css",
	},
	{
		value: "stackoverflow-light",
		label: "Stack Overflow Light",
		asset: "stackoverflow-light.css",
	},
	{
		value: "solarized-light",
		label: "Solarized Light",
		asset: "base16/solarized-light.css",
	},
	{
		value: "solarized-dark",
		label: "Solarized Dark",
		asset: "base16/solarized-dark.css",
	},
	{
		value: "tokyo-night-dark",
		label: "Tokyo Night Dark",
		asset: "tokyo-night-dark.css",
	},
	{ value: "vs", label: "VS", asset: "vs.css" },
	{ value: "vs2015", label: "VS 2015", asset: "vs2015.css" },
	{ value: "windows-95", label: "Windows 95", asset: "base16/windows-95.css" },
];

/**
 * What an unconfigured visitor gets: whichever GitHub theme matches the page.
 *
 * The old picker defaulted light to `"github"`, which is not one of its own
 * options — so a light-mode visitor who had never chosen saw an empty select.
 * `base16/github` is the listed light GitHub theme, and is the fix.
 */
function defaultHighlightTheme(theme: ResolvedTheme): string {
	return theme === "dark" ? "github-dark" : "base16/github";
}

/**
 * Narrows whatever `localStorage` handed back. A value that is no longer one
 * of the offered themes — the old `"github"` among them — is not a choice we
 * can honour, so it falls back to the page's default.
 */
export function parseHighlightTheme(
	raw: string | null,
	theme: ResolvedTheme,
): string {
	const chosen = HIGHLIGHT_THEMES.find((it) => it.value === raw);

	return chosen ? chosen.value : defaultHighlightTheme(theme);
}

/** The old app's key, so a returning visitor's theme is still theirs. */
export const HIGHLIGHT_THEME_KEY = "highlight_theme";

export function readHighlightTheme(theme: ResolvedTheme): string {
	try {
		return parseHighlightTheme(
			localStorage.getItem(HIGHLIGHT_THEME_KEY),
			theme,
		);
	} catch {
		return defaultHighlightTheme(theme);
	}
}

export function writeHighlightTheme(value: string): void {
	try {
		localStorage.setItem(HIGHLIGHT_THEME_KEY, value);
	} catch {
		// Not persisted; the viewer still shows what was asked for this session.
	}
}
