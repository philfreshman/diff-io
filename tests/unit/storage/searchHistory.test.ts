import { describe, expect, test } from "bun:test";
import {
	addToHistory,
	HISTORY_LIMIT,
	historyKey,
	parseHistory,
} from "#/lib/storage/searchHistory.ts";

describe("historyKey", () => {
	test("keeps the key the old app wrote, per registry", () => {
		expect(historyKey("npm")).toBe("search_history_npm");
		expect(historyKey("go")).toBe("search_history_go");
	});
});

describe("parseHistory", () => {
	test("reads back what was stored", () => {
		const raw = JSON.stringify([{ name: "express", description: "fast" }]);

		expect(parseHistory(raw)).toEqual([
			{ name: "express", description: "fast" },
		]);
	});

	test("treats an empty store as an empty history", () => {
		expect(parseHistory(null)).toEqual([]);
		expect(parseHistory("")).toEqual([]);
	});

	test("survives anything else that ended up under the key", () => {
		expect(parseHistory("{not json")).toEqual([]);
		expect(parseHistory('{"name":"express"}')).toEqual([]);
	});

	test("drops entries that are not results", () => {
		const raw = JSON.stringify([{ name: "express" }, "react", null, { v: 1 }]);

		expect(parseHistory(raw)).toEqual([{ name: "express" }]);
	});

	test("caps a store someone has overfilled", () => {
		const raw = JSON.stringify(
			Array.from({ length: 20 }, (_, i) => ({ name: `pkg-${i}` })),
		);

		expect(parseHistory(raw)).toHaveLength(HISTORY_LIMIT);
	});
});

describe("addToHistory", () => {
	test("puts the newest pick first", () => {
		const history = addToHistory([{ name: "react" }], { name: "express" });

		expect(history).toEqual([{ name: "express" }, { name: "react" }]);
	});

	test("moves a package already in the list rather than repeating it", () => {
		const history = addToHistory([{ name: "react" }, { name: "express" }], {
			name: "express",
			version: "5.1.0",
		});

		expect(history).toEqual([
			{ name: "express", version: "5.1.0" },
			{ name: "react" },
		]);
	});

	test("keeps at most ten, dropping the oldest", () => {
		const full = Array.from({ length: HISTORY_LIMIT }, (_, i) => ({
			name: `pkg-${i}`,
		}));

		const history = addToHistory(full, { name: "express" });

		expect(history).toHaveLength(HISTORY_LIMIT);
		expect(history[0]).toEqual({ name: "express" });
		expect(history.at(-1)).toEqual({ name: `pkg-${HISTORY_LIMIT - 2}` });
	});
});
