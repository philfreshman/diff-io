import { test, mock } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// Mock the .wasm?url import BEFORE importing the worker
mock.module("../wasm/diff-wasm/pkg/diff_wasm_bg.wasm?url", () => ({
    default: "mocked-url"
}));

import init, { build_diff_tree } from "../wasm/diff-wasm/pkg/diff_wasm.js";
import { npmRegistry } from "../src/registries/npm/application/npm.ts";
import { extractTarball } from "../src/workers/diff.worker.ts";

test("benchmark typescript comparison", async () => {
    console.log("Initializing WASM...");
    const wasmPath = join(process.cwd(), "wasm/diff-wasm/pkg/diff_wasm_bg.wasm");
    const wasmBuffer = readFileSync(wasmPath);
    await init({ module_or_path: wasmBuffer });

    // const pkg = "typescript";
    // const v1 = "5.9.2";
    // const v2 = "5.9.3";
    const pkg = "react-dom";
    const v1 = "18.3.1";
    const v2 = "19.2.3";

    const tar1 = await npmRegistry.getPackage(pkg, v1);
    const tar2 = await npmRegistry.getPackage(pkg, v2);

    const files1 = await extractTarball(tar1);
    const files2 = await extractTarball(tar2);

    console.log(`Comparing ${Object.keys(files1).length} files vs ${Object.keys(files2).length} files`);

    console.log("Benchmarking build_diff_tree...");
    const iterations = 10;
    const times: number[] = [];

    for (let i = 0; i < iterations; i++) {
        const start = performance.now();
        build_diff_tree(files1, files2, 1);
        const end = performance.now();
        const duration = end - start;
        times.push(duration);
        console.log(`Iteration ${i + 1}: ${duration.toFixed(2)}ms`);
    }

    const average = times.reduce((a, b) => a + b, 0) / iterations;
    const min = Math.min(...times);
    const max = Math.max(...times);

    console.log("\nBenchmark Results:");
    console.log(`Package: ${pkg}`);
    console.log(`Versions: ${v1} vs ${v2}`);
    console.log(`Iterations: ${iterations}`);
    console.log(`Average: ${average.toFixed(2)}ms`);
    console.log(`Min: ${min.toFixed(2)}ms`);
    console.log(`Max: ${max.toFixed(2)}ms`);
}, { timeout: 120000 });
