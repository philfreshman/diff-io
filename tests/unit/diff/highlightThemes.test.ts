import { describe, expect, test } from "bun:test";
import {
	HIGHLIGHT_THEMES,
	parseHighlightTheme,
} from "#/lib/diff/highlightThemes.ts";

describe("HIGHLIGHT_THEMES", () => {
	test("offers the twenty-three themes the old picker did", () => {
		expect(HIGHLIGHT_THEMES).toHaveLength(23);
	});
});

describe("every theme's stylesheet exists", () => {
	// The old picker found a stylesheet by suffix-matching a recursive glob, so
	// a theme highlight.js had dropped simply stopped working with no sign of
	// it. Naming the file makes an upgrade that moves one fail here instead.
	test.each([...HIGHLIGHT_THEMES])("$label", async ({ asset }) => {
		const path = asset.startsWith("/")
			? `public${asset}`
			: `node_modules/highlight.js/styles/${asset}`;

		expect(await Bun.file(path).exists()).toBe(true);
	});
});

describe("parseHighlightTheme", () => {
	test("follows the page theme until the visitor picks one", () => {
		expect(parseHighlightTheme(null, "dark")).toBe("github-dark");
		expect(parseHighlightTheme(null, "light")).toBe("base16/github");
	});

	test("keeps a theme the visitor chose, whatever the page theme is", () => {
		expect(parseHighlightTheme("nord", "light")).toBe("nord");
		expect(parseHighlightTheme("base16/dracula", "dark")).toBe(
			"base16/dracula",
		);
	});

	test("drops a stored value that is no longer offered", () => {
		// `"github"` is exactly that: the old app's light default, which was
		// never one of its own options.
		expect(parseHighlightTheme("github", "light")).toBe("base16/github");
		expect(parseHighlightTheme("solarized", "dark")).toBe("github-dark");
	});
});
