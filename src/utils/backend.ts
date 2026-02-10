import { z } from "astro/zod";
import { type SearchResult, SearchResultSchema } from "../registries/types.ts";

const API_URL = import.meta.env.PUBLIC_API_URL;

export const backend = {
	ping: async () => {
		const response = await fetch(`${API_URL}/api/ping`);
		return response.text();
	},

	search: async (query: string): Promise<SearchResult[]> => {
		const SearchResponseSchema = z.array(SearchResultSchema);

		const response = await fetch(
			`${API_URL}/api/search?query=${encodeURIComponent(query)}`,
		);

		if (!response.ok) {
			throw new Error(`Search failed: ${response.status}`);
		}

		const data = await response.json();

		return SearchResponseSchema.parse(data);
	},

	baseURL: API_URL,
};
