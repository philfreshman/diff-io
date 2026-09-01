import { SettingsMenu } from "#/components/diff/SettingsMenu/SettingsMenu.tsx";
import { IconButton } from "#/components/ui/IconButton/IconButton.tsx";
import {
	ArrowDownIcon,
	ArrowLeftIcon,
	ArrowRightIcon,
	ArrowUpIcon,
	CloseIcon,
	FoldIcon,
	SplitViewIcon,
	UnfoldIcon,
	UnifiedViewIcon,
} from "#/components/ui/icons.tsx";
import styles from "./DiffToolbar.module.css";

export interface DiffToolbarProps {
	/** The file being read, or `""` when the comparison has none open. */
	path: string;
	/** Where that file sits in the changed files, and how many there are. */
	fileIndex: number;
	fileCount: number;
	/** The next changed file up (`-1`) or down (`1`) the tree. */
	onStepFile(direction: 1 | -1): void;
	/** Back to the comparison, with no file open. */
	onClose(): void;
	/** Runs of touched lines in the open file — what the arrows step through. */
	differences: number;
	onStepDifference(direction: 1 | -1): void;
	/** Whether the whole file is open, folds and all. */
	expandAll: boolean;
	onExpandAllChange(expandAll: boolean): void;
	/** The old file beside the new one, rather than one after the other. */
	split: boolean;
	onSplitChange(split: boolean): void;
	/** Whether a line that differs only in whitespace counts as a change. */
	ignoreWhitespace: boolean;
	onIgnoreWhitespaceChange(ignore: boolean): void;
}

/**
 * The bar above the viewer: on the left, where the reader is and how they move
 * — through the differences in this file, then through the files themselves;
 * on the right, how what they are reading is shown.
 *
 * It is part of the workspace's frame rather than the file's, so it stands
 * whether or not a file is open (a comparison with nothing chosen still shows
 * it, with its navigation stood down) — the layout does not rearrange itself
 * under the reader on every click.
 *
 * Expand-all is the file's state, not the toolbar's — the viewer remembers it
 * per file (task 12), so the button reports what the file it is over is doing
 * rather than keeping a count of its own clicks.
 */
export function DiffToolbar({
	path,
	fileIndex,
	fileCount,
	onStepFile,
	onClose,
	differences,
	onStepDifference,
	expandAll,
	onExpandAllChange,
	split,
	onSplitChange,
	ignoreWhitespace,
	onIgnoreWhitespaceChange,
}: DiffToolbarProps) {
	const open = path !== "";

	return (
		<div className={styles.toolbar} data-testid="diff-toolbar">
			<div className={styles.group}>
				<IconButton
					aria-label="Previous difference"
					title="Previous difference"
					disabled={!open}
					onClick={() => onStepDifference(-1)}
				>
					<ArrowUpIcon width="16" height="16" />
				</IconButton>
				<IconButton
					aria-label="Next difference"
					title="Next difference"
					disabled={!open}
					onClick={() => onStepDifference(1)}
				>
					<ArrowDownIcon width="16" height="16" />
				</IconButton>
			</div>

			<div className={styles.group}>
				<IconButton
					aria-label="Previous file"
					title="Previous file"
					disabled={fileIndex <= 0}
					onClick={() => onStepFile(-1)}
				>
					<ArrowLeftIcon width="16" height="16" />
				</IconButton>
				{/* The position is stated even with nothing open, so the count of
				    files to read is on screen before the first click. */}
				<span className={styles.counter} data-testid="file-counter">
					{open ? `${fileIndex + 1}/${fileCount}` : fileCount} files
				</span>
				<IconButton
					aria-label="Next file"
					title="Next file"
					disabled={fileIndex < 0 || fileIndex >= fileCount - 1}
					onClick={() => onStepFile(1)}
				>
					<ArrowRightIcon width="16" height="16" />
				</IconButton>
				<IconButton
					aria-label="Close file"
					title="Close file"
					disabled={!open}
					onClick={onClose}
				>
					<CloseIcon width="16" height="16" />
				</IconButton>
			</div>

			<h2 className={styles.filename}>{path}</h2>

			{open && (
				<span className={styles.differences} data-testid="difference-count">
					{differences} {differences === 1 ? "difference" : "differences"}
				</span>
			)}

			<div className={styles.group}>
				<IconButton
					aria-label={expandAll ? "Fold all" : "Expand all"}
					aria-pressed={expandAll}
					title={expandAll ? "Fold all" : "Expand all"}
					disabled={!open}
					onClick={() => onExpandAllChange(!expandAll)}
				>
					{expandAll ? (
						<FoldIcon width="16" height="16" />
					) : (
						<UnfoldIcon width="16" height="16" />
					)}
				</IconButton>
				{/* Two buttons rather than one that swaps: which layout is showing is
				    then readable without working out what the icon would do next. */}
				<IconButton
					aria-label="Switch to split view"
					aria-pressed={split}
					title="Switch to split view"
					onClick={() => onSplitChange(true)}
				>
					<SplitViewIcon width="16" height="16" />
				</IconButton>
				<IconButton
					aria-label="Switch to unified view"
					aria-pressed={!split}
					title="Switch to unified view"
					onClick={() => onSplitChange(false)}
				>
					<UnifiedViewIcon width="16" height="16" />
				</IconButton>
			</div>

			<SettingsMenu
				ignoreWhitespace={ignoreWhitespace}
				onIgnoreWhitespaceChange={onIgnoreWhitespaceChange}
			/>
		</div>
	);
}
