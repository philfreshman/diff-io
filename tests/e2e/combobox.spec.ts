import { expect, type Page, test } from "@playwright/test";

/**
 * The `Combobox` primitive's contract, driven through its two real call sites:
 * the version selectors for the filtered case, package search for the case
 * where the caller has already filtered the list. Both registries are stubbed,
 * because none of this should depend on what npm published today.
 */
const VERSIONS = {
	versions: {
		"4.16.0": {},
		"4.17.3": {},
		"4.18.2": {},
		"5.0.1": {},
		"5.1.0": {},
	},
};
/** Newest first, as the adapter hands them over. */
const NEWEST_FIRST = ["5.1.0", "5.0.1", "4.18.2", "4.17.3", "4.16.0"];

const RESULTS = [
	{
		package: {
			name: "express",
			version: "5.1.0",
			description: "Fast, unopinionated web framework",
		},
	},
	{ package: { name: "expressive", version: "1.0.0", description: "" } },
];

const input = (page: Page) =>
	page.getByRole("combobox", { name: "From Version" });
const options = (page: Page) => page.getByRole("option");

/** What a screen reader would announce as the current row. */
async function highlighted(page: Page): Promise<string | null> {
	const id = await input(page).getAttribute("aria-activedescendant");
	return id ? page.locator(`#${id}`).textContent() : null;
}

async function stubVersions(page: Page, delayMs = 0) {
	await page.route("https://registry.npmjs.org/express", async (route) => {
		if (delayMs) await new Promise((resolve) => setTimeout(resolve, delayMs));
		await route.fulfill({ json: VERSIONS });
	});
}

/**
 * The wait for `data-ready` matters: Playwright acts as soon as an element is
 * actionable, which can be before React has hydrated it.
 */
async function hydrated(page: Page) {
	await expect(page.locator("[data-ready]").first()).toBeAttached();
}

/** A version field is dead weight until the list it filters has arrived. */
async function ready(page: Page) {
	await hydrated(page);
	await expect(input(page)).toBeEnabled();
}

/** Opens the list and waits for it, so a key press cannot outrun it. */
async function open(page: Page) {
	await ready(page);
	await input(page).click();
	await expect(options(page)).toHaveCount(NEWEST_FIRST.length);
}

test("filters the list to what was typed", async ({ page }) => {
	await stubVersions(page);
	await page.goto("/npm/express");
	await open(page);

	await input(page).fill("5.");

	await expect(options(page)).toHaveText(["5.1.0", "5.0.1"]);
});

test("moves the highlight with the arrow keys, wrapping at both ends", async ({
	page,
}) => {
	await stubVersions(page);
	await page.goto("/npm/express");
	await open(page);

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
	await stubVersions(page);
	await page.goto("/npm/express");
	await open(page);

	await input(page).press("ArrowDown");
	await input(page).press("ArrowDown");
	await input(page).press("ArrowDown");
	await input(page).press("Enter");

	await expect(input(page)).toHaveValue("4.18.2");
	await expect(options(page)).toHaveCount(0);
});

test("Enter with nothing highlighted does nothing where there is no such thing", async ({
	page,
}) => {
	// A version selector's list is the only truth, so it leaves `onSubmitText`
	// out; package search, whose registry cannot be searched for every package,
	// is where Enter on raw text means something.
	await stubVersions(page);
	await page.goto("/npm/express");
	await open(page);

	await input(page).fill("6.0.0-rc.1");
	await input(page).press("Enter");

	await expect(page).toHaveURL("/npm/express");
	await expect(input(page)).toHaveValue("5.0.1");
});

test("Escape closes the list and keeps the text", async ({ page }) => {
	// Package search, because a version field deliberately puts the selected
	// version back when the list closes — its filter text is transient.
	await page.route("https://registry.npmjs.org/-/v1/search**", (route) =>
		route.fulfill({ json: { objects: RESULTS } }),
	);
	await page.goto("/npm");
	await hydrated(page);
	const search = page.getByRole("combobox", { name: "Package Name" });
	await search.fill("expr");
	await expect(options(page).first()).toBeVisible();

	await search.press("Escape");

	await expect(options(page)).toHaveCount(0);
	await expect(search).toHaveValue("expr");
});

test("a click on a row lands, rather than being eaten by the blur", async ({
	page,
}) => {
	await stubVersions(page);
	await page.goto("/npm/express");
	await open(page);

	await options(page).nth(2).click();

	await expect(input(page)).toHaveValue("4.18.2");
	await expect(options(page)).toHaveCount(0);
});

test("says so when nothing matches, instead of showing an empty box", async ({
	page,
}) => {
	await stubVersions(page);
	await page.goto("/npm/express");
	await open(page);

	await input(page).fill("nothing like this");

	await expect(options(page)).toHaveCount(0);
	await expect(page.getByText("No matching versions")).toBeVisible();
});

test("says the list is on its way while the caller fetches it", async ({
	page,
}) => {
	// The stub holds the request open: a list that arrives instantly makes the
	// in-flight state impossible to observe.
	await stubVersions(page, 5_000);
	await page.goto("/npm/express");
	await hydrated(page);

	await input(page).click();

	await expect(page.getByRole("status")).toHaveText("Loading versions…");
	await expect(options(page)).toHaveCount(0);
});

test("announces itself as a combobox over a listbox", async ({ page }) => {
	await stubVersions(page);
	await page.goto("/npm/express");
	await ready(page);

	await expect(input(page)).toHaveAttribute("aria-expanded", "false");

	await input(page).click();

	await expect(input(page)).toHaveAttribute("aria-expanded", "true");
	await expect(page.getByRole("listbox")).toBeVisible();
	await expect(options(page).first()).toHaveAttribute("aria-selected", "false");
});

test("closes when focus leaves the field", async ({ page }) => {
	await stubVersions(page);
	await page.goto("/npm/express");
	await open(page);

	// Tab rather than clicking elsewhere: while the list is open Base UI holds
	// the rest of the document inert, which is its own answer to outside clicks.
	await input(page).press("Tab");

	await expect(options(page)).toHaveCount(0);
});

test("leaves the list alone when the caller has already filtered it", async ({
	page,
}) => {
	await page.route("https://registry.npmjs.org/-/v1/search**", (route) =>
		route.fulfill({ json: { objects: RESULTS } }),
	);
	await page.goto("/npm");
	await hydrated(page);
	const search = page.getByRole("combobox", { name: "Package Name" });

	await search.fill("web framework");

	// Neither result's name contains the query; a local substring filter would
	// have thrown away what the search API just answered.
	await expect(options(page)).toHaveText([/express/, /expressive/]);
});
