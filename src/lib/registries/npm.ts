import { getJson } from "./http.ts";
import type { Fetcher, RegistryAdapter } from "./types.ts";

const REGISTRY_URL = "https://registry.npmjs.org";

export function createNpmAdapter(fetcher: Fetcher = fetch): RegistryAdapter {
	return {
		id: "npm",
		label: "npm",
		tagline: "JavaScript & TypeScript packages",
		capabilities: { discoverySearch: true, searchPlaceholder: "Search npm…" },
		packagePath: {
			parse(segments) {
				// A scoped name spans two segments: "@types" and "node".
				const width = segments[0]?.startsWith("@") ? 2 : 1;

				return {
					name: segments.slice(0, width).join("/"),
					rest: segments.slice(width),
				};
			},

			toSegments(name) {
				return name.split("/").filter(Boolean);
			},
		},

		async search(query, signal) {
			const data = await getJson<{
				objects: {
					package: { name: string; version?: string; description?: string };
				}[];
			}>(
				fetcher,
				`${REGISTRY_URL}/-/v1/search?text=${encodeURIComponent(query)}&size=10`,
				signal,
				`npm: search for ${query} failed`,
			);

			return data.objects.map((object) => ({
				name: object.package.name,
				version: object.package.version,
				description: object.package.description,
			}));
		},

		async versions(name, signal) {
			const data = await getJson<{ versions: Record<string, unknown> }>(
				fetcher,
				`${REGISTRY_URL}/${encodeURIComponent(name)}`,
				signal,
				`npm: no versions for ${name}`,
			);

			// npm lists versions oldest-first; every selector wants newest-first.
			return Object.keys(data.versions).reverse();
		},

		downloadUrl(name, version) {
			// The tarball is named after the unscoped part: @types/node -> node-26.7.0.tgz
			const unscoped = name.split("/").at(-1);
			return `${REGISTRY_URL}/${name}/-/${unscoped}-${version}.tgz`;
		},
	};
}

export const npmAdapter = createNpmAdapter();
