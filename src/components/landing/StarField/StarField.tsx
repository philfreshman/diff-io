import { useEffect, useRef, useState } from "react";
import { useResolvedTheme } from "#/components/theme/useResolvedTheme.ts";
import { CLOUD_GLSL } from "#/lib/starfield/clouds.ts";
import { BLUE, COSMOS_GLSL, hueAt, PURPLE } from "#/lib/starfield/cosmos.ts";
import {
	createRng,
	FIELD_HALF,
	FIELD_SEED,
	generateMarks,
	MARK_COUNT,
} from "#/lib/starfield/field.ts";
import { quad, sphere } from "#/lib/starfield/geometry.ts";
import {
	compose,
	mat4,
	type Mat4,
	multiply,
	perspective,
} from "#/lib/starfield/matrix.ts";
import { createRenderer, type Mesh } from "#/lib/starfield/webgl.ts";
import styles from "./StarField.module.css";

/**
 * The night sky, drawn on one WebGL canvas rather than as a hundred animated
 * elements. Every star is a diff mark — a white `+` or `−` on a faint disc, so
 * the field reads as stars at a glance and as a diff when you look at it. The
 * marks fill a cube that wraps around the camera, which drifts slowly forward
 * through them; the pointer slides the camera the other way, and the parallax
 * between near and far marks is what gives the sky its depth.
 *
 * The backdrop under it all is `--cosmic-backdrop` reproduced in GLSL, because
 * the canvas covers the CSS one. If WebGL is unavailable the canvas is dropped
 * and the CSS gradient is what the visitor gets.
 *
 * The four shaders below are the whole scene; `lib/starfield/webgl.ts` is the
 * little that sits under them. There is no 3D engine here on purpose — the
 * sky's arrival is gated on its own JavaScript downloading, and an engine is
 * half a megabyte of features this scene does not use.
 */
const FOV = 60;
/** Marks are out of sight before the wrap at `FIELD_HALF` can be seen happening. */
const FADE_START = 24;
const FADE_END = 35;
/** World units per second: a drift, not a flight. */
const DRIFT_SPEED = 0.9;
/** Far enough that the camera's slide never reaches it. */
const CLOUD_RADIUS = 150;

const SHOOTING_MIN_MS = 14000;
const SHOOTING_MAX_MS = 30000;
const SHOOTING_LIFETIME_MS = 3000;
const SHOOTING_POOL = 2;

/** The field sits at the world origin and never moves; the camera does. */
const IDENTITY = mat4();

const MARK_VERTEX = /* glsl */ `
attribute float aSize;
attribute float aPhase;
attribute float aPeriod;
attribute float aPlus;
uniform float uTime;
uniform float uPixelRatio;
uniform vec3 uOffset;
varying float vAlpha;
varying float vSize;
varying float vPlus;

const float HALF = ${FIELD_HALF}.0;

void main() {
	// The drift happens here rather than on the CPU: the field is one cube that
	// repeats, so travelling through it is an offset and a modulo, and the
	// position buffer never has to be rewritten or re-uploaded.
	vec3 wrapped = mod(position + uOffset + HALF, 2.0 * HALF) - HALF;
	vec4 mv = modelViewMatrix * vec4(wrapped, 1.0);
	float depth = -mv.z;

	// One pulse takes aPeriod ms; aPhase staggers the field so the marks do not
	// blink in unison.
	float pulse = 0.5 + 0.5 * sin((uTime / aPeriod + aPhase) * 6.2831853);
	vAlpha = 0.5 + pulse * 0.5;
	// The nearest marks are wide on screen; left at full brightness they read as
	// glyphs stuck to the page rather than as marks close by.
	vAlpha *= smoothstep(4.5, 11.0, depth) * mix(0.7, 1.0, smoothstep(11.0, 24.0, depth));
	// And the farthest have to be gone before they reach the edge of the cube.
	vAlpha *= 1.0 - smoothstep(${FADE_START}.0, ${FADE_END}.0, depth);

	// Barely any size pulse: a glyph that breathes reads as a wobble, not a
	// twinkle. The brightness above does that work instead.
	gl_PointSize = clamp(
		aSize * (1.0 + pulse * 0.12) * uPixelRatio * (95.0 / depth),
		uPixelRatio * 2.2,
		uPixelRatio * 14.0
	);
	vSize = gl_PointSize;
	vPlus = aPlus;
	gl_Position = projectionMatrix * mv;
}
`;

