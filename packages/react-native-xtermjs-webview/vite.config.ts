import fs from 'fs';
import { resolve } from 'path';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
import dts from 'vite-plugin-dts';

const logExternal: boolean = false;

export default defineConfig({
	plugins: [
		react({}),
		dts({
			tsconfigPath: './tsconfig.app.json',
		}),
	],
	build: {
		sourcemap: true,
		rollupOptions: {
			// Externalize all non-relative, non-absolute imports (i.e. dependencies)
			// Keep only our own sources and the raw internal HTML in the bundle.
			external: (id) => {
				if (logExternal) fs.writeFileSync('dep.log', `${id}\n`, { flag: 'a' });
				const isRelative = id.startsWith('.') || id.startsWith('/');
				const isInternalHtml = id.includes('dist-internal/index.html?raw');
				return !isRelative && !isInternalHtml;
			},
		},
		lib: {
			entry: resolve(__dirname, 'src/index.tsx'),
			formats: ['es'],
			fileName: () => 'index.js',
		},
	},
});
