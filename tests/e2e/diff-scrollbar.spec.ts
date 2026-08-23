import { expect, type Page, test } from "@playwright/test";

/**
 * lodash 4.17.20 → 4.17.21: a handful of changes scattered through a
 * 17 000-line file. It is the file the minimap exists for — the changes are
 * nowhere near each other, and almost none of them are ever rendered.
 */
const LODASH = "/npm/lodash/4.17.20/4.17.21/lodash.js";

/** Downloading and extracting two archives is not a 10 s assertion. */
const ENGINE = { timeout: 90_000 };

async function open(page: Page, path: string) {
	await page.goto(path);
	await expect(page.getByTestId("diff-view")).toBeVisible(ENGINE);
}

const scrollbar = (page: Page) => page.getByTestId("diff-scrollbar");
const thumb = (page: Page) => page.getByTestId("diff-scrollbar-thumb");
const scroller = (page: Page) => page.getByTestId("diff-scroller");

const scrollTop = (page: Page) =>
	scroller(page).evaluate((element) => element.scrollTop);

test("shows the scrollbar while the file is being scrolled, then hides it", async ({
	page,
}) => {
	await open(page, LODASH);
	await expect(scrollbar(page)).toHaveAttribute("data-shown", "false");

	await scroller(page).hover();
	await page.mouse.wheel(0, 600);
	await expect(scrollbar(page)).toHaveAttribute("data-shown", "true");

	// It is a reading aid, not furniture: it gets out of the way once the
	// reader has stopped moving.
	await expect(scrollbar(page)).toHaveAttribute("data-shown", "false");
});

test("scrolls the file by dragging the thumb", async ({ page }) => {
	await open(page, LODASH);

	const track = await scrollbar(page).boundingBox();
	const grip = await thumb(page).boundingBox();
	if (!track || !grip) throw new Error("no scrollbar");

	await page.mouse.move(grip.x + grip.width / 2, grip.y + grip.height / 2);
	await page.mouse.down();
	await page.mouse.move(grip.x + grip.width / 2, track.y + track.height / 2);
	await page.mouse.up();

	// Half way down the track is roughly half way through the file, and the
	// thumb has followed the pointer rather than the rows it passed over.
	expect(await scrollTop(page)).toBeGreaterThan(0);
	const dropped = await thumb(page).boundingBox();
	expect(dropped?.y ?? 0).toBeGreaterThan(track.y + track.height / 4);
});

test("jumps to a part of the file clicked in the track", async ({ page }) => {
	await open(page, LODASH);

	const track = await scrollbar(page).boundingBox();
	if (!track) throw new Error("no scrollbar");
	await page.mouse.click(track.x + track.width / 2, track.y + track.height - 8);

	expect(await scrollTop(page)).toBeGreaterThan(0);
});

test("marks every change in the file, not only the rendered ones", async ({
	page,
}) => {
	await open(page, LODASH);

	const markers = page.getByTestId("diff-marker");
	await expect(markers.first()).toBeAttached();

	// The rows on screen are the top of a 17 000-line file, so a minimap taken
	// from the DOM could not put a marker anywhere near the bottom of the track.
	const track = await scrollbar(page).boundingBox();
	const last = await markers.last().boundingBox();
	if (!track || !last) throw new Error("no markers");
	expect(last.y).toBeGreaterThan(track.y + track.height / 2);
});
