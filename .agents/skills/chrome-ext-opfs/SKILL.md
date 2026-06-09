---
name: chrome-ext-opfs
description: Use Origin Private File System (OPFS) in Chrome Extensions for high-performance persistent storage
---

# Chrome Extension OPFS

Use OPFS (Origin Private File System) in Manifest V3 Chrome Extensions for performant, persistent file storage.

## When to Use

- Need SQLite-style structured storage with OPFS backend
- Large binary/blob data that exceeds `chrome.storage` quotas
- High-throughput read/write requiring synchronous access in workers
- Offline-first extensions with complex local data

## Architecture

```
Popup/Content Script
       │
       ▼
chrome.runtime.sendMessage  (type: 'GET_BLOCKED_DOMAINS', 'INSERT_HOST', etc.)
       │
       ▼
Background Service Worker
       │
       ▼
chrome.runtime.sendMessage  (type: 'OFFSCREEN_GET_BLOCKED_DOMAINS', 'OFFSCREEN_INSERT_HOST', etc.)
       │
       ▼
Offscreen Document (chrome.offscreen.createDocument + WORKERS)
  └─ chrome.runtime.onMessage: only responds to types starting with 'OFFSCREEN_'
       │
       ▼
Web Worker (new Worker('./worker.js', { type: 'module' }))
  └─ self.onmessage / self.postMessage
       │
       ▼
OPFS (createSyncAccessHandle)
```

## Message Routing (OFFSCREEN_ Prefix)

To prevent the offscreen document from intercepting messages meant for the background (since `chrome.runtime.sendMessage` broadcasts to all extension contexts), namespace offscreen-bound messages with `OFFSCREEN_`:

```js
// Background: send to offscreen with prefix
async function sendToOffscreen(type, payload = {}) {
  await ensureOffscreenDocument();
  return chrome.runtime.sendMessage({ type: 'OFFSCREEN_' + type, payload });
}

// Offscreen: only handle OFFSCREEN_* messages
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  const { type, payload } = message;
  if (!type || !type.startsWith('OFFSCREEN_')) return;
  handleMessage(type.slice('OFFSCREEN_'.length), payload)
    .then(sendResponse)
    .catch(err => sendResponse({ error: err.message }));
  return true;
});
```

## Manifest Setup (Minimal)

```json
{
  "manifest_version": 3,
  "permissions": ["offscreen"],
  "background": { "service_worker": "background.js", "type": "module" },
  "content_security_policy": {
    "extension_pages": "script-src 'self' 'wasm-unsafe-eval'; object-src 'self'"
  }
}
```

**COOP/COEP headers are NOT required** — do not add `cross_origin_embedder_policy` or `cross_origin_opener_policy`. They work without them and may cause service worker issues.

## Offscreen Document Setup

```html
<!-- offscreen/index.html -->
<!DOCTYPE html>
<html><body><script type="module" src="index.js"></script></body></html>
```

```js
// offscreen/index.js
const worker = new Worker(new URL('./worker.js', import.meta.url), { type: 'module' });
const pendingRequests = new Map();

worker.onmessage = (e) => {
  const { id, payload, error } = e.data;
  const resolver = pendingRequests.get(id);
  if (resolver) {
    pendingRequests.delete(id);
    error ? resolver.reject(new Error(error)) : resolver.resolve(payload);
  }
};

function sendToWorker(type, payload) {
  return new Promise((resolve, reject) => {
    const id = crypto.randomUUID();
    const timeout = setTimeout(() => {
      pendingRequests.delete(id);
      reject(new Error(`Worker timeout for ${type}`));
    }, 10000);
    pendingRequests.set(id, { resolve, reject, timeout });
    worker.postMessage({ id, type, payload });
  });
}

// Only handle OFFSCREEN_* messages (from background)
chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  const { type, payload } = message;
  if (!type || !type.startsWith('OFFSCREEN_')) return;
  handleMessage(type.slice('OFFSCREEN_'.length), payload)
    .then(sendResponse)
    .catch(err => sendResponse({ error: err.message }));
  return true;
});
```

**Key:** No `OFFSCREEN_READY` handshake needed. `createDocument()` resolves after the page (and its worker) have loaded.

## Background Integration

```js
// background/index.js
let creating = null;

async function ensureOffscreenDocument() {
  if (await chrome.offscreen.hasDocument?.()) return;
  if (creating) { await creating; return; }
  creating = chrome.offscreen.createDocument({
    url: chrome.runtime.getURL('src/pages/offscreen/index.html'),
    reasons: [chrome.offscreen.Reason.WORKERS],
    justification: 'OPFS requires Web Worker context'
  });
  await creating;
  creating = null;
}

async function sendToOffscreen(type, payload = {}) {
  await ensureOffscreenDocument();
  return chrome.runtime.sendMessage({ type: 'OFFSCREEN_' + type, payload });
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === 'OPFS_WRITE') {
    sendToOffscreen('WRITE_FILE', msg.payload)
      .then(() => sendResponse({ success: true }))
      .catch(e => sendResponse({ error: e.message }));
    return true;
  }
});
```

## Key Constraints

| Constraint | Details |
|------------|---------|
| **Sync access** | Only in Web Workers (not service worker, not offscreen main thread) |
| **Async access** | Available in offscreen main thread via `createWritable()` / `getFile()` |
| **Offscreen required** | Must spawn worker from offscreen doc with `WORKERS` reason |
| **CSP** | Need `'wasm-unsafe-eval'` for WASM modules |
| **Quota** | Per-origin, persists until user clears site data |

## Common Pitfalls

1. **Trying OPFS in service worker** → `createSyncAccessHandle` undefined
2. **Forgetting `WORKERS` reason** → Offscreen doc can't spawn workers
3. **Not closing `SyncAccessHandle`** → File locks, subsequent writes fail
4. **Large files on main thread** → Use async `createWritable()` in offscreen
5. **Using sync handles for large files** → Blocks worker thread; prefer async for >1MB files
6. **Adding COOP/COEP to manifest** → Not needed, may cause SW issues
7. **Offscreen intercepting popup messages** → Use `OFFSCREEN_` prefix to namespace messages
