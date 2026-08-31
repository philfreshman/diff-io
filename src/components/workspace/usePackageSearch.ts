import { useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import type { RegistryAdapter, SearchResult } from "#/lib/registries/types.ts";

/** A single character matches most of a registry; two is where results mean something. */
export const MIN_QUERY_LENGTH = 2;

/** Long enough that a typed word is one request, short enough to feel live. */
export const SEARCH_DEBOUNCE_MS = 300;

export function useDebouncedValue<T>(value: T, delay: number): T {
	const [debounced, setDebounced] = useState(value);

	useEffect(() => {
		const timer = setTimeout(() => setDebounced(value), delay);
		return () => clearTimeout(timer);
	}, [value, delay]);

	return debounced;
}

export interface PackageSearch {
	results: SearchResult[];
	/** True while the query the user can see is still being answered. */
	loading: boolean;
	/** False while below the minimum length, or while the debounce is pending. */
	searching: boolean;
}

/**
 * Debounce, cancellation of the superseded request, caching and the loading
 * flag are all Query's — the old app hand-rolled every one of them around an
 * `AbortController` per keystroke.
 */
export function usePackageSearch(
	adapter: RegistryAdapter,
	query: string,
): PackageSearch {
	const trimmed = query.trim();
	const debounced = useDebouncedValue(trimmed, SEARCH_DEBOUNCE_MS);
	const enabled = debounced.length >= MIN_QUERY_LENGTH;

	const { data, isFetching } = useQuery({
		queryKey: ["search", adapter.id, debounced],
		queryFn: ({ signal }) => adapter.search(debounced, signal),
		enabled,
	});

	// Between the keystroke and the debounce firing there is no request yet, but
	// the field is not idle either: showing the previous query's results as if
	// they answered this one is the bug the spinner exists to prevent.
	const pending = trimmed !== debounced && trimmed.length >= MIN_QUERY_LENGTH;

	return {
		results: enabled ? (data ?? []) : [],
		loading: pending || (enabled && isFetching),
		searching: enabled || pending,
	};
}
