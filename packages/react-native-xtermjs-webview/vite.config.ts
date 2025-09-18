import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'path';
import dts from 'vite-plugin-dts';

export default defineConfig({
	plugins: [
		react(),
		dts({
			tsconfigPath: './tsconfig.app.json',
			// This makes dist/ look nice but breaks Cmd + Click
			rollupTypes: false,
			// We need this or the types defined in package.json will be missing
			// If rollupTypes is true, this is forced true
			insertTypesEntry: true,
			compilerOptions: {
				// This allows Cmd + Click from different packages in the monorepo
				declarationMap: true,
			},
		}),
	],
	build: {
		sourcemap: true,
		rollupOptions: {
			external: ['react', 'react/jsx-runtime', 'react-native-webview'],
			// external: () => {
			// 	fs.writeFileSync('dep.log', `${dep}\n`, { flag: 'a' });
			// 	return false;
			// }
		},
		lib: {
			entry: resolve(__dirname, 'src/index.tsx'),
			formats: ['es'],
			fileName: () => 'index.js',
		},
	},
});
