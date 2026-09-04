import { describe, expect, test } from "bun:test";
import { buildDiffBootScript } from "#/lib/worker/bootScript.ts";

/** Stands in for the hashed URL Vite interpolates at build time. */
const WORKER_URL = "/assets/diff.worker-test.js";

/**
 * The script ships as a string in the document head, so the only honest way to
 * test it is to run it — against a document that is entirely stubbed. What it
 * spawns and what it posts is its whole observable behaviour.
 */
function boot(pathname: string, stored: Record<string, string> = {}) {
	const posted: unknown[] = [];
	const spawned: Array<{ url: string; options: unknown }> = [];

	class FakeWorker {
		onmessage: ((event: { data: unknown }) => void) | null = null;

		constructor(url: string, options: unknown) {
			spawned.push({ url, options });
		}

		postMessage(request: unknown) {
			posted.push(request);
		}
	}

	const window: Record<string, unknown> = {};

	new Function(
		"window",
		"location",
		"localStorage",
		"Worker",
		buildDiffBootScript(WORKER_URL),
	)(
		window,
		{ pathname },
		{ getItem: (key: string) => stored[key] ?? null },
		FakeWorker,
	);

	return { posted, spawned, window };
}

describe("the diff boot script", () => {
	test("posts the build-tree request a crates deep link names", () => {
		const { posted } = boot("/crates/linux-raw-sys/0.6.5/0.12.1/Cargo.toml");

		expect(posted).toEqual([
			{
				id: 0,
				type: "build-tree",
				registry: "crates",
				pkg: "linux-raw-sys",
				from: "0.6.5",
				to: "0.12.1",
				ignoreWhitespace: false,
			},
		]);
	});

	test("starts nothing where the URL names no comparison", () => {
		for (const pathname of [
			"/",
			"/crates",
			"/crates/linux-raw-sys",
			"/crates/linux-raw-sys/0.6.5",
		]) {
			const { spawned, posted, window } = boot(pathname);

			expect(spawned).toEqual([]);
			expect(posted).toEqual([]);
			expect(window).toEqual({});
		}
	});

	test("reads a scoped npm name as the two segments it spans", () => {
		const { posted } = boot("/npm/@types/node/26.0.0/26.7.0/index.d.ts");

		expect(posted).toEqual([
			{
				id: 0,
				type: "build-tree",
				registry: "npm",
				pkg: "@types/node",
				from: "26.0.0",
				to: "26.7.0",
				ignoreWhitespace: false,
			},
		]);
	});

	test("reads a go module name as everything up to the first version", () => {
		const { posted } = boot("/go/github.com/go-chi/chi/v5/v5.0.0/v5.3.1");

		expect(posted).toEqual([
			{
				id: 0,
				type: "build-tree",
				registry: "go",
				pkg: "github.com/go-chi/chi/v5",
				from: "v5.0.0",
				to: "v5.3.1",
				ignoreWhitespace: false,
			},
		]);
	});

	test("starts nothing where the first segment names no registry", () => {
		const { spawned, window } = boot("/about/express/4.18.2/5.1.0");

		expect(spawned).toEqual([]);
		expect(window).toEqual({});
	});

	test("builds the tree with the stored whitespace answer", () => {
		const { posted } = boot("/crates/serde/1.0.0/1.0.1", {
			"ignore-whitespace-preference": "true",
		});

		expect(posted).toMatchObject([{ ignoreWhitespace: true }]);
	});

	test("is whitespace-exact unless the stored answer says otherwise", () => {
		const stores: Record<string, string>[] = [
			{},
			{ "ignore-whitespace-preference": "false" },
		];

		for (const stored of stores) {
			const { posted } = boot("/crates/serde/1.0.0/1.0.1", stored);

			expect(posted).toMatchObject([{ ignoreWhitespace: false }]);
		}
	});
});
