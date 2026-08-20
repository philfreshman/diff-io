import { describe, expect, test } from "bun:test";
import { cratesAdapter, createCratesAdapter } from "#/lib/registries/crates.ts";
import { json, stubFetch } from "./fetchStub.ts";

describe("crates downloadUrl", () => {
	test("points at the static.crates.io crate archive", () => {
		expect(cratesAdapter.downloadUrl("serde", "1.0.219")).toBe(
			"https://static.crates.io/crates/serde/serde-1.0.219.crate",
		);
	});
});

describe("crates search", () => {
	test("reports the crate's newest version alongside its description", async () => {
		const { fetcher, calls } = stubFetch(() =>
			json({
				crates: [
					{
						name: "serde",
						max_version: "1.0.219",
						description: "A serialization framework",
					},
				],
			}),
		);

		const results = await createCratesAdapter(fetcher).search("serde");

		expect(results).toEqual([
			{
				name: "serde",
				version: "1.0.219",
				description: "A serialization framework",
			},
		]);
		expect(calls[0]?.url).toBe(
			"https://crates.io/api/v1/crates?q=serde&per_page=10",
		);
	});
});

describe("crates versions", () => {
	test("keeps the API's newest-first order", async () => {
		const { fetcher, calls } = stubFetch(() =>
			json({ versions: [{ num: "1.0.219" }, { num: "1.0.218" }] }),
		);

		const versions = await createCratesAdapter(fetcher).versions("serde");

		expect(versions).toEqual(["1.0.219", "1.0.218"]);
		expect(calls[0]?.url).toBe("https://crates.io/api/v1/crates/serde");
	});

	test("rejects when the crate does not exist", async () => {
		const { fetcher } = stubFetch(() => json({ errors: [] }, 404));

		expect(createCratesAdapter(fetcher).versions("nope-xyz")).rejects.toThrow(
			/nope-xyz/,
		);
	});
});
