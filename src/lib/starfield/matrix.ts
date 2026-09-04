/**
 * The four 4×4 matrices the sky needs, and nothing else.
 *
 * Every value is column-major, which is the layout `uniformMatrix4fv` wants and
 * the one the GLSL `mat4` is indexed by, so nothing here ever transposes.
 * Results are written into a caller-owned array rather than returned: these are
 * rebuilt every frame, and a sky that allocates five matrices per frame gives
 * the collector something to do sixty times a second for no reason.
 */

export type Mat4 = Float32Array;

export function mat4(): Mat4 {
	const m = new Float32Array(16);
	m[0] = 1;
	m[5] = 1;
	m[10] = 1;
	m[15] = 1;
	return m;
}

/**
 * The symmetric perspective a camera with this field of view sees. `fovDeg` is
 * the *vertical* angle, which is the convention the scene's constants are
 * written in.
 */
export function perspective(
	out: Mat4,
	fovDeg: number,
	aspect: number,
	near: number,
	far: number,
): Mat4 {
	const top = near * Math.tan((fovDeg * Math.PI) / 360);
	const height = 2 * top;
	const width = aspect * height;

	out.fill(0);
	out[0] = (2 * near) / width;
	out[5] = (2 * near) / height;
	out[10] = -(far + near) / (far - near);
	out[11] = -1;
	out[14] = (-2 * far * near) / (far - near);
	return out;
}

/**
 * Position, then an XYZ-ordered Euler rotation, then scale — the order a scene
 * graph composes a node's local transform in, and the one the sky's objects
 * were authored against.
 */
export function compose(
	out: Mat4,
	px: number,
	py: number,
	pz: number,
	rx: number,
	ry: number,
	rz: number,
	sx: number,
	sy: number,
	sz: number,
): Mat4 {
	const a = Math.cos(rx);
	const b = Math.sin(rx);
	const c = Math.cos(ry);
	const d = Math.sin(ry);
	const e = Math.cos(rz);
	const f = Math.sin(rz);

	const ae = a * e;
	const af = a * f;
	const be = b * e;
	const bf = b * f;

	out[0] = c * e * sx;
	out[1] = (af + be * d) * sx;
	out[2] = (bf - ae * d) * sx;
	out[3] = 0;

	out[4] = -c * f * sy;
	out[5] = (ae - bf * d) * sy;
	out[6] = (be + af * d) * sy;
	out[7] = 0;

	out[8] = d * sz;
	out[9] = -b * c * sz;
	out[10] = a * c * sz;
	out[11] = 0;

	out[12] = px;
	out[13] = py;
	out[14] = pz;
	out[15] = 1;
	return out;
}

/** `out = a · b`. `out` may alias neither `a` nor `b`. */
export function multiply(out: Mat4, a: Mat4, b: Mat4): Mat4 {
	for (let col = 0; col < 4; col += 1) {
		const b0 = b[col * 4] as number;
		const b1 = b[col * 4 + 1] as number;
		const b2 = b[col * 4 + 2] as number;
		const b3 = b[col * 4 + 3] as number;
		for (let row = 0; row < 4; row += 1) {
			out[col * 4 + row] =
				(a[row] as number) * b0 +
				(a[4 + row] as number) * b1 +
				(a[8 + row] as number) * b2 +
				(a[12 + row] as number) * b3;
		}
	}
	return out;
}
