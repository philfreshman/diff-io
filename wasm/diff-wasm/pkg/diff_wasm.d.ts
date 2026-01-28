/* tslint:disable */
/* eslint-disable */

export class DiffCounts {
    private constructor();
    free(): void;
    [Symbol.dispose](): void;
    added: number;
    removed: number;
}

export class DiffTreeBuilder {
    free(): void;
    [Symbol.dispose](): void;
    build_tree(): any;
    constructor(similarity_threshold: number);
    set_from_files(files: any): void;
    set_to_files(files: any): void;
}

export function build_diff_tree(from_files: any, to_files: any, similarity_threshold: number): any;

export function count_diff(from: string, to: string): DiffCounts;

export function get_diff_content(filename: string, from_content: string, to_content: string): string;

export type InitInput = RequestInfo | URL | Response | BufferSource | WebAssembly.Module;

export interface InitOutput {
    readonly memory: WebAssembly.Memory;
    readonly __wbg_diffcounts_free: (a: number, b: number) => void;
    readonly __wbg_difftreebuilder_free: (a: number, b: number) => void;
    readonly __wbg_get_diffcounts_added: (a: number) => number;
    readonly __wbg_get_diffcounts_removed: (a: number) => number;
    readonly __wbg_set_diffcounts_added: (a: number, b: number) => void;
    readonly __wbg_set_diffcounts_removed: (a: number, b: number) => void;
    readonly build_diff_tree: (a: any, b: any, c: number) => [number, number, number];
    readonly count_diff: (a: number, b: number, c: number, d: number) => number;
    readonly difftreebuilder_build_tree: (a: number) => [number, number, number];
    readonly difftreebuilder_new: (a: number) => number;
    readonly difftreebuilder_set_from_files: (a: number, b: any) => [number, number];
    readonly difftreebuilder_set_to_files: (a: number, b: any) => [number, number];
    readonly get_diff_content: (a: number, b: number, c: number, d: number, e: number, f: number) => [number, number];
    readonly __wbindgen_malloc: (a: number, b: number) => number;
    readonly __wbindgen_realloc: (a: number, b: number, c: number, d: number) => number;
    readonly __wbindgen_exn_store: (a: number) => void;
    readonly __externref_table_alloc: () => number;
    readonly __wbindgen_externrefs: WebAssembly.Table;
    readonly __externref_table_dealloc: (a: number) => void;
    readonly __wbindgen_free: (a: number, b: number, c: number) => void;
    readonly __wbindgen_start: () => void;
}

export type SyncInitInput = BufferSource | WebAssembly.Module;

/**
 * Instantiates the given `module`, which can either be bytes or
 * a precompiled `WebAssembly.Module`.
 *
 * @param {{ module: SyncInitInput }} module - Passing `SyncInitInput` directly is deprecated.
 *
 * @returns {InitOutput}
 */
export function initSync(module: { module: SyncInitInput } | SyncInitInput): InitOutput;

/**
 * If `module_or_path` is {RequestInfo} or {URL}, makes a request and
 * for everything else, calls `WebAssembly.instantiate` directly.
 *
 * @param {{ module_or_path: InitInput | Promise<InitInput> }} module_or_path - Passing `InitInput` directly is deprecated.
 *
 * @returns {Promise<InitOutput>}
 */
export default function __wbg_init (module_or_path?: { module_or_path: InitInput | Promise<InitInput> } | InitInput | Promise<InitInput>): Promise<InitOutput>;
