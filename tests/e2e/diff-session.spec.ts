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
const files = (page: Page) => page.getByTestId("diff-files").getByRole("link");

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
	const diff = page.getByTestId("file-diff");
	await expect(diff).toContainText('- "version": "26.6.0"');
	await expect(diff).toContainText('+ "version": "26.7.0"');
});

test("a deep link to a file opens it without a click", async ({ page }) => {
	await page.goto(`${NODE}/package.json`);
	await ready(page);

	await expect(page.getByTestId("diff-file")).toContainText("package.json");
	await expect(page.getByTestId("file-diff")).toContainText("26.7.0");
});

test("the file on screen is the file last asked for", async ({ page }) => {
	await page.goto(NODE);
	await ready(page);

	// Clicked back to back: the reply to the first must not overwrite the
	// second, whichever order the worker answers in.
	const [first, second] = await files(page).allInnerTexts();
	expect(second).toBeDefined();
	await files(page).nth(0).click();
	await files(page).nth(1).click();

	await expect(page.getByTestId("diff-file")).toContainText(String(second));
	// The header names the file the engine actually diffed, which is what
	// distinguishes a correctly correlated reply from a stale one.
	await expect(page.getByTestId("file-diff")).not.toContainText(
		`--- from/${first}`,
	);
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
	await expect(page.getByTestId("diff-files")).toHaveCount(0);
});

test("extracts a Go module and strips its versioned root", async ({ page }) => {
	await page.goto("/go/github.com/go-chi/chi/v5/v5.3.1/v5.3.2");
	await ready(page);

	const paths = await files(page).allInnerTexts();

	// Module zips prefix every entry with `<module>@<version>/`. That prefix
	// embeds the version, so leaving it on would make every file read as
	// removed-then-added.
	expect(paths).toContain("tree.go");
	expect(paths.some((path) => path.includes("@v5."))).toBe(false);
});
