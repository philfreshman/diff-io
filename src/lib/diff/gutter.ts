import type { DiffLine } from "#/lib/diff/parseUnifiedDiff.ts";

/** Three digits, so a short file's gutter is not a sliver. */
const MIN_DIGITS = 3;

/**
 * How many digits the line-number gutters have to hold for this file.
 *
 * It is measured over the whole file rather than the rows on screen: the list
 * is virtualised, so a width taken from what is rendered would shift the
 * content sideways every time the scroll reached longer numbers.
 */
export function gutterChars(lines: DiffLine[]): number {
	let highest = 0;
	for (const line of lines) {
		highest = Math.max(highest, line.oldNumber ?? 0, line.newNumber ?? 0);
	}

	return Math.max(String(highest).length, MIN_DIGITS);
}
