import init, {
	count_diff,
	get_diff_content,
} from "../../wasm/diff-wasm/pkg/diff_wasm.js";
import wasmUrl from "../../wasm/diff-wasm/pkg/diff_wasm_bg.wasm?url";
import { registries } from "../registries/registries.ts";

let wasmInitialized = false;
export async function ensureWasmInitialized() {
	if (!wasmInitialized) {
		try {
			let module_or_path: string | URL | Request = wasmUrl as any;
			if (
				typeof module_or_path === "string" &&
				module_or_path.startsWith("/") &&
				typeof process !== "undefined"
			) {
				module_or_path = `file://${module_or_path}`;
			}
			await init({ module_or_path });
			wasmInitialized = true;
		} catch (error) {
			console.error("WASM initialization failed:", error);
			throw error;
		}
	}
}

export type DiffStatus = "added" | "removed" | "modified" | "unchanged";

export type DiffFileEntry = {
	path: string;
	type: "file" | "directory";
	status: DiffStatus;
	added?: number;
	removed?: number;
	children?: DiffFileEntry[];
};

type WorkerRequest =
	| {
			type: "start-diff";
			registry: string;
			pkg: string;
			from: string;
			to: string;
	  }
	| {
			type: "prefetch";
			registry: string;
			pkg: string;
			from: string;
			to: string;
	  }
	| {
			type: "get-diff";
			filename: string;
			fromContent?: string;
			toContent?: string;
	  };

export type FileMapEntry = {
	type: "file" | "directory";
	content: string;
};

const decoder = new TextDecoder();

const extractionCache = new Map<
	string,
	Promise<Record<string, FileMapEntry>>
>();

async function getExtractedPackage(
	registry: string,
	pkg: string,
	version: string,
): Promise<Record<string, FileMapEntry>> {
	const cacheKey = `${registry}:${pkg}:${version}`;
	const cached = extractionCache.get(cacheKey);
	if (cached) return cached;

	const promise = (async () => {
		const registryImpl = registries[registry];
		if (!registryImpl) {
			throw new Error(`Unsupported registry: ${registry}`);
		}

		const tarball = await registryImpl.getPackage(pkg, version);
		return extractTarball(tarball);
	})();

	extractionCache.set(cacheKey, promise);

	// Remove from cache on failure so it can be retried
	promise.catch(() => {
		if (extractionCache.get(cacheKey) === promise) {
			extractionCache.delete(cacheKey);
		}
	});

	return promise;
}

self.onmessage = async (event: MessageEvent<WorkerRequest>) => {
	try {
		await ensureWasmInitialized();
	} catch (error) {
		const message =
			error instanceof Error ? error.message : "WASM initialization failed";
		postMessage({ type: "error", error: message });
		return;
	}

	const data = event.data;

	if (data.type === "start-diff") {
		await handleStartDiff(data.registry, data.pkg, data.from, data.to);
	} else if (data.type === "prefetch") {
		await handlePrefetch(data.registry, data.pkg, data.from, data.to);
	} else if (data.type === "get-diff") {
		handleGetDiff(data.filename, data.fromContent, data.toContent);
	}
};

async function handleStartDiff(
	registry: string,
	pkg: string,
	from: string,
	to: string,
) {
	try {
		const [fromFiles, toFiles] = await Promise.all([
			getExtractedPackage(registry, pkg, from),
			getExtractedPackage(registry, pkg, to),
		]);

		const diffTree = buildDiffTree(fromFiles, toFiles);

		postMessage({
			type: "diff-result",
			data: diffTree,
			fromFiles,
			toFiles,
		});
	} catch (error) {
		const message = error instanceof Error ? error.message : "Unknown error";
		postMessage({ type: "error", error: message });
	}
}

async function handlePrefetch(
	registry: string,
	pkg: string,
	from: string,
	to: string,
) {
	try {
		await Promise.all([
			getExtractedPackage(registry, pkg, from),
			getExtractedPackage(registry, pkg, to),
		]);
	} catch (error) {
		console.error("Prefetch failed:", error);
	}
}

export async function extractTarball(
	tarballBuffer: ArrayBuffer,
): Promise<Record<string, FileMapEntry>> {
	const tarBuffer = await gunzip(tarballBuffer);
	return parseTar(tarBuffer);
}

