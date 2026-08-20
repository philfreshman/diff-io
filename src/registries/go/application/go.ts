import type { PackageRegistry } from "../../types.ts";
import { goService } from "../service/go.ts";

export const goRegistry: PackageRegistry = {
	async search(query) {
		return goService.search(query);
	},

	async getVersions(name) {
		return goService.getVersions(name);
	},

	async getVersion(name, version) {
		return goService.getVersion(name, version);
	},

	async getPackage(name, version) {
		return goService.getZip(name, version);
	},
	getDownloadUrl(name, version) {
		return goService.getDownloadUrl(name, version);
	},
};
