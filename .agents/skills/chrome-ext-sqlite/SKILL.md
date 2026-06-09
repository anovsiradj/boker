---
name: chrome-ext-sqlite
description: Use SQLite WASM with OPFS in Chrome Extensions for structured relational storage
---

# Chrome Extension SQLite WASM + OPFS

Run SQLite in Chrome Extensions using the official `@sqlite.org/sqlite-wasm` package with OPFS persistence.

## When to Use

- Complex relational data (joins, transactions, indexes)
- Large datasets exceeding `chrome.storage` limits (10MB local, 100KB sync)
- Need ACID guarantees, migrations, or SQL queries
- Offline-first with sync capability

## Package

```bash
npm install @sqlite.org/sqlite-wasm
```

No manual copying of WASM files needed when using a bundler like Vite — it resolves `node_modules` imports and copies `.wasm` automatically.

## Architecture

```
Popup/Content/Background
       │
       ▼
chrome.runtime.sendMessage
       │
       ▼
Offscreen Document (chrome.offscreen.createDocument + WORKERS)
       │
       ▼
Web Worker (new Worker('./worker.js', { type: 'module' }))
       │
       ▼
sqlite3InitModule → oo1.OpfsDb → OPFS (createSyncAccessHandle)
```

**Use `sqlite3InitModule` + `oo1.OpfsDb` directly, not `sqlite3Worker1Promiser`.** The `OpfsDb` API is simpler — it wraps the promiser internally and provides a synchronous `exec()` API inside the worker.

## Worker Database Module

