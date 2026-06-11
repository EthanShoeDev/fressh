import tailwindcss from '@tailwindcss/vite';
import { tanstackStart } from '@tanstack/react-start/plugin/vite';
import viteReact from '@vitejs/plugin-react';
import { nitro } from 'nitro/vite';
import { defineConfig } from 'vite';
import tsConfigPaths from 'vite-tsconfig-paths';

export default defineConfig({
	server: {
		port: 3000,
	},
	plugins: [
		tsConfigPaths({
			projects: ['./tsconfig.json'],
		}),
		tanstackStart({
			prerender: {
				enabled: true,
				crawlLinks: true,
				failOnError: true,
				retryCount: 3,
				retryDelay: 250,
			},
		}),
		// Deployment layer: emits a runnable server locally (.output/) and
		// Vercel Build Output API (.vercel/output/) when VERCEL is set.
		nitro(),
		viteReact(),
		tailwindcss(),
	],
});
