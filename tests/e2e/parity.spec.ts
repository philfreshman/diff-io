import { readFileSync } from "node:fs";
import { expect, type Page, test } from "@playwright/test";
import { HIGHLIGHT_THEME_KEY } from "#/lib/diff/highlightThemes.ts";
import { SPLIT_VIEW_KEY } from "#/lib/diff/prefs.ts";
import { historyKey } from "#/lib/storage/searchHistory.ts";
import { THEME_STORAGE_KEY } from "#/lib/theme.ts";
import { ONLY_MODIFIED_KEY, TREE_WIDTH_KEY } from "#/lib/tree/prefs.ts";

/**
 * Task 15's parity gate. The other specs each prove one feature; this one walks
 * the §7 acceptance checklist end to end — every registry through the real
 * engine, the storage contract with returning visitors, and the head the old
 * site served.
 */

/** Downloading and extracting two archives is not a 10 s assertion. */
const ENGINE = { timeout: 90_000 };

const status = (page: Page) => page.getByTestId("diff-status");
const files = (page: Page) =>
	page.getByRole("treeitem").and(page.locator("[data-type='file']"));

async function ready(page: Page, path: string) {
	await page.goto(path);
	await expect(status(page)).toHaveAttribute("data-state", "ready", ENGINE);
}

/**
 * The §8 smoke matrix, minus the npm entries the other specs already drive.
 * Each is a real comparison against the real registry, which is the only way
 * the WASM runs — so this is where a registry-specific extraction bug (Go's
 * versioned root, PyPI's sdist, crates' tarball) surfaces.
 */
const MATRIX = [
	{
		name: "crates.io",
		path: "/crates/serde/1.0.228/1.0.229",
		file: "Cargo.toml",
	},
	{
		name: "PyPI",
		path: "/pypi/requests/2.34.1/2.34.2",
		file: "PKG-INFO",
	},
	{
		name: "Go",
		path: "/go/github.com/go-chi/chi/v5/v5.3.1/v5.3.2",
		file: "tree.go",
	},
	{
		name: "a scoped npm package",
		path: "/npm/@types/node/26.3.0/26.4.0",
		file: "package.json",
	},
];

for (const { name, path, file } of MATRIX) {
	test(`compares a package from ${name}`, async ({ page }) => {
		await ready(page, path);

		await expect(files(page).first()).toBeVisible();
		await files(page).filter({ hasText: file }).first().click();

		await expect(page).toHaveURL(new RegExp(`/${file.replace(".", "\\.")}$`));
		await expect(page.getByTestId("diff-view")).toBeVisible(ENGINE);
	});
}

test("counts the whole comparison, and how much of it changed", async ({
	page,
}) => {
	// node 26.6.0 → 26.7.0 is three files, two of them changed — and the tree
	// below this line shows only the two, so a bare "3 files" reads as a
	// miscount.
	await ready(page, "/npm/node/26.6.0/26.7.0");

	await expect(status(page)).toHaveText("3 files, 2 changed");
	await expect(files(page)).toHaveCount(2);
});

test("no file in a Go module reads as its versioned root", async ({ page }) => {
	await ready(page, "/go/github.com/go-chi/chi/v5/v5.3.1/v5.3.2");

	// `chi@v5.3.2/` prefixing every path would make each file a removal plus an
	// addition — the whole comparison would be "everything changed".
	const paths = await files(page).evaluateAll((rows) =>
		rows.map((row) => row.getAttribute("data-path") ?? ""),
	);

	expect(paths.length).toBeGreaterThan(0);
	expect(paths.some((p) => p.includes("@v5."))).toBe(false);
	expect(paths).toContain("tree.go");
	expect(paths).toContain("middleware/compress.go");
});

/**
 * The six keys, seeded through the app's own constants and asserted against the
 * old site's literals below. Every other spec addresses storage through these
 * same constants, so this object is the only place the literal names appear.
 */
const STORED = {
	[THEME_STORAGE_KEY]: "light",
	[SPLIT_VIEW_KEY]: "true",
	[HIGHLIGHT_THEME_KEY]: "nightfall",
	[TREE_WIDTH_KEY]: "320",
	[ONLY_MODIFIED_KEY]: "false",
	[historyKey("npm")]: JSON.stringify([{ name: "express" }]),
};

/**
 * The six keys are a contract with people who already used the site: a rename
 * or a reshaped value silently drops their theme, their panel width and their
 * history on the floor. Names *and* value formats, therefore, not just names.
 */
test("writes the same six localStorage keys as the old site", async ({
	page,
}) => {
	// The names are pinned here rather than in each spec that seeds one: this is
	// the contract, so a renamed constant has to fail *this* test rather than
	// quietly carrying every other spec along with it.
	expect(Object.keys(STORED).sort()).toEqual([
		"highlight_theme",
		"search_history_npm",
		"split-view-preference",
		"theme",
		"tree_panel_width",
		"tree_show_only_modified",
	]);

	await page.addInitScript((entries) => {
		for (const [key, value] of entries) localStorage.setItem(key, value);
	}, Object.entries(STORED));
	await ready(page, "/npm/node/26.6.0/26.7.0");

	const stored = await page.evaluate(() => ({ ...localStorage }));

	// Nothing added, nothing dropped, and each one still read as what it was
	// written as rather than overwritten with a differently-shaped value on
	// first render.
	expect(Object.keys(stored).sort()).toEqual(Object.keys(STORED).sort());
	for (const [key, value] of Object.entries(STORED)) {
		expect(stored[key]).toBe(value);
	}

	// And the page honoured them rather than merely leaving them alone.
	await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
	await expect(page.getByTestId("tree-panel")).toHaveCSS("width", "320px");
});

