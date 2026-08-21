import { useQuery } from "@tanstack/react-query";
import type { RegistryAdapter } from "#/lib/registries/types.ts";

/** One array, so `list` keeps its identity between renders and effects that
    depend on it do not fire on every one. */
const NONE: string[] = [];

export interface Versions {
	/** Newest first, as every adapter promises. Empty until the list arrives. */
	list: string[];
	loading: boolean;
	/** The registry answered, but not with a version list. */
	error: Error | null;
}

/**
 * Every version of the package the URL names. Keyed by registry and package, so
 * walking back to a package looked at a minute ago costs nothing, and the
 * request for a package that is no longer selected is cancelled by Query rather
 * than by an `AbortController` this component would have to own.
 */
export function useVersions(
	adapter: RegistryAdapter,
	packageName: string,
): Versions {
	const name = packageName.trim();

	const { data, isFetching, error } = useQuery({
		queryKey: ["versions", adapter.id, name],
		queryFn: ({ signal }) => adapter.versions(name, signal),
		enabled: name.length > 0,
	});

	return {
		list: data ?? NONE,
		loading: name.length > 0 && isFetching,
		error: error as Error | null,
	};
}
