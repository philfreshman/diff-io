import { describe, expect, test } from "bun:test";
import { cratesAdapter } from "#/lib/registries/crates.ts";
import { goAdapter } from "#/lib/registries/go.ts";
import { npmAdapter } from "#/lib/registries/npm.ts";
import { pypiAdapter } from "#/lib/registries/pypi.ts";

describe("capabilities", () => {
	test("go cannot be searched by keyword and says what to type instead", () => {
		expect(goAdapter.capabilities.discoverySearch).toBe(false);
		expect(goAdapter.capabilities.searchHint).toContain("module path");
	});

	test("every other registry has keyword search and needs no hint", () => {
		for (const adapter of [npmAdapter, cratesAdapter, pypiAdapter]) {
			expect(adapter.capabilities.discoverySearch).toBe(true);
			expect(adapter.capabilities.searchHint).toBeUndefined();
		}
	});
});
