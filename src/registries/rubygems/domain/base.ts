import type { PackageVersion, SearchResult } from "../../types.ts";

export interface RubyGemsService {
	search(query: string): Promise<SearchResult[]>;
	getVersions(name: string): Promise<string[]>;
	getVersion(name: string, version: string): Promise<PackageVersion>;
	getTarball(name: string, version: string): Promise<ArrayBuffer>;
	getDownloadUrl(name: string, version: string): string;
}
