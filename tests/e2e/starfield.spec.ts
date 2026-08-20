import { expect, type Page, test } from "@playwright/test";

/** Counts non-transparent pixels, i.e. how much of the sky actually got drawn. */
function paintedPixels(page: Page) {
	return page.evaluate(() => {
		const canvas = document.querySelector<HTMLCanvasElement>(
			'[data-testid="star-field"]',
		);
		if (!canvas) throw new Error("star field canvas is not in the document");
		const context = canvas.getContext("2d");
		if (!context) throw new Error("star field canvas has no 2d context");
		const { data } = context.getImageData(0, 0, canvas.width, canvas.height);
		let painted = 0;
		for (let i = 3; i < data.length; i += 4) {
			if ((data[i] ?? 0) > 0) painted += 1;
		}
		return painted;
	});
}

/** A cheap fingerprint of what is currently on the canvas. */
function canvasSignature(page: Page) {
	return page.evaluate(() => {
		const canvas = document.querySelector<HTMLCanvasElement>(
			'[data-testid="star-field"]',
		);
		if (!canvas) throw new Error("star field canvas is not in the document");
		return canvas.toDataURL();
	});
}

test("paints a star field behind the page", async ({ page }) => {
	const errors: string[] = [];
	page.on("pageerror", (error) => errors.push(error.message));
	page.on("console", (message) => {
		if (message.type() === "error") errors.push(message.text());
	});

	await page.goto("/");
	await expect(page.getByTestId("star-field")).toBeAttached();
	await expect.poll(() => paintedPixels(page)).toBeGreaterThan(0);

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
	await expect.poll(() => paintedPixels(page)).toBeGreaterThan(0);

	// Stars pulse and shooting stars travel, so an animating field repaints
	// differently from one frame to the next; a still one does not.
	const first = await canvasSignature(page);
	await page.waitForTimeout(600);
	expect(await canvasSignature(page)).toBe(first);
});
