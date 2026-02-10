import { z } from "astro/zod";

export interface PackageRegistry {
	search(query: string): Promise<SearchResult[]>;
	getVersions(name: string): Promise<string[]>;
	getVersion(name: string, version: string): Promise<PackageVersion>;
	getPackage(name: string, version: string): Promise<ArrayBuffer>;
	getDownloadUrl(name: string, version: string): string;
}

export const SearchResultSchema = z.object({
	name: z.string(),
	description: z.string().optional(),
	version: z.string().optional(),
});

export type SearchResult = z.infer<typeof SearchResultSchema>;

export type PackageVersion = {
	name: string;
	version: string;
	files?: Record<string, string>;
};
