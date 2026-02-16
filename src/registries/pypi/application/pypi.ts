import type { PackageRegistry } from "../../types.ts";
import { pypiService } from "../service/pypi.ts";

export const pypiRegistry: PackageRegistry = {
	async search(query) {
		return pypiService.search(query);
	},

	async getVersions(name) {
		return pypiService.getVersions(name);
	},

	async getVersion(name, version) {
		return pypiService.getVersion(name, version);
	},

	async getPackage(name, version) {
		return pypiService.getTarball(name, version);
	},
	getDownloadUrl(name, version) {
		return pypiService.getDownloadUrl(name, version);
	},
};
