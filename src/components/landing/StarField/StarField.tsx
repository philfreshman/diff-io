import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
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

interface Streak {
	mesh: THREE.Mesh<THREE.PlaneGeometry, THREE.ShaderMaterial>;
	/* The uniform object is held rather than read back off the material:
	   `uniforms` is an index signature, so every read would need a null check. */
	alpha: { value: number };
	startedAt: number;
	from: THREE.Vector3;
	travel: number;
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

		let renderer: THREE.WebGLRenderer;
		try {
			renderer = new THREE.WebGLRenderer({
				canvas,
				antialias: false,
				// Only when the sky is a single frame that is never redrawn: the
				// drawing buffer is otherwise undefined after the browser composites
				// it, and a still sky has nothing to put back.
				preserveDrawingBuffer: still,
			});
		} catch {
			// No WebGL. The CSS `--cosmic-backdrop` behind this canvas is the
			// fallback, so the canvas just gets out of its way.
			setWebglFailed(true);
			return;
		}

		renderer.setClearColor(0x000000, 1);
		const scene = new THREE.Scene();
		const camera = new THREE.PerspectiveCamera(FOV, 1, 0.1, 400);
		scene.add(camera);

		// --- the backdrop, riding on the camera so it stays glued to the screen --
		const uRes = { value: new THREE.Vector2(1, 1) };
		const uHue = { value: 0 };
		const backdropMaterial = new THREE.ShaderMaterial({
			uniforms: { uRes, uHue },
			vertexShader: SPRITE_VERTEX,
			fragmentShader: /* glsl */ `
				varying vec2 vUv;
				uniform vec2 uRes;
				uniform float uHue;
				${COSMOS_GLSL}
				void main() {
					gl_FragColor = vec4(cosmicBackdrop(vec2(vUv.x, 1.0 - vUv.y), uRes, uHue), 1.0);
				}
			`,
			depthTest: false,
			depthWrite: false,
		});
		const backdrop = new THREE.Mesh(
			new THREE.PlaneGeometry(1, 1),
			backdropMaterial,
		);
		backdrop.position.z = -1;
		backdrop.renderOrder = -2;
		camera.add(backdrop);

		// --- the clouds, on a sphere the camera never leaves --------------------
		// The drift moves the field, not the camera, so a sphere at the origin
		// stays around the viewer however long the page is left open.
		const uCloudTime = { value: 0 };
		const uCloudFlow = { value: new THREE.Vector3() };
		const cloudGeometry = new THREE.SphereGeometry(CLOUD_RADIUS, 48, 24);
		const cloudMaterial = new THREE.ShaderMaterial({
			uniforms: {
				uTime: uCloudTime,
				uFlow: uCloudFlow,
				uPurple: { value: new THREE.Color(...PURPLE) },
				uBlue: { value: new THREE.Color(...BLUE) },
			},
			vertexShader: /* glsl */ `
				varying vec3 vDir;
				void main() {
					vDir = position;
					gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
				}
			`,
			fragmentShader: /* glsl */ `
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
			`,
			side: THREE.BackSide,
			depthTest: false,
			depthWrite: false,
			transparent: true,
			blending: THREE.AdditiveBlending,
		});
		const clouds = new THREE.Mesh(cloudGeometry, cloudMaterial);
		// Tilted, so the band in the cloud shader does not lie flat across the
		// middle of the screen looking like a seam.
		clouds.rotation.set(0.16, 0, 0.42);
		clouds.renderOrder = -1;
		scene.add(clouds);

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

		const geometry = new THREE.BufferGeometry();
		geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
		geometry.setAttribute("aSize", new THREE.BufferAttribute(sizes, 1));
		geometry.setAttribute("aPhase", new THREE.BufferAttribute(phases, 1));
		geometry.setAttribute("aPeriod", new THREE.BufferAttribute(periods, 1));
		geometry.setAttribute("aPlus", new THREE.BufferAttribute(pluses, 1));
		// The cube wraps, so three.js must not cull it against a bounding box that
		// only describes where the marks started.
		geometry.boundingSphere = new THREE.Sphere(
			new THREE.Vector3(),
			FIELD_HALF * 2,
		);

		const uTime = { value: 0 };
		const uPixelRatio = { value: 1 };
		const uOffset = { value: new THREE.Vector3() };
		const markMaterial = new THREE.ShaderMaterial({
			uniforms: { uTime, uPixelRatio, uOffset },
			vertexShader: MARK_VERTEX,
			fragmentShader: MARK_FRAGMENT,
			transparent: true,
			depthTest: false,
			depthWrite: false,
			blending: THREE.AdditiveBlending,
		});
		scene.add(new THREE.Points(geometry, markMaterial));

