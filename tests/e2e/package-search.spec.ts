import { expect, type Page, test } from "@playwright/test";

const SEARCH_URL = "https://registry.npmjs.org/-/v1/search**";
const GO_PROXY = "https://proxy.golang.org/**";

const RESULTS = [
	{
		package: {
			name: "express",
			version: "5.1.0",
			description: "Fast, unopinionated web framework",
		},
	},
	{
		package: { name: "express-session", version: "1.18.0", description: "" },
	},
];

const field = (page: Page) =>
	page.getByRole("combobox", { name: "Package Name" });

/**
 * A row's accessible name is its package name *and* its description, so it is
 * matched by the name it renders rather than by the whole string.
 */
const option = (page: Page, name: string) =>
	page
		.getByRole("option")
		.filter({ has: page.getByText(name, { exact: true }) });

/**
 * The registry is stubbed: these tests are about debounce, the icon slot,
 * history and the URL, none of which should depend on npm being up or on what
 * it happens to return today.
 */
async function stubNpmSearch(page: Page, urls: string[] = [], delayMs = 0) {
	await page.route(SEARCH_URL, async (route) => {
		urls.push(route.request().url());
		// A stub answers instantly, which makes an in-flight state impossible to
		// observe; a test about that state has to hold the request open.
		if (delayMs) await new Promise((resolve) => setTimeout(resolve, delayMs));
		await route.fulfill({ json: { objects: RESULTS } });
	});
}

/** Playwright clicks as soon as an element exists; React may not own it yet. */
async function ready(page: Page) {
	await expect(page.locator("[data-ready]").first()).toBeAttached();
}

test("asks the registry once for a word typed at speed", async ({ page }) => {
	const urls: string[] = [];
	await stubNpmSearch(page, urls);
	await page.goto("/npm");
	await ready(page);

	await field(page).pressSequentially("express", { delay: 30 });
	await expect(page.getByRole("option").first()).toBeVisible();

	expect(urls).toHaveLength(1);
	expect(urls[0]).toContain("text=express");
});

test("does not search until there is enough to search for", async ({
	page,
}) => {
	const urls: string[] = [];
	await stubNpmSearch(page, urls);
	await page.goto("/npm");
	await ready(page);

	await field(page).fill("e");
	await page.waitForTimeout(600);

	expect(urls).toHaveLength(0);
});

test("selecting a result becomes the URL", async ({ page }) => {
	await stubNpmSearch(page);
	await page.goto("/npm");
	await ready(page);

	await field(page).fill("express");
	await option(page, "express-session").click();

	await expect(page).toHaveURL("/npm/express-session");
	await expect(page.getByTestId("workspace")).toHaveAttribute(
		"data-package",
		"express-session",
	);
});

test("shows search, then a spinner, then a reset", async ({ page }) => {
	// A stub that answers instantly makes the in-flight state impossible to see.
	await stubNpmSearch(page, [], 2_000);
	await page.goto("/npm");
	await ready(page);

	const slot = page.getByTestId("package-search-state");
	await expect(slot).toHaveAttribute("data-state", "idle");

	await field(page).fill("express");
	await expect(slot).toHaveAttribute("data-state", "searching");

	await option(page, "express").click();
	await expect(slot).toHaveAttribute("data-state", "selected");

	await page
		.getByRole("button", { name: "Clear the selected package" })
		.click();

	await expect(page).toHaveURL("/npm");
	await expect(field(page)).toHaveValue("");
	await expect(slot).toHaveAttribute("data-state", "idle");
});

test("offers the packages this registry has been asked for before", async ({
	page,
}) => {
	await stubNpmSearch(page);
	await page.goto("/npm");
	await ready(page);
	await field(page).fill("express");
	await option(page, "express").click();

	// A fresh visit: history is the only thing an empty field can offer.
	await page.goto("/npm");
	await ready(page);
	await field(page).click();

	// The whole result is remembered, description and all — history is what was
	// picked, not just its name.
	await expect(page.getByRole("option")).toHaveCount(1);
	await expect(option(page, "express")).toBeVisible();
});

test("keeps history apart per registry", async ({ page }) => {
	await stubNpmSearch(page);
	await page.route(GO_PROXY, (route) =>
		route.fulfill({ status: 404, body: "" }),
	);
	await page.goto("/npm");
	await ready(page);
	await field(page).fill("express");
	await option(page, "express").click();

	await page.goto("/crates");
	await ready(page);
	await field(page).click();

	await expect(page.getByRole("option")).toHaveCount(0);
});

test("tells a Go user what it can resolve, and takes a full module path", async ({
	page,
}) => {
	await page.route(GO_PROXY, (route) =>
		route.fulfill({ status: 404, body: "" }),
	);
	await page.goto("/go");
	await ready(page);

	await expect(field(page)).toHaveAttribute(
		"placeholder",
		"github.com/user/module",
	);

	await field(page).fill("chi");
	await expect(page.getByText("Type a full module path")).toBeVisible();

	// Nothing is highlighted, so Enter takes the text as typed — the only way to
	// reach a module the proxy cannot be searched for.
	await field(page).fill("github.com/go-chi/chi/v5");
	await field(page).press("Enter");

	await expect(page).toHaveURL("/go/github.com/go-chi/chi/v5");
	await expect(page.getByTestId("workspace")).toHaveAttribute(
		"data-package",
		"github.com/go-chi/chi/v5",
	);
});
