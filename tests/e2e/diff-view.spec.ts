import { expect, type Page, test } from "@playwright/test";
import { SPLIT_VIEW_KEY } from "#/lib/diff/prefs.ts";

/**
 * express 4.18.2 → 5.1.0 again: a real comparison from the real registry, since
 * the engine only runs in a worker and there is nothing to stub. `package.json`
 * is small and thoroughly changed; `lib/response.js` is long enough to fold.
 */
const MANIFEST = "/npm/express/4.18.2/5.1.0/package.json";

/** Downloading and extracting two archives is not a 10 s assertion. */
const ENGINE = { timeout: 90_000 };

async function open(page: Page, path: string) {
	await page.goto(path);
	await expect(page.getByTestId("diff-view")).toBeVisible(ENGINE);
}

const lines = (page: Page, type: string) =>
	page.getByTestId("diff-view").locator(`tr[data-type="${type}"]`);

test("shows the file as numbered lines, marked by what happened to them", async ({
	page,
}) => {
	await open(page, MANIFEST);

	// Both gutters: a line only in the new file has a new number and no old one,
	// which is the whole of what the two columns say.
	const added = lines(page, "added").first();
	await expect(added).toBeVisible();
	await expect(added.getByTestId("old-number")).toHaveText("");
	await expect(added.getByTestId("new-number")).toHaveText(/^\d+$/);

	const removed = lines(page, "removed").first();
	await expect(removed.getByTestId("old-number")).toHaveText(/^\d+$/);
	await expect(removed.getByTestId("new-number")).toHaveText("");
});

/**
 * lodash 4.17.20 → 4.17.21: a handful of changes in a 17 000-line file. It is
 * the case folding exists for, and the case virtualisation exists for.
 */
const LODASH = "/npm/lodash/4.17.20/4.17.21/lodash.js";

const folds = (page: Page) => page.getByTestId("fold");

test("stands the untouched lines down into folds", async ({ page }) => {
	await open(page, LODASH);

	// A fold says how much it is holding, so the reader can tell a hidden
	// paragraph from a hidden page.
	await expect(folds(page).first()).toHaveText(/Collapsed \d+ lines/);
});

test("opens a fold twenty lines at a time", async ({ page }) => {
	await open(page, LODASH);

	// A fold in the body of the file is the one that can be walked inward; the
	// first and last can only be opened whole.
	const stepped = folds(page)
		.filter({ has: page.getByRole("button", { name: /lines down$/ }) })
		.first();
	const start = Number(await stepped.getAttribute("data-start"));
	const count = Number(await stepped.getAttribute("data-count"));
	await stepped.getByRole("button", { name: "Expand 20 lines down" }).click();
	// The twenty lines it revealed push what is left of the fold below the
	// window, and a virtualised list draws only what is near it — so follow it
	// down the twenty rows it moved.
	await page.getByTestId("diff-scroller").evaluate((node) => {
		node.scrollTop += 20 * 24;
	});

	// Twenty lines were offered and twenty is what it gave: what is left of the
	// fold starts twenty lines further down and is twenty lines shorter.
	const left = folds(page).and(page.locator(`[data-start="${start + 20}"]`));
	await expect(left).toHaveAttribute("data-count", String(count - 20));
});

test("opens a fold whole", async ({ page }) => {
	await open(page, LODASH);

	const fold = folds(page).first();
	const start = await fold.getAttribute("data-start");
	await fold.getByRole("button", { name: "Expand all lines" }).click();

	await expect(
		folds(page).and(page.locator(`[data-start="${start}"]`)),
	).toHaveCount(0);
});

test("draws only the rows on screen, however long the file", async ({
	page,
}) => {
	await open(page, LODASH);

	const scroller = page.getByTestId("diff-scroller");
	const drawn = page.getByTestId("diff-view").locator("tr");
	const overflow = await scroller.evaluate(
		(node) => node.scrollHeight / node.clientHeight,
	);
	expect(overflow).toBeGreaterThan(3);

	// The old renderer bypassed React to survive files this size. This one
	// draws a screenful, and the scroll height stands for the rest.
	const screenful = await drawn.count();
	expect(screenful).toBeLessThan(200);

	const top = await drawn.first().getAttribute("data-index");
	await scroller.evaluate((node) => {
		node.scrollTop = node.scrollHeight;
	});

	// A different screenful, and still a screenful.
	await expect(drawn.first()).not.toHaveAttribute("data-index", top ?? "");
	expect(await drawn.count()).toBeLessThan(200);
});

