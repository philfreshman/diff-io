export interface UrlState {
	registry: string;
	package: string;
	from: string;
	to: string;
	file: string;
}

export function parseUrl(pathname: string): UrlState {
	const parts = pathname.split("/").filter(Boolean);

	if (parts.length === 0) {
		return { registry: "npm", package: "", from: "", to: "" , file: ""};
	}

	const isKnownRegistry = parts[0] === "npm" || parts[0] === "crates";
	const registry = isKnownRegistry ? parts[0] : "npm";
	const remainingParts = isKnownRegistry ? parts.slice(1) : parts;

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
