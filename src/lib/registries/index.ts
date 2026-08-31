import { cratesAdapter } from "./crates.ts";
import { goAdapter } from "./go.ts";
import { npmAdapter } from "./npm.ts";
import { pypiAdapter } from "./pypi.ts";
import type { RegistryAdapter, RegistryId } from "./types.ts";

/** Landing-page order. */
export const registryAdapters: RegistryAdapter[] = [
	npmAdapter,
	cratesAdapter,
	goAdapter,
	pypiAdapter,
];

const byId = new Map<string, RegistryAdapter>(
	registryAdapters.map((adapter) => [adapter.id, adapter]),
);

export function isRegistryId(segment: string): segment is RegistryId {
	return byId.has(segment);
}

export function getAdapter(segment: string): RegistryAdapter | undefined {
	return byId.get(segment);
}

/**
 * The adapter for a segment something upstream has already validated — the
 * route that owns the `$registry` param turns an unknown one into a 404 before
 * any loader runs, so reaching here without an adapter is a bug, not input.
 */
export function requireAdapter(segment: string): RegistryAdapter {
	const adapter = byId.get(segment);
	if (!adapter) throw new Error(`unknown registry: ${segment}`);

	return adapter;
}
