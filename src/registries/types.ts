export interface PackageRegistry {
	search(query: string): Promise<SearchResult[]>;
	getVersions(name: string): Promise<string[]>;
	getVersion(name: string, version: string): Promise<PackageVersion>;
	getPackage(name: string, version: string): Promise<ArrayBuffer>;
	getDownloadUrl(name: string, version: string): string;
}

export type SearchResult = {
	name: string;
	description?: string;
	version?: string;
};

export type PackageVersion = {
	name: string;
	version: string;
	files?: Record<string, string>;
};
