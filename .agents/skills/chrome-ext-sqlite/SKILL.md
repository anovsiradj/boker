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

Key files from `node_modules/@sqlite.org/sqlite-wasm/dist/`:
- `sqlite3-worker1.mjs` — Worker-based promise API (use this)
- `sqlite3.wasm` — WASM binary (copy to extension `lib/`)

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
Web Worker (new Worker('./sqlite-worker.js', { type: 'module' }))
       │
       ▼
sqlite3Worker1Promiser → @sqlite.org/sqlite-wasm → OPFS (createSyncAccessHandle)
```

## SQLite Worker Template

```js
// sqlite-worker.js
import { sqlite3Worker1Promiser } from './lib/sqlite3-worker1.mjs';

let promiser = null;
let dbId = null;
const CURRENT_SCHEMA_VERSION = 2;

async function init() {
  if (promiser) return;
  promiser = await new Promise(resolve => {
    const p = sqlite3Worker1Promiser({ onready: () => resolve(p) });
  });
  const { dbId: id } = await promiser('open', {
    filename: 'file:my-db.sqlite3?vfs=opfs',
  });
  dbId = id;
  await runMigrations();
}

async function runMigrations() {
  await promiser('exec', { dbId, sql: `CREATE TABLE IF NOT EXISTS schema_version (version INTEGER PRIMARY KEY)` });
  const { result: { rows } } = await promiser('exec', { dbId, sql: 'SELECT version FROM schema_version' });
  let currentVersion = rows[0]?.version ?? 0;

  if (currentVersion < 1) {
    await promiser('exec', { dbId, sql: `
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
    ` });
    await promiser('exec', { dbId, sql: 'INSERT INTO schema_version (version) VALUES (1)' });
    currentVersion = 1;
  }

  if (currentVersion < 2) {
    await promiser('exec', { dbId, sql: `
      CREATE TRIGGER IF NOT EXISTS hosts_updated_at AFTER UPDATE ON hosts
      BEGIN UPDATE hosts SET updated_at = CURRENT_TIMESTAMP WHERE id = NEW.id; END;
      CREATE TRIGGER IF NOT EXISTS links_updated_at AFTER UPDATE ON links
      BEGIN UPDATE links SET updated_at = CURRENT_TIMESTAMP WHERE id = NEW.id; END;
    ` });
    await promiser('exec', { dbId, sql: 'UPDATE schema_version SET version = 2' });
  }
}

self.onmessage = async ({ data: { id, type, payload } }) => {
  try {
    await init();
    let result;
    switch (type) {
      case 'EXEC': {
        const { sql, bind = [] } = payload;
        const resp = await promiser('exec', { dbId, sql, bind });
        result = resp.result.rows;
        break;
      }
      case 'QUERY': {
        const { sql, bind = [] } = payload;
        const resp = await promiser('exec', { dbId, sql, bind });
        result = resp.result.rows;
        break;
      }
      case 'TRANSACTION': {
        await promiser('exec', { dbId, sql: 'BEGIN' });
        try {
          for (const stmt of payload.statements) {
            await promiser('exec', { dbId, sql: stmt.sql, bind: stmt.bind });
          }
          await promiser('exec', { dbId, sql: 'COMMIT' });
          result = { success: true };
        } catch (e) {
          await promiser('exec', { dbId, sql: 'ROLLBACK' });
          throw e;
        }
        break;
      }
    }
    self.postMessage({ id, payload: result });
  } catch (e) { self.postMessage({ id, error: e.message }); }
};
```

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

-- Always include updated_at + trigger
updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
CREATE TRIGGER links_updated_at AFTER UPDATE ON links
BEGIN UPDATE links SET updated_at = CURRENT_TIMESTAMP WHERE id = NEW.id; END
```

## Background Bridge

```js
// background.js
async function sendToWorker(type, payload) {
  await ensureOffscreen();
  return chrome.runtime.sendMessage({ type, payload });
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  const handlers = {
    'DB_EXEC': () => sendToWorker('EXEC', msg.payload),
    'DB_QUERY': () => sendToWorker('QUERY', msg.payload),
    'DB_TRANSACTION': () => sendToWorker('TRANSACTION', msg.payload),
  };
  if (handlers[msg.type]) {
    handlers[msg.type]().then(sendResponse).catch(e => sendResponse({ error: e.message }));
    return true;
  }
});
```

## Manifest Requirements

```json
{
  "permissions": ["offscreen"],
  "cross_origin_embedder_policy": { "value": "require-corp" },
  "cross_origin_opener_policy": { "value": "same-origin" },
  "content_security_policy": {
    "extension_pages": "script-src 'self' 'wasm-unsafe-eval'; object-src 'self'"
  }
}
```

## File Copy (Build Step)

```js
// Copy to extension lib/ folder for distribution
// sqlite3-worker1.mjs
// sqlite3.wasm
```

## Performance Tips

- Use `sqlite3Worker1Promiser` (worker-based) — keeps main thread free
- Batch inserts in transactions
- Add indexes on foreign keys and query columns
- Use `RETURNING` clause to avoid extra SELECT
- **WAL mode caveat**: `PRAGMA journal_mode = WAL;` may not persist on OPFS — test before relying on it

## Debugging

- OPFS Explorer extension → inspect database file
- `sqlite3Worker1Promiser` exposes `sqlite3.capi` for low-level debugging
- Log SQL: wrap `promiser('exec')` with console.log

## Common Errors

| Error | Cause | Fix |
|-------|-------|-----|
| `Worker is not defined` | Importing in service worker | Only import in Web Worker (spawned from offscreen) |
| `OPFS not available` | Missing COOP/COEP or not in worker | Check headers, ensure running in Web Worker |
| `SharedArrayBuffer not defined` | Missing headers | Add COOP/COEP to manifest |
| `database is locked` | Concurrent writes | Use transactions, single writer pattern |
| `WASM not loaded` | Wrong path to .wasm | Copy `sqlite3.wasm` to same folder as worker, or configure `locateFile` |