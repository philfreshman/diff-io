import init, {
	build_diff_tree_for_package,
	get_diff_for_path,
	prefetch_package,
} from "diff-wasm";
import wasmUrl from "diff-wasm/diff_wasm_bg.wasm?url";
import type { WorkerRequest, WorkerResponse } from "./protocol.ts";

/** Rename detection threshold, as a content-similarity ratio. */
const SIMILARITY_THRESHOLD = 0.75;

let wasmReady: Promise<unknown> | null = null;

function ensureWasm() {
	wasmReady ??= init({ module_or_path: wasmUrl });
	return wasmReady;
}

function reply(response: WorkerResponse) {
	self.postMessage(response);
}

async function handle(request: WorkerRequest): Promise<unknown> {
	switch (request.type) {
		case "build-tree":
			return await build_diff_tree_for_package(
				request.registry,
				request.pkg,
				request.from,
				request.to,
				SIMILARITY_THRESHOLD,
			);
		case "prefetch":
			await Promise.all([
				prefetch_package(request.registry, request.pkg, request.from),
				prefetch_package(request.registry, request.pkg, request.to),
			]);
			return undefined;
		case "get-file":
			return get_diff_for_path(request.path, request.oldPath);
	}
}

self.onmessage = async (event: MessageEvent<WorkerRequest>) => {
	const request = event.data;
	try {
		await ensureWasm();
		reply({ id: request.id, ok: true, data: await handle(request) });
	} catch (error) {
		reply({
			id: request.id,
			ok: false,
			error: error instanceof Error ? error.message : String(error),
		});
	}
};
