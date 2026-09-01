import { describe, expect, test } from "bun:test";
import { detectLanguage, highlightLine } from "#/lib/diff/highlight.ts";
import type { DiffLine } from "#/lib/diff/parseUnifiedDiff.ts";

function unchanged(...contents: string[]): DiffLine[] {
	return contents.map((content, index) => ({
		type: "unchanged" as const,
		content,
		oldNumber: index + 1,
		newNumber: index + 1,
	}));
}

describe("detectLanguage", () => {
	test("takes the language from the file's name when it can", () => {
		// Auto-detection on a *diff* is a poor guess — express's `package.json`
		// reads as Perl to it, with both versions of every key interleaved. The
		// name of the file is the better evidence, and it is right here.
		const json = unchanged('{ "name": "express" }');

		expect(detectLanguage("package.json", json)).toBe("json");
		expect(detectLanguage("lib/router/index.js", json)).toBe("js");
	});

	test("names the language the file is written in", () => {
		const json = unchanged(
			"{",
			'\t"name": "node",',
			'\t"version": "26.7.0",',
			'\t"keywords": ["node", "npm"],',
			'\t"private": false',
			"}",
		);

		expect(detectLanguage("LICENSE", json)).toBe("json");
	});
});

test("decides from the head of the file, not the whole of it", () => {
	// Sampling is what keeps opening a 40 000-line file cheap; a detector
	// that read all of it would answer "css" here.
	const lines = unchanged(
		...Array.from({ length: 200 }, (_, index) => `\t"key${index}": 1,`),
		...Array.from({ length: 4000 }, () => "a { color: red; }"),
	);

	expect(detectLanguage("Makefile", lines)).toBe("json");
});

test("reads the head of a line rather than the whole of it", () => {
	// A file with no newlines in it — a `.eslintcache`, a minified bundle — is
	// one line of half a megabyte. Handed that whole, `highlightAuto` runs
	// every grammar it knows over all of it and the page stops answering for
	// the better part of a minute, so only the head of a line is evidence.
	const head = ".button { color: red; padding: 4px; } ".repeat(11);
	const tail = '{"name":"node","version":"26.7.0"},'.repeat(12_000);

	expect(detectLanguage(".eslintcache", unchanged(head + tail))).toBe("css");
});

test("has nothing to say about an empty file", () => {
	expect(detectLanguage("LICENSE", [])).toBe(null);
	expect(detectLanguage("LICENSE", unchanged("", "", ""))).toBe(null);
});

describe("highlightLine", () => {
	test("marks up the line in the file's language", () => {
		expect(highlightLine('"version": "26.7.0",', "json")).toContain(
			'class="hljs-attr"',
		);
	});

	test("escapes the line, so a diff cannot inject markup", () => {
		const html = highlightLine("<img src=x onerror=alert(1)>", null);

		expect(html).not.toContain("<img");
		expect(html).toContain("&lt;img");
	});

	test("leaves a line alone when the language is unknown", () => {
		expect(highlightLine("just some prose", null)).toBe("just some prose");
	});

	test("leaves a line too long to be read as plain text", () => {
		// Marking a line up costs roughly its own length again in `<span>`s,
		// and all of it goes into one cell of one row: the half-megabyte line
		// of a `.eslintcache` came to over six megabytes of DOM, which is what
		// froze the tab rather than the highlighting itself.
		const line = '{"name":"node"},'.repeat(10_000);

		expect(highlightLine(line, "json")).toBe(line);
	});

	test("still escapes a line it is too long to mark up", () => {
		const line = `${"a".repeat(20_000)}<img src=x onerror=alert(1)>`;
		const html = highlightLine(line, "html");

		expect(html).not.toContain("<img");
		expect(html).toContain("&lt;img");
	});
});
