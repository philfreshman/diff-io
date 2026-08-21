import type { DiffFileEntry } from "#/lib/worker/protocol.ts";

/**
 * Every file in the tree, in tree order. Directories are structure, not
 * content: only leaves can be opened, so only leaves are listed.
 */
export function flattenFiles(tree: DiffFileEntry | null): DiffFileEntry[] {
	if (!tree) return [];
	if (tree.type === "file") return [tree];

	return (tree.children ?? []).flatMap(flattenFiles);
}

/**
 * The entry a path names, or `undefined` if the pair being compared does not
 * contain it — a stale deep link, or a file that only existed in a version
 * neither selector points at.
 *
 * The engine needs a renamed file's `oldPath` to diff it against its former
 * self, and the URL carries only the new path, so the lookup is how the two
 * are put back together.
 */
export function findFile(
	tree: DiffFileEntry | null,
	path: string,
): DiffFileEntry | undefined {
	if (!path) return undefined;

	return flattenFiles(tree).find((entry) => entry.path === path);
}
