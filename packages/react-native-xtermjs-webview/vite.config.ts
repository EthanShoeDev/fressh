import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import packageJson from './package.json'
import { resolve } from 'path'



export default defineConfig({
  plugins: [react()],
  build: {
    rollupOptions: {
      external: Object.keys(packageJson.peerDependencies || {}),
    },
    lib: {
      entry: resolve(__dirname, 'src/index.tsx'),
      name: 'ReactNativeXtermJsWebView',
      formats: ['es'],
      fileName: 'react-native-xtermjs-webview',
    }
  },
})
