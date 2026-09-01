import { expect, type Page, test } from "@playwright/test";
import { TREE_WIDTH_KEY } from "#/lib/tree/prefs.ts";

/**
 * express 4.18.2 → 5.1.0: a real, nested, thoroughly changed comparison, which
 * is what the tree exists for. It comes from the real registry — the engine
 * only runs in a worker, so there is nothing to stub.
 */
const EXPRESS = "/npm/express/4.18.2/5.1.0";

/** Downloading and extracting two archives is not a 10 s assertion. */
const ENGINE = { timeout: 90_000 };

const tree = (page: Page) => page.getByRole("tree");
const row = (page: Page, name: string | RegExp) =>
	page.getByRole("treeitem").filter({ hasText: name });

async function ready(page: Page) {
	await expect(page.getByTestId("diff-status")).toHaveAttribute(
		"data-state",
		"ready",
		ENGINE,
	);
}

test("shows the comparison as a tree of folders and files", async ({
	page,
}) => {
	await page.goto(EXPRESS);
	await ready(page);

	await expect(tree(page)).toBeVisible();
	await expect(row(page, "package.json")).toBeVisible();
	await expect(row(page, "lib").first()).toBeVisible();
});

test("says what changed in each file, and how much", async ({ page }) => {
	await page.goto(EXPRESS);
	await ready(page);

	const manifest = row(page, "package.json");
	// The counts are the engine's, so the assertion is on their shape rather
	// than on numbers npm could republish.
	await expect(manifest.getByTestId("added")).toHaveText(/^\+\d+$/);
	await expect(manifest.getByTestId("removed")).toHaveText(/^-\d+$/);

	// A folder answers for everything under it, or a collapsed folder would say
	// nothing changed inside it.
	await expect(row(page, "lib").first().getByTestId("removed")).toHaveText(
		/^-\d+$/,
	);
});

test("opens on what changed, without the untouched files", async ({ page }) => {
	await page.goto(EXPRESS);
	await ready(page);

	// only-modified is on for a first-time visitor, and the folders leading to
	// what changed open themselves — so a nested file is one look away, not
	// three clicks.
	await expect(row(page, "query.js")).toBeVisible();
	await expect(row(page, "query.js")).toHaveAttribute("data-status", "removed");
	await expect(
		page.locator("[role='treeitem'][data-status='unchanged']"),
	).toHaveCount(0);
});

test("colours a file by what happened to it", async ({ page }) => {
	await page.goto(EXPRESS);
	await ready(page);

	const removed = await row(page, "query.js")
		.getByTestId("name")
		.evaluate((node) => getComputedStyle(node).color);
	const modified = await row(page, "package.json")
		.getByTestId("name")
		.evaluate((node) => getComputedStyle(node).color);

	expect(removed).toBe("rgb(248, 113, 113)");
	expect(modified).toBe("rgb(251, 191, 36)");
});

test("filtering narrows the tree to what matches, and opens the way to it", async ({
	page,
}) => {
	await page.goto(EXPRESS);
	await ready(page);

	await page
		.getByRole("searchbox", { name: "Filter files and folders" })
		.fill("router");

	await expect(row(page, "layer.js")).toBeVisible();
	await expect(row(page, "package.json")).toHaveCount(0);
});

test("the toggle brings the unchanged files back, and remembers it", async ({
	page,
}) => {
	await page.goto(EXPRESS);
	await ready(page);
	const toggle = page.getByRole("button", { name: "Show only modified files" });
	await expect(toggle).toHaveAttribute("aria-pressed", "true");

	await toggle.click();

	await expect(toggle).toHaveAttribute("aria-pressed", "false");
	await expect(
		page.locator("[role='treeitem'][data-status='unchanged']").first(),
	).toBeVisible();

	await page.reload();
	await ready(page);

	await expect(
		page.getByRole("button", { name: "Show only modified files" }),
	).toHaveAttribute("aria-pressed", "false");
});

test("a folder opens and shuts on click, and stays shut", async ({ page }) => {
	await page.goto(EXPRESS);
	await ready(page);
	const middleware = row(page, "middleware");
	await expect(middleware).toHaveAttribute("aria-expanded", "true");

	await middleware.click();

	// Closing by hand outranks the auto-expansion only-modified would do.
	await expect(middleware).toHaveAttribute("aria-expanded", "false");
	await expect(row(page, "query.js")).toHaveCount(0);

	await middleware.click();

	await expect(row(page, "query.js")).toBeVisible();
});

test("shows at a glance which rows open and which are files", async ({
	page,
}) => {
	await page.goto(EXPRESS);
	await ready(page);

	const middleware = row(page, "middleware");
	await expect(middleware.getByTestId("chevron")).toHaveAttribute(
		"data-expanded",
		"true",
	);
	await expect(middleware.getByTestId("icon")).toHaveAttribute(
		"data-icon",
		"folder-open",
	);

	await middleware.click();

	await expect(middleware.getByTestId("chevron")).toHaveAttribute(
		"data-expanded",
		"false",
	);
	await expect(middleware.getByTestId("icon")).toHaveAttribute(
		"data-icon",
		"folder",
	);
	// A file has nothing to open, so it has no chevron at all.
	await expect(row(page, "package.json").getByTestId("chevron")).toHaveCount(0);
	await expect(row(page, "package.json").getByTestId("icon")).toHaveAttribute(
		"data-icon",
		"file",
	);
});

