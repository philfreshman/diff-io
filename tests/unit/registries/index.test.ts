import { describe, expect, test } from "bun:test";
import {
	getAdapter,
	isRegistryId,
	registryAdapters,
} from "#/lib/registries/index.ts";

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

	test("gives every registry a label and a glow for its tile", () => {
		for (const adapter of registryAdapters) {
			expect(adapter.label.length).toBeGreaterThan(0);
			expect(adapter.glow).toMatch(/^\d+, \d+, \d+$/);
		}
	});
});
