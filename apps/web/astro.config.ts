import vercel from '@astrojs/vercel';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'astro/config';
import type { PluginOption } from 'vite';

// https://astro.build/config
export default defineConfig({
	vite: {
		// astro bundles its own nested copy of vite; @tailwindcss/vite resolves
		// the workspace copy, so their Plugin types are nominally distinct.
		// Cast to the locally-resolved vite PluginOption to bridge them.
		plugins: [tailwindcss() as PluginOption],
	},

	adapter: vercel(),
});
