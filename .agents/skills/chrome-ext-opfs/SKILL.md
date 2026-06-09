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

**COOP/COEP headers are NOT required** — do NOT add `cross_origin_embedder_policy` or `cross_origin_opener_policy`. They work without them and may cause service worker issues.

## Offscreen Document Setup

```html
<!-- offscreen/index.html -->
<!DOCTYPE html>
<html><body><script type="module" src="index.js"></script></body></html>
```

```js
// offscreen/index.js
const worker = new Worker(new URL('./worker.js', import.meta.url), { type: 'module' });
const pending = new Map();

worker.onmessage = (e) => {
  const { id, payload, error } = e.data;
  const resolver = pending.get(id);
  if (resolver) {
    pending.delete(id);
    error ? resolver.reject(new Error(error)) : resolver.resolve(payload);
  }
};

function sendToWorker(type, payload) {
  return new Promise((resolve, reject) => {
    const id = crypto.randomUUID();
    const timeout = setTimeout(() => {
      pending.delete(id);
      reject(new Error(`Worker timeout for ${type}`));
    }, 10000);
    pending.set(id, { resolve, reject, timeout });
    worker.postMessage({ id, type, payload });
  });
}

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  handleMessage(msg).then(sendResponse).catch(e => sendResponse({ error: e.message }));
  return true;
});

async function handleMessage(message) {
  const { type, payload } = message;
  switch (type) {
    case 'WRITE_FILE':
      return await sendToWorker('WRITE_FILE', payload);
    case 'READ_FILE':
      return { content: await sendToWorker('READ_FILE', payload) };
    default:
      throw new Error(`Unknown type: ${type}`);
  }
}
```

**Key:** No `OFFSCREEN_READY` handshake needed. `createDocument()` resolves after the page (and its worker) have loaded.

## OPFS Worker Pattern

```js
// offscreen/worker.js
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
        const size = syncHandle.getSize();
        const buffer = new DataView(new ArrayBuffer(size));
        syncHandle.read(buffer);
        syncHandle.close();
        result = new TextDecoder().decode(buffer);
        break;
      }
      case 'LIST_FILES': {
        const files = [];
        for await (const [name] of root.entries()) files.push(name);
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

async function opfsWrite(name, content) {
  await ensureOffscreenDocument();
  return chrome.runtime.sendMessage({ type: 'WRITE_FILE', payload: { name, content } });
}

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  const handlers = {
    'WRITE_FILE': () => opfsWrite(msg.payload.name, msg.payload.content),
    'READ_FILE': () => opfsRead(msg.payload.name),
  };
  if (handlers[msg.type]) {
    handlers[msg.type]().then(sendResponse).catch(e => sendResponse({ error: e.message }));
    return true;
  }
});
```

## Using SQLite with OPFS

For structured storage, use `@sqlite.org/sqlite-wasm` with the `oo1.OpfsDb` API directly in the worker:

```js
import sqlite3InitModule from '@sqlite.org/sqlite-wasm';

const sqlite3 = await sqlite3InitModule();
const db = new sqlite3.oo1.OpfsDb('/mydb.sqlite3');
db.exec('CREATE TABLE IF NOT EXISTS ...');
```

This internally uses `createSyncAccessHandle()` for OPFS access.

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

## Debugging

Install **OPFS Explorer** extension → DevTools → OPFS Explorer tab to inspect files.

## Reference Implementation

See: https://github.com/clmnin/sqlite-opfs-mv3
