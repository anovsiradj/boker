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

No manual copying of WASM files needed when using Vite — it resolves `node_modules` imports and copies `.wasm` to `assets/` automatically.

## Architecture

```
Popup → Background → Offscreen (OFFSCREEN_ prefix) → Web Worker → sqlite3InitModule → oo1.OpfsDb → OPFS
```

**Use `sqlite3InitModule` + `oo1.OpfsDb` directly, not `sqlite3Worker1Promiser`.** The `OpfsDb` API is simpler — it wraps the promiser internally and provides a synchronous `exec()` API inside the worker.

## Database Module

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
    db = new oo.OpfsDb('/mydb.sqlite3');
  } else {
    db = new oo.DB('/mydb.sqlite3', 'ct');
  }
  db.exec(`
    CREATE TABLE IF NOT EXISTS host (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      host TEXT NOT NULL UNIQUE,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS link (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      url TEXT NOT NULL UNIQUE,
      host_id INTEGER NOT NULL,
      title TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (host_id) REFERENCES host(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_link_host_id ON link(host_id);
    CREATE INDEX IF NOT EXISTS idx_host_host ON host(host);
  `);
}

function exec(sql, bind = []) {
  const results = [];
  db.exec({ sql, bind, rowMode: 'object', callback: (row) => results.push(row) });
  return results;
}
```

## Worker Message Handler

```js
// worker.js
import { initDatabase, insertHost, getBlockedDomains } from './worker/database.js';

self.onmessage = async (event) => {
  const { id, type, payload } = event.data;
  try {
    await initDatabase();  // safe to call on every message (cached)
    let result;
    switch (type) {
      case 'INSERT_HOST':
        result = insertHost(payload.host);
        break;
      case 'GET_BLOCKED_DOMAINS':
        result = getBlockedDomains();
        break;
    }
    self.postMessage({ id, payload: result });
  } catch (err) {
    self.postMessage({ id, error: err.message });
  }
};

export function insertHost(host) {
  return exec(`
    INSERT INTO host (host) VALUES (?)
    ON CONFLICT(host) DO UPDATE SET updated_at = CURRENT_TIMESTAMP
    RETURNING id
  `, [host])[0]?.id;
}

export function getBlockedDomains() {
  return exec('SELECT host FROM host ORDER BY host').map(r => r.host);
}
```

## Offscreen Bridge

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

// Only handle OFFSCREEN_* messages from background
chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  const { type, payload } = message;
  if (!type || !type.startsWith('OFFSCREEN_')) return;
  handleMessage(type.slice('OFFSCREEN_'.length), payload)
    .then(sendResponse)
    .catch(err => sendResponse({ error: err.message }));
  return true;
});

async function handleMessage(type, payload) {
  switch (type) {
    case 'INSERT_HOST':
      return { hostId: await sendToWorker('INSERT_HOST', payload) };
    case 'GET_BLOCKED_DOMAINS':
      return { domains: await sendToWorker('GET_BLOCKED_DOMAINS', payload) };
    case 'EXPORT_DB':
      return { data: await sendToWorker('EXPORT_DB') };
    case 'IMPORT_DB':
      return await sendToWorker('IMPORT_DB', payload);
    default:
      throw new Error(`Unknown type: ${type}`);
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
    url: chrome.runtime.getURL('src//offscreen/index.html'),
    reasons: [chrome.offscreen.Reason.WORKERS],
    justification: 'Run SQLite with OPFS'
  });
  await creating;
  creating = null;
}

async function sendToOffscreen(type, payload = {}) {
  await ensureOffscreenDocument();
  return chrome.runtime.sendMessage({ type: 'OFFSCREEN_' + type, payload });
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.type === 'INSERT_HOST') {
    sendToOffscreen('INSERT_HOST', message.payload)
      .then(r => sendResponse({ hostId: r?.hostId || r }))
      .catch(e => sendResponse({ error: e.message }));
    return true;
  }
  if (message.type === 'GET_BLOCKED_DOMAINS') {
    sendToOffscreen('GET_BLOCKED_DOMAINS')
      .then(r => sendResponse({ domains: r.domains || [] }))
      .catch(e => sendResponse({ error: e.message }));
    return true;
  }
  if (message.type === 'EXPORT_DB') {
    sendToOffscreen('EXPORT_DB')
      .then(r => sendResponse({ data: r.data }))
      .catch(e => sendResponse({ error: e.message }));
    return true;
  }
  if (message.type === 'IMPORT_DB') {
    sendToOffscreen('IMPORT_DB', message.payload)
      .then(r => sendResponse(r))
      .catch(e => sendResponse({ error: e.message }));
    return true;
  }
});

chrome.runtime.onInstalled.addListener(async () => {
  await sendToOffscreen('INIT_DB');
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

**COOP/COEP headers are NOT required.** Do not add `cross_origin_embedder_policy` or `cross_origin_opener_policy`.

## Upsert Patterns

Use singular table names and `ON CONFLICT ... DO UPDATE`:

```sql
INSERT INTO host (host) VALUES (?)
ON CONFLICT(host) DO UPDATE SET updated_at = CURRENT_TIMESTAMP
RETURNING id

INSERT INTO link (url, host_id, title) VALUES (?, ?, ?)
ON CONFLICT(url) DO UPDATE SET title = excluded.title, updated_at = CURRENT_TIMESTAMP
RETURNING id
```

Include `created_at` and `updated_at` on every table with triggers:

```sql
updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
CREATE TRIGGER host_updated_at AFTER UPDATE ON host
BEGIN UPDATE host SET updated_at = CURRENT_TIMESTAMP WHERE id = NEW.id; END;
```

## JSON Export/Import

```js
export function exportDatabase() {
  const hosts = exec('SELECT * FROM host');
  const links = exec('SELECT * FROM link');
  return { hosts, links };
}

export function importDatabase(data) {
  exec('DELETE FROM link');
  exec('DELETE FROM host');
  for (const row of data.hosts || []) {
    exec('INSERT INTO host (id, host, created_at, updated_at) VALUES (?, ?, ?, ?)',
      [row.id, row.host, row.created_at, row.updated_at]);
  }
  for (const row of data.links || []) {
    exec('INSERT INTO link (id, url, host_id, title, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)',
      [row.id, row.url, row.host_id, row.title, row.created_at, row.updated_at]);
  }
}
```

## Performance Tips

- Use `oo1.OpfsDb` directly — simpler API, same performance as promiser
- Batch inserts in transactions
- Add indexes on foreign keys and query columns
- Use `RETURNING` clause to avoid extra SELECT
- **WAL mode caveat**: `PRAGMA journal_mode = WAL;` may not persist on OPFS — test first

## Debugging

- Worker console available via `chrome://inspect` → Workers
- Look for `sqlite3 module loaded` and `OPFS available` log messages
- OPFS Explorer extension → inspect database file

## Common Errors

| Error | Cause | Fix |
|-------|-------|------|
| `Worker is not defined` | Importing in service worker | Only import in Web Worker |
| `OPFS not available` | Not in Web Worker context | Ensure offscreen uses `Reason.WORKERS` and spawns a Worker |
| `database is locked` | Concurrent writes | Use transactions, single writer pattern |
| `WASM not loaded` | Missing .wasm in assets | Vite copies automatically; check `dist/assets/` |
| `sqlite3 module not found` | Wrong import path | Import from `@sqlite.org/sqlite-wasm` directly |
