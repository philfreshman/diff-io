import { backend } from "../../../utils/backend.ts";
import type { PackageVersion, SearchResult } from "../../types.ts";
import type { RubyGemsService } from "../domain/base.ts";

export class RubyGemsRegistryService implements RubyGemsService {
	async search(packageName: string): Promise<SearchResult[]> {
		return backend.search(packageName, "rubygems");
	}

	async getVersions(name: string): Promise<string[]> {
		const res = await fetch(
			`https://api.deps.dev/v3/systems/RUBYGEMS/packages/${name}`,
		);

		if (!res.ok) throw new Error(`Failed to fetch versions for ${name}`);
		const data = await res.json();
		return data.versions.map((v: any) => v.versionKey.version).reverse();
	}

	async getVersion(name: string, version: string): Promise<PackageVersion> {
		const res = await fetch(
			`https://rubygems.org/api/v1/gems/${encodeURIComponent(name)}/versions/${encodeURIComponent(version)}.json`,
		);
		if (!res.ok)
			throw new Error(`Failed to fetch version ${version} for ${name}`);
		const data = await res.json();
		return {
			name,
			version: data.number,
		};
	}

	async getTarball(name: string, version: string): Promise<ArrayBuffer> {
		const url = this.getDownloadUrl(name, version);
		const res = await fetch(url);
		if (!res.ok) throw new Error(`Failed to fetch tarball from ${url}`);
		return res.arrayBuffer();
	}

	getDownloadUrl(packageName: string, version: string): string {
		return `https://rubygems.org/downloads/${packageName}-${version}.gem`;
	}
}

export const rubygemsService = new RubyGemsRegistryService();
