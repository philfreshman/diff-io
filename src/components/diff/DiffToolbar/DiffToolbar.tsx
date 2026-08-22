import { HighlightThemeSelect } from "#/components/diff/HighlightThemeSelect/HighlightThemeSelect.tsx";
import { IconButton } from "#/components/ui/IconButton/IconButton.tsx";
import {
	FoldIcon,
	SplitViewIcon,
	UnfoldIcon,
	UnifiedViewIcon,
} from "#/components/ui/icons.tsx";
import styles from "./DiffToolbar.module.css";

export interface DiffToolbarProps {
	/** The file being read, named for the reader. */
	path: string;
	/** Whether the whole file is open, folds and all. */
	expandAll: boolean;
	onExpandAllChange(expandAll: boolean): void;
	/** The old file beside the new one, rather than one after the other. */
	split: boolean;
	onSplitChange(split: boolean): void;
}

/**
 * The bar above the viewer: what is being read, and the controls that change
 * how it is shown.
 *
 * Expand-all is the file's state, not the toolbar's — the viewer remembers it
 * per file (task 12), so the button reports what the file it is over is doing
 * rather than keeping a count of its own clicks.
 */
export function DiffToolbar({
	path,
	expandAll,
	onExpandAllChange,
	split,
	onSplitChange,
}: DiffToolbarProps) {
	return (
		<div className={styles.toolbar} data-testid="diff-toolbar">
			<div className={styles.controls}>
				<IconButton
					aria-label={expandAll ? "Fold all" : "Expand all"}
					aria-pressed={expandAll}
					title={expandAll ? "Fold all" : "Expand all"}
					onClick={() => onExpandAllChange(!expandAll)}
				>
					{expandAll ? (
						<FoldIcon width="16" height="16" />
					) : (
						<UnfoldIcon width="16" height="16" />
					)}
				</IconButton>
				<IconButton
					aria-label={split ? "Switch to unified view" : "Switch to split view"}
					aria-pressed={split}
					title={split ? "Switch to unified view" : "Switch to split view"}
					onClick={() => onSplitChange(!split)}
				>
					{split ? (
						<UnifiedViewIcon width="16" height="16" />
					) : (
						<SplitViewIcon width="16" height="16" />
					)}
				</IconButton>
			</div>
			<h2 className={styles.filename}>{path}</h2>
			<HighlightThemeSelect />
		</div>
	);
}
