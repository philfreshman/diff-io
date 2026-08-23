/*
 * The cloud sky: fbm noise sampled by direction, painted on a sphere around the
 * viewer. It sits on top of the flat `cosmicBackdrop` gradient and gives it
 * some structure to look at without lifting the sky off black.
 */

/**
 * `hash`, `noise`, `fbm` and `nebula(dir, time, flow, purple, blue)`, where
 * `dir` is a unit direction, `time` is seconds, and `flow` shifts the sample
 * point so the clouds can drift with the viewer's travel rather than on a clock
 * of their own.
 */
export const CLOUD_GLSL = /* glsl */ `
float hash(vec3 p) {
	p = fract(p * 0.3183099 + vec3(0.71, 0.113, 0.419));
	p *= 17.0;
	return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
}

float noise(vec3 x) {
	vec3 i = floor(x);
	vec3 f = fract(x);
	f = f * f * (3.0 - 2.0 * f);
	return mix(
		mix(
			mix(hash(i + vec3(0.0, 0.0, 0.0)), hash(i + vec3(1.0, 0.0, 0.0)), f.x),
			mix(hash(i + vec3(0.0, 1.0, 0.0)), hash(i + vec3(1.0, 1.0, 0.0)), f.x),
			f.y
		),
		mix(
			mix(hash(i + vec3(0.0, 0.0, 1.0)), hash(i + vec3(1.0, 0.0, 1.0)), f.x),
			mix(hash(i + vec3(0.0, 1.0, 1.0)), hash(i + vec3(1.0, 1.0, 1.0)), f.x),
			f.y
		),
		f.z
	);
}

float fbm(vec3 p) {
	float v = 0.0;
	float a = 0.5;
	for (int i = 0; i < 5; i += 1) {
		v += a * noise(p);
		p *= 2.03;
		a *= 0.5;
	}
	return v;
}

vec3 nebula(vec3 dir, float time, vec3 flow, vec3 purple, vec3 blue) {
	// Two cloud systems, drifting at different rates so the sky never repeats.
	float p = fbm(dir * 2.1 + flow + vec3(time * 0.006, 0.0, 0.0));
	float b = fbm(dir * 1.7 + flow + vec3(0.0, time * 0.004, 4.0));
	// The band round the equator — a galaxy seen edge on.
	float band = exp(-dir.y * dir.y * 9.0) * (0.35 + 0.65 * fbm(dir * 3.4));

	// Tight thresholds: fbm sits around 0.5, so a wide ramp lights the whole
	// sky and the backdrop stops being black.
	float pa = smoothstep(0.56, 0.95, p) * 0.30;
	float ba = smoothstep(0.56, 0.95, b) * 0.26;
	return purple * pa + blue * ba + vec3(0.05, 0.045, 0.07) * band * 0.4;
}
`;
