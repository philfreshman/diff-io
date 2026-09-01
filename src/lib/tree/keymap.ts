import type { TreeRow } from "./visibility.ts";

/**
 * What a keystroke asks of the tree.
 *
 * Which row a key lands on is decided here, against the flat row list alone,
 * so the component is left with only the three things it is the one that can
 * do: move focus, open a file, and open or shut a folder.
 */
export type TreeCommand =
	/** Move the tree's one tab stop to this row. */
	| { kind: "focus"; index: number }
	/** Enter or Space: open the file, or open and shut the folder. */
	| { kind: "activate"; index: number }
	/** Open (`true`) or shut (`false`) the folder on this row. */
	| { kind: "toggle"; index: number; expanded: boolean };

/** Where the keyboard is, and the list it is walking. */
interface Cursor {
	rows: readonly TreeRow[];
	index: number;
	row: TreeRow;
}

/**
 * Right opens what is shut; on a folder already open it steps inside. On a
 * leaf, and on an open folder holding nothing visible, it does nothing rather
 * than walking on to the next sibling — which is what ↓ is for.
 */
function stepIn({ rows, index, row }: Cursor): TreeCommand | undefined {
	if (row.hasChildren && !row.expanded) {
		return { kind: "toggle", index, expanded: true };
	}
	if ((rows[index + 1]?.depth ?? -1) > row.depth) {
		return { kind: "focus", index: index + 1 };
	}

	return undefined;
}

/**
 * Left shuts what is open; on a leaf, or on a folder already shut, it goes up
 * to the folder holding it — the nearest row above sitting shallower.
 */
function stepOut({ rows, index, row }: Cursor): TreeCommand | undefined {
	if (row.hasChildren && row.expanded) {
		return { kind: "toggle", index, expanded: false };
	}
	for (let i = index - 1; i >= 0; i -= 1) {
		if ((rows[i]?.depth ?? 0) < row.depth) return { kind: "focus", index: i };
	}

	return undefined;
}

/**
 * The keys the tree answers to, and what each asks of it — the ARIA authoring
 * practices' tree pattern, as a table.
 *
 * A table rather than a switch so that each key is one line to read and each
 * is answerable on its own: what ← does on a leaf is a question about this
 * file, not about a component that has to be mounted first.
 */
const KEYS: Record<string, (cursor: Cursor) => TreeCommand | undefined> = {
	ArrowDown: ({ index }) => ({ kind: "focus", index: index + 1 }),
	ArrowUp: ({ index }) => ({ kind: "focus", index: index - 1 }),
	Home: () => ({ kind: "focus", index: 0 }),
	End: ({ rows }) => ({ kind: "focus", index: rows.length - 1 }),
	Enter: ({ index }) => ({ kind: "activate", index }),
	" ": ({ index }) => ({ kind: "activate", index }),
	ArrowRight: stepIn,
	ArrowLeft: stepOut,
};

/**
 * What `key` asks of a tree whose tab stop is on `index`, or `undefined` when
 * the tree does not answer to it — which is also what says the keystroke is
 * the page's rather than the tree's, and must not be swallowed.
 */
export function treeCommand(
	key: string,
	rows: readonly TreeRow[],
	index: number,
): TreeCommand | undefined {
	const row = rows[index];
	if (!row) return undefined;

	const command = KEYS[key]?.({ rows, index, row });
	if (command?.kind !== "focus") return command;

	// ↑ on the first row and ↓ on the last stay where they are: a tree's ends
	// are ends, not a wrap round to the other one.
	return { ...command, index: clamp(command.index, rows.length) };
}

function clamp(index: number, length: number): number {
	return Math.min(Math.max(index, 0), length - 1);
}