export async function gunzip(buffer: ArrayBuffer): Promise<ArrayBuffer> {
	if (typeof DecompressionStream === "undefined") {
		throw new Error("Gzip decompression is not supported in this environment");
	}

	const decompressedStream = new Blob([buffer])
		.stream()
		.pipeThrough(new DecompressionStream("gzip"));
	const response = new Response(decompressedStream);
	return response.arrayBuffer();
}

export function parseTar(buffer: ArrayBuffer): Record<string, FileMapEntry> {
	const bytes = new Uint8Array(buffer);
	const files: Record<string, FileMapEntry> = {};

	let offset = 0;
	while (offset + 512 <= bytes.length) {
		if (isEndOfArchive(bytes, offset)) {
			break;
		}

		const name = readString(bytes, offset, 100);
		const size = readOctal(bytes, offset + 124, 12);
		const typeFlag = bytes[offset + 156];
		const isDirectory = typeFlag === 53; // "5" in ASCII
		const normalizedName = normalizePath(name, isDirectory);

		if (normalizedName) {
			if (isDirectory) {
				files[normalizedName] = { type: "directory", content: "" };
			} else {
				const contentStart = offset + 512;
				const content = bytes.slice(contentStart, contentStart + size);
				files[normalizedName] = {
					type: "file",
					content: decoder.decode(content),
				};
			}
		}

		const blocks = Math.ceil(size / 512);
		offset += 512 + blocks * 512;
	}

	// Ensure directories derived from file paths are present
	Object.keys(files).forEach((path) => {
		const parts = path.split("/");
		for (let i = 1; i < parts.length; i++) {
			const dirPath = parts.slice(0, i).join("/");
			if (dirPath && !files[dirPath]) {
				files[dirPath] = { type: "directory", content: "" };
			}
		}
	});

	return stripCommonRoot(files);
}

export function stripCommonRoot(
	files: Record<string, FileMapEntry>,
): Record<string, FileMapEntry> {
	const paths = Object.keys(files);
	if (paths.length === 0) return files;

	const topLevel = new Set<string>();
	for (const path of paths) {
		const firstPart = path.split("/")[0];
		topLevel.add(firstPart);
	}

	if (topLevel.size === 1) {
		const root = topLevel.values().next().value;
		if (root && files[root]?.type === "directory") {
			const newFiles: Record<string, FileMapEntry> = {};
			let hasFiles = false;
			for (const path of paths) {
				if (path === root) continue;
				const newPath = path.slice(root.length + 1);
				if (newPath) {
					newFiles[newPath] = files[path];
					hasFiles = true;
				}
			}
			if (hasFiles) {
				return newFiles;
			}
		}
	}

	return files;
}

function isEndOfArchive(bytes: Uint8Array, offset: number) {
	for (let i = offset; i < offset + 512; i++) {
		if (bytes[i] !== 0) return false;
	}
	return true;
}

function readString(bytes: Uint8Array, offset: number, length: number): string {
	const slice = bytes.slice(offset, offset + length);
	const raw = decoder.decode(slice);
	return raw.replace(/\0+.*$/, "").trim();
}

function readOctal(bytes: Uint8Array, offset: number, length: number): number {
	const str = readString(bytes, offset, length).trim();
	return str ? parseInt(str, 8) : 0;
}

function normalizePath(path: string, isDirectory: boolean): string {
	if (!path) return "";
	const trimmed = path.replace(/^\/+/, "");
	if (isDirectory) {
		return trimmed.replace(/\/+$/, "");
	}
	return trimmed;
}

export function buildDiffTree(
	fromFiles: Record<string, FileMapEntry>,
	toFiles: Record<string, FileMapEntry>,
): DiffFileEntry {
	const root: DiffFileEntry = {
		path: "/",
		type: "directory",
		status: "unchanged",
		children: [],
	};

	const fromPaths = new Set(Object.keys(fromFiles));
	const toPaths = new Set(Object.keys(toFiles));
	const fromDirs = collectDirectories(fromPaths);
	const toDirs = collectDirectories(toPaths);

	const allPaths = new Set<string>([
		...fromPaths,
		...toPaths,
		...fromDirs,
		...toDirs,
	]);

	const sortedPaths = Array.from(allPaths).filter(Boolean).sort();
	for (const path of sortedPaths) {
		const type: "file" | "directory" =
			(fromFiles[path]?.type || toFiles[path]?.type) === "directory" ||
			fromDirs.has(path) ||
			toDirs.has(path)
				? "directory"
				: "file";
		insertNode(root, path, type);
	}

	computeStatuses(root, fromFiles, toFiles, fromDirs, toDirs);
	return root;
}

