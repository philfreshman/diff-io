import type { PackageVersion, SearchResult } from "../../types.ts";
import type { CratesService } from "../domain/base.ts";

export class CratesRegistryService implements CratesService {
	async search(query: string): Promise<SearchResult[]> {
		const res = await fetch(
			`https://crates.io/api/v1/crates?q=${encodeURIComponent(query)}&per_page=10`,
		);
		const data = await res.json();

		interface CrateSearchItem {
			name: string;
			max_version: string;
			description: string;
		}

		return data.crates.map((item: CrateSearchItem) => ({
			name: item.name,
			version: item.max_version,
			description: item.description,
		}));
	}

	async getVersions(name: string): Promise<string[]> {
		const res = await fetch(
			`https://crates.io/api/v1/crates/${encodeURIComponent(name)}`,
		);
		if (!res.ok) throw new Error("Failed to fetch versions");
		const data = await res.json();
		interface CrateVersion {
			num: string;
		}
		return data.versions.map((v: CrateVersion) => v.num);
	}

	async getVersion(name: string, version: string): Promise<PackageVersion> {
		const res = await fetch(
			`https://crates.io/api/v1/crates/${encodeURIComponent(name)}/${version}`,
		);
		const data = await res.json();
		return {
			name,
			version: data.version.num,
		};
	}

	async getTarball(name: string, version: string): Promise<ArrayBuffer> {
		const url = this.getDownloadUrl(name, version);
		const res = await fetch(url);
		if (!res.ok) throw new Error(`Failed to fetch tarball from ${url}`);
		return res.arrayBuffer();
	}

	getDownloadUrl(name: string, version: string): string {
		// Crates tarballs are at https://static.crates.io/crates/pkg/pkg-version.crate
		return `https://static.crates.io/crates/${name}/${name}-${version}.crate`;
	}
}

export const cratesService = new CratesRegistryService();
