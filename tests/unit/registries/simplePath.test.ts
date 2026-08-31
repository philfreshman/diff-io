import { describe, expect, test } from "bun:test";
import { cratesAdapter } from "#/lib/registries/crates.ts";
import { pypiAdapter } from "#/lib/registries/pypi.ts";

for (const adapter of [cratesAdapter, pypiAdapter]) {
	describe(`${adapter.id} packagePath`, () => {
		test("takes exactly one segment for the package name", () => {
			expect(
				adapter.packagePath.parse(["serde", "1.0.1", "1.0.2", "src", "lib.rs"]),
			).toEqual({ name: "serde", rest: ["1.0.1", "1.0.2", "src", "lib.rs"] });
		});

		test("parses a bare package with no versions yet", () => {
			expect(adapter.packagePath.parse(["serde"])).toEqual({
				name: "serde",
				rest: [],
			});
		});

		test("round-trips through toSegments", () => {
			expect(adapter.packagePath.toSegments("serde")).toEqual(["serde"]);
		});
	});
}