function collectDirectories(paths: Set<string>): Set<string> {
	const dirs = new Set<string>();
	for (const path of paths) {
		const segments = path.split("/");
		for (let i = 1; i < segments.length; i++) {
			const dir = segments.slice(0, i).join("/");
			if (dir) dirs.add(dir);
		}
	}
	return dirs;
}

function insertNode(
	root: DiffFileEntry,
	fullPath: string,
	type: "file" | "directory",
) {
	const parts = fullPath.split("/");
	let current = root;

	for (let i = 0; i < parts.length; i++) {
		const partPath = parts.slice(0, i + 1).join("/");
		const isLeaf = i === parts.length - 1;
		current.children = current.children || [];
		let child = current.children.find((c) => c.path === partPath);

		if (!child) {
			child = {
				path: partPath,
				type: isLeaf ? type : "directory",
				status: "unchanged",
				children: [],
			};
			current.children.push(child);
		}

		current = child;
	}
}

function computeStatuses(
	node: DiffFileEntry,
	fromFiles: Record<string, FileMapEntry>,
	toFiles: Record<string, FileMapEntry>,
	fromDirs: Set<string>,
	toDirs: Set<string>,
): { status: DiffStatus; added: number; removed: number } {
	if (node.type === "file") {
		const fromEntry = fromFiles[node.path];
		const toEntry = toFiles[node.path];

		if (fromEntry && !toEntry) {
			node.status = "removed";
			node.added = 0;
			node.removed = fromEntry.content.split("\n").length;
		} else if (!fromEntry && toEntry) {
			node.status = "added";
			node.added = toEntry.content.split("\n").length;
			node.removed = 0;
		} else if (fromEntry && toEntry) {
			if (fromEntry.content === toEntry.content) {
				node.status = "unchanged";
				node.added = 0;
				node.removed = 0;
			} else {
				node.status = "modified";
				const { added, removed } = countDiff(
					fromEntry.content,
					toEntry.content,
				);
				node.added = added;
				node.removed = removed;
			}
		} else {
			node.status = "unchanged";
			node.added = 0;
			node.removed = 0;
		}
		return {
			status: node.status,
			added: node.added || 0,
			removed: node.removed || 0,
		};
	}

	const children = node.children || [];
	const childResults = children.map((child) =>
		computeStatuses(child, fromFiles, toFiles, fromDirs, toDirs),
	);

	const inFrom = node.path === "/" || fromDirs.has(node.path);
	const inTo = node.path === "/" || toDirs.has(node.path);

	const totalAdded = childResults.reduce((acc, curr) => acc + curr.added, 0);
	const totalRemoved = childResults.reduce(
		(acc, curr) => acc + curr.removed,
		0,
	);
	node.added = totalAdded;
	node.removed = totalRemoved;

	if (inFrom && !inTo) {
		node.status = "removed";
	} else if (!inFrom && inTo) {
		node.status = "added";
	} else if (childResults.every((res) => res.status === "unchanged")) {
		node.status = "unchanged";
	} else {
		node.status = "modified";
	}

	return { status: node.status, added: node.added, removed: node.removed };
}

function countDiff(
	from: string,
	to: string,
): { added: number; removed: number } {
	const result = count_diff(from, to);
	try {
		const added = result.added;
		const removed = result.removed;
		return { added, removed };
	} finally {
		result.free();
	}
}

export function handleGetDiff(
	filename: string,
	fromContent?: string,
	toContent?: string,
) {
	let result: string;
	let isDiff = true;

	if (fromContent === undefined && toContent === undefined) {
		result = "File not present in either version.";
		isDiff = false;
	} else if (fromContent === undefined) {
		const toLines = (toContent ?? "").split("\n");
		const header = `--- /dev/null\n+++ to/${filename}`;
		result = [header, ...toLines.map((line) => `+ ${line}`)].join("\n");
	} else if (toContent === undefined) {
		const fromLines = (fromContent ?? "").split("\n");
		const header = `--- from/${filename}\n+++ /dev/null`;
		result = [header, ...fromLines.map((line) => `- ${line}`)].join("\n");
	} else if (fromContent === toContent) {
		result = toContent ?? "";
		isDiff = false;
	} else {
		try {
			result = get_diff_content(filename, fromContent, toContent);
		} catch (error) {
			const message =
				error instanceof Error ? error.message : "Diff generation failed";
			postMessage({ type: "error", error: message });
			return;
		}
	}

	postMessage({ type: "diff-result", filename, data: result, isDiff });
}
