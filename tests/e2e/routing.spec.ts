import { expect, test } from "@playwright/test";

test("serves a deep link straight from its URL", async ({ page }) => {
	await page.goto("/npm/express/4.18.2/5.1.0/lib/router/index.js");

	await expect(page.getByTestId("slug-package")).toHaveText("express");
	await expect(page.getByTestId("slug-from")).toHaveText("4.18.2");
	await expect(page.getByTestId("slug-to")).toHaveText("5.1.0");
	await expect(page.getByTestId("slug-file")).toHaveText("lib/router/index.js");
});

test("keeps a Go module path whole", async ({ page }) => {
	await page.goto("/go/github.com/go-chi/chi/v5/v5.3.1/v5.3.2/tree.go");

	await expect(page.getByTestId("slug-package")).toHaveText(
		"github.com/go-chi/chi/v5",
	);
	await expect(page.getByTestId("slug-from")).toHaveText("v5.3.1");
	await expect(page.getByTestId("slug-file")).toHaveText("tree.go");
});

test("opens a registry with nothing selected", async ({ page }) => {
	await page.goto("/crates");

	await expect(page.getByTestId("slug-package")).toBeEmpty();
	await expect(page).toHaveTitle("diffpack | crates.io");
});

test("titles the document after the comparison in the URL", async ({
	page,
}) => {
	await page.goto("/npm/@types/node/26.6.0/26.7.0");

	await expect(page).toHaveTitle("diffpack | @types/node 26.6.0 → 26.7.0");
	await expect(page.getByTestId("slug-package")).toHaveText("@types/node");
});

test("does not invent a registry that does not exist", async ({ page }) => {
	const response = await page.goto("/maven/guava/1.0/2.0");

	expect(response?.status()).toBe(404);
	await expect(page.getByTestId("not-found")).toBeVisible();
	await expect(page.getByTestId("slug-package")).toHaveCount(0);
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
	await expect(page.getByTestId("slug-package")).toHaveText("serde");

	await page.goBack();

	await expect(page.getByTestId("slug-package")).toHaveText("express");
	await expect(page.getByTestId("slug-file")).toBeEmpty();
});

test("404s a bare unknown registry too", async ({ page }) => {
	const response = await page.goto("/maven");

	expect(response?.status()).toBe(404);
	await expect(page.getByTestId("not-found")).toBeVisible();
});
