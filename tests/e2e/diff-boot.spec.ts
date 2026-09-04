import { expect, type Page, test } from "@playwright/test";

/**
 * The engine is started from the document head, before React exists. These
 * assert the three things that buys and the one thing it must not cost: the
 * comparison is under way without hydration, hydration does not then ask for
 * it a second time, and the stored whitespace answer is the one it was built
 * with.
 *
 * `node` is a two-file npm package, which keeps the downloads small.
 */
const NODE = "/npm/node/26.6.0/26.7.0";

/** Downloading and extracting two archives is not a 10 s assertion. */
const ENGINE = { timeout: 90_000 };

const status = (page: Page) => page.getByTestId("diff-status");

/**
 * Records every request the page makes of a worker, from before the head
 * script runs. The protocol is the seam: one `build-tree` on the wire is the
 * whole claim, whoever sent it.
 */
async function recordWorkerRequests(page: Page) {
	await page.addInitScript(() => {
		const posted: unknown[] = [];
		(window as unknown as Record<string, unknown>).__posted = posted;

		const original = Worker.prototype.postMessage;
		Worker.prototype.postMessage = function patched(
			this: Worker,
			// The overloads differ only past the message, which is all this reads.
			...args: [message: unknown, ...rest: unknown[]]
		) {
			posted.push(args[0]);
			return (original as (...args: unknown[]) => void).apply(this, args);
		};
	});
}

function buildTreeRequests(page: Page) {
	return page.evaluate(() => {
		const posted =
			((window as unknown as Record<string, unknown>).__posted as {
				type?: string;
			}[]) ?? [];
		return posted.filter((request) => request.type === "build-tree");
	});
}

test("builds the comparison without waiting for React", async ({ page }) => {
	// Everything the app is, minus the worker: with the bundle gone, nothing
	// can hydrate, so whatever the engine still manages it managed on its own.
	await page.route(/\/assets\/[^/]+\.js(\?.*)?$/, (route) =>
		route.request().url().includes("diff.worker")
			? route.continue()
			: route.abort(),
	);

	await page.goto(NODE);

	const outcome = await page.evaluate(async () => {
		type Reply = { id?: number; ok?: boolean; error?: string };
		const boot = (window as unknown as Record<string, unknown>)
			.__diffpackDiffBoot as
			| { worker: Worker; id: number; replies: Reply[] }
			| undefined;
		if (!boot) return "nothing was booted";

		// By id: the worker's other messages share the channel, and the tree is
		// the answer to the one request the script made.
		const answer = (reply: Reply) => reply.id === boot.id;
		const reply =
			boot.replies.find(answer) ??
			(await new Promise<Reply>((resolve) => {
				const earlier = boot.worker.onmessage;
				boot.worker.onmessage = (event) => {
					earlier?.call(boot.worker, event);
					if (answer(event.data)) resolve(event.data);
				};
			}));

		return reply.ok ? "built" : (reply.error ?? "failed with no reason");
	});

	expect(outcome).toBe("built");
	// And React really never ran: the store the page was served with is the
	// store it still has.
	await expect(status(page)).toHaveAttribute("data-state", "idle");
});

test("hydration adopts the boot's request rather than repeating it", async ({
	page,
}) => {
	await recordWorkerRequests(page);

	await page.goto(NODE);
	await expect(status(page)).toHaveAttribute("data-state", "ready", ENGINE);

	// Two would be two sets of archive downloads for one comparison.
	expect(await buildTreeRequests(page)).toHaveLength(1);
});

test("a deep link opened with ignore-whitespace on is built that way once", async ({
	page,
}) => {
	await recordWorkerRequests(page);
	await page.addInitScript(() =>
		localStorage.setItem("ignore-whitespace-preference", "true"),
	);

	await page.goto(NODE);
	await expect(status(page)).toHaveAttribute("data-state", "ready", ENGINE);

	// The reason the session waits for a non-null answer at all: starting on the
	// wrong one would build the tree twice.
	expect(await buildTreeRequests(page)).toEqual([
		expect.objectContaining({ ignoreWhitespace: true }),
	]);
});
