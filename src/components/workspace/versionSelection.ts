/** The two versions a comparison is made of, newest as `to`. */
export interface VersionSelection {
	from: string;
	to: string;
}

/**
 * What the two fields should say, given the URL and the list the registry
 * answered with.
 *
 * The URL wins whenever it names a version that exists — a shared link is a
 * statement about which versions to compare, and nothing here may quietly
 * change it. It loses only when the list contradicts it, which is what a
 * hand-typed or long-since-yanked version looks like.
 *
 * With nothing in the URL the defaults are `versions[1]` → `versions[0]`: the
 * previous release against the newest, the comparison almost everyone arrives
 * wanting. A package with a single version compares it against itself rather
 * than leaving a field empty and the Compare button dead.
 */
export function resolveSelection(
	versions: readonly string[],
	url: Partial<VersionSelection>,
): VersionSelection {
	// Before the list arrives there is nothing to check the URL against, and
	// nothing to default to either: what the URL says is all there is.
	if (versions.length === 0) {
		return { from: url.from ?? "", to: url.to ?? "" };
	}

	const known = (version: string | undefined): version is string =>
		version !== undefined && versions.includes(version);

	return {
		from: known(url.from) ? url.from : (versions[1] ?? versions[0] ?? ""),
		to: known(url.to) ? url.to : (versions[0] ?? ""),
	};
}
