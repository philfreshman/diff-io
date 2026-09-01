import { defineConfig } from "@playwright/test";

/**
 * The repo is worked on in several git worktrees at once, each able to run its
 * own server, so the port is not a constant.
 */
const port = Number(process.env.PORT ?? 4321);
const baseURL = process.env.BASE_URL ?? `http://localhost:${port}`;

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
	// `github` annotates the diff; `html` is what the CI job uploads on failure.
	reporter: process.env.CI
		? [["github"], ["html", { open: "never" }]]
		: [["list"]],
	use: { baseURL, trace: "retain-on-failure" },
	// Set BASE_URL to test an already-running server (e.g. a production preview),
	// which is also how to iterate without paying for a rebuild each run.
	webServer: process.env.BASE_URL
		? undefined
		: {
				// A production build, never `vite dev`: three defects reached
				// `development` past a green dev-only run (7bd9d90). The build is part
				// of the command rather than a prerequisite you might forget, so a
				// stale `.output/` cannot be tested by accident.
				//
				// `--strictPort` is not a detail. Without it `vite preview` shrugs at
				// a busy port and moves to the next one, while Playwright goes on
				// polling this one — so the suite silently runs against whatever else
				// answers there, which in this repo is another worktree's server. It
				// has to die instead.
				command: `bun run build && bunx vite preview --port ${port} --strictPort`,
				url: baseURL,
				reuseExistingServer: false,
				// Cold `build:wasm` compiles the Rust crate from scratch; warm it is
				// about a second.
				timeout: 600_000,
			},
});
