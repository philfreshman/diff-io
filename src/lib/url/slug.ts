import type { RegistryAdapter, RegistryId } from "#/lib/registries/types.ts";

/** Everything a diff URL says, after the registry segment. */
export interface DiffSlug {
	registry: RegistryId;
	package: string;
	from: string;
	to: string;
	file: string;
}

/**
 * A URL that reached us is not necessarily one we built: a segment can be
 * mis-encoded (a bare "%" in a filename), and `decodeURIComponent` throws on
 * those rather than handing back what the user actually typed.
 */
function decodeSegment(segment: string): string {
	try {
		return decodeURIComponent(segment);
	} catch {
		return segment;
	}
}

/**
 * Turns the splat of `/$registry/$` into the workspace's boot state. The
 * registry decides how many segments the package name spans, so the shape of a
 * URL is the adapter's business, not the route's.
 */
export function parseSlug(adapter: RegistryAdapter, splat: string): DiffSlug {
	const segments = splat.split("/").filter(Boolean).map(decodeSegment);
	const { name, rest } = adapter.packagePath.parse(segments);

	return {
		registry: adapter.id,
		package: name,
		from: rest[0] ?? "",
		to: rest[1] ?? "",
		file: rest.slice(2).join("/"),
	};
}

/**
 * Percent-encoding, minus the escape of "@": scoped npm URLs are live and
 * indexed as `/npm/@types/node`, and `%40types` is a different URL.
 */
function encodeSegment(segment: string): string {
	return encodeURIComponent(segment).replaceAll("%40", "@");
}

/** The URL a selection is shared as — the inverse of {@link parseSlug}. */
export function buildPath(
	adapter: RegistryAdapter,
	slug: Omit<Partial<DiffSlug>, "registry">,
): string {
	const name = adapter.packagePath.toSegments(slug.package ?? "");
	const from = slug.from ?? "";
	const to = slug.to ?? "";
	// A file lives in the segments after both versions, so without them there is
	// nowhere to put it: writing it anyway would read back as a version.
	const file = from && to ? (slug.file ?? "") : "";

	const segments = [...name, from, to, ...file.split("/")]
		.filter(Boolean)
		.map(encodeSegment);

	return `/${[adapter.id, ...segments].join("/")}`;
}
