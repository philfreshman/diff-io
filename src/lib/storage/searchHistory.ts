import type { RegistryId, SearchResult } from "#/lib/registries/types.ts";

/**
 * Per-registry recent picks, shown when the search field is focused and empty.
 * The key and the cap are a contract with existing users: the old app wrote
 * `search_history_npm` and kept ten entries, and their history should survive
 * the rebuild.
 */
export const HISTORY_LIMIT = 10;

export function historyKey(registry: RegistryId): string {
	return `search_history_${registry}`;
}

function isResult(value: unknown): value is SearchResult {
	return (
		typeof value === "object" &&
		value !== null &&
		typeof (value as SearchResult).name === "string"
	);
}

/**
 * What is in storage is whatever a previous version of the app — or the user
 * with devtools open — put there, so nothing about its shape is assumed.
 */
export function parseHistory(raw: string | null): SearchResult[] {
	if (!raw) return [];

	try {
		const parsed: unknown = JSON.parse(raw);
		if (!Array.isArray(parsed)) return [];
		return parsed.filter(isResult).slice(0, HISTORY_LIMIT);
	} catch {
		return [];
	}
}

/** Most recent first, one entry per package, capped. */
export function addToHistory(
	history: readonly SearchResult[],
	result: SearchResult,
): SearchResult[] {
	const rest = history.filter((entry) => entry.name !== result.name);
	return [result, ...rest].slice(0, HISTORY_LIMIT);
}

/**
 * `localStorage` is absent on the server and can throw in a private-mode
 * browser; a missing history is never a reason to fail a render.
 */
function storage(): Storage | null {
	try {
		return globalThis.localStorage ?? null;
	} catch {
		return null;
	}
}

export function readHistory(registry: RegistryId): SearchResult[] {
	return parseHistory(storage()?.getItem(historyKey(registry)) ?? null);
}

export function writeHistory(
	registry: RegistryId,
	history: readonly SearchResult[],
): void {
	try {
		storage()?.setItem(historyKey(registry), JSON.stringify(history));
	} catch {
		// Quota or a disabled store: history is a convenience, not state we own.
	}
}
