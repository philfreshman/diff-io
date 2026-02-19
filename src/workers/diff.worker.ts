import type { InitOutput } from "diff-wasm";
import init, {
	build_diff_tree_for_package,
	get_diff_for_path,
	prefetch_package,
} from "diff-wasm";

import wasmUrl from "diff-wasm/diff_wasm_bg.wasm?url";

let wasmPromise: Promise<InitOutput> | null = null;

export function ensureWasmInitialized(): Promise<InitOutput> {
	if (!wasmPromise) {
		wasmPromise = init(wasmUrl).catch((err: Error) => {
			console.error("WASM initialization failed:", err);
			console.error("WASM url: ", wasmUrl);
			throw err;
		});
	}
	return wasmPromise;
}

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

type WorkerRequest =
	| {
			type: "start-diff";
			registry: string;
			pkg: string;
			from: string;
			to: string;
	  }
	| {
			type: "prefetch";
			registry: string;
			pkg: string;
			from: string;
			to: string;
	  }
	| {
			type: "get-diff";
			filename: string;
			oldPath?: string;
	  };

self.onmessage = async (event: MessageEvent<WorkerRequest>) => {
	try {
		await ensureWasmInitialized();
	} catch (error) {
		const message =
			error instanceof Error ? error.message : "WASM initialization failed";
		postMessage({ type: "error", error: message });
		return;
	}

	const data = event.data;

	if (data.type === "start-diff") {
		await handleStartDiff(data.registry, data.pkg, data.from, data.to);
	} else if (data.type === "prefetch") {
		await handlePrefetch(data.registry, data.pkg, data.from, data.to);
	} else if (data.type === "get-diff") {
		handleGetDiff(data.filename, data.oldPath);
	}
};

async function handleStartDiff(
	registry: string,
	pkg: string,
	from: string,
	to: string,
) {
	try {
		const start = performance.now();
		const diffTree = await build_diff_tree_for_package(
			registry,
			pkg,
			from,
			to,
			0.75,
		);
		const end = performance.now();

		console.log(`Building diff tree took ${(end - start).toFixed(2)}ms`);

		postMessage({
			type: "diff-result",
			data: diffTree,
		});
	} catch (error) {
		const message = error instanceof Error ? error.message : "Unknown error";
		postMessage({ type: "error", error: message });
	}
}

async function handlePrefetch(
	registry: string,
	pkg: string,
	from: string,
	to: string,
) {
	try {
		await Promise.all([
			prefetch_package(registry, pkg, from),
			prefetch_package(registry, pkg, to),
		]);
	} catch (error) {
		console.error("Prefetch failed:", error);
	}
}

export function handleGetDiff(filename: string, oldPath?: string) {
	try {
		const result = get_diff_for_path(filename, oldPath) as {
			data: string;
			isDiff: boolean;
		};
		postMessage({
			type: "diff-result",
			filename,
			data: result.data,
			isDiff: result.isDiff,
		});
	} catch (error) {
		const message =
			error instanceof Error ? error.message : "Diff generation failed";
		postMessage({ type: "error", error: message });
	}
}
