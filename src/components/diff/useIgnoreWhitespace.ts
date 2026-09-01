import { useEffect, useState } from "react";
import {
	readIgnoreWhitespace,
	writeIgnoreWhitespace,
} from "#/lib/diff/prefs.ts";

export interface IgnoreWhitespaceControls {
	/** The setting in force, or `null` before the stored choice has been read. */
	ignore: boolean | null;
	set(ignore: boolean): void;
}

/**
 * Whether whitespace counts as a change — a reading habit, like split view and
 * the highlight theme, so it is remembered rather than asked again per file.
 *
 * `null` until the stored choice is read, not `false`: the server has no
 * `localStorage`, and a deep link opened with the setting on would otherwise
 * build the whole tree whitespace-exact first and immediately throw it away.
 * The session waits for an answer rather than being given a guess.
 */
export function useIgnoreWhitespace(): IgnoreWhitespaceControls {
	const [ignore, setIgnore] = useState<boolean | null>(null);

	useEffect(() => setIgnore(readIgnoreWhitespace()), []);

	return {
		ignore,
		set(next: boolean) {
			setIgnore(next);
			writeIgnoreWhitespace(next);
		},
	};
}
