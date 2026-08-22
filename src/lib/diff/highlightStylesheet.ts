import { HIGHLIGHT_THEMES } from "#/lib/diff/highlightThemes.ts";

/**
 * Where each theme's stylesheet is served from.
 *
 * The patterns are spelled out one per theme rather than globbed with `**`:
 * highlight.js ships 258 stylesheets and the picker offers 23, and a wildcard
 * would have Vite emit every one of them into the build. They are the `asset`
 * paths of `HIGHLIGHT_THEMES`, and `themeStylesheet` returns null for any that
 * has drifted from this list — which is what the picker's e2e coverage walks
 * every option to catch.
 */
const STYLESHEETS = import.meta.glob<string>(
	[
		"/node_modules/highlight.js/styles/base16/3024.css",
		"/node_modules/highlight.js/styles/atom-one-dark.css",
		"/node_modules/highlight.js/styles/atom-one-light.css",
		"/node_modules/highlight.js/styles/default.css",
		"/node_modules/highlight.js/styles/base16/dracula.css",
		"/node_modules/highlight.js/styles/base16/github.css",
		"/node_modules/highlight.js/styles/github-dark.css",
		"/node_modules/highlight.js/styles/github-dark-dimmed.css",
		"/node_modules/highlight.js/styles/base16/material.css",
		"/node_modules/highlight.js/styles/monokai.css",
		"/node_modules/highlight.js/styles/monokai-sublime.css",
		"/node_modules/highlight.js/styles/night-owl.css",
		"/node_modules/highlight.js/styles/nord.css",
		"/node_modules/highlight.js/styles/base16/onedark.css",
		"/node_modules/highlight.js/styles/stackoverflow-dark.css",
		"/node_modules/highlight.js/styles/stackoverflow-light.css",
		"/node_modules/highlight.js/styles/base16/solarized-light.css",
		"/node_modules/highlight.js/styles/base16/solarized-dark.css",
		"/node_modules/highlight.js/styles/tokyo-night-dark.css",
		"/node_modules/highlight.js/styles/vs.css",
		"/node_modules/highlight.js/styles/vs2015.css",
		"/node_modules/highlight.js/styles/base16/windows-95.css",
	],
	{ query: "?url", import: "default", eager: true },
);

/** The URL to point a `<link>` at, or null for a theme we cannot serve. */
export function themeStylesheet(value: string): string | null {
	const theme = HIGHLIGHT_THEMES.find((it) => it.value === value);
	if (!theme) return null;
	// Ours, already a URL under `public/`.
	if (theme.asset.startsWith("/")) return theme.asset;

	return (
		STYLESHEETS[`/node_modules/highlight.js/styles/${theme.asset}`] ?? null
	);
}
