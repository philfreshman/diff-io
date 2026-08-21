import { expect, type Page, test } from "@playwright/test";

const PACKAGE_DOC = "https://registry.npmjs.org/express";

/** npm lists versions oldest-first; the adapter reverses them. */
const VERSIONS = {
	versions: { "1.0.0": {}, "2.0.0": {}, "3.0.0": {} },
};

const from = (page: Page) =>
	page.getByRole("combobox", { name: "From Version" });
const to = (page: Page) => page.getByRole("combobox", { name: "To Version" });
const compare = (page: Page) => page.getByRole("button", { name: "Compare" });

/**
 * The version list is stubbed: these tests are about defaults, filtering and
 * what Compare writes, none of which should depend on what npm published today.
 */
async function stubVersions(page: Page) {
	await page.route(PACKAGE_DOC, (route) => route.fulfill({ json: VERSIONS }));
}

/** Playwright clicks as soon as an element exists; React may not own it yet. */
async function ready(page: Page) {
	await expect(page.locator("[data-ready]").first()).toBeAttached();
	await expect(from(page)).toBeEnabled();
}

test("defaults to the previous release against the newest", async ({
	page,
}) => {
	await stubVersions(page);
	await page.goto("/npm/express");
	await ready(page);

	await expect(from(page)).toHaveValue("2.0.0");
	await expect(to(page)).toHaveValue("3.0.0");
});

test("a deep link's versions survive the list arriving", async ({ page }) => {
	await stubVersions(page);
	await page.goto("/npm/express/1.0.0/3.0.0");
	await ready(page);

	await expect(from(page)).toHaveValue("1.0.0");
	await expect(to(page)).toHaveValue("3.0.0");
});

test("typing filters the list, and closing puts the version back", async ({
	page,
}) => {
	await stubVersions(page);
	await page.goto("/npm/express");
	await ready(page);

	await from(page).fill("2.");
	await expect(page.getByRole("option")).toHaveCount(1);
	await expect(page.getByRole("option", { name: "2.0.0" })).toBeVisible();

	// Filter text is transient: it lasts until the list closes, so the field
	// never says something Compare would not run.
	await from(page).press("Escape");
	await expect(from(page)).toHaveValue("2.0.0");

	await from(page).fill("1.0.0");
	await page.getByRole("option", { name: "1.0.0" }).click();
	await expect(from(page)).toHaveValue("1.0.0");
});

test("offers each version as an archive to download", async ({ page }) => {
	await stubVersions(page);
	await page.goto("/npm/express");
	await ready(page);

	await expect(
		page.getByRole("link", { name: "Download 2.0.0" }),
	).toHaveAttribute(
		"href",
		"https://registry.npmjs.org/express/-/express-2.0.0.tgz",
	);
	await expect(
		page.getByRole("link", { name: "Download 3.0.0" }),
	).toHaveAttribute(
		"href",
		"https://registry.npmjs.org/express/-/express-3.0.0.tgz",
	);
});

test("Compare is dead until there is something to compare", async ({
	page,
}) => {
	await page.goto("/npm");
	await expect(compare(page)).toBeDisabled();
	// No package, so there are no versions to choose from either.
	await expect(from(page)).toBeDisabled();
});

test("Compare, and only Compare, writes the comparison to the URL", async ({
	page,
}) => {
	await stubVersions(page);
	await page.goto("/npm/express");
	await ready(page);

	// Choosing a version is not asking for a comparison: it costs two archive
	// downloads, so the URL waits for the button.
	await from(page).click();
	await page.getByRole("option", { name: "1.0.0" }).click();
	await expect(page).toHaveURL("/npm/express");

	await compare(page).click();
	await expect(page).toHaveURL("/npm/express/1.0.0/3.0.0");
	await expect(page.getByTestId("slug-from")).toHaveText("1.0.0");
	await expect(page.getByTestId("slug-to")).toHaveText("3.0.0");
});

test("keeps the open file when only the versions change", async ({ page }) => {
	await stubVersions(page);
	await page.goto("/npm/express/1.0.0/2.0.0/lib/index.js");
	await ready(page);

	await to(page).click();
	await page.getByRole("option", { name: "3.0.0" }).click();
	await compare(page).click();

	await expect(page).toHaveURL("/npm/express/1.0.0/3.0.0/lib/index.js");
});

test("a new package clears the versions the last one had", async ({ page }) => {
	await stubVersions(page);
	await page.route("https://registry.npmjs.org/-/v1/search**", (route) =>
		route.fulfill({ json: { objects: [{ package: { name: "express" } }] } }),
	);
	await page.goto("/npm/other/1.0.0/2.0.0");
	await page.route("https://registry.npmjs.org/other", (route) =>
		route.fulfill({ status: 404, body: "" }),
	);
	await expect(page.locator("[data-ready]").first()).toBeAttached();

	await page.getByRole("combobox", { name: "Package Name" }).fill("express");
	await page
		.getByRole("option")
		.filter({ has: page.getByText("express", { exact: true }) })
		.click();

	// The versions of the package that was left behind are not a default for the
	// one just chosen.
	await expect(page).toHaveURL("/npm/express");
	await expect(from(page)).toHaveValue("2.0.0");
	await expect(to(page)).toHaveValue("3.0.0");
});

test("hovering Compare downloads the archives before the click", async ({
	page,
}) => {
	// The real registry: prefetch runs inside the WASM worker, which fetches the
	// tarballs itself. `node` is a two-file package, so this stays small.
	const tarballs: string[] = [];
	page.on("request", (request) => {
		if (request.url().endsWith(".tgz")) tarballs.push(request.url());
	});

	await page.goto("/npm/node/26.6.0/26.7.0");
	await ready(page);

	await compare(page).hover();

	await expect
		.poll(() => tarballs.length, { timeout: 30_000 })
		.toBeGreaterThanOrEqual(2);
	expect(tarballs.some((url) => url.includes("26.6.0"))).toBe(true);
	expect(tarballs.some((url) => url.includes("26.7.0"))).toBe(true);
});
