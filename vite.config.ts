import { defineConfig } from 'vite';
import { viteStaticCopy } from 'vite-plugin-static-copy';
import path from 'path';

const root = path.resolve(__dirname, 'src');
const pagesDir = path.resolve(root, 'pages');
const outDir = path.resolve(__dirname, 'dist');
const publicDir = path.resolve(__dirname, 'public');

export default defineConfig({
  resolve: {
    alias: {
      '@': root,
      '@pages': pagesDir,
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
        offscreen: path.resolve(pagesDir, 'offscreen', 'index.html'),
        background: path.resolve(pagesDir, 'background', 'index.ts'),
        popup: path.resolve(pagesDir, 'popup', 'index.html'),
      },
      output: {
        entryFileNames: 'src/pages/[name]/index.js',
        chunkFileNames: 'src/pages/[name]/[name]-[hash].js',
        assetFileNames: 'assets/[name].[ext]',
      },
    },
  },
});