/**
 * Virtualisation moves what is under a still pointer on every scroll step: a
 * row, the stretched table behind it, a fold's padding. Left to `auto` the
 * browser reads each of those differently and the cursor flickers, so the
 * scroller states it and every row inherits it.
 */
test("keeps a text cursor over the whole file while it is scrolled", async ({
	page,
}) => {
	await open(page, LODASH);

	const scroller = page.getByTestId("diff-scroller");
	const cursors = await scroller.evaluate((node) => {
		const seen = new Set<string>();
		for (const element of [node, ...node.querySelectorAll("*")]) {
			// The ways of opening a fold are controls, not text.
			if (element.closest("button")) continue;
			seen.add(getComputedStyle(element).cursor);
		}
		return [...seen];
	});

	expect(cursors).toEqual(["text"]);
});

test("puts the old file beside the new one when that is the preference", async ({
	page,
}) => {
	// A returning visitor's choice, which is where it is kept; task 13's toggle
	// is the other way to set it.
	await page.addInitScript(
		(key) => localStorage.setItem(key, "true"),
		SPLIT_VIEW_KEY,
	);
	await open(page, MANIFEST);

	// A removal and the addition that replaced it are one change, so the two
	// are opposite each other rather than stacked — the whole reason to read a
	// diff this way.
	const replaced = page
		.getByTestId("diff-view")
		.locator('tr[data-left-type="removed"][data-right-type="added"]');
	await expect(replaced.first()).toBeVisible();
});

const treeRow = (page: Page, path: string) =>
	page.getByRole("treeitem").and(page.locator(`[data-path="${path}"]`));

test("remembers what was opened in a file, and where it was left", async ({
	page,
}) => {
	await open(page, LODASH);

	const scroller = page.getByTestId("diff-scroller");
	await folds(page)
		.first()
		.getByRole("button", { name: "Expand all lines" })
		.click();
	const opened = await page.getByTestId("diff-view").getAttribute("data-rows");
	await scroller.evaluate((node) => {
		node.scrollTop = 900;
	});

	// Clicking through the tree and back is the normal way to read a diff. A
	// file that forgot what had been opened in it would make every return a
	// fresh start, halfway through a review.
	await treeRow(page, "package.json").click();
	await expect(page.getByTestId("diff-view")).toHaveAttribute(
		"data-path",
		"package.json",
	);
	await treeRow(page, "lodash.js").click();
	await expect(page.getByTestId("diff-view")).toHaveAttribute(
		"data-path",
		"lodash.js",
	);

	// The same file, showing the same rows, at the same line — the position is
	// restored to the row it was left on rather than to the pixel.
	await expect(page.getByTestId("diff-view")).toHaveAttribute(
		"data-rows",
		opened ?? "",
	);
	const back = await scroller.evaluate((node) => node.scrollTop);
	expect(Math.abs(back - 900)).toBeLessThan(24);
});

test("a new comparison is a new file, opened at the top", async ({ page }) => {
	await open(page, LODASH);

	const fold = folds(page).first();
	const start = await fold.getAttribute("data-start");
	await fold.getByRole("button", { name: "Expand all lines" }).click();

	// What had been opened in one comparison's file means nothing in another's.
	await page.goto("/npm/lodash/4.17.19/4.17.21/lodash.js");
	await expect(page.getByTestId("diff-view")).toBeVisible(ENGINE);

	await expect(
		folds(page).and(page.locator(`[data-start="${start}"]`)),
	).toHaveCount(1);
});

test("Escape closes the file and leaves the comparison open", async ({
	page,
}) => {
	await open(page, MANIFEST);

	await page.keyboard.press("Escape");

	await expect(page.getByTestId("diff-view")).toBeHidden();
	await expect(page).toHaveURL("/npm/express/4.18.2/5.1.0");
	await expect(page.getByRole("tree")).toBeVisible();
});

test("Escape in a field is the field's, not the viewer's", async ({ page }) => {
	await open(page, MANIFEST);

	// Escape closes a combobox's list and leaves what was typed (task 6). A
	// viewer that also read it would close the file out from under the user.
	await page.getByRole("combobox", { name: "Package Name" }).click();
	await page.keyboard.press("Escape");

	await expect(page.getByTestId("diff-view")).toBeVisible();
});
