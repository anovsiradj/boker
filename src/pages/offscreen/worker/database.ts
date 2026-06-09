import sqlite3InitModule from '@sqlite.org/sqlite-wasm';

let db: any = null;

function log(...args: any[]) {
  self.postMessage({ type: 'log', payload: { args } });
}

function error(...args: any[]) {
  self.postMessage({ type: 'error', payload: { args } });
}

export async function initDatabase() {
  if (db) return;
  log('Initializing database...');

  const sqlite3 = await sqlite3InitModule({
    print: log,
    printErr: error,
  });
  log('SQLite module loaded');

  const oo = sqlite3.oo1;

  if ('OpfsDb' in oo) {
    db = new oo.OpfsDb('/boker.sqlite3');
    log('OPFS available. Persisted db =', db.filename);
  } else {
    db = new oo.DB('/boker.sqlite3', 'ct');
    log('OPFS not available. Transient db =', db.filename);
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
    CREATE TRIGGER IF NOT EXISTS host_updated_at
      AFTER UPDATE ON host
      BEGIN
        UPDATE host SET updated_at = CURRENT_TIMESTAMP WHERE id = NEW.id;
      END;
    CREATE TRIGGER IF NOT EXISTS link_updated_at
      AFTER UPDATE ON link
      BEGIN
        UPDATE link SET updated_at = CURRENT_TIMESTAMP WHERE id = NEW.id;
      END;
  `);

  log('Database initialized');
}

function exec(sql: string, bind: any[] = []) {
  const results: any[] = [];
  db.exec({
    sql,
    bind,
    rowMode: 'object',
    callback: (row: any) => results.push(row),
  });
  return results;
}

export function insertHost(host: string) {
  const rows = exec(`
    INSERT INTO host (host) VALUES (?)
    ON CONFLICT(host) DO UPDATE SET updated_at = CURRENT_TIMESTAMP
    RETURNING id
  `, [host]);
  return rows[0]?.id;
}

export function insertLink(url: string, hostId: number, title: string | null) {
  const rows = exec(`
    INSERT INTO link (url, host_id, title) VALUES (?, ?, ?)
    ON CONFLICT(url) DO UPDATE SET title = excluded.title, updated_at = CURRENT_TIMESTAMP
    RETURNING id
  `, [url, hostId, title]);
  return rows[0]?.id;
}

export function getBlockedDomains() {
  const rows = exec('SELECT host FROM host ORDER BY host');
  return rows.map(r => r.host);
}

export function deleteHost(id: number) {
  exec('DELETE FROM host WHERE id = ?', [id]);
}

export function getHostIdByHost(host: string) {
  const rows = exec('SELECT id FROM host WHERE host = ?', [host]);
  return rows[0]?.id;
}

export function exportDatabase() {
  const hosts = exec('SELECT * FROM host');
  const links = exec('SELECT * FROM link');
  return { hosts, links };
}

export function importDatabase(data: any) {
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
