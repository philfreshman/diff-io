import type { diffClient } from "#/lib/worker/diffWorkerClient.ts";

declare global {
	interface Window {
		diffClient: typeof diffClient | undefined;
	}
}
