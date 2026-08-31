#!/usr/bin/env bun
/**
 * Recaptures the reference set in `migration/screenshots/` against a running
 * build, so the rebuild can be read against the Astro site frame by frame.
 *
 * The names and the framing are the contract: shot `07` here must be the same
 * view, at the same size, as `07` in the reference folder, or the pair cannot
 * be compared. Sizes are the reference set's — a 1440×900 window at
 * `deviceScaleFactor: 2`, and 390×844 for the one mobile shot.
 *
 *     bun run dev
 *     bun scripts/capture-screenshots.mjs                    # -> screenshots/
 *     bun scripts/capture-screenshots.mjs --only 07 12 --out /tmp/shots
 *     BASE_URL=http://localhost:4321 bun scripts/capture-screenshots.mjs
 *
 * It is a harness, not a test: it never asserts. Comparing what it produced
 * with `migration/screenshots/` is the review step, and one that a human does —
 * the two trees are different implementations, so a pixel comparison would be
 * red everywhere and say nothing.
 */
import { mkdir } from "node:fs/promises";
import { chromium } from "@playwright/test";

const BASE_URL = process.env.BASE_URL ?? "http://localhost:4321";

const DESKTOP = { width: 1440, height: 900 };
const MOBILE = { width: 390, height: 844 };

/** Two archives over the network, extracted in a worker. */
const ENGINE = 90_000;

/**
 * The comparisons the reference set was taken from. Nearly every diff and tree
 * shot in it is `node 26.6.0 → 26.7.0` — two files, one changed line each — so
 * that is what these use too. A shot of a different package would be a picture
 * of a different thing, and the pair could not be read against each other.
 */
const NODE = "/npm/node/26.6.0/26.7.0";
/** Where the reference needed a deep tree instead. */
const EXPRESS = "/npm/express/4.18.2/5.1.0";
const CHI = "/go/github.com/go-chi/chi/v5/v5.3.1/v5.3.2";

const args = process.argv.slice(2);
const outDir = readFlag("--out") ?? "screenshots";
const only = readList("--only");

function readFlag(name) {
	const at = args.indexOf(name);
	return at === -1 ? undefined : args[at + 1];
}

function readList(name) {
	const at = args.indexOf(name);
	if (at === -1) return null;
	const values = [];
	for (let i = at + 1; i < args.length && !args[i].startsWith("--"); i++) {
		values.push(args[i]);
	}
	return values.length ? values : null;
}

const tree = (page) =>
	page.getByRole("treeitem").and(page.locator("[data-type='file']"));

/** Waits for the engine rather than for a duration. */
async function diffReady(page) {
	await page
		.getByTestId("diff-status")
		.and(page.locator("[data-state='ready']"))
		.waitFor({ timeout: ENGINE });
}

async function openFile(page, path, file) {
	await page.goto(`${BASE_URL}${path}`);
	await diffReady(page);
	await tree(page).filter({ hasText: file }).first().click();
	await page.getByTestId("diff-view").waitFor({ timeout: ENGINE });
	// Highlighting lands a frame after the rows do.
	await page.waitForTimeout(500);
}

/**
 * Each shot: the file name it is written under, the theme the reference was
 * taken in, an optional viewport, what to do to get there, and — when the
 * reference is a crop rather than a page — the element to clip to.
 */
