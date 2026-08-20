/**
 * The star field as data. Positions are normalised 0..1 so the canvas can be
 * resized without regenerating the field, and the generator takes its randomness
 * as an argument so a seed produces the same sky twice — which is what makes it
 * safe to render during hydration and testable without a browser.
 */

export interface Star {
	/** Normalised horizontal position, 0 (left) to 1 (right). */
	x: number;
	/** Normalised vertical position, 0 (top) to 1 (bottom). */
	y: number;
	/** Device-independent pixels. */
	radius: number;
	/** Length of one pulse, in milliseconds. */
	periodMs: number;
	/** Where in its pulse the star starts, 0..1, so they do not blink in unison. */
	phase: number;
}

export const STAR_COUNT = 100;

const MIN_RADIUS = 0.25;
const MAX_RADIUS = 1.25;
const MIN_PERIOD_MS = 2000;
const MAX_PERIOD_MS = 6000;

/**
 * Mulberry32 — small, fast, and good enough for scattering dots. Seeded so the
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

export function generateStars(count: number, rng: () => number): Star[] {
	return Array.from({ length: count }, () => ({
		x: rng(),
		y: rng(),
		radius: between(rng, MIN_RADIUS, MAX_RADIUS),
		periodMs: between(rng, MIN_PERIOD_MS, MAX_PERIOD_MS),
		phase: rng(),
	}));
}
