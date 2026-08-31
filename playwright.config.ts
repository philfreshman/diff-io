import { defineConfig } from "@playwright/test";

const baseURL = process.env.BASE_URL ?? "http://localhost:4321";

export default defineConfig({
	testDir: "./tests/e2e",
	// The WASM engine downloads real archives from the registries, so these are
	// slow and network-dependent by nature.
	timeout: 120_000,
	// Slow work happens inside `page.evaluate`, which the test timeout covers;
	// assertions themselves are about the UI and should fail fast.
	expect: { timeout: 10_000 },
	fullyParallel: false,
	workers: 1,
	reporter: process.env.CI ? "github" : "list",
	use: { baseURL, trace: "retain-on-failure" },
	// Set BASE_URL to test an already-running server (e.g. a production preview).
	webServer: process.env.BASE_URL
		? undefined
		: {
				command: "bun run dev",
				url: baseURL,
				reuseExistingServer: true,
				timeout: 120_000,
			},
});
