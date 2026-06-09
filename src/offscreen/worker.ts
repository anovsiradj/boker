import { initDatabase, insertHost, insertLink, getBlockedDomains, deleteHost, getHostIdByHost, exportDatabase, importDatabase } from './worker/database.js';

self.onmessage = async (event: MessageEvent) => {
  const { id, type, payload } = event.data;

  try {
    await initDatabase();
    let result: any;

    switch (type) {
      case 'INIT_DB':
        result = { success: true };
        break;

      case 'INSERT_HOST':
        result = insertHost(payload.host);
        break;

      case 'INSERT_LINK':
        result = insertLink(payload.url, payload.hostId, payload.title);
        break;

      case 'GET_BLOCKED_DOMAINS':
        result = getBlockedDomains();
        break;

      case 'DELETE_HOST': {
        let hostId = payload.id;
        if (!hostId && payload.host) {
          hostId = getHostIdByHost(payload.host);
        }
        if (hostId) {
          deleteHost(hostId);
        }
        result = { success: true };
        break;
      }

      case 'EXPORT_DB':
        result = exportDatabase();
        break;

      case 'IMPORT_DB':
        result = importDatabase(payload.data);
        break;

      default:
        throw new Error(`Unknown message type: ${type}`);
    }

    self.postMessage({ id, payload: result });
  } catch (err: any) {
    self.postMessage({ id, error: err.message });
  }
};
