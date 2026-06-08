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

```html
<!-- popup.html / offscreen.html / sidepanel.html -->
<!DOCTYPE html>
<html>
<body>
  <script type="module" src="popup.js"></script>
</body>
</html>
```

```js
// background.js - service worker
import { initStorage } from './shared/storage.js';
await initStorage();
```

```js
// content.js - content script
import { debounce } from './shared/utils.js';
const handler = debounce(() => {}, 300);
```

```js
// offscreen.js - spawns worker
const worker = new Worker(new URL('./worker.js', import.meta.url), { type: 'module' });
```

```js
// worker.js - web worker
self.onmessage = async (e) => {
  const { sqlite3Worker1Promiser } = await import('./lib/sqlite3-worker1.mjs');
  // ...
};
```

## Import Patterns

### Relative Imports (Recommended)

```js
import { foo } from './shared/utils.js';
import { bar } from '../lib/sqlite3-worker1.mjs';
```

### Import Maps (For bare specifiers)

```html
<!-- In popup.html, offscreen.html — NOT in workers -->
<script type="importmap">
{
  "imports": {
    "date-fns": "./lib/date-fns.js",
    "zod": "./lib/zod.js"
  }
}
</script>
```

**Note:** Import maps only work in HTML documents (popup, offscreen, side panel). They do **not** work in service workers, web workers, or content scripts. Use relative imports or bundlers for those contexts.

### Dynamic Imports (Code Splitting)

```js
// Load heavy module only when needed
const { heavy } = await import('./heavy-module.js');
```

## Shared Modules Pattern

```
src/
├── background.js
├── offscreen.js
├── worker.js
├── popup.js
├── content.js
└── shared/
    ├── storage.js      # chrome.storage wrapper
    ├── messaging.js    # Message types + helpers
    ├── types.js        # TypeScript interfaces
    └── utils.js        # Pure functions
```

```js
// shared/storage.js - works everywhere
export async function get(key, defaultValue) {
  if (globalThis.chrome?.storage?.local) {
    const { [key]: value } = await chrome.storage.local.get(key);
    return value ?? defaultValue;
  }
  // Fallback for testing
  return localStorage.getItem(key) ?? defaultValue;
}
```

## TypeScript Setup

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
  "include": ["src/**/*"]
}
```

## Importing WASM/Worker Files

```js
// For WASM packages, import the .mjs entry point
import { sqlite3Worker1Promiser } from './lib/sqlite3-worker1.mjs';

// For worker entry points, use URL + import.meta.url
const worker = new Worker(new URL('./worker.js', import.meta.url), { type: 'module' });
```

## Common Issues

| Issue | Fix |
|-------|-----|
| `Unexpected token 'export'` | File not loaded as module — check `type: "module"` or `<script type="module">` |
| `Cannot use import statement outside module` | Same as above |
| `ERR_UNKNOWN_URL_SCHEME` | Use relative paths or `chrome.runtime.getURL()` |
| `SharedArrayBuffer` errors | Add COOP/COEP headers to manifest |
| Worker not loading | Ensure `.js` extension, `{ type: "module" }`, and correct path |
| Circular imports | Restructure shared modules, use dynamic import for one side |

## CSP Requirements

```json
"content_security_policy": {
  "extension_pages": "script-src 'self' 'wasm-unsafe-eval'; object-src 'self'"
}
```

- No `'unsafe-eval'` needed for ESM (only for bundled IIFE)
- `'wasm-unsafe-eval'` for WASM instantiation

## Debugging

- DevTools → Sources → shows original module files
- Source maps work automatically with TypeScript + esbuild
- Console errors show correct file:line