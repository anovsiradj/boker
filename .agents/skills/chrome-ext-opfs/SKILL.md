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
Extension Context          OPFS Access
─────────────────          ───────────
Service Worker      →  Cannot access OPFS directly (no createSyncAccessHandle)
Offscreen Document  →  Cannot access OPFS directly (no createSyncAccessHandle)
Web Worker          →  ✅ Full OPFS + createSyncAccessHandle (via offscreen)
```

**Required pattern:** Service Worker → Offscreen Document → Web Worker → OPFS

## Manifest Setup

```json
{
  "manifest_version": 3,
  "permissions": ["offscreen"],
  "background": { "service_worker": "background.js", "type": "module" },
  "cross_origin_embedder_policy": { "value": "require-corp" },
  "cross_origin_opener_policy": { "value": "same-origin" },
  "content_security_policy": {
    "extension_pages": "script-src 'self' 'wasm-unsafe-eval'; object-src 'self'"
  }
}
```

## Offscreen Document Setup

```html
<!-- offscreen.html -->
<!DOCTYPE html>
<html><body><script type="module" src="offscreen.js"></script></body></html>
```

```js
// offscreen.js
const worker = new Worker(new URL('./opfs-worker.js', import.meta.url), { type: 'module' });
const pending = new Map();

worker.onmessage = (e) => {
  const { id, payload, error } = e.data;
  const resolver = pending.get(id);
  if (resolver) { pending.delete(id); error ? resolver.reject(new Error(error)) : resolver.resolve(payload); }
};

function send(type, payload) {
  return new Promise((resolve, reject) => {
    const id = crypto.randomUUID();
    pending.set(id, { resolve, reject });
    worker.postMessage({ id, type, payload });
  });
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  send(msg.type, msg.payload).then(sendResponse).catch(e => sendResponse({ error: e.message }));
  return true;
});
```

## OPFS Worker Pattern

```js
// opfs-worker.js
self.onmessage = async ({ data: { id, type, payload } }) => {
  try {
    const root = await navigator.storage.getDirectory();
    let result;
    switch (type) {
      case 'WRITE_FILE': {
        const handle = await root.getFileHandle(payload.name, { create: true });
        const syncHandle = await handle.createSyncAccessHandle();
        const buffer = new TextEncoder().encode(payload.content);
        syncHandle.write(buffer);
        syncHandle.close();
        result = { success: true };
        break;
      }
      case 'READ_FILE': {
        const handle = await root.getFileHandle(payload.name);
        const syncHandle = await handle.createSyncAccessHandle();
        const buffer = new DataView(new ArrayBuffer(syncHandle.getSize()));
        syncHandle.read(buffer);
        syncHandle.close();
        result = new TextDecoder().decode(buffer);
        break;
      }
      case 'WRITE_FILE_ASYNC': {
        // For offscreen main thread or large files - no sync handle needed
        const handle = await root.getFileHandle(payload.name, { create: true });
        const writable = await handle.createWritable();
        await writable.write(payload.content);
        await writable.close();
        result = { success: true };
        break;
      }
      case 'READ_FILE_ASYNC': {
        const handle = await root.getFileHandle(payload.name);
        const file = await handle.getFile();
        const buffer = await file.arrayBuffer();
        result = new TextDecoder().decode(buffer);
        break;
      }
      case 'LIST_FILES': {
        const files = [];
        for await (const [name, handle] of root.entries()) files.push(name);
        result = files;
        break;
      }
      case 'DELETE_FILE': {
        await root.removeEntry(payload.name);
        result = { success: true };
        break;
      }
    }
    self.postMessage({ id, payload: result });
  } catch (e) { self.postMessage({ id, error: e.message }); }
};
```

## Background Integration

```js
// background.js
async function ensureOffscreen() {
  if (await chrome.offscreen.hasDocument?.()) return;
  await chrome.offscreen.createDocument({
    url: chrome.runtime.getURL('offscreen.html'),
    reasons: [chrome.offscreen.Reason.WORKERS],
    justification: 'OPFS requires Web Worker context'
  });
}

async function opfsWrite(name, content) {
  await ensureOffscreen();
  return chrome.runtime.sendMessage({ type: 'WRITE_FILE', payload: { name, content } });
}
```

## Key Constraints

| Constraint | Details |
|------------|---------|
| **Sync access** | Only in Web Workers (not service worker, not offscreen main thread) |
| **Async access** | Available in offscreen main thread via `createAccessHandle()` / `createWritable()` |
| **Offscreen required** | Must spawn worker from offscreen doc with `WORKERS` reason |
| **COOP/COEP headers** | Required for `SharedArrayBuffer` (needed by SQLite WASM) |
| **CSP** | Need `'wasm-unsafe-eval'` for WASM modules |
| **Quota** | Per-origin, persists until user clears site data |

## Common Pitfalls

1. **Trying OPFS in service worker** → `createSyncAccessHandle` undefined
2. **Missing COOP/COEP** → `SharedArrayBuffer` unavailable → SQLite WASM falls back to memory
3. **Forgetting `WORKERS` reason** → Offscreen doc can't spawn workers
4. **Not closing `SyncAccessHandle`** → File locks, subsequent writes fail
5. **Large files on main thread** → Use async `createAccessHandle()` + `read()`/`write()` in offscreen, or `createWritable()` in worker
6. **Using sync handles for large files** → Blocks worker thread; prefer async for >1MB files

## Debugging

Install **OPFS Explorer** extension → DevTools → OPFS Explorer tab to inspect files.