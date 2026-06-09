import { defineConfig } from 'vite';
import { viteStaticCopy } from 'vite-plugin-static-copy';
import path from 'path';

const root = path.resolve(__dirname, 'src');
const outDir = path.resolve(__dirname, 'dist');
const publicDir = path.resolve(__dirname, 'public');

export default defineConfig({
  resolve: {
    alias: {
      '@': root,
    },
  },
  plugins: [
    viteStaticCopy({
      targets: [
        { src: 'public/manifest.json', dest: '.' },
      ],
    }),
  ],
  publicDir,
  build: {
    outDir,
    emptyOutDir: true,
    sourcemap: true,
    target: 'chrome116',
    rollupOptions: {
      input: {
        offscreen: path.resolve(root, 'offscreen', 'index.html'),
        background: path.resolve(root, 'background', 'index.ts'),
        popup: path.resolve(root, 'popup', 'index.html'),
      },
      output: {
        entryFileNames: 'src/[name]/index.js',
        chunkFileNames: 'src/[name]/[name]-[hash].js',
        assetFileNames: 'assets/[name].[ext]',
      },
    },
  },
});
