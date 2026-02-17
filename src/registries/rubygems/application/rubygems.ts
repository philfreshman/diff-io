import type { PackageRegistry } from "../../types.ts";
import { rubygemsService } from "../service/rubygems.ts";

export const rubygemsRegistry: PackageRegistry = {
	async search(query) {
		return rubygemsService.search(query);
	},

	async getVersions(name) {
		return rubygemsService.getVersions(name);
	},

	async getVersion(name, version) {
		return rubygemsService.getVersion(name, version);
	},

	async getPackage(name, version) {
		return rubygemsService.getTarball(name, version);
	},

	getDownloadUrl(name, version) {
		return rubygemsService.getDownloadUrl(name, version);
	},
};
