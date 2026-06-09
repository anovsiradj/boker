---
name: chrome-ext-npm
description: Use npm packages in Chrome Extensions (Manifest V3) across service workers, offscreen documents, web workers, and content scripts
---

# Chrome Extension npm Package Usage

Strategies for using npm packages in Manifest V3 Chrome Extensions across all contexts.

## When to Use

- Need third-party libraries (`@sqlite.org/sqlite-wasm`, `webextension-polyfill`, etc.)
- Using WASM packages that require bundler integration
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

## Recommended: ESM + Vite

Use **Vite** as the bundler — it handles ESM resolution, WASM file copying, TypeScript, and source maps out of the box. No need to manually copy `.mjs` or `.wasm` files to a `lib/` directory.

### Project Structure

```
extension/
├── package.json              # type: "module"
├── vite.config.ts
├── public/
│   └── manifest.json         # Copied as-is to dist/
├── src/
│   └── pages/
│       ├── background/
│       │   └── index.ts      # Service worker entry
│       ├── offscreen/
│       │   ├── index.html    # Offscreen HTML
│       │   ├── index.ts      # Offscreen entry
│       │   ├── worker.ts     # Web worker entry
│       │   └── worker/
│       │       └── database.ts  # Shared DB module
│       └── popup/
│           ├── index.html    # Popup HTML
│           └── index.ts      # Popup entry
└── dist/                     # Build output (gitignored)
```

### package.json

```json
{
  "name": "my-extension",
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

export default defineConfig({
  plugins: [
    viteStaticCopy({
      targets: [
        { src: 'public/manifest.json', dest: '.' },
      ],
    }),
  ],
  publicDir: path.resolve(__dirname, 'public'),
  build: {
    outDir: path.resolve(__dirname, 'dist'),
    emptyOutDir: true,
    sourcemap: true,
    target: 'chrome116',
    rollupOptions: {
      input: {
        offscreen: 'src/pages/offscreen/index.html',
        background: 'src/pages/background/index.ts',
        popup: 'src/pages/popup/index.html',
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
// Vite resolves bare specifiers from node_modules
import sqlite3InitModule from '@sqlite.org/sqlite-wasm';
import browser from 'webextension-polyfill';
```

No `lib/` directory, no manual WASM copying. Vite bundles the JS and copies `.wasm` to `assets/` automatically.

## Context-Specific Patterns

### Service Worker (background/index.ts)

```ts
// Use chrome.* API directly (no polyfill needed in SW)
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'MY_ACTION') {
    doSomething().then(() => sendResponse({ success: true }));
    return true;
  }
});
```

### Web Worker (worker.ts)

```ts
// Full WASM + OPFS + synchronous APIs
import sqlite3InitModule from '@sqlite.org/sqlite-wasm';
// No chrome.* API access; communicates via self.onmessage/self.postMessage
```

### Popup (popup/index.ts)

```ts
// Use webextension-polyfill for Promise-based messaging
import browser from 'webextension-polyfill';

async function sendMessage(type, payload = {}) {
  return browser.runtime.sendMessage({ type, payload });
}
```

## WASM Package Handling

Vite automatically detects `.wasm` files imported from `node_modules` and copies them to the output `assets/` directory. No special config needed — just import the JS entry point.

```js
import sqlite3InitModule from '@sqlite.org/sqlite-wasm';
// ✅ Vite bundles the JS wrapper
// ✅ Vite copies sqlite3.wasm to dist/assets/
```

## CSP Requirements

```json
"content_security_policy": {
  "extension_pages": "script-src 'self' 'wasm-unsafe-eval'; object-src 'self'"
}
```

- `'wasm-unsafe-eval'` required for WASM instantiation
- No `'unsafe-eval'` needed for ESM

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

## Common Issues

| Issue | Solution |
|-------|----------|
| `require is not defined` | Package is CJS only → use Vite bundler or find ESM alternative |
| `process is not defined` | Define `process.env.NODE_ENV` in Vite config |
| `fs`/`path` not found | Node built-ins not available → use browser polyfills or avoid |
| WASM 404 | Check `dist/assets/` — Vite copies automatically |
| Worker MIME type | Use `new Worker(url, { type: 'module' })` |
| CSP blocks eval | Use Vite (no eval), or add `'wasm-unsafe-eval'` only |
