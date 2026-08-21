import { useEffect, useState } from "react";
import { Combobox } from "#/components/ui/Combobox/Combobox.tsx";
import { DownloadIcon } from "#/components/ui/icons.tsx";
import styles from "./VersionCombobox.module.css";

export interface VersionComboboxProps {
	/** "From Version" / "To Version" — also the field's accessible name. */
	label: string;
	/** Newest first. Empty while the list is on its way, or after it failed. */
	versions: readonly string[];
	/** The version this field stands for; always one the caller chose. */
	value: string;
	onChange(version: string): void;
	loading?: boolean;
	/** The registry archive for `value`, if there is a version to download. */
	downloadUrl?: string;
}

/**
 * One version, chosen from the list the registry gave us. Typing filters that
 * list and nothing more: unlike package search there is no version the registry
 * did not tell us about, so Enter on nothing highlighted means nothing here and
 * `onSubmitText` is left out.
 */
export function VersionCombobox({
	label,
	versions,
	value,
	onChange,
	loading = false,
	downloadUrl,
}: VersionComboboxProps) {
	// The input doubles as the filter, so mid-typing it says something that is
	// not the selection. That text is transient — it lasts until the list closes.
	const [inputValue, setInputValue] = useState(value);

	useEffect(() => setInputValue(value), [value]);

	return (
		<div className={styles.field}>
			<span className={styles.labelRow}>
				<span className={styles.label}>{label}</span>
				{downloadUrl ? (
					<a
						className={styles.download}
						href={downloadUrl}
						aria-label={`Download ${value}`}
						title="Download package"
						rel="noopener noreferrer"
					>
						<DownloadIcon width="14" height="14" />
					</a>
				) : null}
			</span>
			<Combobox
				label={label}
				items={versions}
				inputValue={inputValue}
				onInputValueChange={setInputValue}
				onSelect={onChange}
				itemToText={(version) => version}
				// A closed list is the end of filtering: whatever was typed goes back
				// to being the selected version, so the field never disagrees with
				// what Compare would actually run.
				onOpenChange={(open) => {
					if (!open) setInputValue(value);
				}}
				// Opening the list must show the whole list: the input already holds
				// the selected version, and filtering by it would offer the user the
				// one version they cannot usefully choose. Anything else typed is a
				// filter and behaves like one.
				filter={(version, query) =>
					query === value || version.toLowerCase().includes(query.toLowerCase())
				}
				loading={loading}
				loadingMessage="Loading versions…"
				emptyMessage={versions.length ? "No matching versions" : "No versions"}
				placeholder={loading ? "Loading…" : "Select version"}
				// Nothing to choose from and nothing to filter: the field is dead
				// weight until a package has been named.
				disabled={!loading && versions.length === 0}
			/>
		</div>
	);
}
