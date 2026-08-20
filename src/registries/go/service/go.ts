import type { PackageVersion, SearchResult } from "../../types.ts";
import type { GoService } from "../domain/base.ts";

const PROXY_URL = "https://proxy.golang.org";

/**
 * The module proxy serves lower-cased paths, escaping every uppercase letter as
 * "!" followed by its lowercase form, so `Masterminds` becomes `!masterminds`.
 * Requesting the unescaped path is a 404.
 */
function escapeModulePath(name: string): string {
	return name.replace(/[A-Z]/g, (char) => `!${char.toLowerCase()}`);
}

function parseVersion(version: string): { numbers: number[]; suffix: string } {
	const [core, ...suffix] = version.replace(/^v/, "").split("+")[0].split("-");

	return {
		numbers: core.split(".").map((part) => Number.parseInt(part, 10) || 0),
		suffix: suffix.join("-"),
	};
}

/** Newest first, matching the order the other registries hand back. */
function compareVersionsDesc(a: string, b: string): number {
	const left = parseVersion(a);
	const right = parseVersion(b);

	for (let i = 0; i < 3; i++) {
		const diff = (right.numbers[i] ?? 0) - (left.numbers[i] ?? 0);
		if (diff !== 0) return diff;
	}

	// A release outranks any pre-release of the same version.
	if (left.suffix === right.suffix) return 0;
	if (!left.suffix) return -1;
	if (!right.suffix) return 1;
	return right.suffix.localeCompare(left.suffix);
}

/**
 * Go has no search API reachable from the browser: the proxy exposes none, and
 * pkg.go.dev sends no CORS headers. The one thing resolvable client-side is a
 * module path the user typed out in full, so that is what search accepts.
 */
function looksLikeModulePath(query: string): boolean {
	const [host] = query.split("/");
	return query.includes("/") && host.includes(".");
}

export class GoProxyService implements GoService {
	async search(query: string): Promise<SearchResult[]> {
		const name = query
			.trim()
			.replace(/^https?:\/\//, "")
			.replace(/\/+$/, "");

		if (!looksLikeModulePath(name)) return [];

		try {
			const versions = await this.getVersions(name);
			if (versions.length === 0) return [];

			return [
				{
					name,
					version: versions[0],
					description: `Go module — ${versions.length} version${versions.length === 1 ? "" : "s"}`,
				},
			];
		} catch {
			// An unresolvable path is an ordinary miss while the user is still typing.
			return [];
		}
	}

	async getVersions(name: string): Promise<string[]> {
		const res = await fetch(`${PROXY_URL}/${escapeModulePath(name)}/@v/list`);
		if (!res.ok) throw new Error("Failed to fetch versions");

		const versions = (await res.text())
			.split("\n")
			.map((line) => line.trim())
			.filter(Boolean);

		// The list is unordered, and modules that were never tagged list nothing at
		// all — the proxy still resolves a pseudo-version for the default branch.
		if (versions.length === 0) {
			const latest = await this.getLatestVersion(name);
			return latest ? [latest] : [];
		}

		return versions.sort(compareVersionsDesc);
	}

	async getVersion(name: string, version: string): Promise<PackageVersion> {
		return { name, version };
	}

	async getZip(name: string, version: string): Promise<ArrayBuffer> {
		const url = this.getDownloadUrl(name, version);
		const res = await fetch(url);
		if (!res.ok) throw new Error(`Failed to fetch module zip from ${url}`);
		return res.arrayBuffer();
	}

	getDownloadUrl(name: string, version: string): string {
		return `${PROXY_URL}/${escapeModulePath(name)}/@v/${version}.zip`;
	}

	private async getLatestVersion(name: string): Promise<string | null> {
		const res = await fetch(`${PROXY_URL}/${escapeModulePath(name)}/@latest`);
		if (!res.ok) return null;

		const data = await res.json();
		return typeof data.Version === "string" ? data.Version : null;
	}
}

export const goService = new GoProxyService();