		// --- shooting stars -----------------------------------------------------
		const streakGeometry = new THREE.PlaneGeometry(1, 1);
		const streaks: Streak[] = [];
		const idle: Streak[] = [];
		for (let i = 0; i < SHOOTING_POOL; i += 1) {
			const uAlpha = { value: 0 };
			const mesh = new THREE.Mesh(
				streakGeometry,
				new THREE.ShaderMaterial({
					uniforms: { uAlpha },
					vertexShader: SPRITE_VERTEX,
					fragmentShader: STREAK_FRAGMENT,
					transparent: true,
					depthTest: false,
					depthWrite: false,
					blending: THREE.AdditiveBlending,
				}),
			);
			mesh.visible = false;
			// Down and to the right.
			mesh.rotation.z = -Math.PI / 4;
			scene.add(mesh);
			idle.push({
				mesh,
				alpha: uAlpha,
				startedAt: 0,
				from: new THREE.Vector3(),
				travel: 0,
			});
		}

		let width = 1;
		let height = 1;
		const halfHeightAt = (z: number) =>
			Math.tan((FOV * Math.PI) / 360) * Math.abs(z);

		const resize = () => {
			width = canvas.clientWidth;
			height = canvas.clientHeight;
			const ratio = Math.min(window.devicePixelRatio || 1, 2);
			renderer.setPixelRatio(ratio);
			renderer.setSize(width, height, false);
			camera.aspect = width / height;
			camera.updateProjectionMatrix();
			uPixelRatio.value = ratio;
			uRes.value.set(width, height);
			const h = 2 * halfHeightAt(1);
			backdrop.scale.set(h * camera.aspect, h, 1);
		};

		const launch = (now: number) => {
			const streak = idle.pop();
			if (!streak) return;
			const z = -10 - rng() * 26;
			const halfH = halfHeightAt(z);
			const halfW = halfH * (width / height);
			// Shooting stars start in the upper-left quadrant and travel down-right.
			streak.from.set(-halfW + rng() * halfW, halfH - rng() * halfH, z);
			// 300px of screen travel, expressed at this star's depth.
			streak.travel = (300 / height) * halfH * 2;
			streak.startedAt = now;
			streak.mesh.visible = true;
			streak.mesh.scale.set(halfH * 0.5, halfH * 0.012, 1);
			streaks.push(streak);
		};

		const pointer = new THREE.Vector2(0, 0);
		const target = new THREE.Vector2(0, 0);
		const onPointerMove = (event: PointerEvent) => {
			target.set(
				(event.clientX / window.innerWidth) * 2 - 1,
				(event.clientY / window.innerHeight) * 2 - 1,
			);
		};

		let last = 0;
		let nextLaunchAt = Number.POSITIVE_INFINITY;

		const draw = (now: number) => {
			const dt = last === 0 ? 0 : Math.min((now - last) / 1000, 0.05);
			last = now;

			const t = now / 1000;
			uTime.value = now;
			uHue.value = hueAt(t);
			uCloudTime.value = t;

			// The camera slides against the pointer and never turns: the view comes
			// back to where it was, and only the parallax between near and far marks
			// says anything happened. Both axes are inverted — the camera moves away
			// from the cursor, so the field drifts towards it.
			pointer.lerp(target, 0.03);
			camera.position.x = -pointer.x * 0.5 + Math.sin(t / 17) * 0.5;
			camera.position.y = pointer.y * 0.3 + Math.cos(t / 23) * 0.35;

			// Forwards is always -z, since nothing rotates the camera.
			uOffset.value.z += DRIFT_SPEED * dt;
			// Kept small: the offset is taken modulo the cube anyway, and letting it
			// grow all session would eat float precision.
			uOffset.value.z %= FIELD_HALF * 2;
			// The clouds drift with the travel rather than on a clock of their own.
			uCloudFlow.value.set(0, 0, uOffset.value.z * 0.004);

			if (now >= nextLaunchAt) {
				launch(now);
				nextLaunchAt =
					now + SHOOTING_MIN_MS + rng() * (SHOOTING_MAX_MS - SHOOTING_MIN_MS);
			}

			for (let i = streaks.length - 1; i >= 0; i -= 1) {
				const streak = streaks[i];
				if (!streak) continue;
				const life = (now - streak.startedAt) / SHOOTING_LIFETIME_MS;
				if (life >= 1) {
					streak.mesh.visible = false;
					streaks.splice(i, 1);
					idle.push(streak);
					continue;
				}
				const d = life * streak.travel;
				streak.mesh.position.set(
					streak.from.x + d,
					streak.from.y - d,
					streak.from.z,
				);
				streak.alpha.value = life < 0.1 ? life * 10 : 1 - life;
			}

			renderer.render(scene, camera);
			// The fade-in waits on this rather than on mount, so the sky never
			// fades up over a canvas that has nothing on it yet.
			canvas.dataset.drawn = "true";
		};

		const dispose = () => {
			geometry.dispose();
			markMaterial.dispose();
			cloudGeometry.dispose();
			cloudMaterial.dispose();
			streakGeometry.dispose();
			for (const streak of [...streaks, ...idle])
				streak.mesh.material.dispose();
			backdrop.geometry.dispose();
			backdropMaterial.dispose();
			renderer.dispose();
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
				dispose();
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
			dispose();
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
