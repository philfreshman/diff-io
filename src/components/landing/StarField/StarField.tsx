import { useEffect, useRef } from "react";
import { useResolvedTheme } from "#/components/theme/useResolvedTheme.ts";
import { createRng, generateStars, STAR_COUNT } from "#/lib/starfield.ts";
import styles from "./StarField.module.css";

/**
 * The night sky, drawn on one canvas rather than as a hundred animated
 * elements. The field is generated from a fixed seed, so the same sky is drawn
 * on every visit and there is nothing random happening during render.
 */
const SEED = 0x5eed;
const SHOOTING_STAR_INTERVAL_MS = 2000;
const SHOOTING_STAR_LIFETIME_MS = 3000;
const SHOOTING_STAR_TRAVEL_PX = 300;

interface ShootingStar {
	x: number;
	y: number;
	startedAt: number;
}

export function StarField() {
	const canvasRef = useRef<HTMLCanvasElement>(null);
	const theme = useResolvedTheme();

	useEffect(() => {
		// The canvas only exists under the dark theme, and only after mount.
		if (theme !== "dark") return;
		const canvas = canvasRef.current;
		if (!canvas) return;
		const context = canvas.getContext("2d");
		if (!context) return;

		const rng = createRng(SEED);
		const stars = generateStars(STAR_COUNT, rng);
		const shooting: ShootingStar[] = [];
		let width = 0;
		let height = 0;

		const resize = () => {
			const ratio = window.devicePixelRatio || 1;
			width = canvas.clientWidth;
			height = canvas.clientHeight;
			canvas.width = Math.round(width * ratio);
			canvas.height = Math.round(height * ratio);
			context.setTransform(ratio, 0, 0, ratio, 0, 0);
		};

		const launch = (now: number) => {
			// Shooting stars start in the upper-left quadrant and travel down-right.
			shooting.push({ x: rng() * 0.5, y: rng() * 0.5, startedAt: now });
		};

		const draw = (now: number) => {
			context.clearRect(0, 0, width, height);

			for (const star of stars) {
				// A full pulse takes `periodMs`; `phase` staggers the field so the
				// stars do not blink in unison.
				const progress = ((now / star.periodMs + star.phase) % 1) * Math.PI * 2;
				const pulse = (Math.sin(progress) + 1) / 2;
				context.globalAlpha = 0.5 + pulse * 0.5;
				context.fillStyle = "#ffffff";
				context.beginPath();
				context.arc(
					star.x * width,
					star.y * height,
					star.radius * (1 + pulse * 0.5),
					0,
					Math.PI * 2,
				);
				context.fill();
			}

			for (let i = shooting.length - 1; i >= 0; i -= 1) {
				const star = shooting[i];
				if (!star) continue;
				const life = (now - star.startedAt) / SHOOTING_STAR_LIFETIME_MS;
				if (life >= 1) {
					shooting.splice(i, 1);
					continue;
				}
				const travel = life * SHOOTING_STAR_TRAVEL_PX;
				context.globalAlpha = life < 0.1 ? life * 10 : 1 - life;
				context.fillStyle = "#ffffff";
				context.beginPath();
				context.arc(
					star.x * width + travel,
					star.y * height + travel,
					1,
					0,
					Math.PI * 2,
				);
				context.fill();
			}

			context.globalAlpha = 1;
		};

		resize();
		window.addEventListener("resize", resize);

		// A canvas animation loop is invisible to the CSS reduced-motion query, so
		// the preference has to be honoured here: draw the sky once and stop.
		if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
			const drawStill = () => {
				resize();
				draw(0);
			};
			drawStill();
			window.addEventListener("resize", drawStill);
			return () => {
				window.removeEventListener("resize", resize);
				window.removeEventListener("resize", drawStill);
			};
		}

		let frame = 0;
		const tick = (now: number) => {
			draw(now);
			frame = requestAnimationFrame(tick);
		};

		launch(performance.now());
		frame = requestAnimationFrame(tick);
		const interval = window.setInterval(
			() => launch(performance.now()),
			SHOOTING_STAR_INTERVAL_MS,
		);

		return () => {
			cancelAnimationFrame(frame);
			window.clearInterval(interval);
			window.removeEventListener("resize", resize);
		};
	}, [theme]);

	// A night sky under a light theme is just noise on a white page.
	if (theme !== "dark") return null;

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