const MARK_FRAGMENT = /* glsl */ `
varying float vAlpha;
varying float vSize;
varying float vPlus;

float box(vec2 p, vec2 halfSize) {
	vec2 d = abs(p) - halfSize;
	return length(max(d, 0.0)) + min(max(d.x, d.y), 0.0);
}

void main() {
	vec2 p = gl_PointCoord - 0.5;
	// The bar of a −, and the same bar turned upright to finish a +.
	float d = box(p, vec2(0.32, 0.085));
	if (vPlus > 0.5) d = min(d, box(p, vec2(0.085, 0.32)));

	// One pixel, expressed in sprite units. A distant mark is only two or three
	// pixels across, so this smears it back into a soft speck — the level of
	// detail comes out of the antialiasing for free.
	float aa = max(1.2 / vSize, 0.02);
	float glyph = 1.0 - smoothstep(-aa, aa, d);
	// A faint disc behind the mark, so it still reads as a star at a glance and
	// only resolves into a + or a − when you look at it.
	float halo = pow(smoothstep(0.44, 0.02, length(p)), 1.6) * 0.32;

	float a = min(1.0, glyph + halo) * vAlpha;
	if (a < 0.004) discard;
	gl_FragColor = vec4(1.0, 1.0, 1.0, a);
}
`;

const SPRITE_VERTEX = /* glsl */ `
varying vec2 vUv;
void main() {
	vUv = uv;
	gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

const STREAK_FRAGMENT = /* glsl */ `
varying vec2 vUv;
uniform float uAlpha;

