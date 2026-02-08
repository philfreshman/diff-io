// @ts-check
import { defineConfig } from 'astro/config';
import tailwindcss from '@tailwindcss/vite';
import { fileURLToPath } from 'url';
import path from 'path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
	output: 'static',
	devToolbar: {
		enabled: false
	},
	vite: {
		plugins: [tailwindcss()],
		resolve: {
			alias: {
				'diff-wasm': path.resolve(__dirname, './wasm/diff-wasm/pkg')
			}
		},
		build: {
			minify: 'esbuild',
			sourcemap: false
		},
		optimizeDeps: {
			exclude: ['diff-wasm']
		},
		worker: {
			format: 'es'
		}
	},
});
