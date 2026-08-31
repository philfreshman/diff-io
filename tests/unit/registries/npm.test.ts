import { describe, expect, test } from "bun:test";
import { createNpmAdapter, npmAdapter } from "#/lib/registries/npm.ts";
import { json, stubFetch } from "./fetchStub.ts";

describe("npm packagePath.parse", () => {
	test("takes one segment for an unscoped package", () => {
		expect(
			npmAdapter.packagePath.parse([
				"express",
				"4.18.2",
				"5.1.0",
				"lib",
				"router",
				"index.js",
			]),
		).toEqual({
			name: "express",
			rest: ["4.18.2", "5.1.0", "lib", "router", "index.js"],
		});
	});

	test("takes two segments for a scoped package", () => {
		expect(
			npmAdapter.packagePath.parse([
				"@types",
				"node",
				"26.6.0",
				"26.7.0",
				"index.d.ts",
			]),
		).toEqual({
			name: "@types/node",
			rest: ["26.6.0", "26.7.0", "index.d.ts"],
		});
	});

	test("keeps a scope with no package name from swallowing the versions", () => {
		expect(npmAdapter.packagePath.parse(["@types"])).toEqual({
			name: "@types",
			rest: [],
		});
	});
});

describe("npm packagePath.toSegments", () => {
	test("splits a scoped name into scope and package", () => {
		expect(npmAdapter.packagePath.toSegments("@types/node")).toEqual([
			"@types",
			"node",
		]);
	});

	test("leaves an unscoped name as a single segment", () => {
		expect(npmAdapter.packagePath.toSegments("express")).toEqual(["express"]);
	});
});

describe("npm downloadUrl", () => {
	test("points at the registry tarball for the version", () => {
		expect(npmAdapter.downloadUrl("express", "5.1.0")).toBe(
			"https://registry.npmjs.org/express/-/express-5.1.0.tgz",
		);
	});

	test("drops the scope from the tarball filename", () => {
		expect(npmAdapter.downloadUrl("@types/node", "26.7.0")).toBe(
			"https://registry.npmjs.org/@types/node/-/node-26.7.0.tgz",
		);
	});
});

describe("npm versions", () => {
	test("lists the registry document's versions newest first", async () => {
		const { fetcher, calls } = stubFetch(() =>
			json({ versions: { "4.18.2": {}, "5.0.0": {}, "5.1.0": {} } }),
		);

		const versions = await createNpmAdapter(fetcher).versions(
			"express",
			new AbortController().signal,
		);

		expect(versions).toEqual(["5.1.0", "5.0.0", "4.18.2"]);
		expect(calls[0]?.url).toBe("https://registry.npmjs.org/express");
	});
});

describe("npm versions failure", () => {
	test("rejects when the package does not exist", async () => {
		const { fetcher } = stubFetch(() => json({ error: "Not found" }, 404));

		expect(
			createNpmAdapter(fetcher).versions("no-such-package-xyz"),
		).rejects.toThrow(/no-such-package-xyz/);
	});

	test("forwards the abort signal to the request", async () => {
		const { fetcher, calls } = stubFetch(() => json({ versions: {} }));
		const controller = new AbortController();

		await createNpmAdapter(fetcher).versions("express", controller.signal);

		expect(calls[0]?.signal).toBe(controller.signal);
	});
});

describe("npm search", () => {
	test("returns name, version and description for each hit", async () => {
		const { fetcher, calls } = stubFetch(() =>
			json({
				objects: [
					{
						package: {
							name: "express",
							version: "5.1.0",
							description: "Fast, unopinionated web framework",
						},
					},
				],
			}),
		);

		const results = await createNpmAdapter(fetcher).search("express");

		expect(results).toEqual([
			{
				name: "express",
				version: "5.1.0",
				description: "Fast, unopinionated web framework",
			},
		]);
		expect(calls[0]?.url).toBe(
			"https://registry.npmjs.org/-/v1/search?text=express&size=10",
		);
	});

	test("encodes a scoped query", async () => {
		const { fetcher, calls } = stubFetch(() => json({ objects: [] }));

		await createNpmAdapter(fetcher).search("@types/node");

		expect(calls[0]?.url).toContain("text=%40types%2Fnode");
	});
});
