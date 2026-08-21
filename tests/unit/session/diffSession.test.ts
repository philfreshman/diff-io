import { describe, expect, test } from "bun:test";
import { createDiffSession } from "#/lib/session/diffSession.ts";
import type {
	DiffFileEntry,
	DiffRequest,
	FileDiff,
} from "#/lib/worker/protocol.ts";

const REQUEST: DiffRequest = {
	registry: "npm",
	pkg: "express",
	from: "4.18.2",
	to: "5.1.0",
};

const TREE: DiffFileEntry = {
	path: "",
	type: "directory",
	status: "modified",
	children: [
		{ path: "index.js", type: "file", status: "modified" },
		{
			path: "lib/router.js",
			oldPath: "lib/routes.js",
			type: "file",
			status: "renamed",
		},
	],
};

/** A promise plus the handles to settle it from the test. */
function deferred<T>() {
	let resolve!: (value: T) => void;
	let reject!: (reason: Error) => void;
	const promise = new Promise<T>((res, rej) => {
		resolve = res;
		reject = rej;
	});

	return { promise, resolve, reject };
}

/**
 * Stands in for the worker client. It records what it was asked for and hands
 * back promises the test settles by hand, which is the only way to be inside
 * an in-flight request when the next one arrives.
 */
function stubClient() {
	const trees: Array<ReturnType<typeof deferred<DiffFileEntry>>> = [];
	const filesAsked: Array<[string, string | undefined]> = [];
	const fileReplies: Array<ReturnType<typeof deferred<FileDiff>>> = [];
	const prefetched: DiffRequest[] = [];
	let prefetchFails = false;

	return {
		trees,
		filesAsked,
		fileReplies,
		prefetched,
		failPrefetch() {
			prefetchFails = true;
		},
		client: {
			buildTree() {
				const next = deferred<DiffFileEntry>();
				trees.push(next);
				return next.promise;
			},
			getFile(path: string, oldPath?: string) {
				filesAsked.push([path, oldPath]);
				const next = deferred<FileDiff>();
				fileReplies.push(next);
				return next.promise;
			},
			prefetch(request: DiffRequest) {
				prefetched.push(request);
				return prefetchFails
					? Promise.reject(new Error("offline"))
					: Promise.resolve();
			},
		},
	};
}

/** The nth request the stub is holding open, or a clear failure if there is none. */
function take<T>(list: T[], index: number): T {
	const pending = list[index];
	if (!pending) throw new Error(`no request in flight at ${index}`);

	return pending;
}

/** Lets the microtask queue drain, so a settled promise has been observed. */
const settled = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("start", () => {
	test("goes loading, then ready with the tree", async () => {
		const stub = stubClient();
		const session = createDiffSession(stub.client);

		const running = session.start(REQUEST);
		expect(session.store.state.status).toBe("loading");

		take(stub.trees, 0).resolve(TREE);
		await running;

		expect(session.store.state.status).toBe("ready");
		expect(session.store.state.tree).toBe(TREE);
	});

	test("asking again for the comparison on screen costs nothing", async () => {
		// The workspace re-renders on every keystroke in the header; a second
		// `start` for the same pair must not re-download two archives.
		const stub = stubClient();
		const session = createDiffSession(stub.client);

		const running = session.start(REQUEST);
		take(stub.trees, 0).resolve(TREE);
		await running;
		await session.start({ ...REQUEST });

		expect(stub.trees).toHaveLength(1);
	});

	test("surfaces the engine's own message when it fails", async () => {
		const stub = stubClient();
		const session = createDiffSession(stub.client);

		const running = session.start(REQUEST);
		take(stub.trees, 0).reject(new Error("404 fetching express@5.1.0"));
		await running;

		expect(session.store.state.status).toBe("error");
		expect(session.store.state.error).toBe("404 fetching express@5.1.0");
	});

	test("a superseded comparison never lands", async () => {
		const stub = stubClient();
		const session = createDiffSession(stub.client);

		const first = session.start(REQUEST);
		const second = session.start({ ...REQUEST, to: "5.2.0" });
		// The first archive finishes downloading after the user has moved on.
		take(stub.trees, 0).resolve(TREE);
		take(stub.trees, 1).resolve({ ...TREE, path: "second" });
		await Promise.all([first, second]);

		expect(session.store.state.tree?.path).toBe("second");
	});

	test("a superseded failure does not replace a live comparison", async () => {
		const stub = stubClient();
		const session = createDiffSession(stub.client);

		const first = session.start(REQUEST);
		const second = session.start({ ...REQUEST, to: "5.2.0" });
		take(stub.trees, 1).resolve(TREE);
		take(stub.trees, 0).reject(new Error("404"));
		await Promise.all([first, second]);

		expect(session.store.state.status).toBe("ready");
		expect(session.store.state.error).toBeNull();
	});
});