const SHOTS = [
	{
		name: "01-landing-dark",
		theme: "dark",
		async act(page) {
			await page.goto(BASE_URL);
			// The star field animates in.
			await page.waitForTimeout(1_500);
		},
	},
	{
		name: "02-landing-light",
		theme: "light",
		async act(page) {
			await page.goto(BASE_URL);
			await page.waitForTimeout(1_000);
		},
	},
	{
		name: "03-landing-tile-hover",
		theme: "dark",
		async act(page) {
			await page.goto(BASE_URL);
			await page.getByTestId("registry-tile").first().hover();
			await page.waitForTimeout(800);
		},
	},
	{
		name: "04-npm-empty-state",
		theme: "dark",
		async act(page) {
			await page.goto(`${BASE_URL}/npm`);
			await page.getByTestId("workspace").waitFor();
		},
	},
	{
		name: "05-header-empty",
		theme: "dark",
		clip: "header",
		async act(page) {
			await page.goto(`${BASE_URL}/npm`);
			await page.getByTestId("workspace").waitFor();
		},
	},
	{
		name: "06-search-dropdown",
		theme: "dark",
		async act(page) {
			await page.goto(`${BASE_URL}/npm`);
			await page.getByPlaceholder("Search npm…").fill("express");
			await page.getByRole("option").first().waitFor({ timeout: 20_000 });
		},
	},
	{
		name: "07-diff-unified-dark",
		theme: "dark",
		act: (page) => openFile(page, NODE, "package.json"),
	},
	{
		name: "08-header-populated",
		theme: "dark",
		clip: "header",
		act: (page) => openFile(page, NODE, "package.json"),
	},
	{
		name: "09-version-dropdown",
		theme: "dark",
		async act(page) {
			await page.goto(`${BASE_URL}${NODE}`);
			await page.getByLabel("From Version").click();
			await page.getByRole("option").first().waitFor({ timeout: 20_000 });
		},
	},
	{
		name: "10-file-explorer-panel",
		theme: "dark",
		clip: "[data-testid='tree-panel']",
		act: (page) => openFile(page, NODE, "package.json"),
	},
	{
		name: "11-toolbar",
		theme: "dark",
		clip: "[data-testid='diff-toolbar']",
		act: (page) => openFile(page, NODE, "package.json"),
	},
	{
		name: "12-diff-split-view",
		theme: "dark",
		async act(page) {
			await openFile(page, NODE, "package.json");
			await page.getByRole("button", { name: "Switch to split view" }).click();
			await page.waitForTimeout(500);
		},
	},
	{
		name: "13-diff-expanded-all",
		theme: "dark",
		async act(page) {
			await openFile(page, NODE, "package.json");
			// "Expand all", not the folds' own "Expand all lines".
			await page
				.getByTestId("diff-toolbar")
				.getByRole("button", { name: "Expand all", exact: true })
				.click();
			await page.waitForTimeout(800);
		},
	},
	{
		name: "14-diff-unified-light",
		theme: "light",
		act: (page) => openFile(page, NODE, "package.json"),
	},
	{
		name: "15-collapsed-hunk-expanders",
		theme: "light",
		clip: "[data-testid='diff-view']",
		act: (page) => openFile(page, NODE, "package.json"),
	},
	{
		name: "16-tree-filter",
		theme: "light",
		clip: "[data-testid='tree-panel']",
		async act(page) {
			await openFile(page, NODE, "package.json");
			await page.getByLabel("Filter files and folders").fill("pack");
			await page.waitForTimeout(400);
		},
	},
	{
		name: "17-tree-show-all-files",
		theme: "light",
		clip: "[data-testid='tree-panel']",
		async act(page) {
			await openFile(page, NODE, "package.json");
			await page.getByLabel("Show only modified files").click();
			await page.waitForTimeout(400);
		},
	},
	{
		name: "18-theme-select",
		theme: "dark",
		clip: "[data-testid='diff-toolbar']",
		async act(page) {
			await openFile(page, NODE, "package.json");
			await page.getByLabel("Theme:").focus();
		},
	},
	{
		name: "19-mobile-diff",
		theme: "dark",
		viewport: MOBILE,
		// Mobile layout is deferred (plan §9.6, open question 11.10), so this
		// one is expected to differ from its reference. It is captured anyway:
		// what it looks like today is the input to that decision.
		act: (page) => openFile(page, NODE, "package.json"),
	},
	{
		name: "21-tree-nested-badges",
		theme: "dark",
		clip: "[data-testid='tree-panel']",
		// express, for a tree with folders in it to aggregate counts over.
		act: (page) => openFile(page, EXPRESS, "index.js"),
	},
	{
		name: "22-crates-registry",
		theme: "dark",
		async act(page) {
			await page.goto(`${BASE_URL}/crates`);
			await page.getByTestId("workspace").waitFor();
		},
	},
	{
		name: "23-pypi-registry",
		theme: "dark",
		async act(page) {
			await page.goto(`${BASE_URL}/pypi`);
			await page.getByTestId("workspace").waitFor();
		},
	},
	{
		name: "24-go-empty-state",
		theme: "dark",
		async act(page) {
			await page.goto(`${BASE_URL}/go`);
			await page.getByTestId("workspace").waitFor();
		},
	},
	{
		name: "25-go-search-modulepath",
		theme: "dark",
		async act(page) {
			await page.goto(`${BASE_URL}/go`);
			await page
				.getByPlaceholder("github.com/user/module")
				.fill("github.com/go-chi/chi/v5");
			await page.waitForTimeout(1_500);
		},
	},
	{
		name: "26-go-header-resolved",
		theme: "dark",
		clip: "header",
		async act(page) {
			await page.goto(`${BASE_URL}${CHI}`);
			await diffReady(page);
		},
	},
	{
		name: "27-go-diff",
		theme: "dark",
		// `go.mod` does not change between these tags, so the only-modified tree
		// never lists it.
		act: (page) => openFile(page, CHI, "tree.go"),
	},
];

async function main() {
	await mkdir(outDir, { recursive: true });
	const wanted = only
		? SHOTS.filter((shot) => only.some((id) => shot.name.startsWith(id)))
		: SHOTS;

	if (!wanted.length) {
		console.error(`No shot matches ${only?.join(", ")}`);
		process.exit(1);
	}

	const browser = await chromium.launch();
	const failures = [];

	for (const shot of wanted) {
		const context = await browser.newContext({
			viewport: shot.viewport ?? DESKTOP,
			deviceScaleFactor: 2,
			colorScheme: shot.theme,
		});
		// The theme is a stored preference read before the first paint, not a
		// media query, so it is set the way a returning visitor would have it.
		await context.addInitScript(
			(theme) => localStorage.setItem("theme", theme),
			shot.theme,
		);
		const page = await context.newPage();

		try {
			await shot.act(page);
			const target = shot.clip ? page.locator(shot.clip).first() : page;
			await target.screenshot({ path: `${outDir}/${shot.name}.png` });
			console.log(`✓ ${shot.name}`);
		} catch (error) {
			failures.push(shot.name);
			console.error(`✗ ${shot.name} — ${error.message.split("\n")[0]}`);
		} finally {
			await context.close();
		}
	}

	await browser.close();
	console.log(
		`\n${wanted.length - failures.length}/${wanted.length} captured into ${outDir}/`,
	);
	if (failures.length) process.exit(1);
}

await main();
