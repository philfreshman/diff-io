import { describe, expect, test } from "bun:test";
import type { DiffSlug } from "#/lib/url/slug.ts";
import { enginePreloadLinks } from "#/lib/worker/preloadHints.ts";

/** Stands in for the hashed URL Vite resolves at build time. */
const URLS = { worker: "/assets/diff.worker-test.js" };

/** What a hint for the module the worker fetches itself would look like. */
const WASM = "/assets/diff_wasm_bg-test.wasm";

function slug(over: Partial<DiffSlug> = {}): DiffSlug {
	return {
		registry: "crates",
		package: "linux-raw-sys",
		from: "0.6.5",
		to: "0.12.1",
		file: "",
		...over,
	};
}

describe("the engine's preload hints", () => {
	test("asks for the worker chunk where the URL names a comparison", () => {
		expect(enginePreloadLinks(slug(), URLS)).toEqual([
			{ rel: "modulepreload", href: URLS.worker },
		]);
	});

	// The document's preload cache is not the worker's: a `preload as="fetch"`
	// hint here is never claimed, so the module is downloaded twice.
	test("leaves the wasm to the worker that will fetch it", () => {
		const hrefs = enginePreloadLinks(slug(), URLS).map((link) => link.href);

		expect(hrefs).not.toContain(WASM);
	});

	test("asks for nothing where the URL names no comparison", () => {
		const partial: Partial<DiffSlug>[] = [
			{ package: "" },
			{ from: "" },
			{ to: "" },
		];

		for (const over of partial) {
			expect(enginePreloadLinks(slug(over), URLS)).toEqual([]);
		}
	});

	test("asks for nothing where the route parsed no slug at all", () => {
		expect(enginePreloadLinks(undefined, URLS)).toEqual([]);
	});
});