test("the tree is one tab stop, and the arrows move inside it", async ({
	page,
}) => {
	await page.goto(EXPRESS);
	await ready(page);
	const rows = page.getByRole("treeitem");

	// Roving tabindex: whatever the tree's row count, Tab reaches the tree once.
	await expect(rows.first()).toHaveAttribute("tabindex", "0");
	await expect(page.locator("[role='treeitem'][tabindex='0']")).toHaveCount(1);

	await rows.first().focus();
	await page.keyboard.press("ArrowDown");

	await expect(rows.nth(1)).toBeFocused();
	await expect(rows.nth(1)).toHaveAttribute("tabindex", "0");
	await expect(page.locator("[role='treeitem'][tabindex='0']")).toHaveCount(1);

	await page.keyboard.press("ArrowUp");
	await expect(rows.first()).toBeFocused();

	await page.keyboard.press("End");
	await expect(rows.last()).toBeFocused();

	await page.keyboard.press("Home");
	await expect(rows.first()).toBeFocused();
});

test("left and right walk the folder structure", async ({ page }) => {
	await page.goto(EXPRESS);
	await ready(page);
	const middleware = row(page, "middleware");

	await middleware.focus();
	await page.keyboard.press("ArrowLeft");

	// Left closes an open folder; a second left goes up to its parent.
	await expect(middleware).toHaveAttribute("aria-expanded", "false");
	await page.keyboard.press("ArrowLeft");
	await expect(row(page, "lib").first()).toBeFocused();

	await page.keyboard.press("ArrowRight");
	await page.keyboard.press("ArrowRight");

	// Right on an open folder steps into it rather than doing nothing.
	await expect(row(page, "application.js")).toBeFocused();
});

test("Enter opens the focused file", async ({ page }) => {
	await page.goto(EXPRESS);
	await ready(page);

	await row(page, "package.json").focus();
	await page.keyboard.press("Enter");

	await expect(page).toHaveURL(`${EXPRESS}/package.json`);
	await expect(row(page, "package.json")).toHaveAttribute(
		"aria-selected",
		"true",
	);
});

test("counts the comparison at the foot of the panel it describes", async ({
	page,
}) => {
	await page.goto(EXPRESS);
	await ready(page);

	// The count is about the tree, so it stands under the tree rather than over
	// the whole body.
	const panel = page.getByTestId("tree-panel");
	const status = panel.getByTestId("diff-status");
	await expect(status).toHaveText(/^\d+ files, \d+ changed$/);

	const rows = (await tree(page).boundingBox()) ?? { y: 0, height: 0 };
	const foot = (await status.boundingBox()) ?? { y: 0, height: 0 };
	expect(foot.y).toBeGreaterThanOrEqual(rows.y + rows.height);
});

test("the panel is resizable, within limits, and stays where it was put", async ({
	page,
}) => {
	await page.goto(EXPRESS);
	await ready(page);
	const panel = page.getByTestId("tree-panel");
	const width = () =>
		panel.evaluate((node) => node.getBoundingClientRect().width);

	expect(await width()).toBe(320);

	const handle = page.getByRole("separator", { name: "Resize file tree" });
	const box = (await handle.boundingBox()) ?? {
		x: 0,
		y: 0,
		width: 0,
		height: 0,
	};
	const grip = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
	await page.mouse.move(grip.x, grip.y);
	await page.mouse.down();
	await page.mouse.move(grip.x + 120, grip.y, { steps: 5 });
	await page.mouse.up();

	expect(await width()).toBe(440);

	await page.reload();
	await ready(page);

	expect(await width()).toBe(440);
});

test("a stored width is applied before the first paint", async ({ page }) => {
	// Applied by the pre-paint script, like the theme: a panel that starts at
	// its default and jumps once React hydrates is a visible flash.
	await page.addInitScript((key) => {
		localStorage.setItem(key, "9999");
	}, TREE_WIDTH_KEY);
	await page.goto(EXPRESS);

	const applied = await page.evaluate(() =>
		document.documentElement.style.getPropertyValue("--tree-panel-width"),
	);

	// Clamped, too: a stored width has to leave room for the diff.
	expect(applied).toBe("640px");
});

test("the resizer answers the keyboard too", async ({ page }) => {
	await page.goto(EXPRESS);
	await ready(page);
	const handle = page.getByRole("separator", { name: "Resize file tree" });
	const panel = page.getByTestId("tree-panel");

	await handle.focus();
	await page.keyboard.press("ArrowRight");
	await page.keyboard.press("ArrowRight");

	expect(
		await panel.evaluate((node) => node.getBoundingClientRect().width),
	).toBe(352);
	// A slider-like control has to say where it is, not just look draggable.
	await expect(handle).toHaveAttribute("aria-valuenow", "352");
});