test("serves every icon and card image it points at", async ({
	page,
	request,
}) => {
	await page.goto("/");

	const referenced = await page.evaluate(() => ({
		icons: [...document.querySelectorAll<HTMLLinkElement>("link[rel*='icon']")]
			.map((link) => link.getAttribute("href") ?? "")
			.concat(
				document
					.querySelector<HTMLLinkElement>("link[rel='manifest']")
					?.getAttribute("href") ?? "",
			),
		cards: [
			...document.querySelectorAll<HTMLMetaElement>("meta[property$=':image']"),
		].map((meta) => meta.content),
	}));

	expect(referenced.icons).toEqual([
		"/favicon-96x96.png",
		"/favicon.svg",
		"/favicon.ico",
		"/apple-touch-icon.png",
		"/site.webmanifest",
	]);
	expect(referenced.cards).toEqual([
		"/web-app-manifest-512x512.png",
		"/web-app-manifest-512x512.png",
	]);

	for (const href of [...referenced.icons, ...referenced.cards]) {
		const response = await request.get(href);
		expect(response.status(), href).toBe(200);
	}

	// The manifest a returning visitor's installed shortcut resolves against.
	const manifest = await (await request.get("/site.webmanifest")).json();
	expect(manifest).toEqual(
		JSON.parse(readFileSync("public/site.webmanifest", "utf8")),
	);
});

test("counts a visit, and each comparison after it", async ({ page }) => {
	// The measurement calls are what is asserted; the library itself is not
	// loaded, so no traffic from a test run reaches the property.
	await page.route("https://www.googletagmanager.com/**", (route) =>
		route.fulfill({ status: 204, body: "" }),
	);
	await page.goto("/npm");
	await expect(page.getByTestId("workspace")).toBeVisible();

	const dataLayer = () =>
		page.evaluate(() =>
			[...(window.dataLayer ?? [])].map((entry) => [...entry]),
		);

	expect(await dataLayer()).toEqual([
		["js", expect.anything()],
		["config", "G-JH9PM7WWGG"],
	]);

	// A client-side navigation is a page in its own right here, the way every
	// URL was its own document on the Astro site.
	//
	// The hover is not decoration. `vite dev` hard-navigates a click into a
	// route whose chunk it has not served yet — a full page load, which would
	// look like no page_view at all — and the router's `defaultPreload:
	// "intent"` is what fetches it ahead of the click. A production build needs
	// no such help.
	const home = page.getByRole("link", { name: "diffpack" });
	await home.hover();
	await page.waitForTimeout(1_000);
	await home.click();
	await expect(page).toHaveURL("/");

	// The head is reconciled about a second after the click in a production
	// build, and the view is reported once it is.
	await expect
		.poll(async () => (await dataLayer()).length, { timeout: 15_000 })
		.toBeGreaterThan(2);
	const [type, name, params] = (await dataLayer())[2] as [
		string,
		string,
		Record<string, string>,
	];
	expect([type, name]).toEqual(["event", "page_view"]);
	expect(params.page_path).toBe("/");
	// The title of the page arrived at, not of the one just left.
	expect(params.page_title).toBe("diffpack");
});

/**
 * A hydration mismatch is a console error rather than a failed assertion, so
 * nothing else in the suite would notice one. Pre-paint scripts write
 * `data-theme` and the panel width before React runs, which is precisely the
 * shape of thing that produces them.
 */
const ROUTES = [
	"/",
	"/npm",
	"/crates",
	"/pypi",
	"/go",
	"/npm/express/4.18.2/5.1.0",
	"/go/github.com/go-chi/chi/v5/v5.3.1/v5.3.2/tree.go",
];

for (const route of ROUTES) {
	test(`renders ${route} without complaining to the console`, async ({
		page,
	}) => {
		const complaints: string[] = [];
		page.on("console", (message) => {
			if (message.type() !== "error" && message.type() !== "warning") return;
			const text = message.text();
			// The registries themselves are not under test: a 404 from a version
			// list is the adapter's business, not a rendering fault. The GL
			// messages are headless Chromium's software renderer narrating the
			// star field to itself, and say nothing about the page.
			//
			// The wasm MIME warning is `vite preview`'s static server, which does
			// not read the deploy's header rules; the `content-type` for the
			// module is set in `nitro({ routeRules })` and lands in
			// `.vercel/output/config.json`, which is where it is checked.
			if (
				/Failed to load resource|googletagmanager|WebGL-0x|GL Driver Message|instantiateStreaming/.test(
					text,
				)
			) {
				return;
			}
			complaints.push(text);
		});
		page.on("pageerror", (error) => complaints.push(error.message));

		await page.goto(route);
		await expect(page.locator("html")).toHaveAttribute("data-theme", /.+/);
		// Long enough for hydration to have happened and had its say.
		await page.waitForTimeout(2_000);

		expect(complaints).toEqual([]);
	});
}
