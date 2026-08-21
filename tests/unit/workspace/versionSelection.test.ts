import { describe, expect, test } from "bun:test";
import { resolveSelection } from "#/components/workspace/versionSelection.ts";

// Newest first, as every adapter promises.
const VERSIONS = ["3.0.0", "2.1.0", "2.0.0", "1.0.0"];

describe("resolveSelection", () => {
	test("defaults to the previous release against the newest", () => {
		expect(resolveSelection(VERSIONS, {})).toEqual({
			from: "2.1.0",
			to: "3.0.0",
		});
	});

	test("keeps what the URL asked for", () => {
		expect(resolveSelection(VERSIONS, { from: "1.0.0", to: "2.0.0" })).toEqual({
			from: "1.0.0",
			to: "2.0.0",
		});
	});

	test("defaults the half of the pair the URL leaves out", () => {
		expect(resolveSelection(VERSIONS, { from: "1.0.0" })).toEqual({
			from: "1.0.0",
			to: "3.0.0",
		});
	});

	test("drops a version the registry has never heard of", () => {
		// A hand-typed or yanked version: the field must say something real, or
		// Compare downloads an archive that does not exist.
		expect(resolveSelection(VERSIONS, { from: "9.9.9", to: "2.0.0" })).toEqual({
			from: "2.1.0",
			to: "2.0.0",
		});
	});

	test("compares a lone version against itself", () => {
		// A package with one release has no previous one; an empty field would
		// leave Compare dead with nothing the user could do about it.
		expect(resolveSelection(["1.0.0"], {})).toEqual({
			from: "1.0.0",
			to: "1.0.0",
		});
	});

	test("says what the URL says while the list is still on its way", () => {
		// Nothing to check against and nothing to default to. Clearing the fields
		// here would flash a deep link's versions away and back.
		expect(resolveSelection([], { from: "1.0.0", to: "2.0.0" })).toEqual({
			from: "1.0.0",
			to: "2.0.0",
		});
		expect(resolveSelection([], {})).toEqual({ from: "", to: "" });
	});
});
