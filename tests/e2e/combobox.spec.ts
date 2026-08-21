import { expect, type Page, test } from "@playwright/test";

const input = (page: Page) => page.getByRole("combobox", { name: "Version" });
const options = (page: Page) => page.getByRole("option");

/** What a screen reader would announce as the current row. */
async function highlighted(page: Page): Promise<string | null> {
	const id = await input(page).getAttribute("aria-activedescendant");
	return id ? page.locator(`#${id}`).textContent() : null;
}

/** The harness holds two comboboxes; either one being live means React is. */
function ready(page: Page) {
	return expect(page.locator("[data-ready]").first()).toBeAttached();
}

/**
 * Opens the list and waits for it, so a key press cannot outrun it. The wait
 * for `data-ready` matters: Playwright clicks as soon as an element is
 * actionable, which can be before React has hydrated it.
 */
async function open(page: Page, count: number) {
	await ready(page);
	await input(page).click();
	await expect(options(page)).toHaveCount(count);
}

test("filters the list to what was typed", async ({ page }) => {
	await page.goto("/spike-combobox");
	await open(page, 5);

	await input(page).fill("5.");

	await expect(options(page)).toHaveText(["5.1.0", "5.0.1"]);
});

test("moves the highlight with the arrow keys, wrapping at both ends", async ({
	page,
}) => {
	await page.goto("/spike-combobox");
	await open(page, 5);

	await input(page).press("ArrowDown");
	expect(await highlighted(page)).toBe("5.1.0");

	// The input itself is part of the loop, per the ARIA practices guide, so
	// stepping off the last row lands there before coming back to the first.
	for (let i = 0; i < 4; i += 1) await input(page).press("ArrowDown");
	expect(await highlighted(page)).toBe("4.16.0");

	await input(page).press("ArrowDown");
	expect(await highlighted(page)).toBe(null);

	await input(page).press("ArrowUp");
	expect(await highlighted(page)).toBe("4.16.0");
});

test("Enter takes the highlighted row", async ({ page }) => {
	await page.goto("/spike-combobox");
	await open(page, 5);

	await input(page).press("ArrowDown");
	await input(page).press("ArrowDown");
	await input(page).press("Enter");

	await expect(page.getByTestId("selected")).toHaveText("5.0.1");
	await expect(input(page)).toHaveValue("5.0.1");
	await expect(options(page)).toHaveCount(0);
});

test("Enter with nothing highlighted accepts what was typed", async ({
	page,
}) => {
	await page.goto("/spike-combobox");
	await open(page, 5);

	await input(page).fill("6.0.0-rc.1");
	await input(page).press("Enter");

	await expect(page.getByTestId("submitted")).toHaveText("6.0.0-rc.1");
	await expect(page.getByTestId("selected")).toBeEmpty();
});

test("Escape closes the list and keeps the text", async ({ page }) => {
	await page.goto("/spike-combobox");
	await open(page, 5);
	await input(page).fill("4.1");

	await input(page).press("Escape");

	await expect(options(page)).toHaveCount(0);
	await expect(input(page)).toHaveValue("4.1");
});

test("a click on a row lands, rather than being eaten by the blur", async ({
	page,
}) => {
	await page.goto("/spike-combobox");
	await open(page, 5);

	await options(page).nth(2).click();

	await expect(page.getByTestId("selected")).toHaveText("4.18.2");
	await expect(options(page)).toHaveCount(0);
});

test("says so when nothing matches, instead of showing an empty box", async ({
	page,
}) => {
	await page.goto("/spike-combobox");
	await open(page, 5);

	await input(page).fill("nothing like this");

	await expect(options(page)).toHaveCount(0);
	await expect(page.getByText("No matches")).toBeVisible();
});

test("says the list is on its way while the caller fetches it", async ({
	page,
}) => {
	await page.goto("/spike-combobox");
	await ready(page);
	await page.getByRole("button", { name: "toggle loading" }).click();

	await input(page).click();

	await expect(page.getByRole("status")).toHaveText("Loading…");
	await expect(options(page)).toHaveCount(0);
});

test("announces itself as a combobox over a listbox", async ({ page }) => {
	await page.goto("/spike-combobox");
	await ready(page);

	await expect(input(page)).toHaveAttribute("aria-expanded", "false");

	await input(page).click();

	await expect(input(page)).toHaveAttribute("aria-expanded", "true");
	await expect(page.getByRole("listbox")).toBeVisible();
	await expect(options(page).first()).toHaveAttribute("aria-selected", "false");
});

test("closes when focus leaves the field", async ({ page }) => {
	await page.goto("/spike-combobox");
	await open(page, 5);

	// Tab rather than clicking elsewhere: while the list is open Base UI holds
	// the rest of the document inert, which is its own answer to outside clicks.
	await input(page).press("Tab");

	// Asserted by content: focus lands on the next combobox, which opens its own
	// list and holds the rest of the document inert while it is up.
	await expect(page.getByRole("option", { name: "5.1.0" })).toHaveCount(0);
});

test("leaves the list alone when the caller has already filtered it", async ({
	page,
}) => {
	await page.goto("/spike-combobox");
	await ready(page);
	const search = page.getByRole("combobox", { name: "Package" });

	await search.click();
	await search.fill("web framework");

	// Neither result's name contains the query; a local substring filter would
	// have thrown away what the search API just answered.
	await expect(page.getByRole("option")).toHaveText([/express/, /expressive/]);

	await page.getByRole("option").first().click();

	await expect(page.getByTestId("picked")).toHaveText("express");
});
