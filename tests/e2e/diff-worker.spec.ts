import { expect, test } from "@playwright/test";

/**
 * `node` is a two-file npm package, which keeps the archive download small
 * enough to use as a smoke fixture against the real registry.
 */
const NODE_PKG = { registry: "npm", pkg: "node", from: "26.6.0", to: "26.7.0" };

test("builds a diff tree for a real package", async ({ page }) => {
	await page.goto("/spike");
	await expect(page.getByTestId("spike-status")).toHaveText("ready");

	const paths = await page.evaluate(async (req) => {
		const client = window.diffClient;
		if (!client) throw new Error("diffClient was not exposed by the harness");
		const tree = await client.buildTree(req);
		return (tree.children ?? []).map((child) => child.path);
	}, NODE_PKG);

	expect(paths).toContain("package.json");
});

test("returns a unified diff for a changed file", async ({ page }) => {
	await page.goto("/spike");
	await expect(page.getByTestId("spike-status")).toHaveText("ready");

	const diff = await page.evaluate(async (req) => {
		const client = window.diffClient;
		if (!client) throw new Error("diffClient was not exposed by the harness");
		await client.buildTree(req);
		return await client.getFile("package.json");
	}, NODE_PKG);

	const lines = diff.data.split("\n");
	const removed = lines.filter(
		(line) => line.startsWith("-") && !line.startsWith("---"),
	);
	const added = lines.filter(
		(line) => line.startsWith("+") && !line.startsWith("+++"),
	);

	expect(diff.isDiff).toBe(true);
	expect(removed.some((line) => line.includes('"version": "26.6.0"'))).toBe(
		true,
	);
	expect(added.some((line) => line.includes('"version": "26.7.0"'))).toBe(true);
});

test("resolves concurrent file requests to their own file", async ({
	page,
}) => {
	await page.goto("/spike");
	await expect(page.getByTestId("spike-status")).toHaveText("ready");

	const result = await page.evaluate(async (req) => {
		const client = window.diffClient;
		if (!client) throw new Error("diffClient was not exposed by the harness");
		const tree = await client.buildTree(req);
		// Unchanged files come back as raw content with no diff header, so this
		// needs two files that actually changed.
		const files = (tree.children ?? [])
			.filter((child) => child.type === "file" && child.status !== "unchanged")
			.map((child) => child.path);
		const [first, second] = files;
		if (!first || !second)
			throw new Error(`expected two changed files, got ${files.length}`);

		// Fired together: replies must be matched by request id, not by arrival order.
		const [firstDiff, secondDiff] = await Promise.all([
			client.getFile(first),
			client.getFile(second),
		]);
		// The header names the file the engine actually diffed, which is what
		// distinguishes a correctly correlated reply from a mismatched one.
		return {
			first,
			second,
			firstHeader: firstDiff.data.split("\n")[0],
			secondHeader: secondDiff.data.split("\n")[0],
		};
	}, NODE_PKG);

	expect(result.firstHeader).toBe(`--- from/${result.first}`);
	expect(result.secondHeader).toBe(`--- from/${result.second}`);
});

test("rejects when the package cannot be fetched", async ({ page }) => {
	await page.goto("/spike");
	await expect(page.getByTestId("spike-status")).toHaveText("ready");

	const message = await page.evaluate(async () => {
		const client = window.diffClient;
		if (!client) throw new Error("diffClient was not exposed by the harness");
		try {
			await client.buildTree({
				registry: "npm",
				pkg: "diffpack-package-that-does-not-exist",
				from: "1.0.0",
				to: "1.0.1",
			});
			return null;
		} catch (error) {
			return error instanceof Error ? error.message : String(error);
		}
	});

	expect(message).not.toBeNull();
});

test("extracts a Go module and strips its versioned root", async ({ page }) => {
	await page.goto("/spike");
	await expect(page.getByTestId("spike-status")).toHaveText("ready");

	const paths = await page.evaluate(async () => {
		const client = window.diffClient;
		if (!client) throw new Error("diffClient was not exposed by the harness");
		const tree = await client.buildTree({
			registry: "go",
			pkg: "github.com/go-chi/chi/v5",
			from: "v5.3.1",
			to: "v5.3.2",
		});
		return (tree.children ?? []).map((child) => child.path);
	});

	// Module zips prefix every entry with `<module>@<version>/`. That prefix
	// embeds the version, so leaving it on would make every file read as
	// removed-then-added.
	expect(paths).toContain("tree.go");
	expect(paths.some((path) => path.includes("@v5."))).toBe(false);
});
