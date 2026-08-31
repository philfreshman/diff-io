import { IconButton } from "#/components/ui/IconButton/IconButton.tsx";
import { FilterIcon, SearchIcon } from "#/components/ui/icons.tsx";
import styles from "./TreeFilter.module.css";

export interface TreeFilterProps {
	filter: string;
	onFilterChange(filter: string): void;
	onlyModified: boolean;
	onOnlyModifiedChange(onlyModified: boolean): void;
}

/**
 * The two controls above the tree. Both narrow it, and neither is a search:
 * the tree is already here, so typing hides rows rather than fetching any.
 */
export function TreeFilter({
	filter,
	onFilterChange,
	onlyModified,
	onOnlyModifiedChange,
}: TreeFilterProps) {
	return (
		<div className={styles.controls}>
			<div className={styles.field}>
				<SearchIcon className={styles.searchIcon} width="16" height="16" />
				<input
					type="search"
					className={styles.input}
					aria-label="Filter files and folders"
					placeholder="Filter files and folders..."
					value={filter}
					onChange={(event) => onFilterChange(event.target.value)}
				/>
			</div>
			<IconButton
				aria-label="Show only modified files"
				aria-pressed={onlyModified}
				title="Toggle show only modified files"
				className={styles.toggle}
				onClick={() => onOnlyModifiedChange(!onlyModified)}
			>
				<FilterIcon width="16" height="16" />
			</IconButton>
		</div>
	);
}
