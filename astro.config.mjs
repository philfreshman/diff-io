// @ts-check
import { defineConfig } from 'astro/config';
import tailwindcss from '@tailwindcss/vite';

// https://astro.build/config
export default defineConfig({
	output: 'static',
	devToolbar: {
		enabled: false
	},
	vite: {
		plugins: [tailwindcss()],
		build: {
			minify: 'esbuild',
			sourcemap: false
		}
	},
});
