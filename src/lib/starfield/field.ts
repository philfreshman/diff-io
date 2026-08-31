/**
 * The star field as data. Every star is a diff mark — a `+` or a `−` — scattered
 * through a cube that wraps around the viewer, so the field can be flown through
 * forever without running out. The generator takes its randomness as an argument
 * so a seed produces the same sky twice, which is what makes it safe to build
 * during hydration and testable without a browser.
 */

export interface DiffMark {
	/** World position, each axis in −`FIELD_HALF`..`FIELD_HALF`. */
	x: number;
	y: number;
	z: number;
	/** Relative size, before perspective and the device pixel ratio. */
	size: number;
	/** Length of one pulse, in milliseconds. */
	periodMs: number;
	/** Where in its pulse the mark starts, 0..1, so they do not blink in unison. */
	phase: number;
	/** A `+` when true, a `−` when false. */
	plus: boolean;
}

/**
 * Half the side of the cube the field lives in. The shader wraps marks within
 * it, and the far fade puts them out of sight well before the seam, so the
 * count below is much larger than what is ever on screen at once.
 */
export const FIELD_HALF = 38;
export const MARK_COUNT = 6500;
export const FIELD_SEED = 0x5eed;

/** Rather more `+` than `−`, which is what a release usually looks like. */
const PLUS_SHARE = 0.62;
const MIN_SIZE = 0.55;
const MAX_SIZE = 1.65;
const MIN_PERIOD_MS = 2000;
const MAX_PERIOD_MS = 6000;

/**
 * Mulberry32 — small, fast, and good enough for scattering marks. Seeded so the
 * field is reproducible.
 */
export function createRng(seed: number): () => number {
	let state = seed >>> 0;
	return () => {
		state = (state + 0x6d2b79f5) >>> 0;
		let t = state;
		t = Math.imul(t ^ (t >>> 15), t | 1);
		t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}

function between(rng: () => number, min: number, max: number): number {
	return min + rng() * (max - min);
}

export function generateMarks(count: number, rng: () => number): DiffMark[] {
	return Array.from({ length: count }, () => ({
		x: between(rng, -FIELD_HALF, FIELD_HALF),
		y: between(rng, -FIELD_HALF, FIELD_HALF),
		z: between(rng, -FIELD_HALF, FIELD_HALF),
		size: between(rng, MIN_SIZE, MAX_SIZE),
		periodMs: between(rng, MIN_PERIOD_MS, MAX_PERIOD_MS),
		phase: rng(),
		plus: rng() < PLUS_SHARE,
	}));
}
