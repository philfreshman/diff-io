import diffWorkerUrl from "./diff.worker.ts?worker&url";
import type { EngineUrls } from "./preloadHints.ts";

/**
 * Where the build put the worker chunk.
 *
 * Stated once because two places need the same answer and must not disagree:
 * the head script spawns the worker by URL, and the preload hint asks for that
 * same chunk ahead of it. A hint for a chunk other than the one actually
 * spawned is a download nobody uses.
 */
export const engineUrls: EngineUrls = { worker: diffWorkerUrl };
