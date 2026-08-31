export type RegistryId = "npm" | "crates" | "go" | "pypi";

export interface SearchResult {
	name: string;
	version?: string;
	description?: string;
}

/** How a registry's package name maps to URL path segments. */
export interface PackagePath {
	/** Splits `<package…>/<from>/<to>/<file…>` into the name and everything after it. */
	parse(segments: string[]): { name: string; rest: string[] };
	/** The inverse: the segments a package name occupies in a URL. */
	toSegments(name: string): string[];
}

/** The one system boundary in this layer: injected so adapters stay testable. */
export type Fetcher = (
	input: string | URL | Request,
	init?: RequestInit,
) => Promise<Response>;

export interface RegistryCapabilities {
	/** Go: false — no CORS-reachable search API exists. */
	discoverySearch: boolean;
	/** What the empty search field invites, in this ecosystem's own words. */
	searchPlaceholder: string;
	/** What the user must type when discovery search is unavailable. */
	searchHint?: string;
}

export interface RegistryAdapter {
	id: RegistryId;
	/** Display name: "crates.io", "Go". */
	label: string;
	/** The ecosystem it serves, as the landing tile says it. */
	tagline: string;
	capabilities: RegistryCapabilities;
	packagePath: PackagePath;
	/** Packages matching what the user typed. */
	search(query: string, signal?: AbortSignal): Promise<SearchResult[]>;
	/** Every version of a package, newest first. */
	versions(name: string, signal?: AbortSignal): Promise<string[]>;
	/** Direct link to the archive this registry serves for a version. */
	downloadUrl(name: string, version: string): string;
}
