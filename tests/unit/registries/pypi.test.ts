import { describe, expect, test } from "bun:test";
import { createPypiAdapter, pypiAdapter } from "#/lib/registries/pypi.ts";
import { json, stubFetch } from "./fetchStub.ts";

describe("pypi downloadUrl", () => {
	test("files the sdist under the first letter of the package name", () => {
		expect(pypiAdapter.downloadUrl("requests", "2.32.3")).toBe(
			"https://files.pythonhosted.org/packages/source/r/requests/requests-2.32.3.tar.gz",
		);
	});
});

describe("pypi search", () => {
	test("goes through the diffpack backend, which PyPI has no CORS equivalent for", async () => {
		const { fetcher, calls } = stubFetch(() =>
			json([
				{ name: "requests", version: "2.32.3", description: "HTTP for Humans" },
			]),
		);

		const results = await createPypiAdapter(fetcher).search("requests");

		expect(results).toEqual([
			{ name: "requests", version: "2.32.3", description: "HTTP for Humans" },
		]);
		expect(calls[0]?.url).toBe(
			"https://api.diffpack.io/api/search?package=requests&registry=pypi",
		);
	});

	test("rejects a backend payload that is not a list of named results", async () => {
		const { fetcher } = stubFetch(() => json([{ description: "nameless" }]));

		expect(createPypiAdapter(fetcher).search("requests")).rejects.toThrow();
	});
});

describe("pypi versions", () => {
	test("lists deps.dev versions newest first", async () => {
		const { fetcher, calls } = stubFetch(() =>
			json({
				versions: [
					{ versionKey: { version: "2.32.2" } },
					{ versionKey: { version: "2.32.3" } },
				],
			}),
		);

		const versions = await createPypiAdapter(fetcher).versions("requests");

		expect(versions).toEqual(["2.32.3", "2.32.2"]);
		expect(calls[0]?.url).toBe(
			"https://api.deps.dev/v3/systems/pypi/packages/requests",
		);
	});

	test("rejects when the package does not exist", async () => {
		const { fetcher } = stubFetch(() => json({}, 404));

		expect(createPypiAdapter(fetcher).versions("nope-xyz")).rejects.toThrow(
			/nope-xyz/,
		);
	});
});
