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
**CommonJS: Only via bundler (webpack/esbuild/rollup)

## Recommended: ESM + Bundler

Use a bundler (esbuild, rollup, webpack) for production. For development, use native ESM with import maps.

### Project Structure

```
extension/
├── package.json           # type: "module"
├── src/
│   ├── background.ts      # Service worker entry
│   ├── offscreen.ts       # Offscreen document entry
│   ├── worker.ts          # Web worker entry
│   ├── popup.ts           # Popup entry
│   ├── content.ts         # Content script entry
│   └── shared/            # Shared ESM modules
├── lib/                   # Copied WASM/assets (gitignored)
└── dist/                  # Bundled output (gitignored)
```

### package.json

```json
{
  "name": "my-extension",
  "version": "1.0.0",
  "type": "module",
  "scripts": {
    "dev": "esbuild --serve=8080 src/background.ts --outdir=dist --format=esm",
    "build": "esbuild src/background.ts src/offscreen.ts src/worker.ts src/popup.ts src/content.ts --outdir=dist --format=esm --target=chrome100",
    "copy-wasm": "copyfiles -u 1 node_modules/@sqlite.org/sqlite-wasm/dist/sqlite3*.mjs node_modules/@sqlite.org/sqlite-wasm/dist/sqlite3.wasm lib/"
  },
  "dependencies": {
    "@sqlite.org/sqlite-wasm": "^3.45.0",
    "date-fns": "^3.0.0",
    "zod": "^3.22.0"
  },
  "devDependencies": {
    "esbuild": "^0.20.0",
    "copyfiles": "^2.4.1"
  }
}
```

## Strategy 1: Native ESM (No Bundler, Dev Only)

```html
<!-- popup.html / offscreen.html -->
<script type="importmap">
{
  "imports": {
    "date-fns": "https://esm.sh/date-fns@3",
    "zod": "https://esm.sh/zod@3"
  }
}
</script>
<script type="module" src="popup.js"></script>
```

```js
// popup.js
import { format } from 'date-fns';
import { z } from 'zod';
```

**Pros:** Zero config, fast iteration, standard `<script type="importmap">`  
**Cons:** Network dependency, no tree-shaking, CSP issues with external CDN, **only works in documents (popup/offscreen), not in workers**

## Strategy 2: Bundled with esbuild (Recommended)

```js
// esbuild.config.mjs
import { build } from 'esbuild';
import { copyFileSync, mkdirSync, existsSync } from 'fs';

const entries = {
  background: 'src/background.ts',
  offscreen: 'src/offscreen.ts',
  worker: 'src/worker.ts',
  popup: 'src/popup.ts',
  content: 'src/content.ts',
};

await build({
  entryPoints: Object.values(entries),
  outdir: 'dist',
  format: 'esm',
  target: 'chrome100',
  platform: 'browser',
  bundle: true,
  splitting: false,
  external: ['chrome'],
  define: { 'process.env.NODE_ENV': '"production"' },
});

// Copy WASM files
if (!existsSync('lib')) mkdirSync('lib', { recursive: true });
copyFileSync('node_modules/@sqlite.org/sqlite-wasm/dist/sqlite3-worker1.mjs', 'lib/sqlite3-worker1.mjs');
copyFileSync('node_modules/@sqlite.org/sqlite-wasm/dist/sqlite3.wasm', 'lib/sqlite3.wasm');
```

### Import in Source

```js
// src/worker.ts
import { sqlite3Worker1Promiser } from '../lib/sqlite3-worker1.mjs'; // Local copy
import { format } from 'date-fns'; // Bundled
import { z } from 'zod'; // Bundled
```

## Strategy 3: WASM Packages (Special Handling)

For `@sqlite.org/sqlite-wasm`, `@tensorflow/tfjs`, `pdfjs-dist`:

1. **Copy WASM files to `lib/`** (not bundled)
2. **Import worker entry point locally** (not from node_modules)
3. **Set `locateFile` if needed**

```js
// For pdfjs-dist
import * as pdfjs from 'pdfjs-dist';
pdfjs.GlobalWorkerOptions.workerSrc = chrome.runtime.getURL('lib/pdf.worker.min.mjs');
```

## Context-Specific Patterns

### Service Worker (background.ts)

```ts
// Only async, no DOM, no WASM sync APIs
import { storage } from './shared/storage.js';

chrome.runtime.onInstalled.addListener(async () => {
  await storage.init();
});
```

### Offscreen Document (offscreen.ts)

```ts
// Can spawn workers, has DOM, async only
const worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });
```

### Web Worker (worker.ts)

```ts
// Full WASM + OPFS + sync APIs
import { sqlite3Worker1Promiser } from '../lib/sqlite3-worker1.mjs';
// Self-contained, no chrome.* APIs except messaging
```

### Popup/Side Panel (popup.ts)

```ts
// Full DOM, can use bundled npm packages
import { z } from 'zod';
import { format } from 'date-fns';

const schema = z.object({ domain: z.string().url() });
```

### Content Script (content.ts)

```ts
// Isolated world, no direct access to page JS
// Can use bundled packages
import { debounce } from 'lodash-es';

const handler = debounce(() => { /* ... */ }, 300);
```

## Shared Code Pattern

```ts
// shared/storage.ts - works in ALL contexts
export async function get(key: string) {
  if (typeof chrome !== 'undefined' && chrome.storage) {
    const { [key]: value } = await chrome.storage.local.get(key);
    return value;
  }
  // Fallback for testing
  return localStorage.getItem(key);
}
```

## CSP Requirements

```json
// manifest.json
"content_security_policy": {
  "extension_pages": "script-src 'self' 'wasm-unsafe-eval'; object-src 'self'"
}
```

- `'wasm-unsafe-eval'` required for WASM instantiation
- No `'unsafe-eval'` needed for ESM (unlike bundled IIFE)

## TypeScript Config

```json
// tsconfig.json
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
  "include": ["src/**/*", "lib/**/*"]
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
| `process is not defined` | Define `process.env.NODE_ENV` in build, or use `import.meta.env` |
| `fs`/`path` not found | Node built-ins not available → use browser polyfills or avoid |
| WASM 404 | Copy `.wasm` to `lib/`, serve via `chrome.runtime.getURL()` |
| Worker MIME type | Ensure `.mjs` extension or `type: module` in import |
| CSP blocks eval | Use bundler (no eval), or add `'wasm-unsafe-eval'` only |