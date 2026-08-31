import { describe, expect, test } from "bun:test";
import { createGoAdapter, goAdapter } from "#/lib/registries/go.ts";
import { json, stubFetch, text } from "./fetchStub.ts";

describe("go packagePath.parse", () => {
	test("treats a major-version path suffix as part of the module path", () => {
		expect(
			goAdapter.packagePath.parse([
				"github.com",
				"go-chi",
				"chi",
				"v5",
				"v5.3.1",
				"v5.3.2",
				"tree.go",
			]),
		).toEqual({
			name: "github.com/go-chi/chi/v5",
			rest: ["v5.3.1", "v5.3.2", "tree.go"],
		});
	});

	test("takes the whole path when no version follows", () => {
		expect(
			goAdapter.packagePath.parse(["github.com", "spf13", "cobra"]),
		).toEqual({ name: "github.com/spf13/cobra", rest: [] });
	});

	test("returns an empty name for an empty path", () => {
		expect(goAdapter.packagePath.parse([])).toEqual({ name: "", rest: [] });
	});
});

describe("go packagePath.toSegments", () => {
	test("splits a module path back into its segments", () => {
		expect(
			goAdapter.packagePath.toSegments("github.com/go-chi/chi/v5"),
		).toEqual(["github.com", "go-chi", "chi", "v5"]);
	});

	test("round-trips a parsed name", () => {
		const segments = ["github.com", "go-chi", "chi", "v5"];
		const { name } = goAdapter.packagePath.parse([...segments, "v5.3.1"]);
		expect(goAdapter.packagePath.toSegments(name)).toEqual(segments);
	});
});

describe("go downloadUrl", () => {
	test("points at the module proxy zip for the version", () => {
		expect(goAdapter.downloadUrl("github.com/go-chi/chi/v5", "v5.3.1")).toBe(
			"https://proxy.golang.org/github.com/go-chi/chi/v5/@v/v5.3.1.zip",
		);
	});

	test("escapes uppercase letters, which the proxy serves lower-cased", () => {
		expect(
			goAdapter.downloadUrl("github.com/Masterminds/semver", "v3.2.1"),
		).toBe(
			"https://proxy.golang.org/github.com/!masterminds/semver/@v/v3.2.1.zip",
		);
	});
});

describe("go versions", () => {
	test("sorts the proxy's unordered list newest first", async () => {
		const { fetcher, calls } = stubFetch(() =>
			text("v5.3.1\nv5.10.0\nv5.2.0\nv5.3.2\n"),
		);

		const versions = await createGoAdapter(fetcher).versions(
			"github.com/go-chi/chi/v5",
		);

		expect(versions).toEqual(["v5.10.0", "v5.3.2", "v5.3.1", "v5.2.0"]);
		expect(calls[0]?.url).toBe(
			"https://proxy.golang.org/github.com/go-chi/chi/v5/@v/list",
		);
	});

	test("ranks a release above its own pre-releases", async () => {
		const { fetcher } = stubFetch(() =>
			text("v1.2.0-beta.1\nv1.2.0\nv1.2.0-beta.2\n"),
		);

		expect(await createGoAdapter(fetcher).versions("example.com/m")).toEqual([
			"v1.2.0",
			"v1.2.0-beta.2",
			"v1.2.0-beta.1",
		]);
	});

	test("ignores build metadata when ordering", async () => {
		const { fetcher } = stubFetch(() =>
			text("v2.0.0+incompatible\nv2.1.0+incompatible\n"),
		);

		expect(await createGoAdapter(fetcher).versions("example.com/m")).toEqual([
			"v2.1.0+incompatible",
			"v2.0.0+incompatible",
		]);
	});

	test("escapes uppercase letters in the module path", async () => {
		const { fetcher, calls } = stubFetch(() => text("v3.2.1\n"));

		await createGoAdapter(fetcher).versions("github.com/Masterminds/semver");

		expect(calls[0]?.url).toBe(
			"https://proxy.golang.org/github.com/!masterminds/semver/@v/list",
		);
	});
});

describe("go versions for untagged modules", () => {
	test("falls back to the pseudo-version when nothing is tagged", async () => {
		const { fetcher, calls } = stubFetch((url) =>
			url.endsWith("/@v/list")
				? text("")
				: json({ Version: "v0.0.0-20260101120000-abcdef123456" }),
		);

		const versions = await createGoAdapter(fetcher).versions("example.com/m");

		expect(versions).toEqual(["v0.0.0-20260101120000-abcdef123456"]);
		expect(calls[1]?.url).toBe(
			"https://proxy.golang.org/example.com/m/@latest",
		);
	});

	test("returns nothing when the proxy cannot resolve the module either", async () => {
		const { fetcher } = stubFetch((url) =>
			url.endsWith("/@v/list") ? text("") : text("not found", 404),
		);

		expect(await createGoAdapter(fetcher).versions("example.com/m")).toEqual(
			[],
		);
	});

	test("rejects when the version list itself fails", async () => {
		const { fetcher } = stubFetch(() => text("gone", 500));

		expect(createGoAdapter(fetcher).versions("example.com/m")).rejects.toThrow(
			/example.com\/m/,
		);
	});
});

describe("go search", () => {
	test("resolves a fully-typed module path to its newest version", async () => {
		const { fetcher } = stubFetch(() => text("v5.3.1\nv5.3.2\n"));

		const results = await createGoAdapter(fetcher).search(
			"github.com/go-chi/chi/v5",
		);

		expect(results).toEqual([
			{
				name: "github.com/go-chi/chi/v5",
				version: "v5.3.2",
				description: "Go module — 2 versions",
			},
		]);
	});

	test("does not call the proxy for a query that is not a module path", async () => {
		const { fetcher, calls } = stubFetch(() => text("v1.0.0\n"));

		expect(await createGoAdapter(fetcher).search("chi")).toEqual([]);
		expect(calls).toHaveLength(0);
	});

	test("treats an unresolvable path as an ordinary miss", async () => {
		const { fetcher } = stubFetch(() => text("not found", 404));

		expect(
			await createGoAdapter(fetcher).search("example.com/does/not/exist"),
		).toEqual([]);
	});

	test("accepts a path the user pasted with a scheme or trailing slash", async () => {
		const { fetcher, calls } = stubFetch(() => text("v1.0.0\n"));

		const results = await createGoAdapter(fetcher).search(
			"https://github.com/spf13/cobra/",
		);

		expect(results[0]?.name).toBe("github.com/spf13/cobra");
		expect(calls[0]?.url).toBe(
			"https://proxy.golang.org/github.com/spf13/cobra/@v/list",
		);
	});
});

describe("go search cancellation", () => {
	test("reports an aborted search rather than an empty result set", async () => {
		const controller = new AbortController();
		const { fetcher } = stubFetch(() => {
			controller.abort();
			throw new DOMException("The operation was aborted.", "AbortError");
		});

		expect(
			createGoAdapter(fetcher).search(
				"github.com/go-chi/chi/v5",
				controller.signal,
			),
		).rejects.toThrow(/abort/i);
	});
});
