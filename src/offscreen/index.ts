const worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });

const pendingRequests = new Map();

worker.onmessage = (event) => {
  const { id, type, payload, error } = event.data;
  const resolver = pendingRequests.get(id);
  if (resolver) {
    pendingRequests.delete(id);
    if (error) {
      resolver.reject(new Error(error));
    } else {
      resolver.resolve(payload);
    }
  }
};

function sendToWorker(type: string, payload: any) {
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
  const { type, payload } = message;
  if (!type || !type.startsWith('OFFSCREEN_')) return;

  handleOffscreenMessage(type.slice('OFFSCREEN_'.length), payload)
    .then(sendResponse)
    .catch(err => sendResponse({ error: err.message }));
  return true;
});

async function handleOffscreenMessage(type: string, payload: any) {
  switch (type) {
    case 'INIT_DB':
      await sendToWorker('INIT_DB');
      return { success: true };

    case 'INSERT_HOST':
      return { hostId: await sendToWorker('INSERT_HOST', payload) };

    case 'INSERT_LINK':
      return { linkId: await sendToWorker('INSERT_LINK', payload) };

    case 'GET_BLOCKED_DOMAINS':
      return { domains: await sendToWorker('GET_BLOCKED_DOMAINS', payload) };

    case 'DELETE_HOST':
      await sendToWorker('DELETE_HOST', payload);
      return { success: true };

    case 'EXPORT_DB':
      return { data: await sendToWorker('EXPORT_DB') };

    case 'IMPORT_DB':
      return await sendToWorker('IMPORT_DB', payload);

    default:
      throw new Error(`Unknown offscreen message type: ${type}`);
  }
}
