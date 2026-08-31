import { expect, type Page, test } from "@playwright/test";

/**
 * express 4.18.2 → 5.1.0, the same comparison the viewer suite reads:
 * `package.json` is small and thoroughly changed.
 */
const MANIFEST = "/npm/express/4.18.2/5.1.0/package.json";

/** Downloading and extracting two archives is not a 10 s assertion. */
const ENGINE = { timeout: 90_000 };

const toolbar = (page: Page) => page.getByTestId("diff-toolbar");

async function open(page: Page, path: string) {
	await page.goto(path);
	await expect(page.getByTestId("diff-view")).toBeVisible(ENGINE);
}

test("names the file being read", async ({ page }) => {
	await open(page, MANIFEST);

	await expect(toolbar(page)).toContainText("package.json");
});

/**
 * lodash 4.17.20 → 4.17.21: a handful of changes in a 17 000-line file, so
 * there is plenty folded away to open.
 */
const LODASH = "/npm/lodash/4.17.20/4.17.21/lodash.js";

test("opens the whole file, and folds it back up", async ({ page }) => {
	await open(page, LODASH);

	const viewer = page.getByTestId("diff-view");
	const folded = await viewer.getAttribute("data-rows");
	await toolbar(page).getByRole("button", { name: "Expand all" }).click();

	// Nothing is stood down any more: the file is showing every line it has.
	await expect(page.getByTestId("fold")).toHaveCount(0);
	await expect(viewer).not.toHaveAttribute("data-rows", folded ?? "");

	await toolbar(page).getByRole("button", { name: "Fold all" }).click();

	await expect(viewer).toHaveAttribute("data-rows", folded ?? "");
});

const splitRows = (page: Page) =>
	page.getByTestId("diff-view").locator("tr[data-left-type]");

test("puts the old file beside the new one, and remembers that it was asked", async ({
	page,
}) => {
	await open(page, MANIFEST);

	await expect(splitRows(page)).toHaveCount(0);
	await toolbar(page)
		.getByRole("button", { name: "Switch to split view" })
		.click();

	await expect(splitRows(page).first()).toBeVisible();
	// The preference outlives the page: it is the same key the old app wrote,
	// so a returning visitor's choice still stands.
	expect(
		await page.evaluate(() => localStorage.getItem("split-view-preference")),
	).toBe("true");

	await toolbar(page)
		.getByRole("button", { name: "Switch to unified view" })
		.click();

	await expect(splitRows(page)).toHaveCount(0);
	expect(
		await page.evaluate(() => localStorage.getItem("split-view-preference")),
	).toBe("false");
});

const themeLink = (page: Page) => page.locator("link#highlight-theme");

test("themes the code, and remembers which theme", async ({ page }) => {
	await open(page, MANIFEST);

	await toolbar(page)
		.getByRole("combobox", { name: "Theme:" })
		.selectOption({ label: "Nord" });

	await expect(themeLink(page)).toHaveAttribute("href", /nord/);
	// `highlight_theme` is the old app's key, so a returning visitor's theme is
	// still theirs.
	expect(
		await page.evaluate(() => localStorage.getItem("highlight_theme")),
	).toBe("nord");
});

test("every theme it offers is one it can serve", async ({ page }) => {
	await open(page, MANIFEST);

	const select = toolbar(page).getByRole("combobox", { name: "Theme:" });
	const values = await select
		.locator("option")
		.evaluateAll((options) =>
			options.map((option) => (option as HTMLOptionElement).value),
		);
	expect(values).toHaveLength(23);

	// The stylesheets are named one by one so the build emits only these — a
	// theme that fell out of that list would offer an option that colours
	// nothing, which is invisible until someone picks it.
	for (const value of values) {
		await select.selectOption(value);
		// The stylesheet is this theme's, not whichever one was showing before:
		// a theme missing from the list would otherwise leave the previous
		// theme's `<link>` in place and look like it had worked.
		const name = value.split("/").at(-1) ?? value;
		await expect(themeLink(page), value).toHaveAttribute(
			"href",
			new RegExp(name),
		);

		const href = await themeLink(page).getAttribute("href");
		const response = await page.request.get(href ?? "");
		expect(response.status(), value).toBe(200);
	}
});

test("colours the code by what the tokens are", async ({ page }) => {
	await open(page, MANIFEST);

	// The language is the file's name, not a guess taken from the diff: with
	// both versions of every key interleaved, auto-detection reads this file as
	// Perl.
	await expect(page.getByTestId("diff-view")).toHaveAttribute(
		"data-language",
		"json",
	);

	// Its keys are attributes, then — and highlight.js's classes are what a
	// theme's stylesheet is written against.
	await expect(
		page.getByTestId("diff-view").locator("span.hljs-attr").first(),
	).toBeVisible();
});
