import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rendererRoot = path.resolve(__dirname, './renderer');

function rendererChunk(id) {
  if (!id.includes('node_modules')) return undefined;
  if (id.includes('/react/') || id.includes('/react-dom/') || id.includes('/scheduler/')) {
    return 'react';
  }
  return 'vendor';
}

export default defineConfig(({ command }) => ({
  root: rendererRoot,
  base: './',
  plugins: [react()],
  resolve: {
    alias: {
      '@': rendererRoot,
    },
  },
  define: command === 'build' ? { 'process.env.NODE_ENV': '"production"' } : {},
  build: {
    outDir: path.resolve(rendererRoot, './dist'),
    emptyOutDir: true,
    minify: 'esbuild',
    rollupOptions: {
      input: {
        main: path.resolve(rendererRoot, './index.html'),
      },
      output: {
        // Keep framework and feature-heavy dependencies independently cacheable.
        // This also makes bundle growth visible per subsystem in build output.
        manualChunks: rendererChunk,
      },
    },
  },
  server: {
    port: 5173,
    open: false,
    cors: true,
    fs: {
      // 允许访问 renderer 目录 + 项目根目录下的 src/core/ 下沉模块
      allow: [rendererRoot, path.resolve(__dirname, '../src')],
    },
  },
}));
