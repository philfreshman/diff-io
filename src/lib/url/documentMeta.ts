import type { RegistryAdapter } from "#/lib/registries/types.ts";
import type { DiffSlug } from "./slug.ts";

export interface DocumentMeta {
	title: string;
	description: string;
}

/**
 * What a deep link says about itself in a tab, a search result and a link
 * preview. Every URL served the same tags in the old app.
 */
export function documentMeta(
	adapter: RegistryAdapter,
	slug: DiffSlug,
): DocumentMeta {
	if (!slug.package) {
		return {
			title: `diffpack | ${adapter.label}`,
			description: `Compare ${adapter.label} package versions in your browser.`,
		};
	}

	if (!slug.from || !slug.to) {
		return {
			title: `diffpack | ${slug.package}`,
			description: `Compare ${slug.package} versions in your browser.`,
		};
	}

	const comparison = `${slug.package} ${slug.from} → ${slug.to}`;

	return {
		title: `diffpack | ${comparison}${slug.file ? ` · ${slug.file}` : ""}`,
		description: slug.file
			? `Changes to ${slug.file} in ${comparison}.`
			: `Changes in ${comparison}.`,
	};
}

/** {@link documentMeta} in the shape a route's `head` renders. */
export function metaTags(adapter: RegistryAdapter, slug: DiffSlug) {
	const { title, description } = documentMeta(adapter, slug);

	return [
		{ title },
		{ name: "description", content: description },
		// A link to a diff is shared far more often than the front page is, so
		// the preview names the comparison rather than the site.
		{ property: "og:title", content: title },
		{ property: "og:description", content: description },
		{ property: "twitter:title", content: title },
		{ property: "twitter:description", content: description },
	];
}
