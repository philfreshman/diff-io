import { expect, type Page, test } from "@playwright/test";

/**
 * The engine, driven through the workspace rather than a harness: the URL is
 * the request for a comparison, so these navigate and then assert on what the
 * page ends up holding. They hit the real registries, which is the only place
 * the WASM can run (task 1).
 *
 * `node` is a two-file npm package, which keeps the downloads small.
 */
const NODE = "/npm/node/26.6.0/26.7.0";

/** Downloading and extracting two archives is not a 10 s assertion. */
const ENGINE = { timeout: 90_000 };

const status = (page: Page) => page.getByTestId("diff-status");
/** Files are reached through the tree; folders are `treeitem`s too. */
const files = (page: Page) =>
	page.getByRole("treeitem").and(page.locator("[data-type='file']"));

async function ready(page: Page) {
	await expect(status(page)).toHaveAttribute("data-state", "ready", ENGINE);
}

test("a deep link is the request for a comparison", async ({ page }) => {
	await page.goto(NODE);
	await ready(page);

	await expect(files(page).filter({ hasText: "package.json" })).toHaveCount(1);
});

test("opening a file writes the URL and renders its diff", async ({ page }) => {
	await page.goto(NODE);
	await ready(page);

	await files(page).filter({ hasText: "package.json" }).click();

	await expect(page).toHaveURL(`${NODE}/package.json`);
	const view = page.getByTestId("diff-view");
	await expect(
		view.locator('tr[data-type="removed"]').filter({ hasText: "26.6.0" }),
	).toHaveCount(1);
	await expect(
		view.locator('tr[data-type="added"]').filter({ hasText: "26.7.0" }),
	).toHaveCount(1);
});

test("a deep link to a file opens it without a click", async ({ page }) => {
	await page.goto(`${NODE}/package.json`);
	await ready(page);

	await expect(page.getByTestId("diff-view")).toHaveAttribute(
		"data-path",
		"package.json",
	);
	await expect(page.getByTestId("diff-view")).toContainText("26.7.0");
});

test("the file on screen is the file last asked for", async ({ page }) => {
	await page.goto(NODE);
	await ready(page);

	// By path, not by row text: a row also carries its `+n`/`-n` counts.
	const [first, second] = await files(page).evaluateAll((rows) =>
		rows.map((row) => row.getAttribute("data-path") ?? ""),
	);
	expect(second).toBeDefined();

	// What the second file looks like on its own, so a stale reply carrying the
	// first file's lines is a different answer and not just a different label.
	// The engine's `--- from/…` header, which the old assertion read, is not
	// rendered any more — the parser strips it (task 11).
	await page.goto(`${NODE}/${second}`);
	const alone = await page.getByTestId("diff-view").getAttribute("data-rows");

	await page.goto(NODE);
	await ready(page);
	// Clicked back to back: the reply to the first must not overwrite the
	// second, whichever order the worker answers in.
	await files(page).nth(0).click();
	await files(page).nth(1).click();

	const view = page.getByTestId("diff-view");
	await expect(view).toHaveAttribute("data-path", String(second));
	await expect(view).toHaveAttribute("data-rows", alone ?? "");
	expect(first).not.toBe(second);
});

test("says so when the comparison cannot be built", async ({ page }) => {
	await page.goto("/npm/diffpack-package-that-does-not-exist/1.0.0/1.0.1");

	await expect(status(page)).toHaveAttribute("data-state", "error", ENGINE);
	await expect(page.getByTestId("diff-error")).not.toBeEmpty();
});

test("a file the comparison does not contain is an error, not a spinner", async ({
	page,
}) => {
	await page.goto(`${NODE}/does/not/exist.js`);
	await ready(page);

	await expect(page.getByTestId("file-error")).toContainText(
		"does/not/exist.js",
	);
});

test("nothing to compare, nothing started", async ({ page }) => {
	await page.goto("/npm/express");

	await expect(status(page)).toHaveAttribute("data-state", "idle");
	// The panel and the bar are the workspace's frame and stand either way, but
	// half a package name is not a comparison: nothing has been fetched, so
	// there are no rows in the tree and nothing said about a count.
	await expect(page.getByRole("treeitem")).toHaveCount(0);
	await expect(status(page)).toBeEmpty();
});

test("extracts a Go module and strips its versioned root", async ({ page }) => {
	await page.goto("/go/github.com/go-chi/chi/v5/v5.3.1/v5.3.2");
	await ready(page);

	// Module zips prefix every entry with `<module>@<version>/`. That prefix
	// embeds the version, so leaving it on would make every file read as
	// removed-then-added, under a folder named after the version.
	await expect(files(page).filter({ hasText: "tree.go" })).toHaveCount(1);
	await expect(page.locator("[data-path*='@v5.']")).toHaveCount(0);
});
