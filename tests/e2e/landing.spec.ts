import { expect, test } from "@playwright/test";

test("offers every registry diffpack supports", async ({ page }) => {
	await page.goto("/");

	const tiles = page.getByTestId("registry-tile");

	await expect(tiles).toHaveCount(4);
	await expect(tiles).toHaveText([/npm/, /crates\.io/, /Go/, /PyPI/]);
});

test("says what each registry is for, and offers it as one link", async ({
	page,
}) => {
	await page.goto("/");

	const npm = page.getByRole("link", { name: /npm/ });

	await expect(npm).toHaveAttribute("href", "/npm");
	await expect(npm).toContainText("JavaScript & TypeScript packages");
});

test("opens a registry from its tile", async ({ page }) => {
	await page.goto("/");

	await page
		.getByTestId("registry-tile")
		.filter({ hasText: "crates.io" })
		.click();

	await expect(page).toHaveURL(/\/crates$/);
	await expect(page).toHaveTitle("diffpack | crates.io");
});

test("glows on hover without a single inline handler", async ({ page }) => {
	await page.goto("/");

	const tile = page.getByTestId("registry-tile").first();
	const shadow = () =>
		tile.evaluate((node) => getComputedStyle(node).boxShadow);

	expect(await shadow()).toBe("none");

	await tile.hover();

	await expect.poll(shadow).toContain("rgb");
	expect(
		await page.locator("[onmouseover], [onmouseout], [onclick]").count(),
	).toBe(0);
});

test("points at the repository from the footer", async ({ page }) => {
	await page.goto("/");

	const repo = page.getByRole("link", { name: "diffpack on GitHub" });

	await expect(page.getByText("More registries coming soon.")).toBeVisible();
	await expect(repo).toHaveAttribute(
		"href",
		"https://github.com/philfreshman/diffpack",
	);
	await expect(repo).toHaveAttribute("rel", "noopener noreferrer");
});

test("describes itself for anything that links to it", async ({ request }) => {
	const html = await (await request.get("/")).text();

	expect(html).toContain("<title>diffpack</title>");
	expect(html).toContain(
		'content="Compare package versions across ecosystems. Source-aware dependency review for npm, crates.io, Go and PyPI."',
	);
});

test("hangs the nebula behind the stars, in the dark theme only", async ({
	page,
}) => {
	await page.goto("/");

	const backdrop = () =>
		page
			.getByTestId("cosmos")
			.evaluate((node) => getComputedStyle(node).backgroundImage);

	expect(await backdrop()).toContain("radial-gradient");

	await page.evaluate(() => localStorage.setItem("theme", "light"));
	await page.reload();

	expect(await backdrop()).toBe("none");
});

test("holds the nebula still when the visitor asks for reduced motion", async ({
	browser,
}) => {
	const page = await browser.newPage({ reducedMotion: "reduce" });
	await page.goto("/");

	const animation = await page
		.getByTestId("cosmos")
		.evaluate((node) => getComputedStyle(node).animationName);

	expect(animation).toBe("none");
	await page.close();
});
