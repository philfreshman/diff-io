import { z } from "zod";
import { getJson } from "./http.ts";
import { singleSegmentPath } from "./singleSegmentPath.ts";
import type { Fetcher, RegistryAdapter } from "./types.ts";

const BACKEND_URL = "https://api.diffpack.io";
const DEPS_DEV_URL = "https://api.deps.dev/v3/systems/pypi/packages";

/**
 * PyPI has no CORS-reachable search API, so search goes through diffpack's own
 * backend (a separate service). Its payload is validated because the contract
 * lives outside this repo.
 */
const SearchResponse = z.array(
	z.object({
		name: z.string(),
		version: z.string().optional(),
		description: z.string().optional(),
	}),
);

export function createPypiAdapter(fetcher: Fetcher = fetch): RegistryAdapter {
	return {
		id: "pypi",
		label: "PyPI",
		tagline: "Python packages",
		capabilities: { discoverySearch: true, searchPlaceholder: "Search PyPI…" },
		packagePath: singleSegmentPath,

		async search(query, signal) {
			const params = new URLSearchParams({ package: query, registry: "pypi" });
			const payload = await getJson(
				fetcher,
				`${BACKEND_URL}/api/search?${params}`,
				signal,
				`pypi: search for ${query} failed`,
			);

			return SearchResponse.parse(payload);
		},

		async versions(name, signal) {
			const data = await getJson<{
				versions: { versionKey: { version: string } }[];
			}>(
				fetcher,
				`${DEPS_DEV_URL}/${encodeURIComponent(name)}`,
				signal,
				`pypi: no versions for ${name}`,
			);

			// deps.dev lists oldest first.
			return data.versions.map((v) => v.versionKey.version).reverse();
		},

		downloadUrl(name, version) {
			// PyPI shards source archives by the package's first letter.
			const shard = name.charAt(0);
			return `https://files.pythonhosted.org/packages/source/${shard}/${name}/${name}-${version}.tar.gz`;
		},
	};
}

export const pypiAdapter = createPypiAdapter();
