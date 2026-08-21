import {
	ChevronDownIcon,
	ChevronRightIcon,
	FileIcon,
	FolderIcon,
	FolderOpenIcon,
} from "#/components/ui/icons.tsx";
import { useRef, useState } from "react";
import type { TreeRow } from "#/lib/tree/visibility.ts";
import styles from "./FileTree.module.css";

export interface FileTreeProps {
	rows: readonly TreeRow[];
	/** The file the URL names, if it is in this comparison. */
	selectedPath: string;
	onOpenFile(path: string): void;
	onToggleFolder(path: string, expanded: boolean): void;
}

/** The name a row shows: the last segment of its path. */
function nameOf(path: string): string {
	return path.split("/").pop() || path;
}

/**
 * The file tree, as a real `role="tree"`: rows carry their own depth and
 * expanded state, and the flat row list they come from is what the keyboard
 * walks.
 */
export function FileTree({
	rows,
	selectedPath,
	onOpenFile,
	onToggleFolder,
}: FileTreeProps) {
	// A tree is one tab stop: exactly one row is tabbable, and the arrows move
	// which one that is. The focused row is remembered by path rather than by
	// index, because filtering and expanding renumber the rows underneath it.
	const [focusedPath, setFocusedPath] = useState("");
	const elements = useRef(new Map<string, HTMLElement>());

	const index = rows.findIndex((row) => row.entry.path === focusedPath);
	const selectedIndex = rows.findIndex(
		(row) => row.entry.path === selectedPath,
	);
	// Nothing focused yet: the file the URL names is where the user already is,
	// and failing that the top of the tree.
	const activeIndex = index >= 0 ? index : Math.max(selectedIndex, 0);
	const activePath = rows[activeIndex]?.entry.path ?? "";

	function focusRow(next: number) {
		const row = rows[Math.min(Math.max(next, 0), rows.length - 1)];
		if (!row) return;
		setFocusedPath(row.entry.path);
		const element = elements.current.get(row.entry.path);
		element?.focus({ preventScroll: true });
		element?.scrollIntoView({ block: "nearest" });
	}

	function activate(row: TreeRow) {
		setFocusedPath(row.entry.path);
		if (row.hasChildren) onToggleFolder(row.entry.path, !row.expanded);
		else onOpenFile(row.entry.path);
	}

	function handleKeyDown(event: React.KeyboardEvent) {
		const row = rows[activeIndex];
		if (!row) return;

		switch (event.key) {
			case "ArrowDown":
				focusRow(activeIndex + 1);
				break;
			case "ArrowUp":
				focusRow(activeIndex - 1);
				break;
			case "Home":
				focusRow(0);
				break;
			case "End":
				focusRow(rows.length - 1);
				break;
			case "Enter":
			case " ":
				activate(row);
				break;
			case "ArrowRight":
				// Open what is shut; on what is already open, step inside it.
				if (row.hasChildren && !row.expanded) {
					onToggleFolder(row.entry.path, true);
				} else if ((rows[activeIndex + 1]?.depth ?? -1) > row.depth) {
					focusRow(activeIndex + 1);
				}
				break;
			case "ArrowLeft": {
				// Shut what is open; on a leaf, go up to the folder holding it.
				if (row.hasChildren && row.expanded) {
					onToggleFolder(row.entry.path, false);
					break;
				}
				for (let i = activeIndex - 1; i >= 0; i -= 1) {
					if ((rows[i]?.depth ?? 0) < row.depth) {
						focusRow(i);
						break;
					}
				}
				break;
			}
			default:
				return;
		}

		event.preventDefault();
	}

	return (
		<div
			className={styles.tree}
			role="tree"
			aria-label="Changed files"
			onKeyDown={handleKeyDown}
		>
			{rows.map((row) => {
				const { entry, expanded, hasChildren } = row;
				const folder = entry.type === "directory";

				return (
					// biome-ignore lint/a11y/useKeyWithClickEvents: the tree owns the keyboard, per the ARIA practices guide
					<div
						key={entry.path}
						role="treeitem"
						className={styles.row}
						ref={(element) => {
							if (element) elements.current.set(entry.path, element);
							else elements.current.delete(entry.path);
						}}
						tabIndex={entry.path === activePath ? 0 : -1}
						onFocus={() => setFocusedPath(entry.path)}
						style={{ paddingLeft: `${row.depth * 18 + 4}px` }}
						aria-level={row.depth + 1}
						aria-expanded={hasChildren ? expanded : undefined}
						aria-selected={entry.path === selectedPath}
						data-path={entry.path}
						data-type={entry.type}
						data-status={entry.status}
						title={
							entry.status === "renamed" && entry.oldPath
								? `Renamed from ${entry.oldPath}`
								: entry.path
						}
						onClick={() => activate(row)}
					>
						<span className={styles.slot}>
							{hasChildren ? (
								<span data-testid="chevron" data-expanded={expanded}>
									{expanded ? <ChevronDownIcon /> : <ChevronRightIcon />}
								</span>
							) : null}
						</span>
						<span
							className={folder ? styles.folderIcon : styles.fileIcon}
							data-testid="icon"
							data-icon={
								folder ? (expanded ? "folder-open" : "folder") : "file"
							}
						>
							{folder ? (
								expanded ? (
									<FolderOpenIcon />
								) : (
									<FolderIcon />
								)
							) : (
								<FileIcon />
							)}
						</span>
						<span className={styles.name} data-testid="name">
							{nameOf(entry.path)}
						</span>
						{entry.status === "renamed" && (
							<span className={styles.renamed}>RENAMED</span>
						)}
						{entry.added ? (
							<span className={styles.added} data-testid="added">
								+{entry.added}
							</span>
						) : null}
						{entry.removed ? (
							<span className={styles.removed} data-testid="removed">
								-{entry.removed}
							</span>
						) : null}
					</div>
				);
			})}
		</div>
	);
}
