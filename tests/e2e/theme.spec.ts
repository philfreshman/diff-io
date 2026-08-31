import { expect, type Page, test } from "@playwright/test";

/**
 * Captures the theme as it stood at the browser's first paint. The first
 * `requestAnimationFrame` callback of a fresh document runs before that paint,
 * so a wrong value here is exactly the flash a user would see.
 */
async function recordFirstPaintTheme(page: Page) {
	await page.addInitScript(() => {
		requestAnimationFrame(() => {
			(
				window as unknown as { firstPaintTheme?: string | null }
			).firstPaintTheme = document.documentElement.getAttribute("data-theme");
		});
	});
}

async function firstPaintTheme(page: Page) {
	return page.evaluate(
		() =>
			(window as unknown as { firstPaintTheme?: string | null })
				.firstPaintTheme,
	);
}

async function storeSelection(page: Page, selection: string) {
	await page.addInitScript((value) => {
		localStorage.setItem("theme", value);
	}, selection);
}

test("a first-time visitor gets the dark theme before anything is painted", async ({
	page,
}) => {
	await recordFirstPaintTheme(page);
	await page.goto("/");

	expect(await firstPaintTheme(page)).toBe("dark");
	await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
	await expect(page.locator("html")).toHaveAttribute(
		"data-theme-selection",
		"dark",
	);
});

test("a stored light preference is applied before anything is painted", async ({
	page,
}) => {
	await storeSelection(page, "light");
	await recordFirstPaintTheme(page);
	await page.goto("/");

	expect(await firstPaintTheme(page)).toBe("light");
	await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
});

test("the system selection follows the operating system preference", async ({
	page,
}) => {
	await storeSelection(page, "system");

	await page.emulateMedia({ colorScheme: "light" });
	await page.goto("/");
	await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
	await expect(page.locator("html")).toHaveAttribute(
		"data-theme-selection",
		"system",
	);

	await page.emulateMedia({ colorScheme: "dark" });
	await page.reload();
	await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
});

test("the toggle cycles the selection and remembers it", async ({ page }) => {
	await page.emulateMedia({ colorScheme: "light" });
	await page.goto("/");

	const toggle = page.getByRole("button", { name: /theme/i });
	// The toggle enables itself once mounted; clicking before that does nothing.
	await expect(toggle).toBeEnabled();
	const html = page.locator("html");
	const stored = () => page.evaluate(() => localStorage.getItem("theme"));

	await expect(html).toHaveAttribute("data-theme-selection", "dark");

	await toggle.click();
	await expect(html).toHaveAttribute("data-theme-selection", "system");
	await expect(html).toHaveAttribute("data-theme", "light");
	expect(await stored()).toBe("system");

	await toggle.click();
	await expect(html).toHaveAttribute("data-theme-selection", "light");
	expect(await stored()).toBe("light");

	await toggle.click();
	await expect(html).toHaveAttribute("data-theme-selection", "dark");
	await expect(html).toHaveAttribute("data-theme", "dark");
	expect(await stored()).toBe("dark");

	// The choice survives a reload, not just this page's lifetime.
	await page.reload();
	await expect(html).toHaveAttribute("data-theme-selection", "dark");
});
