import { describe, expect, test } from "bun:test";
import { createRng, generateStars } from "#/lib/starfield.ts";

describe("generateStars", () => {
	test("produces the same field for the same seed", () => {
		expect(generateStars(20, createRng(7))).toEqual(
			generateStars(20, createRng(7)),
		);
	});

	test("produces a different field for a different seed", () => {
		expect(generateStars(20, createRng(7))).not.toEqual(
			generateStars(20, createRng(8)),
		);
	});

	test("produces the requested number of stars", () => {
		expect(generateStars(100, createRng(1))).toHaveLength(100);
	});

	test("keeps every star on screen and visible", () => {
		for (const star of generateStars(200, createRng(3))) {
			expect(star.x).toBeGreaterThanOrEqual(0);
			expect(star.x).toBeLessThanOrEqual(1);
			expect(star.y).toBeGreaterThanOrEqual(0);
			expect(star.y).toBeLessThanOrEqual(1);
			expect(star.radius).toBeGreaterThan(0);
			expect(star.periodMs).toBeGreaterThan(0);
			expect(star.phase).toBeGreaterThanOrEqual(0);
			expect(star.phase).toBeLessThan(1);
		}
	});
});
