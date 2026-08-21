import { getJson } from "./http.ts";
import { singleSegmentPath } from "./singleSegmentPath.ts";
import type { Fetcher, RegistryAdapter } from "./types.ts";

const API_URL = "https://crates.io/api/v1/crates";

export function createCratesAdapter(fetcher: Fetcher = fetch): RegistryAdapter {
	return {
		id: "crates",
		label: "crates.io",
		tagline: "Rust ecosystem packages",
		capabilities: { discoverySearch: true },
		packagePath: singleSegmentPath,

		async search(query, signal) {
			const data = await getJson<{
				crates: { name: string; max_version?: string; description?: string }[];
			}>(
				fetcher,
				`${API_URL}?q=${encodeURIComponent(query)}&per_page=10`,
				signal,
				`crates: search for ${query} failed`,
			);

			return data.crates.map((crate) => ({
				name: crate.name,
				version: crate.max_version,
				description: crate.description,
			}));
		},

		async versions(name, signal) {
			const data = await getJson<{ versions: { num: string }[] }>(
				fetcher,
				`${API_URL}/${encodeURIComponent(name)}`,
				signal,
				`crates: no versions for ${name}`,
			);

			// crates.io already returns newest first.
			return data.versions.map((version) => version.num);
		},

		downloadUrl(name, version) {
			return `https://static.crates.io/crates/${name}/${name}-${version}.crate`;
		},
	};
}

export const cratesAdapter = createCratesAdapter();
