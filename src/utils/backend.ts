import { z } from "astro/zod";
import { type SearchResult, SearchResultSchema } from "../registries/types.ts";

const API_URL = import.meta.env.PUBLIC_API_URL;

console.log("API_URL", API_URL);

export const backend = {
	ping: async () => {
		const response = await fetch(`${API_URL}/api/ping`);
		return response.text();
	},

	search: async (
		packageName: string,
		registry: string,
	): Promise<SearchResult[]> => {
		const SearchResponseSchema = z.array(SearchResultSchema);

		const params = new URLSearchParams({
			package: packageName,
			registry: registry,
		});

		const response = await fetch(`${API_URL}/api/search?${params.toString()}`);

		if (!response.ok) {
			throw new Error(`Search failed: ${response.status}`);
		}

		const data = await response.json();
		return SearchResponseSchema.parse(data);
	},

	download: async (packageName: string, registry: string, version: string) => {
		const queryParams = new URLSearchParams({
			package: packageName,
			version: version,
			registry: registry,
		});

		const url = `${API_URL}/api/download?${queryParams.toString()}`;

		window.location.assign(url);
	},

	baseURL: API_URL,
};
