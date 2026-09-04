/** Wire types shared by the diff worker and its client. */

export type DiffStatus =
	| "added"
	| "removed"
	| "modified"
	| "unchanged"
	| "renamed";

export type DiffFileEntry = {
	path: string;
	oldPath?: string;
	type: "file" | "directory";
	status: DiffStatus;
	added?: number;
	removed?: number;
	children?: DiffFileEntry[];
};

export type FileDiff = {
	data: string;
	isDiff: boolean;
};

export type DiffRequest = {
	registry: string;
	pkg: string;
	from: string;
	to: string;
};

/**
 * `ignoreWhitespace` rides the two calls that diff and not the one that
 * downloads: prefetch only warms the archives, and the same two serve either
 * answer — a flag there would split one set of downloads into two.
 */
export type WorkerRequest =
	| ({
			id: number;
			type: "build-tree";
			ignoreWhitespace: boolean;
	  } & DiffRequest)
	| ({ id: number; type: "prefetch" } & DiffRequest)
	| {
			id: number;
			type: "get-file";
			path: string;
			oldPath?: string;
			ignoreWhitespace: boolean;
	  };

/** `Omit` over a union must distribute, or the per-variant fields are lost. */
export type WorkerRequestInput = WorkerRequest extends infer T
	? T extends { id: number }
		? Omit<T, "id">
		: never
	: never;

export type WorkerResponse =
	| { id: number; ok: true; data: unknown }
	| { id: number; ok: false; error: string };

/**
 * [BENCH] Instrumentation only — see philfreshman/diffpack#148. The worker's
 * console is not the page's, so a phase timed inside the worker has to be
 * echoed across `postMessage` or the harness never sees it. Strip with the
 * rest of the `[BENCH]` seams once the numbers are recorded.
 */
export type BenchMessage = { bench: string; ms: number };

export function isBenchMessage(
	message: WorkerResponse | BenchMessage,
): message is BenchMessage {
	return "bench" in message;
}
