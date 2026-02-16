import type { PackageVersion, SearchResult } from "../../types.ts";
import type { PyPIService } from "../domain/base.ts";

export class PyPIRegistryService implements PyPIService {
	async search(query: string): Promise<SearchResult[]> {
		const res = await fetch(
			`https://diffpack-api.vercel.app/api/search?query=${encodeURIComponent(query)}`,
		);

		if (!res.ok) return [];
		return res.json();
	}

	async getVersions(name: string): Promise<string[]> {
		const res = await fetch(
			`https://api.deps.dev/v3/systems/pypi/packages/${name}`,
		);

		if (!res.ok) throw new Error(`Failed to fetch versions for ${name}`);
		const data = await res.json();
		return data.versions.map((v: any) => v.versionKey.version).reverse();
	}

	async getVersion(name: string, version: string): Promise<PackageVersion> {
		const res = await fetch(`https://pypi.org/pypi/${name}/${version}/json`);
		if (!res.ok)
			throw new Error(`Failed to fetch version ${version} for ${name}`);
		const data = await res.json();
		return {
			name,
			version: data.info.version,
		};
	}

	async getTarball(name: string, version: string): Promise<ArrayBuffer> {
		const res = await fetch(`https://pypi.org/pypi/${name}/${version}/json`);
		if (!res.ok)
			throw new Error(`Failed to fetch metadata for ${name} v${version}`);
		const data = await res.json();

		interface PyPIUrl {
			url: string;
			packagetype: string;
		}

		// Find the source distribution (sdist)
		const sdist = data.urls.find((url: PyPIUrl) => url.packagetype === "sdist");
		if (!sdist)
			throw new Error(`No source distribution found for ${name} v${version}`);

		const tarballRes = await fetch(sdist.url);
		if (!tarballRes.ok)
			throw new Error(`Failed to fetch tarball from ${sdist.url}`);
		return tarballRes.arrayBuffer();
	}
	getDownloadUrl(name: string, version: string): string {
		const firstChar = name.charAt(0);
		return `https://files.pythonhosted.org/packages/source/${firstChar}/${name}/${name}-${version}.tar.gz`;
	}
}

export const pypiService = new PyPIRegistryService();
