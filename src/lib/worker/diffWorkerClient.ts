import type {
	DiffFileEntry,
	DiffRequest,
	FileDiff,
	WorkerRequest,
	WorkerRequestInput,
	WorkerResponse,
} from "./protocol.ts";

type Pending = {
	resolve: (value: unknown) => void;
	reject: (reason: Error) => void;
};

const pending = new Map<number, Pending>();
let nextId = 0;
let worker: Worker | null = null;

/**
 * The WASM module keeps its extraction cache and its active-diff pointer in
 * module-local state, so a second worker would silently start from an empty
 * cache and fail every `getFile` with "No active diff context". One worker per
 * document, created lazily and never torn down.
 */
function getWorker(): Worker {
	if (worker) return worker;

	worker = new Worker(new URL("./diff.worker.ts", import.meta.url), {
		type: "module",
	});

	worker.onmessage = (event: MessageEvent<WorkerResponse>) => {
		const response = event.data;
		const entry = pending.get(response.id);
		if (!entry) return;
		pending.delete(response.id);
		if (response.ok) entry.resolve(response.data);
		else entry.reject(new Error(response.error));
	};

	return worker;
}

/**
 * Requests carry an id because several may be in flight at once — clicking
 * quickly through the file tree is the common case — and replies must resolve
 * the call that asked for them rather than whichever is newest.
 */
function send<T>(request: WorkerRequestInput): Promise<T> {
	const id = nextId++;
	return new Promise<T>((resolve, reject) => {
		pending.set(id, { resolve: resolve as (value: unknown) => void, reject });
		getWorker().postMessage({ ...request, id } as WorkerRequest);
	});
}

export const diffClient = {
	/** Downloads both versions, extracts them, and returns the diff tree. */
	buildTree(
		request: DiffRequest,
		ignoreWhitespace: boolean,
	): Promise<DiffFileEntry> {
		return send<DiffFileEntry>({
			type: "build-tree",
			...request,
			ignoreWhitespace,
		});
	},

	/** Reads one file's diff out of the cache populated by `buildTree`. */
	getFile(
		path: string,
		oldPath: string | undefined,
		ignoreWhitespace: boolean,
	): Promise<FileDiff> {
		return send<FileDiff>({
			type: "get-file",
			path,
			oldPath,
			ignoreWhitespace,
		});
	},

	/** Warms the extraction cache so a later `buildTree` skips the downloads. */
	prefetch(request: DiffRequest): Promise<void> {
		return send<void>({ type: "prefetch", ...request });
	},
};
