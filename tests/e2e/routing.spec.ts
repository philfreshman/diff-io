import { expect, type Page, test } from "@playwright/test";

/**
 * What the route parsed out of the URL, stated on the workspace shell. It is
 * server-rendered, so these assertions hold before any registry has answered.
 */
const workspace = (page: Page) => page.getByTestId("workspace");

test("serves a deep link straight from its URL", async ({ page }) => {
	await page.goto("/npm/express/4.18.2/5.1.0/lib/router/index.js");

	await expect(workspace(page)).toHaveAttribute("data-package", "express");
	await expect(workspace(page)).toHaveAttribute("data-from", "4.18.2");
	await expect(workspace(page)).toHaveAttribute("data-to", "5.1.0");
	await expect(workspace(page)).toHaveAttribute(
		"data-file",
		"lib/router/index.js",
	);
});

test("keeps a Go module path whole", async ({ page }) => {
	await page.goto("/go/github.com/go-chi/chi/v5/v5.3.1/v5.3.2/tree.go");

	await expect(workspace(page)).toHaveAttribute(
		"data-package",
		"github.com/go-chi/chi/v5",
	);
	await expect(workspace(page)).toHaveAttribute("data-from", "v5.3.1");
	await expect(workspace(page)).toHaveAttribute("data-file", "tree.go");
});

test("opens a registry with nothing selected", async ({ page }) => {
	await page.goto("/crates");

	await expect(workspace(page)).toHaveAttribute("data-package", "");
	await expect(page).toHaveTitle("diffpack | crates.io");
});

test("titles the document after the comparison in the URL", async ({
	page,
}) => {
	await page.goto("/npm/@types/node/26.6.0/26.7.0");

	await expect(page).toHaveTitle("diffpack | @types/node 26.6.0 → 26.7.0");
	await expect(workspace(page)).toHaveAttribute("data-package", "@types/node");
});

test("does not invent a registry that does not exist", async ({ page }) => {
	const response = await page.goto("/maven/guava/1.0/2.0");

	expect(response?.status()).toBe(404);
	await expect(page.getByTestId("not-found")).toBeVisible();
	await expect(workspace(page)).toHaveCount(0);
});

test("answers a deep link fully rendered, before any JavaScript runs", async ({
	request,
}) => {
	const response = await request.get("/npm/express/4.18.2/5.1.0");
	const html = await response.text();

	expect(html).toContain("<title>diffpack | express 4.18.2 → 5.1.0</title>");
	expect(html).toContain("Changes in express 4.18.2 → 5.1.0.");
	expect(html).toContain("express");
});

test("restores the previous comparison when the user goes back", async ({
	page,
}) => {
	await page.goto("/npm/express/4.18.2/5.1.0");
	await page.goto("/crates/serde/1.0.1/1.0.2/src/lib.rs");
	await expect(workspace(page)).toHaveAttribute("data-package", "serde");

	await page.goBack();

	await expect(workspace(page)).toHaveAttribute("data-package", "express");
	await expect(workspace(page)).toHaveAttribute("data-file", "");
});

test("404s a bare unknown registry too", async ({ page }) => {
	const response = await page.goto("/maven");

	expect(response?.status()).toBe(404);
	await expect(page.getByTestId("not-found")).toBeVisible();
});
