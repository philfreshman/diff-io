/**
 * Hand-written stand-in for `wasm/diff-wasm/pkg/diff_wasm.d.ts`.
 *
 * The real declarations are emitted by `bun run build:wasm` (wasm-pack) into a
 * gitignored `pkg/` directory, so pointing `tsconfig.json` `paths` at them made
 * `bun run typecheck` — and therefore the pre-commit hook — fail in every fresh
 * clone without a Rust toolchain. `tsc` reads this file instead; Vite still
 * resolves the real module through `resolve.alias` in `vite.config.ts`.
 *
 * Source of truth is `wasm/diff-wasm/src/lib.rs`. `bun run check:wasm-types`
 * compares the signatures below against the generated ones and fails on drift;
 * CI runs it after `build:wasm`, where a toolchain is available.
 *
 * Only the surface the app imports is declared. `initSync` and the internals of
 * `InitOutput` are wasm-bindgen boilerplate that nothing here calls.
 */

/* biome-ignore-all lint/suspicious/noExplicitAny: mirrors what wasm-bindgen emits for `JsValue`. */

export type InitInput =
	| RequestInfo
	| URL
	| Response
	| BufferSource
	| WebAssembly.Module;

export interface InitOutput {
	readonly memory: WebAssembly.Memory;
}

export function build_diff_tree_for_package(
	registry: string,
	pkg: string,
	from: string,
	to: string,
	similarity_threshold: number,
): Promise<any>;

export function get_diff_for_path(
	filename: string,
	old_path?: string | null,
): any;

export function prefetch_package(
	registry: string,
	pkg: string,
	version: string,
): Promise<void>;

export default function __wbg_init(
	module_or_path?:
		| { module_or_path: InitInput | Promise<InitInput> }
		| InitInput
		| Promise<InitInput>,
): Promise<InitOutput>;
