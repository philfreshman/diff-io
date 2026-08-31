import { describe, expect, test } from "bun:test";
import { cratesAdapter } from "#/lib/registries/crates.ts";
import { goAdapter } from "#/lib/registries/go.ts";
import {
	getAdapter,
	isRegistryId,
	registryAdapters,
	requireAdapter,
} from "#/lib/registries/index.ts";
import { npmAdapter } from "#/lib/registries/npm.ts";
import { pypiAdapter } from "#/lib/registries/pypi.ts";

describe("getAdapter", () => {
	test("finds each registry by its URL segment", () => {
		for (const id of ["npm", "crates", "go", "pypi"] as const) {
			expect(getAdapter(id)?.id).toBe(id);
		}
	});

	test("returns nothing for a segment that is not a registry", () => {
		expect(getAdapter("maven")).toBeUndefined();
	});
});

describe("isRegistryId", () => {
	test("recognises a known registry segment", () => {
		expect(isRegistryId("crates")).toBe(true);
	});

	test("rejects an unknown segment", () => {
		expect(isRegistryId("maven")).toBe(false);
	});
});

describe("registryAdapters", () => {
	test("lists the four registries in landing-page order", () => {
		expect(registryAdapters.map((adapter) => adapter.id)).toEqual([
			"npm",
			"crates",
			"go",
			"pypi",
		]);
	});

	test("gives every registry the label and tagline its tile shows", () => {
		for (const adapter of registryAdapters) {
			expect(adapter.label.length).toBeGreaterThan(0);
			expect(adapter.tagline.length).toBeGreaterThan(0);
		}
	});

	test("names the ecosystem each registry serves, not the registry again", () => {
		expect(npmAdapter.tagline).toBe("JavaScript & TypeScript packages");
		expect(cratesAdapter.tagline).toBe("Rust ecosystem packages");
		expect(goAdapter.tagline).toBe("Go modules & standard ecosystem");
		expect(pypiAdapter.tagline).toBe("Python packages");
	});
});

describe("requireAdapter", () => {
	test("hands back the adapter for a validated segment", () => {
		expect(requireAdapter("go").id).toBe("go");
	});

	test("refuses to guess a registry, rather than falling back to npm", () => {
		expect(() => requireAdapter("maven")).toThrow("maven");
	});
});
