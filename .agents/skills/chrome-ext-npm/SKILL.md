---
name: chrome-ext-npm
description: Use npm packages in Chrome Extensions (Manifest V3) across service workers, offscreen documents, web workers, and content scripts
---

# Chrome Extension npm Package Usage

Strategies for using npm packages in Manifest V3 Chrome Extensions across all contexts.

## When to Use

- Need third-party libraries (date-fns, zod, lodash, etc.)
- Using WASM packages (@sqlite.org/sqlite-wasm, pdfjs-dist, etc.)
- Sharing code between extension contexts
- TypeScript projects needing type definitions

## Context Compatibility Matrix

| Context | ES Modules | CommonJS | WASM | Node Built-ins | Dynamic Import |
|---------|------------|----------|------|----------------|----------------|
| Service Worker | ✅ | ❌ | ⚠️* | ❌ | ✅ |
| Offscreen Document | ✅ | ⚠️** | ✅ | ❌ | ✅ |
| Web Worker | ✅ | ❌ | ✅ | ❌ | ✅ |
| Popup/Side Panel | ✅ | ⚠️** | ✅ | ❌ | ✅ |
| Content Script | ✅ | ⚠️** | ✅ | ❌ | ✅ |

*WASM in SW: Only async compilation, no `createSyncAccessHandle`  
**CommonJS: Only via bundler (Vite/esbuild/webpack)

## Recommended: ESM + Bundler (Vite)

Use **Vite** as the bundler — it handles ESM resolution, WASM file copying, TypeScript, and source maps out of the box.

### Project Structure

```
extension/
├── package.json           # type: "module"
├── vite.config.ts
├── public/
│   └── manifest.json      # Extension manifest (copied as-is)
├── src/
│   ├── pages/
│   │   ├── background/
│   │   │   └── index.ts   # Service worker entry
│   │   ├── offscreen/
│   │   │   ├── index.html # Offscreen document HTML
│   │   │   ├── index.ts   # Offscreen document entry
│   │   │   └── worker.ts  # Web worker entry
│   │   └── popup/
│   │       ├── index.html # Popup HTML
│   │       └── index.ts   # Popup entry
│   └── (shared modules)
└── dist/                  # Bundled output (gitignored)
```

### package.json

```json
{
  "name": "my-extension",
  "version": "1.0.0",
  "type": "module",
  "scripts": {
    "dev": "vite build --mode development --watch",
    "build": "vite build --mode production"
  },
  "dependencies": {
    "@sqlite.org/sqlite-wasm": "^3.53.0",
    "webextension-polyfill": "^0.12.0"
  },
  "devDependencies": {
    "@types/chrome": "^0.0.258",
    "typescript": "^5.3.0",
    "vite": "^5.0.0",
    "vite-plugin-static-copy": "^1.0.0"
  }
}
```

### vite.config.ts

```ts
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
```

### Import Packages Directly

```js
// Import from node_modules directly — Vite resolves and bundles
import sqlite3InitModule from '@sqlite.org/sqlite-wasm';
import browser from 'webextension-polyfill';
```

No need to copy `.mjs` or `.wasm` files to `lib/` — Vite handles WASM assets automatically.

## Strategy 2: esbuild (Alternative)

```js
// esbuild.config.mjs
import { build } from 'esbuild';

await build({
  entryPoints: ['src/background.ts', 'src/offscreen.ts', 'src/worker.ts', 'src/popup.ts'],
  outdir: 'dist',
  format: 'esm',
  target: 'chrome100',
  platform: 'browser',
  bundle: true,
  external: ['chrome'],
});
```

When using esbuild, WASM files must be copied manually:

```bash
copyfiles -u 3 "node_modules/@sqlite.org/sqlite-wasm/dist/sqlite3*" dist/
```

## WASM Package Handling

### Vite (Recommended)

Vite automatically detects `.wasm` files imported from node_modules and copies them to the output `assets/` directory. No special config needed — just import the JS entry point.

### esbuild

esbuild does NOT handle `.wasm` files. You must:

1. Copy `.wasm` files from `node_modules` to the output directory
2. Import the `.mjs` entry point from a local path (not node_modules)
3. The `.wasm` path is resolved relative to the JS file at runtime

```js
// Copy as part of build
copyFileSync('node_modules/@sqlite.org/sqlite-wasm/dist/sqlite3.wasm', 'dist/sqlite3.wasm');
```

## Context-Specific Patterns

### Service Worker (background.ts)

```ts
import browser from 'webextension-polyfill';
import { initStorage } from './shared/storage.js';

chrome.runtime.onInstalled.addListener(async () => {
  await initStorage();
});
```

### Offscreen Document (offscreen/index.ts)

```ts
// Can spawn workers, has DOM, async only
const worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });
```

### Web Worker (worker.ts)

```ts
// Full WASM + OPFS + sync APIs
import sqlite3InitModule from '@sqlite.org/sqlite-wasm';
// Self-contained, no chrome.* APIs except messaging
```

### Popup (popup/index.ts)

```ts
import browser from 'webextension-polyfill';
const response = await browser.runtime.sendMessage({ type: 'GET_DATA' });
```

## CSP Requirements

```json
"content_security_policy": {
  "extension_pages": "script-src 'self' 'wasm-unsafe-eval'; object-src 'self'"
}
```

- `'wasm-unsafe-eval'` required for WASM instantiation
- No `'unsafe-eval'` needed for ESM (unlike bundled IIFE)

## TypeScript Config

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "lib": ["ES2022", "WebWorker"],
    "types": ["chrome"],
    "strict": true,
    "isolatedModules": true,
    "noEmit": true,
    "allowImportingTsExtensions": true,
    "resolveJsonModule": true
  },
  "include": ["src/**/*"]
}
```

## Chrome Types

```bash
npm install -D @types/chrome
```

## Common Issues

| Issue | Solution |
|-------|----------|
| `require is not defined` | Package is CJS only → use bundler or find ESM alternative |
| `process is not defined` | Define `process.env.NODE_ENV` in build config |
| `fs`/`path` not found | Node built-ins not available → use browser polyfills or avoid |
| WASM 404 | With Vite: check `assets/` dir for .wasm; with esbuild: copy manually |
| Worker MIME type | Ensure `{ type: 'module' }` in `new Worker()` call |
| CSP blocks eval | Use bundler (no eval), or add `'wasm-unsafe-eval'` only |
