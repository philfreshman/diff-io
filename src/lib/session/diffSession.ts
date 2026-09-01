import { Store } from "@tanstack/react-store";
import { diffClient } from "#/lib/worker/diffWorkerClient.ts";
import type {
	DiffFileEntry,
	DiffRequest,
	FileDiff,
} from "#/lib/worker/protocol.ts";
import { findFile } from "./tree.ts";

type DiffClient = Pick<typeof diffClient, "buildTree" | "getFile" | "prefetch">;

export type SessionStatus = "idle" | "loading" | "ready" | "error";

export interface OpenFile {
	path: string;
	status: "loading" | "ready" | "error";
	diff: FileDiff | null;
	error: string | null;
}

export interface DiffSessionState {
	/** The comparison on screen, as `registry/pkg/from/to`; `null` when idle. */
	key: string | null;
	status: SessionStatus;
	tree: DiffFileEntry | null;
	error: string | null;
	/** The file the URL names, or `null` when it names none. */
	file: OpenFile | null;
}

const IDLE: DiffSessionState = {
	key: null,
	status: "idle",
	tree: null,
	error: null,
	file: null,
};

/**
 * A comparison is the pair of versions *and* the question asked of them:
 * whether whitespace counts changes which lines differ, so it is part of what
 * is being read, not a way of showing what has already been read.
 *
 * Kept off `DiffRequest` because that is also the prefetch payload, and a
 * prefetch only warms the archives — one flag there would split one set of
 * downloads into two.
 */
export interface ComparisonRequest extends DiffRequest {
	ignoreWhitespace: boolean;
}

/** Two requests are the same comparison exactly when this string matches. */
function sessionKey(request: ComparisonRequest): string {
	return [
		request.registry,
		request.pkg,
		request.from,
		request.to,
		String(request.ignoreWhitespace),
	].join("\n");
}

/** The download half of a request: what the engine needs to fetch, and no more. */
function archives(request: DiffRequest): DiffRequest {
	return {
		registry: request.registry,
		pkg: request.pkg,
		from: request.from,
		to: request.to,
	};
}

function message(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

/**
 * The diff session: everything the engine produced for the comparison the URL
 * names. It is a store rather than component state because the worker outlives
 * any one route match — a version change re-renders the workspace, and the
 * reply to a request made before it must still find its way home.
 *
 * A factory over the client so the store's own behaviour — staleness, error
 * surfacing, prefetch de-duplication — can be tested without a browser; the
 * real engine only runs in a worker (task 1).
 */
export function createDiffSession(client: DiffClient) {
	const store = new Store<DiffSessionState>(IDLE);
	const prefetched = new Set<string>();
	/** The question the comparison on screen was built from — `openFile` asks
	 *  the engine the same one, or the file would disagree with its tree. */
	let ignoreWhitespace = false;

	/** A reply is worth keeping only while its comparison is still the one asked for. */
	function isCurrent(key: string): boolean {
		return store.state.key === key;
	}

	async function start(request: ComparisonRequest): Promise<void> {
		const key = sessionKey(request);
		// Re-entered on every render of the workspace, so asking for the
		// comparison already on screen has to cost nothing — not two more
		// archive downloads.
		if (isCurrent(key)) return;

		ignoreWhitespace = request.ignoreWhitespace;
		store.setState(() => ({ ...IDLE, key, status: "loading" }));

		try {
			const tree = await client.buildTree(
				archives(request),
				request.ignoreWhitespace,
			);
			if (!isCurrent(key)) return;
			store.setState((state) => ({ ...state, status: "ready", tree }));
		} catch (error) {
			if (!isCurrent(key)) return;
			store.setState((state) => ({
				...state,
				status: "error",
				error: message(error),
			}));
		}
	}

	/**
	 * Warms the extraction cache for a comparison the user has not asked for
	 * yet, so hovering Compare pays for the downloads a click would.
	 *
	 * A guess, not a promise: it runs once per comparison and its failures are
	 * silent, because the click is where an error has somewhere to be shown.
	 */
	function prefetch(request: DiffRequest): void {
		// The archives alone: a prefetch warms downloads, and the same two serve
		// either answer to the whitespace question.
		const warming = archives(request);
		const key = sessionKey({ ...warming, ignoreWhitespace: false });
		if (prefetched.has(key)) return;
		prefetched.add(key);
		client.prefetch(warming).catch(() => prefetched.delete(key));
	}

	/**
	 * Opens the file the URL names. Cache-only in the engine, so it is cheap —
	 * but it can only run once `start` has left an active diff behind, which is
	 * why the caller waits for `ready`.
	 */
	async function openFile(path: string): Promise<void> {
		if (!path) {
			if (store.state.file)
				store.setState((state) => ({ ...state, file: null }));
			return;
		}

		const key = store.state.key;
		if (!key || store.state.status !== "ready") return;

		const entry = findFile(store.state.tree, path);
		const open = (file: OpenFile) =>
			store.setState((state) => ({ ...state, file }));

		if (!entry) {
			open({
				path,
				status: "error",
				diff: null,
				error: `${path} is not in this comparison`,
			});
			return;
		}

		open({ path, status: "loading", diff: null, error: null });

		/** Both must still hold: the comparison, and the file within it. */
		const stillOpen = () => isCurrent(key) && store.state.file?.path === path;

		try {
			const diff = await client.getFile(
				entry.path,
				entry.oldPath,
				ignoreWhitespace,
			);
			if (!stillOpen()) return;
			open({ path, status: "ready", diff, error: null });
		} catch (error) {
			if (!stillOpen()) return;
			open({ path, status: "error", diff: null, error: message(error) });
		}
	}

	/** Back to nothing selected — a URL naming no comparison at all. */
	function reset(): void {
		if (store.state.key === null) return;
		store.setState(() => IDLE);
	}

	return { store, start, prefetch, openFile, reset };
}

/**
 * One session per document, matching the one worker per document the engine's
 * thread-local extraction cache requires (§2.6). Nothing writes to it on the
 * server — every entry point is an effect — so the module singleton cannot
 * leak one request's comparison into another's SSR render.
 */
export const diffSession = createDiffSession(diffClient);
