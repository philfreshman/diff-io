import type { DiffFileEntry } from "#/lib/worker/protocol.ts";

/** One rendered line of the tree: what to draw, and how far in. */
export interface TreeRow {
	entry: DiffFileEntry;
	depth: number;
	expanded: boolean;
	hasChildren: boolean;
}

/** Everything the user has done to the tree that changes what it shows. */
export interface TreeView {
	filter: string;
	onlyModified: boolean;
	/** Folders the user opened by hand. */
	expandedKeys: ReadonlySet<string>;
	/** Folders the user closed by hand, which outranks auto-expansion. */
	collapsedKeys: ReadonlySet<string>;
}

/**
 * The tree the user can actually see, flattened in render order.
 *
 * Flat rather than nested because everything downstream wants it flat: the
 * renderer maps over it, and ↑↓/Home/End are index arithmetic over exactly
 * this list. The root itself is structure, not content, so it is never a row.
 */
export function visibleRows(
	root: DiffFileEntry | null,
	view: TreeView,
): TreeRow[] {
	if (!root) return [];

	const rows: TreeRow[] = [];
	for (const child of root.children ?? [])
		collect(child, 0, withSoleRootOpen(root, view), rows);

	return rows;
}

/**
 * A folder earns its row when something inside it does — otherwise filtering
 * to `router` or to modified files would hide the folders on the way there.
 */
function hasVisibleDescendant(entry: DiffFileEntry, view: TreeView): boolean {
	return (entry.children ?? []).some(
		(child) => isVisible(child, view) || hasVisibleDescendant(child, view),
	);
}

function isVisible(entry: DiffFileEntry, view: TreeView): boolean {
	// The whole path, not the name: filtering for "router" should find
	// `lib/router/index.js`, and a matching folder brings its contents with it
	// because their paths carry its name too.
	const matchesFilter = entry.path
		.toLowerCase()
		.includes(view.filter.toLowerCase());
	const changed = entry.status !== "unchanged";

	return matchesFilter && (!view.onlyModified || changed);
}

/**
 * A package whose whole content sits under one folder (`src/`, a Go module's
 * package directory) would otherwise present as a single unopened row. Nothing
 * chosen by hand yet is what makes this safe to decide for the user.
 */
function withSoleRootOpen(root: DiffFileEntry, view: TreeView): TreeView {
	const children = root.children ?? [];
	const sole = children.length === 1 ? children[0] : undefined;
	if (sole?.type !== "directory") return view;
	if (view.expandedKeys.size > 0 || view.collapsedKeys.has(sole.path)) {
		return view;
	}

	return { ...view, expandedKeys: new Set([sole.path]) };
}

function collect(
	entry: DiffFileEntry,
	depth: number,
	view: TreeView,
	rows: TreeRow[],
): void {
	if (!isVisible(entry, view) && !hasVisibleDescendant(entry, view)) return;

	const children = entry.children ?? [];
	const hasChildren = children.length > 0;
	// While the tree is narrowed — by a filter or by only-modified — the folders
	// on the way to what survived open themselves, or the matches would be
	// buried under folders the user never asked to close.
	const narrowed = view.filter.length > 0 || view.onlyModified;
	const expanded =
		hasChildren &&
		(view.expandedKeys.has(entry.path) ||
			(narrowed &&
				!view.collapsedKeys.has(entry.path) &&
				hasVisibleDescendant(entry, view)));

	rows.push({ entry, depth, expanded, hasChildren });
	if (!expanded) return;

	for (const child of children) collect(child, depth + 1, view, rows);
}
