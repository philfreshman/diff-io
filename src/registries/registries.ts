import { cratesRegistry } from "./crates/application/crates.ts";
import { goRegistry } from "./go/application/go.ts";
import { npmRegistry } from "./npm/application/npm.ts";
import { pypiRegistry } from "./pypi/application/pypi.ts";
import type { PackageRegistry } from "./types.ts";

export const registries: Record<string, PackageRegistry> = {
	npm: npmRegistry,
	crates: cratesRegistry,
	go: goRegistry,
	pypi: pypiRegistry,
};
