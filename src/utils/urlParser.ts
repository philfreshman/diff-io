export const KNOWN_REGISTRIES = ["npm", "crates", "go", "pypi"];

/**
 * Go module versions are always semver with a "v" prefix. The "/v2" major
 * version suffix a module path may end with is not one — it has no dotted
 * components — so this tells `github.com/go-chi/chi/v5` apart from `v5.2.3`.
 */
const GO_MODULE_VERSION = /^v\d+\.\d+\.\d+/;

export interface UrlState {
	registry: string;
	package: string;
	from: string;
	to: string;
	file: string;
}

export function parseUrl(pathname: string): UrlState {
	const decodedPathname = decodeURIComponent(pathname);
	const parts = decodedPathname.split("/").filter(Boolean);

	if (parts.length === 0) {
		return { registry: "npm", package: "", from: "", to: "", file: "" };
	}

	const isKnownRegistry = KNOWN_REGISTRIES.includes(parts[0]);
	const registry = isKnownRegistry ? parts[0] : "npm";
	const remainingParts = isKnownRegistry ? parts.slice(1) : parts;

	if (registry === "go") {
		// A module path carries its own slashes and varies in depth, so the package
		// name is everything up to the first part that looks like a version.
		const versionIndex = remainingParts.findIndex((part) =>
			GO_MODULE_VERSION.test(part),
		);
		const packageEnd =
			versionIndex === -1 ? remainingParts.length : versionIndex;

		return {
			registry,
			package: remainingParts.slice(0, packageEnd).join("/"),
			from: remainingParts[packageEnd] || "",
			to: remainingParts[packageEnd + 1] || "",
			file: remainingParts.slice(packageEnd + 2).join("/"),
		};
	}

	let pkg = "";
	let from = "";
	let to = "";
	let fileParts: string[] = [];

	if (remainingParts[0]?.startsWith("@")) {
		pkg = `${remainingParts[0]}/${remainingParts[1] || ""}`;
		from = remainingParts[2] || "";
		to = remainingParts[3] || "";
		fileParts = remainingParts.slice(4);
	} else {
		pkg = remainingParts[0] || "";
		from = remainingParts[1] || "";
		to = remainingParts[2] || "";
		fileParts = remainingParts.slice(3);
	}

	return {
		registry,
		package: pkg.replace(/\/$/, ""),
		from,
		to,
		file: fileParts.join("/"),
	};
}
