import { expect, type Page, test } from "@playwright/test";

/**
 * express 4.18.2 → 5.1.0, the same comparison the viewer suite reads:
 * `package.json` is small and thoroughly changed.
 */
const MANIFEST = "/npm/express/4.18.2/5.1.0/package.json";

/** Downloading and extracting two archives is not a 10 s assertion. */
const ENGINE = { timeout: 90_000 };

const toolbar = (page: Page) => page.getByTestId("diff-toolbar");

/**
 * lodash 4.17.20 → 4.17.21: a handful of changes in a 17 000-line file, so
 * there is plenty folded away to open, and plenty of file between one
 * difference and the next.
 */
const LODASH = "/npm/lodash/4.17.20/4.17.21/lodash.js";

async function open(page: Page, path: string) {
	await page.goto(path);
	await expect(page.getByTestId("diff-view")).toBeVisible(ENGINE);
}

/** The comparison with nothing open in it: the frame, before the file. */
const EXPRESS = "/npm/express/4.18.2/5.1.0";

test("stands whether or not a file is open", async ({ page }) => {
	await page.goto(EXPRESS);
	await expect(page.getByTestId("diff-status")).toHaveAttribute(
		"data-state",
		"ready",
		ENGINE,
	);

	// The tree and the bar are the workspace's frame: choosing a file fills a
	// layout that is already on screen rather than replacing one.
	await expect(page.getByTestId("tree-panel")).toBeVisible();
	await expect(toolbar(page)).toBeVisible();
	await expect(page.getByTestId("file-counter")).toHaveText("14 files");
	// Nothing to navigate through yet, so nothing that navigates is live.
	await expect(
		toolbar(page).getByRole("button", { name: "Next difference" }),
	).toBeDisabled();
	await expect(
		toolbar(page).getByRole("button", { name: "Close file" }),
	).toBeDisabled();
});

test("walks the changed files, and closes the one it is on", async ({
	page,
}) => {
	await open(page, MANIFEST);

	// `package.json` is the last changed file of the comparison, so there is
	// nowhere further down to step.
	await expect(page.getByTestId("file-counter")).toHaveText("14/14 files");
	await expect(
		toolbar(page).getByRole("button", { name: "Next file" }),
	).toBeDisabled();

	await toolbar(page).getByRole("button", { name: "Previous file" }).click();

	await expect(page).toHaveURL(`${EXPRESS}/lib/view.js`);
	await expect(page.getByTestId("file-counter")).toHaveText("13/14 files");

	await toolbar(page).getByRole("button", { name: "Close file" }).click();

	await expect(page).toHaveURL(EXPRESS);
	await expect(page.getByTestId("diff-view")).toHaveCount(0);
});

test("blurs the file it is holding rather than emptying the pane", async ({
	page,
}) => {
	await open(page, MANIFEST);
	const view = page.getByTestId("diff-view");

	// `data-pending` is what the workspace marks the viewer with while the next
	// file is on its way (the rule itself is unit-tested); this is the part
	// that has to survive the build — a stylesheet that stopped matching would
	// leave the pane looking as if nothing were happening.
	await expect(view).toHaveCSS("filter", "none");

	await view.evaluate((node) => node.setAttribute("data-pending", ""));

	await expect(view).toHaveCSS("filter", /blur/);
	// And the rows are still there to be read through it.
	await expect(view.locator("tr").first()).toBeVisible();
});

test("counts the differences, and scrolls to them one at a time", async ({
	page,
}) => {
	await open(page, LODASH);

	// A run of touched lines is one difference, however many lines it is.
	await expect(page.getByTestId("difference-count")).toContainText(
		/^\d+ differences$/,
	);

	const scroller = page.getByTestId("diff-scroller");
	const top = async () => scroller.evaluate((it) => it.scrollTop);
	expect(await top()).toBe(0);

	await toolbar(page).getByRole("button", { name: "Next difference" }).click();
	const first = await top();
	expect(first).toBeGreaterThan(0);

	await toolbar(page).getByRole("button", { name: "Next difference" }).click();
	expect(await top()).toBeGreaterThan(first);

	await toolbar(page)
		.getByRole("button", { name: "Previous difference" })
		.click();
	expect(await top()).toBe(first);
});

/** The gear, and what it opens. */
const settings = (page: Page) =>
	toolbar(page).getByRole("button", { name: "Settings" });

const themeFold = (page: Page) => page.getByTestId("theme-fold");

async function openSettings(page: Page) {
	// A menu opened by a click stays open until it is dismissed, and the gear
	// toggles — so it is shut first, or the click meant to open it closes it.
	if (await themeFold(page).count()) await settings(page).click();
	await expect(themeFold(page)).toHaveCount(0);
	await settings(page).click();
	await expect(
		page.getByRole("checkbox", { name: /whitespace/i }),
	).toBeVisible();
}

test("the gear opens the settings, whitespace among them, not yet live", async ({
	page,
}) => {
	await open(page, MANIFEST);
	await openSettings(page);

	// The setting is stated rather than hidden: it is coming, and saying so is
	// what stops it being asked for again.
	await expect(
		page.getByRole("checkbox", { name: "Ignore whitespaces" }),
	).toBeDisabled();
});

test("names the file being read", async ({ page }) => {
	await open(page, MANIFEST);

	await expect(toolbar(page)).toContainText("package.json");
});

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

/** The themes, a fold in from the gear. */
async function openThemes(page: Page) {
	await openSettings(page);
	await themeFold(page).click();
	await expect(
		page.getByRole("button", { name: "Nord", exact: true }),
	).toBeVisible();
}

test("themes the code, and remembers which theme", async ({ page }) => {
	await open(page, MANIFEST);
	await openThemes(page);

	await page.getByRole("button", { name: "Nord", exact: true }).click();

	await expect(themeLink(page)).toHaveAttribute("href", /nord/);
	// `highlight_theme` is the old app's key, so a returning visitor's theme is
	// still theirs.
	expect(
		await page.evaluate(() => localStorage.getItem("highlight_theme")),
	).toBe("nord");
});

test("every theme it offers is one it can serve", async ({ page }) => {
	await open(page, MANIFEST);
	await openThemes(page);

	const themes = page.getByTestId("theme-option");
	const values = await themes.evaluateAll((nodes) =>
		nodes.map((node) => node.getAttribute("data-theme") ?? ""),
	);
	expect(values).toHaveLength(23);

	// The stylesheets are named one by one so the build emits only these — a
	// theme that fell out of that list would offer a choice that colours
	// nothing, which is invisible until someone picks it.
	for (const value of values) {
		await openThemes(page);
		await page.locator(`[data-theme="${value}"]`).click();
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
