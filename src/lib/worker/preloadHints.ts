import type { DiffSlug } from "#/lib/url/slug.ts";

/** The hashed URL of the worker chunk, as the build resolves it. */
export interface EngineUrls {
	worker: string;
}

/**
 * What the document asks the browser to fetch alongside its own assets.
 *
 * Without this the worker chunk is requested only once the head script has run
 * and, since it is the chunk that asks for the `.wasm`, the module waits behind
 * it — which is the 713 ms `wasm-init` measured in #148, none of which is
 * compilation or worker startup.
 *
 * The `.wasm` itself is deliberately not hinted for. A worker fetches in its
 * own fetch group and never reads the document's preload cache, so a
 * `preload as="fetch"` here is claimed by nobody: measured cold, the module was
 * downloaded twice and the copy the engine actually used arrived at 1415 ms
 * rather than 739 ms, the two having contended. The worker asks for it itself,
 * as early as it can — see `diff.worker.ts`.
 *
 * Only where the URL names a whole comparison: the boot script spawns nothing
 * without one, so a hint anywhere else is a download nobody makes.
 */
export function enginePreloadLinks(
	slug: DiffSlug | undefined,
	urls: EngineUrls,
) {
	if (!slug?.package || !slug.from || !slug.to) return [];

	return [{ rel: "modulepreload", href: urls.worker }];
}