describe("openFile", () => {
	async function readySession() {
		const stub = stubClient();
		const session = createDiffSession(stub.client);
		const running = session.start(REQUEST);
		take(stub.trees, 0).resolve(TREE);
		await running;

		return { stub, session };
	}

	test("reads the file the URL names", async () => {
		const { stub, session } = await readySession();

		const running = session.openFile("index.js");
		expect(session.store.state.file).toMatchObject({
			path: "index.js",
			status: "loading",
		});

		take(stub.fileReplies, 0).resolve({ data: "@@", isDiff: true });
		await running;

		expect(session.store.state.file).toMatchObject({
			path: "index.js",
			status: "ready",
		});
	});

	test("asks for a renamed file under both of its paths", async () => {
		const { stub, session } = await readySession();

		void session.openFile("lib/router.js");

		expect(stub.filesAsked[0]).toEqual(["lib/router.js", "lib/routes.js"]);
	});

	test("an empty path closes whatever was open", async () => {
		const { stub, session } = await readySession();
		const running = session.openFile("index.js");
		take(stub.fileReplies, 0).resolve({ data: "@@", isDiff: true });
		await running;

		await session.openFile("");

		expect(session.store.state.file).toBeNull();
	});

	test("a path this comparison does not contain is an error", async () => {
		// A deep link into a pair where the file no longer exists: it has to say
		// so, not spin forever waiting for the engine.
		const { stub, session } = await readySession();

		await session.openFile("gone.js");

		expect(session.store.state.file).toMatchObject({
			path: "gone.js",
			status: "error",
		});
		expect(stub.filesAsked).toHaveLength(0);
	});

	test("the file on screen is the one asked for last", async () => {
		const { stub, session } = await readySession();

		void session.openFile("index.js");
		void session.openFile("lib/router.js");
		// Clicking through the tree quickly: the first reply arrives last.
		take(stub.fileReplies, 1).resolve({ data: "second", isDiff: true });
		take(stub.fileReplies, 0).resolve({ data: "first", isDiff: true });
		await settled();

		expect(session.store.state.file).toMatchObject({
			path: "lib/router.js",
			diff: { data: "second", isDiff: true },
		});
	});

	test("nothing to read before the tree exists", async () => {
		const stub = stubClient();
		const session = createDiffSession(stub.client);
		void session.start(REQUEST);

		await session.openFile("index.js");

		expect(stub.filesAsked).toHaveLength(0);
		expect(session.store.state.file).toBeNull();
	});
});

describe("prefetch", () => {
	test("warms a comparison once, however often it is hovered", () => {
		const stub = stubClient();
		const session = createDiffSession(stub.client);

		session.prefetch(REQUEST);
		session.prefetch({ ...REQUEST });
		session.prefetch({ ...REQUEST, to: "5.2.0" });

		expect(stub.prefetched).toHaveLength(2);
	});

	test("a failed guess is silent, and can be tried again", async () => {
		const stub = stubClient();
		stub.failPrefetch();
		const session = createDiffSession(stub.client);

		session.prefetch(REQUEST);
		await settled();
		session.prefetch(REQUEST);

		expect(stub.prefetched).toHaveLength(2);
		expect(session.store.state.status).toBe("idle");
	});
});

describe("reset", () => {
	test("clears the comparison when the URL stops naming one", async () => {
		const stub = stubClient();
		const session = createDiffSession(stub.client);
		const running = session.start(REQUEST);
		take(stub.trees, 0).resolve(TREE);
		await running;

		session.reset();

		expect(session.store.state).toMatchObject({
			key: null,
			status: "idle",
			tree: null,
			file: null,
		});
	});
});
