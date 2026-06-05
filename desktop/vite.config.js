import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rendererRoot = path.resolve(__dirname, './renderer');

export default defineConfig({
  root: rendererRoot,
  base: './',
  plugins: [react()],
  resolve: {
    alias: {
      '@': rendererRoot,
    },
  },
  build: {
    outDir: path.resolve(rendererRoot, './dist'),
    emptyOutDir: true,
    rollupOptions: {
      input: {
        main: path.resolve(rendererRoot, './index.html'),
      },
    },
  },
  server: {
    port: 5173,
    open: false,
    cors: true,
  },
});
