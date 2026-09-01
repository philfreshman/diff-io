import hljs from "highlight.js";
import type { DiffLine } from "#/lib/diff/parseUnifiedDiff.ts";

/**
 * Syntax highlighting for the viewer: which language a file is in, and one
 * line of it marked up.
 *
 * The language is decided once for the whole file — `highlightAuto` on every
 * line separately would be both slow and inconsistent, since a line like `}`
 * tells it nothing.
 */

/** How much of the file the language is guessed from, when it has to be. */
const SAMPLE_LINES = 200;
const SAMPLE_CHARS = 20_000;
/**
 * And how much of any one line of it.
 *
 * `highlightAuto` runs every grammar it knows over what it is handed, and its
 * cost climbs with the length of a *line* far faster than with the number of
 * them: 200 lines of source is under two hundred milliseconds, while a single
 * line of the same length is closer to a second, and a whole minified file —
 * a `.eslintcache`, a bundle — is twenty seconds of frozen page. The head of
 * a line is also all the evidence there is in it; the rest is more of the
 * same.
 */
const SAMPLE_LINE_CHARS = 400;

/**
 * What the file is written in.
 *
 * Its extension first: highlight.js knows most of them as aliases, and a name
 * is far better evidence than a guess taken from a *diff*, where both versions
 * of every line are interleaved — express's `package.json` reads as Perl that
 * way. Guessing is the fallback for the files that have no extension to read.
 */
export function detectLanguage(path: string, lines: DiffLine[]): string | null {
	const named = languageFromPath(path);
	if (named) return named;

	const sample = detectionSample(lines);
	if (!sample) return null;

	return hljs.highlightAuto(sample).language ?? null;
}

function languageFromPath(path: string): string | null {
	const name = path.split("/").at(-1) ?? path;
	const dot = name.lastIndexOf(".");
	// No extension, and a leading dot is a name rather than one: `.gitignore`
	// is not a `gitignore` file.
	if (dot < 1) return null;

	const extension = name.slice(dot + 1).toLowerCase();

	return hljs.getLanguage(extension) ? extension : null;
}

function detectionSample(lines: DiffLine[]): string {
	const sampled: string[] = [];
	let budget = SAMPLE_CHARS;

	for (const [index, line] of lines.entries()) {
		if (index >= SAMPLE_LINES || budget <= 0) break;
		if (!line.content) continue;
		// Cut to the budgets rather than counted against them afterwards: a
		// file with no newlines in it is a single line of half a megabyte, and
		// counting only notices once the whole of it is already in the sample.
		const head = line.content.slice(0, Math.min(SAMPLE_LINE_CHARS, budget));
		sampled.push(head);
		budget -= head.length;
	}

	return sampled.join("\n");
}

/**
 * The rendered lines are the visible ones, and scrolling brings the same ones
 * back — so the markup is kept rather than recomputed. The cache is dropped
 * whole when it fills; a diff session is short, and an eviction order would
 * cost more than it saves.
 */
const CACHE_LIMIT = 20_000;
const cache = new Map<string, string>();

/**
 * Past this, a line is shown as plain text.
 *
 * Marking one up costs roughly its own length again in `<span>`s, and that
 * markup goes into a single cell of a single row — a 580 000-character line
 * becomes over six megabytes of DOM that the browser cannot lay out. No line
 * anyone reads is this long: the ones that are come from files written by a
 * machine, where the colouring was never going to help.
 */
const MAX_HIGHLIGHT_CHARS = 10_000;

/**
 * One line, marked up. A language highlight.js does not know — and a file it
 * could not place at all — leaves the line as text, escaped either way: the
 * markup goes into the row as HTML, so nothing may survive from the archive.
 */
export function highlightLine(
	content: string,
	language: string | null,
): string {
	const tooLong = content.length > MAX_HIGHLIGHT_CHARS;
	if (!language || tooLong || !hljs.getLanguage(language)) {
		return escapeHtml(content);
	}

	const key = `${language} ${content}`;
	const cached = cache.get(key);
	if (cached !== undefined) return cached;

	const html = hljs.highlight(content, {
		language,
		ignoreIllegals: true,
	}).value;
	if (cache.size >= CACHE_LIMIT) cache.clear();
	cache.set(key, html);

	return html;
}

function escapeHtml(content: string): string {
	return content
		.replaceAll("&", "&amp;")
		.replaceAll("<", "&lt;")
		.replaceAll(">", "&gt;");
}