```js
// worker/database.js
import sqlite3InitModule from '@sqlite.org/sqlite-wasm';

let db = null;

export async function initDatabase() {
  if (db) return;
  const sqlite3 = await sqlite3InitModule({
    print: (...args) => console.log(...args),
    printErr: (...args) => console.error(...args),
  });
  const oo = sqlite3.oo1;
  if ('OpfsDb' in oo) {
    db = new oo.OpfsDb('/boker.sqlite3');
  } else {
    db = new oo.DB('/boker.sqlite3', 'ct');
  }
  db.exec(`
    CREATE TABLE IF NOT EXISTS hosts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      domain TEXT NOT NULL,
      subdomain TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(domain, subdomain)
    );
    CREATE TABLE IF NOT EXISTS links (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      url TEXT NOT NULL UNIQUE,
      host_id INTEGER NOT NULL,
      title TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (host_id) REFERENCES hosts(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_links_host_id ON links(host_id);
    CREATE INDEX IF NOT EXISTS idx_hosts_domain ON hosts(domain);
  `);
}

function exec(sql, bind = []) {
  const results = [];
  db.exec({
    sql, bind,
    rowMode: 'object',
    callback: (row) => results.push(row),
  });
  return results;
}
```

## Worker Message Handler

```js
// worker.js
import { initDatabase, insertHost, insertLink } from './worker/database.js';

self.onmessage = async (event) => {
  const { id, type, payload } = event.data;
  try {
    await initDatabase();
    let result;
    switch (type) {
      case 'GET_BLOCKED_DOMAINS':
        result = exec('SELECT DISTINCT domain FROM hosts WHERE subdomain IS NULL')
          .map(r => r.domain);
        break;
      case 'INSERT_HOST':
        result = exec(`
          INSERT INTO hosts (domain, subdomain) VALUES (?, ?)
          ON CONFLICT(domain, subdomain) DO UPDATE SET updated_at = CURRENT_TIMESTAMP
          RETURNING id
        `, [payload.domain, payload.subdomain])[0]?.id;
        break;
    }
    self.postMessage({ id, payload: result });
  } catch (err) {
    self.postMessage({ id, error: err.message });
  }
};
```

## Offscreen Document Bridge

```js
// offscreen/index.js
const worker = new Worker(new URL('./worker.js', import.meta.url), { type: 'module' });

const pendingRequests = new Map();

worker.onmessage = (event) => {
  const { id, payload, error } = event.data;
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

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  handleMessage(message).then(sendResponse).catch(err => sendResponse({ error: err.message }));
  return true;
});

async function handleMessage(message) {
  const { type, payload } = message;
  switch (type) {
    case 'INIT_DB':
      await sendToWorker('INIT_DB');
      return { success: true };
    case 'INSERT_HOST':
      return { hostId: await sendToWorker('INSERT_HOST', payload) };
    case 'GET_BLOCKED_DOMAINS':
      return { domains: await sendToWorker('GET_BLOCKED_DOMAINS', payload) };
    case 'EXPORT_DB':
      return { data: await sendToWorker('EXPORT_DB') };
    case 'IMPORT_DB':
      return await sendToWorker('IMPORT_DB', payload);
    default:
      throw new Error(`Unknown message type: ${type}`);
  }
}
```

## Background Bridge

```js
// background/index.js
let creating = null;

async function ensureOffscreenDocument() {
  if (await chrome.offscreen.hasDocument?.()) return;
  if (creating) { await creating; return; }
  creating = chrome.offscreen.createDocument({
    url: chrome.runtime.getURL('src/pages/offscreen/index.html'),
    reasons: [chrome.offscreen.Reason.WORKERS],
    justification: 'Run SQLite WASM with OPFS for persistent storage'
  });
  await creating;
  creating = null;
}

async function sendToOffscreen(type, payload = {}) {
  await ensureOffscreenDocument();
  return chrome.runtime.sendMessage({ type, payload });
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.type === 'GET_BLOCKED_DOMAINS') {
    sendToOffscreen('GET_BLOCKED_DOMAINS')
      .then(response => sendResponse({ domains: response.domains || [] }))
      .catch(err => sendResponse({ error: err.message }));
    return true;
  }
  // ... other handlers
});
```

## Manifest Requirements

```json
{
  "permissions": ["offscreen"],
  "content_security_policy": {
    "extension_pages": "script-src 'self' 'wasm-unsafe-eval'; object-src 'self'"
  }
}
```

**COOP/COEP headers are NOT required.** Do NOT add `cross_origin_embedder_policy` or `cross_origin_opener_policy` — they work without them and may cause service worker issues.

## Upsert Patterns

```sql
-- Hosts: unique on (domain, subdomain)
INSERT INTO hosts (domain, subdomain) VALUES (?, ?)
ON CONFLICT(domain, subdomain) DO UPDATE SET updated_at = CURRENT_TIMESTAMP
RETURNING id

-- Links: unique on url
INSERT INTO links (url, host_id, title) VALUES (?, ?, ?)
ON CONFLICT(url) DO UPDATE SET title = excluded.title, updated_at = CURRENT_TIMESTAMP
RETURNING id

-- Always include created_at + updated_at + trigger
updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
CREATE TRIGGER links_updated_at AFTER UPDATE ON links
BEGIN UPDATE links SET updated_at = CURRENT_TIMESTAMP WHERE id = NEW.id; END
```

## Performance Tips

- Use `oo1.OpfsDb` directly (not `sqlite3Worker1Promiser`) — simpler API, same performance
- Batch inserts in transactions
- Add indexes on foreign keys and query columns
- Use `RETURNING` clause to avoid extra SELECT
- **WAL mode caveat**: `PRAGMA journal_mode = WAL;` may not persist on OPFS — test before relying on it

## Debugging

- Worker console shows `sqlite3 module loaded` and `OpfsDb available` when working
- OPFS Explorer extension → inspect database file
- Log SQL: wrap `db.exec()` with console.log

## Common Errors

| Error | Cause | Fix |
|-------|-------|-----|
| `Worker is not defined` | Importing in service worker | Only import in Web Worker (spawned from offscreen) |
| `OPFS not available` | Not in Web Worker context | Ensure offscreen uses `Reason.WORKERS` and spawns a Worker |
| `database is locked` | Concurrent writes | Use transactions, single writer pattern |
| `WASM not loaded` | Bundler didn't copy .wasm | Check dist/ for .wasm files; Vite copies automatically |
| `sqlite3 module not found` | Wrong import path | Import from `@sqlite.org/sqlite-wasm` directly (not from lib/) |
