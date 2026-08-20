import type { PackageVersion, SearchResult } from "../../types.ts";

export interface GoService {
	search(query: string): Promise<SearchResult[]>;
	getVersions(name: string): Promise<string[]>;
	getVersion(name: string, version: string): Promise<PackageVersion>;
	getZip(name: string, version: string): Promise<ArrayBuffer>;
	getDownloadUrl(name: string, version: string): string;
}
