import { expect, type Page, test } from "@playwright/test";
import { THEME_STORAGE_KEY } from "#/lib/theme.ts";

function tokenValue(page: Page, token: string) {
	return page.evaluate(
		(name) =>
			getComputedStyle(document.documentElement).getPropertyValue(name).trim(),
		token,
	);
}

test("semantic colour tokens resolve to different values per theme", async ({
	page,
}) => {
	await page.addInitScript(
		(key) => localStorage.setItem(key, "light"),
		THEME_STORAGE_KEY,
	);
	await page.goto("/");

	const light = {
		background: await tokenValue(page, "--color-background"),
		foreground: await tokenValue(page, "--color-foreground"),
	};

	const toggle = page.getByRole("button", { name: /theme/i });
	await expect(toggle).toBeEnabled();
	await toggle.click();
	await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");

	expect(await tokenValue(page, "--color-background")).not.toBe(
		light.background,
	);
	expect(await tokenValue(page, "--color-foreground")).not.toBe(
		light.foreground,
	);
});

test("the display font is loaded and used for the wordmark", async ({
	page,
}) => {
	await page.goto("/");

	const heading = page.getByRole("heading", { name: "diffpack" });
	await expect(heading).toHaveCSS("font-family", /Miriam Libre/);

	// The wordmark is the bold face; a font-family that resolves but never loads
	// would silently render the fallback.
	const loaded = await page.evaluate(async () => {
		await document.fonts.ready;
		return document.fonts.check('700 1rem "Miriam Libre"');
	});
	expect(loaded).toBe(true);
});
