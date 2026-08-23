import { expect, type Page, test } from "@playwright/test";

/**
 * The sky is a WebGL canvas, so there is nothing to read back out of it: its
 * drawing buffer is undefined once the browser has composited it, and asking
 * for a 2d context on it fails outright. What the component offers instead is
 * `data-drawn`, set the first time a frame actually reaches the canvas — which
 * is the thing worth waiting for anyway.
 */
function skyIsDrawn(page: Page) {
	return expect(page.getByTestId("star-field")).toHaveAttribute(
		"data-drawn",
		"true",
	);
}

test("paints a star field behind the page", async ({ page }) => {
	const errors: string[] = [];
	page.on("pageerror", (error) => errors.push(error.message));
	page.on("console", (message) => {
		if (message.type() === "error") errors.push(message.text());
	});

	await page.goto("/");
	await expect(page.getByTestId("star-field")).toBeAttached();
	await skyIsDrawn(page);

	expect(errors).toEqual([]);
});

test("keeps the star field out of the accessibility tree and pointer path", async ({
	page,
}) => {
	await page.goto("/");

	const canvas = page.getByTestId("star-field");
	await expect(canvas).toHaveAttribute("aria-hidden", "true");
	await expect(canvas).toHaveCSS("pointer-events", "none");
});

test("holds the sky still when the visitor asks for reduced motion", async ({
	page,
}) => {
	await page.emulateMedia({ reducedMotion: "reduce" });
	await page.goto("/");
	// The sky is client-only now that it depends on the theme, so the canvas
	// arrives after hydration rather than in the server's HTML.
	await expect(page.getByTestId("star-field")).toBeAttached();
	await skyIsDrawn(page);

	// Marks pulse, the field drifts and shooting stars travel, so an animating
	// sky composites differently from one moment to the next; a still one does
	// not. The screenshot is the only honest way to compare — see above.
	const first = await page.screenshot();
	await page.waitForTimeout(600);
	expect((await page.screenshot()).equals(first)).toBe(true);
});

test("the sky reaches the screen, rather than being painted over", async ({
	browser,
}) => {
	// Reduced motion holds the sky still, so two screenshots of the same page
	// differ only because of what is or is not painted.
	const page = await browser.newPage({ reducedMotion: "reduce" });
	await page.goto("/");
	await expect(page.getByTestId("star-field")).toBeAttached();
	await skyIsDrawn(page);

	const sky = await page.screenshot();
	await page.addStyleTag({
		content: '[data-testid="star-field"] { display: none }',
	});
	const noSky = await page.screenshot();

	expect(sky.equals(noSky)).toBe(false);
	await page.close();
});

test("keeps the sky to the landing page", async ({ page }) => {
	await page.goto("/");
	await expect(page.getByTestId("star-field")).toBeAttached();

	await page.goto("/npm/express/4.18.2/5.1.0");

	await expect(page.getByTestId("star-field")).toHaveCount(0);
});

test("draws no sky in the light theme, and brings it back with the toggle", async ({
	page,
}) => {
	await page.addInitScript(() => localStorage.setItem("theme", "light"));
	await page.goto("/");

	await expect(page.getByTestId("star-field")).toHaveCount(0);

	// light → dark is the toggle's first step, and it must not need a reload.
	await page.getByRole("button", { name: "Switch to dark theme" }).click();

	await expect(page.getByTestId("star-field")).toBeAttached();
});
