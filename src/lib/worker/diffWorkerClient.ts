import { type DiffBoot, readDiffBoot } from "./bootScript.ts";
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

/** The comparison a `build-tree` request asks for, as the boot script states it. */
type Comparison = DiffRequest & { ignoreWhitespace: boolean };

function sameComparison(left: Comparison, right: Comparison): boolean {
	return (
		left.registry === right.registry &&
		left.pkg === right.pkg &&
		left.from === right.from &&
		left.to === right.to &&
		left.ignoreWhitespace === right.ignoreWhitespace
	);
}

/**
 * The page's one link to the engine.
 *
 * A factory over how the worker is come by, because there are two ways: the
 * page spawns one, or it adopts the one the `<head>` boot script already
 * spawned and posted to. Which of those happened is not something the store
 * above should have to know, and it is exactly what a test needs to say.
 */
export function createDiffClient(
	spawn: () => Worker,
	boot: () => DiffBoot | null = readDiffBoot,
) {
	const pending = new Map<number, Pending>();
	let nextId = 0;
	let worker: Worker | null = null;
	/**
	 * The boot script's `build-tree`, waiting for whoever asked for it. Cleared
	 * the moment it is claimed *or* another comparison is asked for: the engine
	 * holds one active diff, so handing this tree back after a second
	 * `build-tree` has replaced it would leave `getFile` reading the wrong one.
	 */
	let adopted: { request: Comparison; tree: Promise<DiffFileEntry> } | null =
		null;

	function receive(message: WorkerResponse) {
		const entry = pending.get(message.id);
		if (!entry) return;
		pending.delete(message.id);
		if (message.ok) entry.resolve(message.data);
		else entry.reject(new Error(message.error));
	}

	function awaitReply<T>(id: number): Promise<T> {
		return new Promise<T>((resolve, reject) => {
			pending.set(id, { resolve: resolve as (value: unknown) => void, reject });
		});
	}

	/**
	 * The WASM module keeps its extraction cache and its active-diff pointer in
	 * module-local state, so a second worker would silently start from an empty
	 * cache and fail every `getFile` with "No active diff context". One worker
	 * per document, and where the boot script made one, that is the one.
	 */
	function getWorker(): Worker {
		if (worker) return worker;

		const booted = boot();
		if (!booted) {
			worker = spawn();
			worker.onmessage = (event) => receive(event.data);
			return worker;
		}

		worker = booted.worker;
		// Past whatever the script used, so a reply cannot resolve the wrong call.
		nextId = booted.id + 1;

		const tree = awaitReply<DiffFileEntry>(booted.id);
		// It may never be claimed — a link opened and abandoned mid-flight — and
		// an unclaimed failure is not the page's to report.
		tree.catch(() => {});
		adopted = { request: booted.request, tree };

		worker.onmessage = (event) => receive(event.data);
		// Everything the script's own handler caught while no client existed.
		for (const reply of booted.replies) {
			receive(reply as WorkerResponse);
		}

		return worker;
	}

	/**
	 * Requests carry an id because several may be in flight at once — clicking
	 * quickly through the file tree is the common case — and replies must
	 * resolve the call that asked for them rather than whichever is newest.
	 */
	function send<T>(request: WorkerRequestInput): Promise<T> {
		const target = getWorker();
		const id = nextId++;
		const reply = awaitReply<T>(id);
		target.postMessage({ ...request, id } as WorkerRequest);
		return reply;
	}

	return {
		/** Downloads both versions, extracts them, and returns the diff tree. */
		buildTree(
			request: DiffRequest,
			ignoreWhitespace: boolean,
		): Promise<DiffFileEntry> {
			getWorker();

			const wanted = { ...request, ignoreWhitespace };
			const claim = adopted;
			// Either way the boot's request stops being adoptable here: claimed,
			// or overtaken by the comparison about to replace it in the engine.
			adopted = null;
			if (claim && sameComparison(claim.request, wanted)) return claim.tree;

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
}

/**
 * One client per document, over the worker the boot script spawned where there
 * was a comparison to spawn it for.
 */
export const diffClient = createDiffClient(
	() =>
		new Worker(new URL("./diff.worker.ts", import.meta.url), {
			type: "module",
		}),
);
