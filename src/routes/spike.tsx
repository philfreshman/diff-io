import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { diffClient } from "#/lib/worker/diffWorkerClient.ts";

export const Route = createFileRoute("/spike")({
	component: Spike,
});

/**
 * Test harness for the diff worker client: exposes it on `window` so the
 * Playwright suite can drive the real worker in a real browser, which is the
 * only place the WASM engine can run.
 *
 * Removed in task 9 (`feature/diff-session`), once the workspace route
 * exercises the client for real.
 */
function Spike() {
	const [ready, setReady] = useState(false);

	useEffect(() => {
		window.diffClient = diffClient;
		setReady(true);
		return () => {
			window.diffClient = undefined;
		};
	}, []);

	return <div data-testid="spike-status">{ready ? "ready" : "loading"}</div>;
}
