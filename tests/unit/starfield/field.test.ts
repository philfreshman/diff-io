import { describe, expect, test } from "bun:test";
import { createRng, FIELD_HALF, generateMarks } from "#/lib/starfield/field.ts";

describe("generateMarks", () => {
	test("produces the same field for the same seed", () => {
		expect(generateMarks(20, createRng(7))).toEqual(
			generateMarks(20, createRng(7)),
		);
	});

	test("produces a different field for a different seed", () => {
		expect(generateMarks(20, createRng(7))).not.toEqual(
			generateMarks(20, createRng(8)),
		);
	});

	test("produces the requested number of marks", () => {
		expect(generateMarks(100, createRng(1))).toHaveLength(100);
	});

	test("keeps every mark inside the cube and visible", () => {
		for (const mark of generateMarks(200, createRng(3))) {
			for (const axis of [mark.x, mark.y, mark.z]) {
				expect(axis).toBeGreaterThanOrEqual(-FIELD_HALF);
				expect(axis).toBeLessThanOrEqual(FIELD_HALF);
			}
			expect(mark.size).toBeGreaterThan(0);
			expect(mark.periodMs).toBeGreaterThan(0);
			expect(mark.phase).toBeGreaterThanOrEqual(0);
			expect(mark.phase).toBeLessThan(1);
		}
	});

	test("draws both kinds of mark, mostly additions", () => {
		const marks = generateMarks(2000, createRng(11));
		const plus = marks.filter((mark) => mark.plus).length;
		expect(plus).toBeGreaterThan(marks.length / 2);
		expect(plus).toBeLessThan(marks.length);
	});
});
