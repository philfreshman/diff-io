import { describe, expect, test } from "bun:test";
import { cratesAdapter } from "#/lib/registries/crates.ts";
import { goAdapter } from "#/lib/registries/go.ts";
import { npmAdapter } from "#/lib/registries/npm.ts";
import { buildPath, parseSlug } from "#/lib/url/slug.ts";

describe("parseSlug", () => {
	test("reads package, versions and file out of a deep link", () => {
		expect(
			parseSlug(npmAdapter, "express/4.18.2/5.1.0/lib/router/index.js"),
		).toEqual({
			registry: "npm",
			package: "express",
			from: "4.18.2",
			to: "5.1.0",
			file: "lib/router/index.js",
		});
	});
});

describe("parseSlug across registries", () => {
	test("keeps a scoped npm name whole", () => {
		expect(parseSlug(npmAdapter, "@types/node/26.6.0/26.7.0")).toEqual({
			registry: "npm",
			package: "@types/node",
			from: "26.6.0",
			to: "26.7.0",
			file: "",
		});
	});

	test("tells a Go major-version suffix apart from a version", () => {
		expect(
			parseSlug(goAdapter, "github.com/go-chi/chi/v5/v5.3.1/v5.3.2/tree.go"),
		).toEqual({
			registry: "go",
			package: "github.com/go-chi/chi/v5",
			from: "v5.3.1",
			to: "v5.3.2",
			file: "tree.go",
		});
	});

	test("reads a Go module that has no versions chosen yet", () => {
		expect(parseSlug(goAdapter, "github.com/go-chi/chi/v5")).toEqual({
			registry: "go",
			package: "github.com/go-chi/chi/v5",
			from: "",
			to: "",
			file: "",
		});
	});

	test("takes one segment for a crates package", () => {
		expect(parseSlug(cratesAdapter, "serde/1.0.1/1.0.2/src/lib.rs")).toEqual({
			registry: "crates",
			package: "serde",
			from: "1.0.1",
			to: "1.0.2",
			file: "src/lib.rs",
		});
	});
});

describe("parseSlug on incomplete URLs", () => {
	test("reads a registry page with nothing selected yet", () => {
		expect(parseSlug(npmAdapter, "")).toEqual({
			registry: "npm",
			package: "",
			from: "",
			to: "",
			file: "",
		});
	});

	test("reads a package that has no versions chosen yet", () => {
		expect(parseSlug(npmAdapter, "/express/")).toEqual({
			registry: "npm",
			package: "express",
			from: "",
			to: "",
			file: "",
		});
	});
});

describe("parseSlug on encoded segments", () => {
	test("decodes a file path that carries a reserved character", () => {
		expect(
			parseSlug(npmAdapter, "express/4.18.2/5.1.0/lib/a%20b%23c.js").file,
		).toBe("lib/a b#c.js");
	});

	test("survives a segment that is not valid encoding", () => {
		expect(parseSlug(npmAdapter, "express/4.18.2/5.1.0/100%.txt").file).toBe(
			"100%.txt",
		);
	});
});

describe("buildPath", () => {
	test("writes the URL a full selection is shared as", () => {
		expect(
			buildPath(npmAdapter, {
				package: "express",
				from: "4.18.2",
				to: "5.1.0",
				file: "lib/router/index.js",
			}),
		).toBe("/npm/express/4.18.2/5.1.0/lib/router/index.js");
	});

	test("stops at the package while no versions are chosen", () => {
		expect(buildPath(npmAdapter, { package: "@types/node" })).toBe(
			"/npm/@types/node",
		);
	});

	test("links to the registry when nothing is chosen at all", () => {
		expect(buildPath(cratesAdapter, {})).toBe("/crates");
	});

	test("drops a file it cannot address, rather than shifting it into a version slot", () => {
		expect(
			buildPath(npmAdapter, {
				package: "express",
				file: "lib/router/index.js",
			}),
		).toBe("/npm/express");
	});

	test("encodes a character that would otherwise end the path", () => {
		expect(
			buildPath(npmAdapter, {
				package: "express",
				from: "4.18.2",
				to: "5.1.0",
				file: "lib/a b#c.js",
			}),
		).toBe("/npm/express/4.18.2/5.1.0/lib/a%20b%23c.js");
	});

	test("leaves an npm scope readable", () => {
		expect(
			buildPath(npmAdapter, {
				package: "@types/node",
				from: "26.6.0",
				to: "26.7.0",
			}),
		).toBe("/npm/@types/node/26.6.0/26.7.0");
	});
});

describe("a URL built by diffpack", () => {
	const cases = [
		{
			adapter: npmAdapter,
			slug: {
				package: "express",
				from: "4.18.2",
				to: "5.1.0",
				file: "lib/router/index.js",
			},
		},
		{
			adapter: npmAdapter,
			slug: {
				package: "@types/node",
				from: "26.6.0",
				to: "26.7.0",
				file: "index.d.ts",
			},
		},
		{
			adapter: cratesAdapter,
			slug: {
				package: "serde",
				from: "1.0.1",
				to: "1.0.2",
				file: "src/lib.rs",
			},
		},
		{
			adapter: goAdapter,
			slug: {
				package: "github.com/go-chi/chi/v5",
				from: "v5.3.1",
				to: "v5.3.2",
				file: "tree.go",
			},
		},
		{
			adapter: npmAdapter,
			slug: {
				package: "express",
				from: "4.18.2",
				to: "5.1.0",
				file: "test/a b#c.js",
			},
		},
	];

	for (const { adapter, slug } of cases) {
		test(`reads back as itself: ${adapter.id} ${slug.package}/${slug.file}`, () => {
			const path = buildPath(adapter, slug);
			const splat = path.slice(`/${adapter.id}/`.length);

			expect(parseSlug(adapter, splat)).toEqual({
				registry: adapter.id,
				...slug,
			});
		});
	}
});
