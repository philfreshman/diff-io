import { describe, expect, test } from "bun:test";
import { cratesAdapter } from "#/lib/registries/crates.ts";
import { npmAdapter } from "#/lib/registries/npm.ts";
import { documentMeta, metaTags } from "#/lib/url/documentMeta.ts";

describe("documentMeta", () => {
	test("names the comparison being viewed", () => {
		expect(
			documentMeta(npmAdapter, {
				registry: "npm",
				package: "express",
				from: "4.18.2",
				to: "5.1.0",
				file: "",
			}),
		).toEqual({
			title: "diffpack | express 4.18.2 → 5.1.0",
			description: "Changes in express 4.18.2 → 5.1.0.",
		});
	});

	test("names the registry when no package is chosen", () => {
		expect(
			documentMeta(cratesAdapter, {
				registry: "crates",
				package: "",
				from: "",
				to: "",
				file: "",
			}),
		).toEqual({
			title: "diffpack | crates.io",
			description: "Compare crates.io package versions in your browser.",
		});
	});

	test("names a package that has no versions chosen yet", () => {
		expect(
			documentMeta(npmAdapter, {
				registry: "npm",
				package: "express",
				from: "",
				to: "",
				file: "",
			}),
		).toEqual({
			title: "diffpack | express",
			description: "Compare express versions in your browser.",
		});
	});

	test("names the file being read", () => {
		expect(
			documentMeta(npmAdapter, {
				registry: "npm",
				package: "express",
				from: "4.18.2",
				to: "5.1.0",
				file: "lib/router/index.js",
			}).title,
		).toBe("diffpack | express 4.18.2 → 5.1.0 · lib/router/index.js");
	});
});

describe("metaTags", () => {
	test("gives a route the title and description tags to render", () => {
		expect(
			metaTags(npmAdapter, {
				registry: "npm",
				package: "express",
				from: "4.18.2",
				to: "5.1.0",
				file: "",
			}),
		).toEqual(
			expect.arrayContaining([
				{ title: "diffpack | express 4.18.2 → 5.1.0" },
				{
					name: "description",
					content: "Changes in express 4.18.2 → 5.1.0.",
				},
			]),
		);
	});

	test("a shared comparison previews as that comparison", () => {
		// A link to a diff is pasted into a chat far more often than the site's
		// front page is, so the preview has to be the comparison's rather than
		// the site's — the old app served one set of tags for every URL.
		const tags = metaTags(npmAdapter, {
			registry: "npm",
			package: "express",
			from: "4.18.2",
			to: "5.1.0",
			file: "lib/router/index.js",
		});
		const shared = Object.fromEntries(
			tags
				.filter((tag) => "property" in tag)
				.map((tag) => [tag.property, tag.content]),
		);

		expect(shared["og:title"]).toBe(
			"diffpack | express 4.18.2 → 5.1.0 · lib/router/index.js",
		);
		expect(shared["og:description"]).toBe(
			"Changes to lib/router/index.js in express 4.18.2 → 5.1.0.",
		);
		expect(shared["twitter:title"]).toBe(shared["og:title"]);
		expect(shared["twitter:description"]).toBe(shared["og:description"]);
	});
});
