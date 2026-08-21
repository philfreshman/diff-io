import { getText } from "./http.ts";
import type { Fetcher, RegistryAdapter } from "./types.ts";

const PROXY_URL = "https://proxy.golang.org";

/**
 * Go module versions are always semver with a "v" prefix. The "/v2" major
 * version suffix a module path may end with is not one — it has no dotted
 * components — so this tells `github.com/go-chi/chi/v5` apart from `v5.3.1`.
 */
const MODULE_VERSION = /^v\d+\.\d+\.\d+/;

/**
 * The module proxy serves lower-cased paths, escaping every uppercase letter as
 * "!" followed by its lowercase form, so `Masterminds` becomes `!masterminds`.
 * Requesting the unescaped path is a 404.
 */
function escapeModulePath(name: string): string {
	return name.replace(/[A-Z]/g, (char) => `!${char.toLowerCase()}`);
}

function parseVersion(version: string): { numbers: number[]; suffix: string } {
	// Build metadata ("+incompatible") plays no part in ordering.
	const [withoutBuild = ""] = version.replace(/^v/, "").split("+");
	const [core = "", ...suffix] = withoutBuild.split("-");

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
	const [host = ""] = query.split("/");
	return query.includes("/") && host.includes(".");
}

export function createGoAdapter(fetcher: Fetcher = fetch): RegistryAdapter {
	async function listVersions(
		name: string,
		signal?: AbortSignal,
	): Promise<string[]> {
		const list = await getText(
			fetcher,
			`${PROXY_URL}/${escapeModulePath(name)}/@v/list`,
			signal,
			`go: no versions for ${name}`,
		);

		const versions = list
			.split("\n")
			.map((line) => line.trim())
			.filter(Boolean);

		// A module that was never tagged lists nothing at all — the proxy still
		// resolves a pseudo-version for its default branch.
		if (versions.length === 0) {
			const latest = await latestVersion(name, signal);
			return latest ? [latest] : [];
		}

		return versions.sort(compareVersionsDesc);
	}

	async function latestVersion(
		name: string,
		signal?: AbortSignal,
	): Promise<string | null> {
		const res = await fetcher(
			`${PROXY_URL}/${escapeModulePath(name)}/@latest`,
			{ signal },
		);
		if (!res.ok) return null;

		const data = (await res.json()) as { Version?: unknown };
		return typeof data.Version === "string" ? data.Version : null;
	}

	return {
		id: "go",
		label: "Go",
		tagline: "Go modules & standard ecosystem",
		capabilities: {
			discoverySearch: false,
			searchHint: "Type a full module path, e.g. github.com/go-chi/chi/v5",
		},
		packagePath: {
			parse(segments) {
				const versionIndex = segments.findIndex((segment) =>
					MODULE_VERSION.test(segment),
				);
				const nameEnd = versionIndex === -1 ? segments.length : versionIndex;

				return {
					name: segments.slice(0, nameEnd).join("/"),
					rest: segments.slice(nameEnd),
				};
			},

			toSegments(name) {
				return name.split("/").filter(Boolean);
			},
		},

		async search(query, signal) {
			const name = query
				.trim()
				.replace(/^https?:\/\//, "")
				.replace(/\/+$/, "");

			if (!looksLikeModulePath(name)) return [];

			try {
				const versions = await listVersions(name, signal);
				if (versions.length === 0) return [];

				return [
					{
						name,
						version: versions[0],
						description: `Go module — ${versions.length} version${versions.length === 1 ? "" : "s"}`,
					},
				];
			} catch (error) {
				// A cancelled keystroke is not a miss — only the caller can tell those apart.
				if (signal?.aborted) throw error;
				// An unresolvable path is an ordinary miss while the user is still typing.
				return [];
			}
		},

		async versions(name, signal) {
			return listVersions(name, signal);
		},

		downloadUrl(name, version) {
			return `${PROXY_URL}/${escapeModulePath(name)}/@v/${version}.zip`;
		},
	};
}

export const goAdapter = createGoAdapter();
