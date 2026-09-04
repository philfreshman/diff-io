/**
 * Just enough WebGL to draw the sky.
 *
 * The sky is four draw calls of hand-written GLSL over static buffers: a
 * backdrop quad, a cloud sphere, a point cloud of marks, and a couple of
 * streaks. It needs no scene graph, no lighting, no materials, no loaders and
 * no render targets, which is everything a general 3D engine is mostly made of
 * — three.js was 515 kB of the landing page's JavaScript to supply a context, a
 * projection matrix and four `drawElements` calls. This file is that much,
 * which is what lets the sky arrive with the page instead of after it.
 *
 * Shaders are GLSL ES 1.00 (`attribute`, `varying`, `gl_FragColor`); a WebGL 2
 * context accepts them unchanged, and WebGL 1 is the fallback.
 */

import type { Mat4 } from "./matrix.ts";

/** A `float`, or the components of a `vec2`/`vec3`/`mat4`. */
export type UniformValue = number | ArrayLike<number> | Mat4;

export interface Attribute {
	data: Float32Array;
	/** Components per vertex: 1 for a `float` attribute, 3 for a `vec3`. */
	size: number;
}

export interface MeshSpec {
	vertex: string;
	fragment: string;
	attributes: Record<string, Attribute>;
	/** Triangles are indexed; a point cloud draws its vertices in order. */
	index?: Uint16Array;
	mode: "triangles" | "points";
	/**
	 * `additive` is what makes the marks and the clouds glow rather than paint
	 * over each other, and it is why their draw order does not matter.
	 */
	blend: "none" | "additive";
	/**
	 * `inside` keeps the far half of a shape and drops the near half, which is
	 * how the clouds are seen from within their own sphere.
	 */
	facing?: "outside" | "inside";
}

export interface Mesh {
	draw(uniforms: Record<string, UniformValue>): void;
	dispose(): void;
}

export interface Renderer {
	mesh(spec: MeshSpec): Mesh;
	/** Sizes the drawing buffer to `width`×`height` CSS pixels at `ratio`. */
	resize(width: number, height: number, ratio: number): void;
	clear(): void;
	dispose(): void;
}

/**
 * Declarations three.js used to prepend, kept because the shaders are written
 * against them. `uv` is unused by some of them, and an unused attribute simply
 * never becomes active.
 */
const VERTEX_PREFIX = /* glsl */ `precision highp float;
uniform mat4 modelViewMatrix;
uniform mat4 projectionMatrix;
attribute vec3 position;
attribute vec2 uv;
`;

const FRAGMENT_PREFIX = /* glsl */ `precision highp float;
`;

function compile(
	gl: WebGLRenderingContext,
	type: number,
	source: string,
): WebGLShader | null {
	const shader = gl.createShader(type);
	if (!shader) return null;
	gl.shaderSource(shader, source);
	gl.compileShader(shader);
	if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
		gl.deleteShader(shader);
		return null;
	}
	return shader;
}

/**
 * Binds a value to a uniform by looking up what the linked program says that
 * uniform's type is, rather than making every call site declare it. Four types
 * appear in these shaders; anything else is a mistake worth failing on.
 */
function setterFor(
	gl: WebGLRenderingContext,
	type: number,
	location: WebGLUniformLocation,
): ((value: UniformValue) => void) | null {
	switch (type) {
		case gl.FLOAT:
			return (v) => gl.uniform1f(location, v as number);
		case gl.FLOAT_VEC2:
			return (v) => gl.uniform2fv(location, v as Float32Array);
		case gl.FLOAT_VEC3:
			return (v) => gl.uniform3fv(location, v as Float32Array);
		case gl.FLOAT_MAT4:
			return (v) => gl.uniformMatrix4fv(location, false, v as Float32Array);
		default:
			return null;
	}
}

/** Compiles both stages and links them, or throws saying which step failed. */
function link(gl: WebGLRenderingContext, spec: MeshSpec): WebGLProgram {
	const vertexShader = compile(
		gl,
		gl.VERTEX_SHADER,
		VERTEX_PREFIX + spec.vertex,
	);
	const fragmentShader = compile(
		gl,
		gl.FRAGMENT_SHADER,
		FRAGMENT_PREFIX + spec.fragment,
	);
	const program = gl.createProgram();
	if (!vertexShader || !fragmentShader || !program) {
		throw new Error("starfield: shader compilation failed");
	}
	gl.attachShader(program, vertexShader);
	gl.attachShader(program, fragmentShader);
	gl.linkProgram(program);
	gl.deleteShader(vertexShader);
	gl.deleteShader(fragmentShader);
	if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
		gl.deleteProgram(program);
		throw new Error("starfield: shader link failed");
	}
	return program;
}

/** One setter per uniform the linked program actually kept, keyed by name. */
function uniformSetters(
	gl: WebGLRenderingContext,
	program: WebGLProgram,
): Map<string, (value: UniformValue) => void> {
	const setters = new Map<string, (value: UniformValue) => void>();
	const count = gl.getProgramParameter(program, gl.ACTIVE_UNIFORMS) as number;
	for (let i = 0; i < count; i += 1) {
		const info = gl.getActiveUniform(program, i);
		if (!info) continue;
		const location = gl.getUniformLocation(program, info.name);
		if (!location) continue;
		const setter = setterFor(gl, info.type, location);
		if (setter) setters.set(info.name, setter);
	}
	return setters;
}

