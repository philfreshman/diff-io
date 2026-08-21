import { QueryClient } from "@tanstack/react-query";

/**
 * Registry search and version lists are the only server state in the app, and
 * both are immutable-ish public data: a package's version list changes when
 * someone publishes, not while the user is typing. Five minutes of freshness
 * makes revisiting a package instant and keeps the registries unbothered.
 *
 * One client per browser session; the server renders no query, so nothing is
 * dehydrated across the wire.
 */
export function createQueryClient(): QueryClient {
	return new QueryClient({
		defaultOptions: {
			queries: {
				staleTime: 5 * 60_000,
				gcTime: 30 * 60_000,
				retry: 1,
				refetchOnWindowFocus: false,
			},
		},
	});
}
