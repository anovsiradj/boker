---
name: chrome-ext-esm
description: Use ES modules on every context (worker, background, foreground, etc.) in Chrome Extension
---

# Chrome Extension ES Modules

Use native ES Modules (ESM) across all Chrome Extension contexts in Manifest V3.

## When to Use

- Modern JavaScript with `import`/`export` syntax
- Tree-shaking and dead code elimination
- Shared modules between service worker, offscreen, workers, popup, content scripts
- TypeScript projects

## Context Support

| Context | ESM Support | Notes |
|---------|-------------|-------|
| Service Worker | ✅ Native | `"type": "module"` in manifest |
| Offscreen Document | ✅ Native | `<script type="module">` |
| Web Worker | ✅ Native | `new Worker(url, { type: "module" })` |
| Popup/Side Panel | ✅ Native | `<script type="module">` |
| Content Script | ✅ Native | `"type": "module"` in manifest (Chrome 100+) |

## Manifest Configuration

```json
{
  "manifest_version": 3,
  "background": { "service_worker": "background.js", "type": "module" },
  "content_scripts": [{
    "js": ["content.js"],
    "type": "module",
    "matches": ["<all_urls>"]
  }],
  "action": { "default_popup": "popup.html" }
}
```

## Entry Points

### Popup / Offscreen HTML

```html
<!-- popup/index.html -->
<!DOCTYPE html>
<html>
<body>
  <script type="module" src="index.js"></script>
</body>
</html>
```

### Service Worker

```js
// background/index.js
import { initStorage } from './shared/storage.js';
await initStorage();
```

### Web Worker

```js
// offscreen/index.js — spawns worker with ESM
const worker = new Worker(new URL('./worker.js', import.meta.url), { type: 'module' });
```

```js
// offscreen/worker.js — worker entry using import
import sqlite3InitModule from '@sqlite.org/sqlite-wasm';

self.onmessage = async (e) => {
  await initDatabase();
  // ...
};
```

## Import Patterns

### Bare Specifiers (with Vite)

```js
// Vite resolves these from node_modules
import sqlite3InitModule from '@sqlite.org/sqlite-wasm';
import browser from 'webextension-polyfill';
```

### Relative Imports (works everywhere)

```js
import { foo } from './shared/utils.js';
import { bar } from '../worker/database.js';
```

### Import Maps (HTML documents only)

```html
<!-- In popup.html or offscreen.html — NOT in workers or service workers -->
<script type="importmap">
{
  "imports": {
    "date-fns": "./lib/date-fns.js"
  }
}
</script>
```

**Import maps only work in HTML documents** (popup, offscreen, side panel). They do not work in service workers, web workers, or content scripts. Use Vite for those contexts.

## Shared Modules Pattern

```
src/
├── pages/
│   ├── background/index.js
│   ├── offscreen/
│   │   ├── index.js
│   │   ├── worker.js
│   │   └── worker/
│   │       └── database.js
│   └── popup/index.js
└── shared/
    ├── storage.js
    └── utils.js
```

```js
// shared/storage.js — works everywhere
export async function get(key, defaultValue) {
  if (globalThis.chrome?.storage?.local) {
    const { [key]: value } = await chrome.storage.local.get(key);
    return value ?? defaultValue;
  }
  return localStorage.getItem(key) ?? defaultValue;
}
```

## Vite Bundler Setup

```ts
// vite.config.ts
import { defineConfig } from 'vite';
import path from 'path';

export default defineConfig({
  build: {
    target: 'chrome116',
    rollupOptions: {
      input: {
        offscreen: 'src//offscreen/index.html',
        background: 'src//background/index.ts',
        popup: 'src//popup/index.html',
      },
      output: {
        entryFileNames: 'src//[name]/index.js',
      },
    },
  },
});
```

Vite bundles all imports, resolves bare specifiers from `node_modules`, and handles `.wasm` assets automatically.

## WASM Module Import

```js
// Direct import — Vite bundles the JS wrapper and copies .wasm
import sqlite3InitModule from '@sqlite.org/sqlite-wasm';
```

No need to copy `.wasm` files to `lib/` or configure `locateFile` when using Vite.

## Message Routing with OFFSCREEN_ Prefix

Since `chrome.runtime.sendMessage` broadcasts to all extension contexts, namespace offscreen-bound messages to prevent collision:

```js
// Background: prefix messages to offscreen
chrome.runtime.sendMessage({ type: 'OFFSCREEN_' + type, payload });

// Offscreen: only handle OFFSCREEN_* messages
chrome.runtime.onMessage.addListener((message) => {
  if (!message.type?.startsWith('OFFSCREEN_')) return;
  const type = message.type.slice('OFFSCREEN_'.length);
  // ...
});
```

## CSP Requirements

```json
"content_security_policy": {
  "extension_pages": "script-src 'self' 'wasm-unsafe-eval'; object-src 'self'"
}
```

- No `'unsafe-eval'` needed for ESM (only for bundled IIFE)
- `'wasm-unsafe-eval'` for WASM instantiation

## TypeScript Setup

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

| Issue | Fix |
|-------|-----|
| `Unexpected token 'export'` | File not loaded as module — check `type: "module"` or `<script type="module">` |
| `Cannot use import statement outside module` | Same as above |
| Worker not loading | Use `new Worker(url, { type: 'module' })` with correct URL |
| Circular imports | Restructure shared modules, use dynamic import for one side |
| `SharedArrayBuffer is not defined` | Not needed for sqlite-wasm — remove COOP/COEP headers |
| Offscreen intercepting messages | Use `OFFSCREEN_` prefix to namespace messages |

## Debugging

- DevTools → Sources → shows original module files (with Vite source maps)
- Console errors show correct file:line
- Worker console: `chrome://inspect` → Workers
