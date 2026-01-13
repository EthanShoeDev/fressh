import { defineConfig } from 'astro/config';

import tailwindcss from '@tailwindcss/vite';

import vercel from '@astrojs/vercel';

// https://astro.build/config
export default defineConfig({
	vite: {
		// @ts-expect-error - Vite version mismatch between @tailwindcss/vite and Astro's bundled vite (Vite 8 beta issue)
		plugins: [tailwindcss()],
	},

	adapter: vercel(),
});
