import { expect, type Page, test } from "@playwright/test";

/**
 * The worker chunk is asked for alongside the document's own assets rather
 * than behind them, and the worker instantiates the wasm without being asked
 * to. #150.
 *
 * `node` is a two-file npm package, which keeps the downloads small.
 */
const NODE = "/npm/node/26.6.0/26.7.0";

// The router emits `modulepreload` for the route's own chunks, so the worker's
// hint is named rather than counted.
const modulepreload = 'head link[rel="modulepreload"][href*="diff.worker"]';

const ready = (page: Page) =>
	expect(page.getByTestId("diff-status")).toHaveAttribute(
		"data-state",
		"ready",
		{ timeout: 90_000 },
	);

test("a comparison page asks for the worker chunk up front", async ({
	page,
}) => {
	await page.goto(NODE);

	const href = await page.locator(modulepreload).getAttribute("href");

	// A hashed href that has gone stale is a 404 the browser reports only as a
	// slower diff, so the hint is followed rather than merely counted.
	const response = await page.request.get(new URL(href ?? "", page.url()).href);
	expect(response.status()).toBe(200);
});

test("a page with no comparison to build asks for nothing", async ({
	page,
}) => {
	await page.goto("/");

	await expect(page.locator(modulepreload)).toHaveCount(0);
});

test("the hint is used, not warned about", async ({ page }) => {
	const warnings: string[] = [];
	page.on("console", (message) => {
		if (message.text().includes("preload")) warnings.push(message.text());
	});

	await page.goto(NODE);
	await ready(page);
	// Chrome reports an unused preload a few seconds after load, not at load, so
	// an assertion that does not wait cannot see the thing it is checking for.
	await page.waitForTimeout(5_000);

	expect(warnings).toEqual([]);
});

/**
 * A document-level `<link rel="preload" as="fetch">` for the `.wasm` looks like
 * the obvious other half of this and is not: the worker fetches in its own
 * fetch group, never touches the document's preload cache, and the module is
 * downloaded twice — the second copy arriving *later* than it would have with
 * no hint at all, because the two contend. Measured cold at 739 ms and 1415 ms.
 */
test("the wasm is downloaded once", async ({ page }) => {
	const wasm: string[] = [];
	page.on("request", (request) => {
		if (request.url().endsWith(".wasm")) wasm.push(request.url());
	});

	const cdp = await page.context().newCDPSession(page);
	await cdp.send("Network.setCacheDisabled", { cacheDisabled: true });

	await page.goto(NODE);
	await ready(page);

	expect(wasm).toHaveLength(1);
});

test("the worker instantiates the wasm without being asked to", async ({
	page,
}) => {
	await page.goto(NODE);
	const workerUrl = await page.locator(modulepreload).getAttribute("href");

	// The home page spawns no worker of its own, so the only `.wasm` request
	// that can follow is the one this worker makes on its own initiative.
	await page.goto("/");

	const wasmRequest = page.waitForRequest(/\.wasm(\?.*)?$/, {
		timeout: 15_000,
	});
	await page.evaluate((url) => {
		new Worker(url, { type: "module" });
	}, workerUrl ?? "");

	await expect(wasmRequest).resolves.toBeTruthy();
});