void main() {
	float along = vUv.x;
	float across = abs(vUv.y - 0.5) * 2.0;
	float core = smoothstep(1.0, 0.0, across);
	float tail = pow(along, 3.0) * core * 0.5;
	float head = smoothstep(0.86, 1.0, along) * core * core;
	gl_FragColor = vec4(1.0, 1.0, 1.0, (tail + head) * uAlpha);
}
`;

const BACKDROP_FRAGMENT = /* glsl */ `
varying vec2 vUv;
uniform vec2 uRes;
uniform float uHue;
${COSMOS_GLSL}
void main() {
	gl_FragColor = vec4(cosmicBackdrop(vec2(vUv.x, 1.0 - vUv.y), uRes, uHue), 1.0);
}
`;

const CLOUD_VERTEX = /* glsl */ `
varying vec3 vDir;
void main() {
	vDir = position;
	gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

const CLOUD_FRAGMENT = /* glsl */ `
varying vec3 vDir;
uniform float uTime;
uniform vec3 uFlow;
uniform vec3 uPurple;
uniform vec3 uBlue;
${CLOUD_GLSL}
void main() {
	gl_FragColor = vec4(
		nebula(normalize(vDir), uTime, uFlow, uPurple, uBlue),
		1.0
	);
}
`;

/** One shooting star's flight, in world units. */
interface Streak {
	startedAt: number;
	fromX: number;
	fromY: number;
	fromZ: number;
	travel: number;
	halfHeight: number;
}

export function StarField() {
	const canvasRef = useRef<HTMLCanvasElement>(null);
	const theme = useResolvedTheme();
	const [webglFailed, setWebglFailed] = useState(false);

	useEffect(() => {
		// The canvas only exists under the dark theme, and only after mount.
		if (theme !== "dark") return;
		const canvas = canvasRef.current;
		if (!canvas) return;

		// A canvas animation loop is invisible to the CSS reduced-motion query, so
		// the preference has to be honoured here: draw the sky once and stop.
		const still = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

		// Only when the sky is a single frame that is never redrawn: the drawing
		// buffer is otherwise undefined after the browser composites it, and a
		// still sky has nothing to put back.
		const renderer = createRenderer(canvas, { preserveDrawingBuffer: still });
		if (!renderer) {
			// No WebGL. The CSS `--cosmic-backdrop` behind this canvas is the
			// fallback, so the canvas just gets out of its way.
			setWebglFailed(true);
			return;
		}

		// --- the camera ---------------------------------------------------------
		// It only ever slides; nothing rotates it. So the view matrix is a
		// translation, and "forwards" stays -z for the whole session.
		const projection = mat4();
		const view = mat4();
		const model = mat4();
		const modelView = mat4();

		// --- the backdrop, glued to the screen rather than to the world ----------
		// It rides at a fixed depth in front of the camera, so its model-view
		// matrix is the same however far the camera has slid.
		const backdropGeometry = quad();
		const uRes = new Float32Array(2);
		const backdropView = mat4();
		const backdrop = renderer.mesh({
			vertex: SPRITE_VERTEX,
			fragment: BACKDROP_FRAGMENT,
			attributes: {
				position: { data: backdropGeometry.position, size: 3 },
				uv: { data: backdropGeometry.uv, size: 2 },
			},
			index: backdropGeometry.index,
			mode: "triangles",
			blend: "none",
		});

		// --- the clouds, on a sphere the camera never leaves ---------------------
		// The drift moves the field, not the camera, so a sphere at the origin
		// stays around the viewer however long the page is left open.
		const cloudGeometry = sphere(CLOUD_RADIUS, 48, 24);
		const uCloudFlow = new Float32Array(3);
		const uPurple = new Float32Array(PURPLE);
		const uBlue = new Float32Array(BLUE);
		// Tilted, so the band in the cloud shader does not lie flat across the
		// middle of the screen looking like a seam.
		const cloudModel = compose(mat4(), 0, 0, 0, 0.16, 0, 0.42, 1, 1, 1);
		const clouds = renderer.mesh({
			vertex: CLOUD_VERTEX,
			fragment: CLOUD_FRAGMENT,
			attributes: {
				position: { data: cloudGeometry.position, size: 3 },
			},
			index: cloudGeometry.index,
			mode: "triangles",
			blend: "additive",
			facing: "inside",
		});

		// --- the field ----------------------------------------------------------
		const rng = createRng(FIELD_SEED);
		const marks = generateMarks(MARK_COUNT, rng);
		const positions = new Float32Array(MARK_COUNT * 3);
		const sizes = new Float32Array(MARK_COUNT);
		const phases = new Float32Array(MARK_COUNT);
		const periods = new Float32Array(MARK_COUNT);
		const pluses = new Float32Array(MARK_COUNT);
		for (let i = 0; i < MARK_COUNT; i += 1) {
			const mark = marks[i];
			if (!mark) continue;
			positions[i * 3] = mark.x;
			positions[i * 3 + 1] = mark.y;
			positions[i * 3 + 2] = mark.z;
			sizes[i] = mark.size;
			phases[i] = mark.phase;
			periods[i] = mark.periodMs;
			pluses[i] = mark.plus ? 1 : 0;
		}

		const uOffset = new Float32Array(3);
		const field = renderer.mesh({
			vertex: MARK_VERTEX,
			fragment: MARK_FRAGMENT,
			attributes: {
				position: { data: positions, size: 3 },
				aSize: { data: sizes, size: 1 },
				aPhase: { data: phases, size: 1 },
				aPeriod: { data: periods, size: 1 },
				aPlus: { data: pluses, size: 1 },
			},
			mode: "points",
			blend: "additive",
		});

		// --- shooting stars -----------------------------------------------------
		// One quad, drawn once per star in flight: they differ only by transform
		// and opacity, which are uniforms.
		const streakGeometry = quad();
		const streak = renderer.mesh({
			vertex: SPRITE_VERTEX,
			fragment: STREAK_FRAGMENT,
			attributes: {
				position: { data: streakGeometry.position, size: 3 },
				uv: { data: streakGeometry.uv, size: 2 },
			},
			index: streakGeometry.index,
			mode: "triangles",
			blend: "additive",
		});
		const streaks: Streak[] = [];

		let width = 1;
		let height = 1;
		let pixelRatio = 1;
		const halfHeightAt = (z: number) =>
			Math.tan((FOV * Math.PI) / 360) * Math.abs(z);

		const resize = () => {
			width = canvas.clientWidth;
			height = canvas.clientHeight;
			pixelRatio = Math.min(window.devicePixelRatio || 1, 2);
			renderer.resize(width, height, pixelRatio);
			perspective(projection, FOV, width / height, 0.1, 400);
			uRes[0] = width;
			uRes[1] = height;
			const h = 2 * halfHeightAt(1);
			compose(backdropView, 0, 0, -1, 0, 0, 0, (h * width) / height, h, 1);
		};

		const launch = (now: number) => {
			if (streaks.length >= SHOOTING_POOL) return;
			const z = -10 - rng() * 26;
			const halfH = halfHeightAt(z);
			const halfW = halfH * (width / height);
			// Shooting stars start in the upper-left quadrant and travel down-right.
			streaks.push({
				startedAt: now,
				fromX: -halfW + rng() * halfW,
				fromY: halfH - rng() * halfH,
				fromZ: z,
				// 300px of screen travel, expressed at this star's depth.
				travel: (300 / height) * halfH * 2,
				halfHeight: halfH,
			});
		};

		let pointerX = 0;
		let pointerY = 0;
		let targetX = 0;
		let targetY = 0;
		const onPointerMove = (event: PointerEvent) => {
			targetX = (event.clientX / window.innerWidth) * 2 - 1;
			targetY = (event.clientY / window.innerHeight) * 2 - 1;
		};

		let last = 0;
		let nextLaunchAt = Number.POSITIVE_INFINITY;
		/** How far the field has been travelled through, in world units. */
		let drift = 0;

		const drawWith = (mesh: Mesh, local: Mat4, uniforms: object) => {
			multiply(modelView, view, local);
			mesh.draw({
				projectionMatrix: projection,
				modelViewMatrix: modelView,
				...uniforms,
			});
		};

		const draw = (now: number) => {
			const dt = last === 0 ? 0 : Math.min((now - last) / 1000, 0.05);
			last = now;

			const t = now / 1000;

			// The camera slides against the pointer and never turns: the view comes
			// back to where it was, and only the parallax between near and far marks
			// says anything happened. Both axes are inverted — the camera moves away
			// from the cursor, so the field drifts towards it.
			pointerX += (targetX - pointerX) * 0.03;
			pointerY += (targetY - pointerY) * 0.03;
			const cameraX = -pointerX * 0.5 + Math.sin(t / 17) * 0.5;
			const cameraY = pointerY * 0.3 + Math.cos(t / 23) * 0.35;
			// A camera that only translates inverts to the opposite translation.
			compose(view, -cameraX, -cameraY, 0, 0, 0, 0, 1, 1, 1);

			// Forwards is always -z, since nothing rotates the camera. Kept small:
			// the offset is taken modulo the cube in the shader anyway, and letting
			// it grow all session would eat float precision.
			drift = (drift + DRIFT_SPEED * dt) % (FIELD_HALF * 2);
			uOffset[2] = drift;
			// The clouds drift with the travel rather than on a clock of their own.
			uCloudFlow[2] = drift * 0.004;

			renderer.clear();

			// The backdrop is opaque and goes down first; everything after it adds
			// light, so among those the order does not matter.
			backdrop.draw({
				projectionMatrix: projection,
				modelViewMatrix: backdropView,
				uRes,
				uHue: hueAt(t),
			});
			drawWith(clouds, cloudModel, {
				uTime: t,
				uFlow: uCloudFlow,
				uPurple,
				uBlue,
			});
			drawWith(field, IDENTITY, {
				uTime: now,
				uPixelRatio: pixelRatio,
				uOffset,
			});

			if (now >= nextLaunchAt) {
				launch(now);
				nextLaunchAt =
					now + SHOOTING_MIN_MS + rng() * (SHOOTING_MAX_MS - SHOOTING_MIN_MS);
			}

			for (let i = streaks.length - 1; i >= 0; i -= 1) {
				const flight = streaks[i];
				if (!flight) continue;
				const life = (now - flight.startedAt) / SHOOTING_LIFETIME_MS;
				if (life >= 1) {
					streaks.splice(i, 1);
					continue;
				}
				const d = life * flight.travel;
				// Down and to the right.
				compose(
					model,
					flight.fromX + d,
					flight.fromY - d,
					flight.fromZ,
					0,
					0,
					-Math.PI / 4,
					flight.halfHeight * 0.5,
					flight.halfHeight * 0.012,
					1,
				);
				drawWith(streak, model, {
					uAlpha: life < 0.1 ? life * 10 : 1 - life,
				});
			}

			// The fade-in waits on this rather than on mount, so the sky never
			// fades up over a canvas that has nothing on it yet.
			canvas.dataset.drawn = "true";
		};

		resize();
		window.addEventListener("resize", resize);
		window.addEventListener("pointermove", onPointerMove);

		if (still) {
			draw(0);
			const redraw = () => {
				resize();
				draw(0);
			};
			window.addEventListener("resize", redraw);
			return () => {
				window.removeEventListener("resize", resize);
				window.removeEventListener("resize", redraw);
				window.removeEventListener("pointermove", onPointerMove);
				renderer.dispose();
			};
		}

		let frame = 0;
		const tick = (now: number) => {
			draw(now);
			frame = requestAnimationFrame(tick);
		};
		// One shooting star on arrival, then rarely.
		const start = performance.now();
		launch(start);
		nextLaunchAt =
			start + SHOOTING_MIN_MS + rng() * (SHOOTING_MAX_MS - SHOOTING_MIN_MS);
		frame = requestAnimationFrame(tick);

		return () => {
			cancelAnimationFrame(frame);
			window.removeEventListener("resize", resize);
			window.removeEventListener("pointermove", onPointerMove);
			renderer.dispose();
		};
	}, [theme]);

	// A night sky under a light theme is just noise on a white page, and without
	// WebGL the CSS backdrop is the sky.
	if (theme !== "dark" || webglFailed) return null;

	return (
		// biome-ignore lint/a11y/noAriaHiddenOnFocusable: a canvas carries no tabindex, so it is not focusable
		<canvas
			ref={canvasRef}
			className={styles.starField}
			data-testid="star-field"
			aria-hidden="true"
		/>
	);
}
