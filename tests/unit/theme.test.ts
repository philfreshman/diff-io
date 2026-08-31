import { describe, expect, test } from "bun:test";
import {
	nextSelection,
	parseSelection,
	resolveTheme,
	themeColor,
} from "#/lib/theme.ts";

describe("parseSelection", () => {
	test("passes a valid stored selection through", () => {
		expect(parseSelection("light")).toBe("light");
		expect(parseSelection("dark")).toBe("dark");
		expect(parseSelection("system")).toBe("system");
	});

	test("falls back to dark when nothing is stored", () => {
		expect(parseSelection(null)).toBe("dark");
	});

	test("falls back to dark when the stored value is not a selection", () => {
		expect(parseSelection("solarized")).toBe("dark");
	});
});

describe("resolveTheme", () => {
	test("uses the OS preference when the selection is system", () => {
		expect(resolveTheme("system", true)).toBe("dark");
		expect(resolveTheme("system", false)).toBe("light");
	});

	test("ignores the OS preference when a theme was chosen explicitly", () => {
		expect(resolveTheme("light", true)).toBe("light");
		expect(resolveTheme("dark", false)).toBe("dark");
	});
});

describe("nextSelection", () => {
	test("cycles light to dark to system and back", () => {
		expect(nextSelection("light")).toBe("dark");
		expect(nextSelection("dark")).toBe("system");
		expect(nextSelection("system")).toBe("light");
	});
});

describe("themeColor", () => {
	test("matches the page background so browser chrome blends in", () => {
		expect(themeColor("light")).toBe("#ffffff");
		expect(themeColor("dark")).toBe("#0a0a0a");
	});
});
