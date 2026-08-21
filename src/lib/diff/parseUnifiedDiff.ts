import type { FileDiff } from "#/lib/worker/protocol.ts";

/** One line of a file as the viewer shows it. */
export interface DiffLine {
	type: "added" | "removed" | "unchanged";
	/** The text itself, with the diff engine's marker already taken off. */
	content: string;
	/** Its number in the old file, or `null` when it is not in the old file. */
	oldNumber: number | null;
	/** Its number in the new file, or `null` when it is not in the new file. */
	newNumber: number | null;
}

/**
 * The engine's output as a line model the renderer can lay out directly.
 *
 * It emits every line of the file, marked, with no `@@` headers — so the two
 * gutter numbers are counted here rather than read off a hunk header.
 */
export function parseUnifiedDiff(file: FileDiff): DiffLine[] {
	const raws = file.data.split("\n");
	if (!file.isDiff) {
		return raws.map((content, index) => ({
			type: "unchanged" as const,
			content,
			oldNumber: index + 1,
			newNumber: index + 1,
		}));
	}

	const lines: DiffLine[] = [];
	let oldNumber = 0;
	let newNumber = 0;

	for (const raw of raws) {
		if (isHeader(raw)) continue;

		if (raw.startsWith("- ")) {
			lines.push({
				type: "removed",
				content: raw.slice(2),
				oldNumber: ++oldNumber,
				newNumber: null,
			});
		} else if (raw.startsWith("+ ")) {
			lines.push({
				type: "added",
				content: raw.slice(2),
				oldNumber: null,
				newNumber: ++newNumber,
			});
		} else {
			lines.push({
				type: "unchanged",
				content: raw.slice(2),
				oldNumber: ++oldNumber,
				newNumber: ++newNumber,
			});
		}
	}

	return lines;
}

/**
 * The engine writes `--- from/x` and `+++ to/x` ahead of the first line. They
 * name the file, which the toolbar already does, so they are not content.
 */
function isHeader(raw: string): boolean {
	return raw.startsWith("--- from/") || raw.startsWith("+++ to/");
}
