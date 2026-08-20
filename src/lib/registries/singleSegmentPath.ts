import type { PackagePath } from "./types.ts";

/**
 * Registries whose package names never contain a slash: the name is the first
 * segment and everything after it is version/file territory.
 */
export const singleSegmentPath: PackagePath = {
	parse(segments) {
		return {
			name: segments[0] ?? "",
			rest: segments.slice(1),
		};
	},

	toSegments(name) {
		return name ? [name] : [];
	},
};
