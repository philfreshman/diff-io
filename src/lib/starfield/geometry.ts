/**
 * The two shapes the sky is built from: a unit quad and a sphere. Both are
 * plain vertex data — the caller decides what to do with them.
 */

export interface Geometry {
	position: Float32Array;
	/** Absent on the sphere, whose shader only reads `position`. */
	uv?: Float32Array;
	index: Uint16Array;
}

/**
 * A 1×1 quad on the z=0 plane, centred on the origin, with `uv` running 0..1
 * left-to-right and bottom-to-top. Scaled up it is the backdrop; scaled thin
 * and rotated it is a shooting star.
 */
export function quad(): Geometry & { uv: Float32Array } {
	return {
		// prettier-ignore
		position: new Float32Array([
			-0.5, 0.5, 0, 0.5, 0.5, 0, -0.5, -0.5, 0, 0.5, -0.5, 0,
		]),
		uv: new Float32Array([0, 1, 1, 1, 0, 0, 1, 0]),
		index: new Uint16Array([0, 2, 1, 2, 3, 1]),
	};
}

/**
 * A UV sphere: `segments` divisions around, `rings` from pole to pole. The
 * clouds are painted on the inside of one, so the tessellation only has to be
 * fine enough that the shader's per-fragment direction does not visibly
 * facet — it carries no other detail.
 */
export function sphere(
	radius: number,
	segments: number,
	rings: number,
): Geometry {
	const position = new Float32Array((segments + 1) * (rings + 1) * 3);
	const indices: number[] = [];

	let v = 0;
	for (let ring = 0; ring <= rings; ring += 1) {
		const theta = (ring / rings) * Math.PI;
		const sinTheta = Math.sin(theta);
		const cosTheta = Math.cos(theta);
		for (let segment = 0; segment <= segments; segment += 1) {
			const phi = (segment / segments) * Math.PI * 2;
			position[v] = -radius * Math.cos(phi) * sinTheta;
			position[v + 1] = radius * cosTheta;
			position[v + 2] = radius * Math.sin(phi) * sinTheta;
			v += 3;
		}
	}

	const stride = segments + 1;
	for (let ring = 0; ring < rings; ring += 1) {
		for (let segment = 0; segment < segments; segment += 1) {
			const a = ring * stride + segment + 1;
			const b = ring * stride + segment;
			const c = (ring + 1) * stride + segment;
			const d = (ring + 1) * stride + segment + 1;
			// The triangle that would degenerate at each pole is left out.
			if (ring !== 0) indices.push(a, b, d);
			if (ring !== rings - 1) indices.push(b, c, d);
		}
	}

	return { position, index: new Uint16Array(indices) };
}
