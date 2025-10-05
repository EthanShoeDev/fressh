import { defineConfig } from 'vite';
import { viteSingleFile } from 'vite-plugin-singlefile';

// https://vite.dev/config/
export default defineConfig((ctx) => {
	const input = ctx.command === 'serve' ? 'index.html' : 'index.build.html';
	console.log('Vite Internal Working with input', input);
	return {
		plugins: [viteSingleFile()],
		build: {
			outDir: 'dist-internal',
		},
	};
});