interface BoundAttribute {
	buffer: WebGLBuffer;
	location: number;
	size: number;
}

/** Uploads each attribute once; they are static for the life of the sky. */
function attributeBuffers(
	gl: WebGLRenderingContext,
	program: WebGLProgram,
	attributes: Record<string, Attribute>,
): { buffers: BoundAttribute[]; vertexCount: number } {
	const buffers: BoundAttribute[] = [];
	let vertexCount = 0;
	for (const [name, attribute] of Object.entries(attributes)) {
		vertexCount = attribute.data.length / attribute.size;
		const location = gl.getAttribLocation(program, name);
		// An attribute the shader never reads is optimised away at link time.
		if (location < 0) continue;
		const buffer = gl.createBuffer();
		if (!buffer) continue;
		gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
		gl.bufferData(gl.ARRAY_BUFFER, attribute.data, gl.STATIC_DRAW);
		buffers.push({ buffer, location, size: attribute.size });
	}
	return { buffers, vertexCount };
}

/** The blend and cull state this mesh draws under, set fresh on every draw. */
function applyState(gl: WebGLRenderingContext, spec: MeshSpec): void {
	if (spec.blend === "additive") {
		gl.enable(gl.BLEND);
		gl.blendEquation(gl.FUNC_ADD);
		gl.blendFuncSeparate(gl.SRC_ALPHA, gl.ONE, gl.ONE, gl.ONE);
	} else {
		gl.disable(gl.BLEND);
	}

	if (spec.facing === "inside") {
		gl.enable(gl.CULL_FACE);
		gl.cullFace(gl.FRONT);
	} else {
		gl.disable(gl.CULL_FACE);
	}
}

/**
 * A renderer over `canvas`, or `null` if WebGL is unavailable — which is the
 * caller's cue to fall back to the CSS backdrop.
 *
 * `preserveDrawingBuffer` is only worth its cost for a sky that is drawn once
 * and never redrawn; otherwise the buffer's contents after compositing are
 * undefined and there is nothing to preserve.
 */
export function createRenderer(
	canvas: HTMLCanvasElement,
	options: { preserveDrawingBuffer: boolean },
): Renderer | null {
	const attributes: WebGLContextAttributes = {
		alpha: false,
		antialias: false,
		// Nothing in the sky is occluded by anything else: every layer is drawn
		// in order with the depth test off, so a depth buffer is dead weight.
		depth: false,
		stencil: false,
		preserveDrawingBuffer: options.preserveDrawingBuffer,
	};

	const gl = (canvas.getContext("webgl2", attributes) ??
		canvas.getContext("webgl", attributes)) as WebGLRenderingContext | null;
	if (!gl) return null;

	gl.clearColor(0, 0, 0, 1);
	gl.disable(gl.DEPTH_TEST);

	const meshes: Mesh[] = [];

	const mesh = (spec: MeshSpec): Mesh => {
		const program = link(gl, spec);
		const setters = uniformSetters(gl, program);
		const attributes = attributeBuffers(gl, program, spec.attributes);

		let indexBuffer: WebGLBuffer | null = null;
		if (spec.index) {
			indexBuffer = gl.createBuffer();
			gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, indexBuffer);
			gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, spec.index, gl.STATIC_DRAW);
		}

		const indexCount = spec.index?.length ?? 0;
		const mode = spec.mode === "points" ? gl.POINTS : gl.TRIANGLES;

		const instance: Mesh = {
			draw(uniforms) {
				// biome-ignore lint/correctness/useHookAtTopLevel: `useProgram` is WebGL's, not React's
				gl.useProgram(program);
				applyState(gl, spec);

				for (const [name, value] of Object.entries(uniforms)) {
					setters.get(name)?.(value);
				}

				for (const { buffer, location, size } of attributes.buffers) {
					gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
					gl.enableVertexAttribArray(location);
					gl.vertexAttribPointer(location, size, gl.FLOAT, false, 0, 0);
				}

				if (indexBuffer) {
					gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, indexBuffer);
					gl.drawElements(mode, indexCount, gl.UNSIGNED_SHORT, 0);
				} else {
					gl.drawArrays(mode, 0, attributes.vertexCount);
				}
			},
			dispose() {
				for (const { buffer } of attributes.buffers) gl.deleteBuffer(buffer);
				if (indexBuffer) gl.deleteBuffer(indexBuffer);
				gl.deleteProgram(program);
			},
		};
		meshes.push(instance);
		return instance;
	};

	return {
		mesh,
		resize(width, height, ratio) {
			canvas.width = Math.floor(width * ratio);
			canvas.height = Math.floor(height * ratio);
			gl.viewport(0, 0, canvas.width, canvas.height);
		},
		clear() {
			gl.clear(gl.COLOR_BUFFER_BIT);
		},
		dispose() {
			for (const item of meshes) item.dispose();
			meshes.length = 0;
			gl.getExtension("WEBGL_lose_context")?.loseContext();
		},
	};
}
