import { useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { CloseIcon, SearchIcon } from "#/components/ui/icons.tsx";
import { IconButton } from "#/components/ui/IconButton/IconButton.tsx";
import { Combobox } from "#/components/ui/Combobox/Combobox.tsx";
import { Spinner } from "#/components/ui/Spinner/Spinner.tsx";
import type { RegistryAdapter, SearchResult } from "#/lib/registries/types.ts";
import {
	addToHistory,
	readHistory,
	writeHistory,
} from "#/lib/storage/searchHistory.ts";
import { buildPath } from "#/lib/url/slug.ts";
import { usePackageSearch } from "./usePackageSearch.ts";
import styles from "./PackageCombobox.module.css";

export interface PackageComboboxProps {
	adapter: RegistryAdapter;
	/** The package the URL names — the field's value, not a suggestion. */
	selected: string;
}

/**
 * Search for a package, or type its name out in full. Choosing one writes the
 * URL: the selection is the address, so back/forward and a shared link mean the
 * same thing (§4.3, URL tier).
 */
export function PackageCombobox({ adapter, selected }: PackageComboboxProps) {
	const navigate = useNavigate();
	const [inputValue, setInputValue] = useState(selected);
	const [history, setHistory] = useState<SearchResult[]>([]);

	// The URL can change without this field: back/forward, or a link elsewhere in
	// the app. Whatever the address says is what the input shows.
	useEffect(() => setInputValue(selected), [selected]);

	// `localStorage` is invisible to the server, so history arrives after mount.
	// Until then the list is empty rather than wrong.
	useEffect(() => setHistory(readHistory(adapter.id)), [adapter.id]);

	const { results, loading, searching } = usePackageSearch(adapter, inputValue);
	// An empty field offers where the user has been; a typed one, what the
	// registry answered.
	const items = searching ? results : history;

	function choose(name: string) {
		const trimmed = name.trim();
		if (!trimmed) return;

		const entry = results.find((result) => result.name === trimmed) ?? {
			name: trimmed,
		};
		const next = addToHistory(history, entry);
		setHistory(next);
		writeHistory(adapter.id, next);

		setInputValue(trimmed);
		// A new package invalidates the versions and the file that were in the URL.
		navigate({ to: buildPath(adapter, { package: trimmed }) });
	}

	function reset() {
		setInputValue("");
		navigate({ to: buildPath(adapter, {}) });
	}

	// Three states, one slot: a package is locked in, the registry is answering,
	// or the field is waiting to be typed in. An open popup makes the rest of the
	// document inert (Base UI's answer to outside clicks), so the slot carries a
	// test id — inside that subtree there is no accessible role to find it by.
	const state = selected ? "selected" : loading ? "searching" : "idle";

	const trailing = (
		<span data-testid="package-search-state" data-state={state}>
			{state === "selected" ? (
				<IconButton
					aria-label="Clear the selected package"
					className={styles.reset}
					onClick={reset}
				>
					<CloseIcon />
				</IconButton>
			) : state === "searching" ? (
				<Spinner label="Searching packages" />
			) : (
				<SearchIcon />
			)}
		</span>
	);

	return (
		<div className={styles.field}>
			<span className={styles.label}>Package Name</span>
			<Combobox
				label="Package Name"
				items={items}
				inputValue={inputValue}
				onInputValueChange={setInputValue}
				onSelect={(item) => choose(item.name)}
				// Enter with nothing highlighted takes the text as typed. It is the
				// only way to reach a Go module, whose search resolves one exact path.
				onSubmitText={choose}
				itemToText={(item) => item.name}
				renderItem={(item) => (
					<>
						<strong className={styles.name}>{item.name}</strong>
						{item.description ? (
							<span className={styles.description}>{item.description}</span>
						) : null}
					</>
				)}
				// The registry already answered the query; filtering again locally
				// would hide results whose name does not contain what was typed.
				filter={null}
				loading={loading}
				loadingMessage="Searching…"
				// Go has no discovery search, so an empty list is not a miss — it is
				// the field telling the user what it can actually resolve.
				emptyMessage={
					adapter.capabilities.searchHint ??
					(searching ? "No packages found" : "Type to search")
				}
				placeholder={adapter.capabilities.searchPlaceholder}
				trailing={trailing}
			/>
		</div>
	);
}
