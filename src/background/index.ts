let creating: Promise<void> | null = null;

async function ensureOffscreenDocument() {
  if (await chrome.offscreen.hasDocument?.()) return;

  if (creating) {
    await creating;
    return;
  }

  creating = chrome.offscreen.createDocument({
    url: chrome.runtime.getURL('src/offscreen/index.html'),
    reasons: [chrome.offscreen.Reason.WORKERS],
    justification: 'Run SQLite WASM with OPFS for persistent URL/host storage'
  });
  await creating;
  creating = null;
}

async function sendToOffscreen(type: string, payload: any = {}) {
  await ensureOffscreenDocument();
  // QUIRK: chrome.runtime.sendMessage broadcasts to all extension contexts (popup, background, offscreen).
  // We prefix offscreen messages with 'OFFSCREEN_' so the offscreen document can filter them and avoid collisions.
  return chrome.runtime.sendMessage({ type: 'OFFSCREEN_' + type, payload });
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.type === 'UPDATE_RULES') {
    updateRules(message.payload.domains)
      .then(() => sendResponse({ success: true }))
      .catch(err => sendResponse({ error: err.message }));
    return true;
  }

  if (message.type === 'GET_BLOCKED_DOMAINS') {
    sendToOffscreen('GET_BLOCKED_DOMAINS')
      .then(response => sendResponse({ domains: Array.isArray(response) ? response : response.domains || [] }))
      .catch(err => sendResponse({ error: err.message }));
    return true;
  }

  if (message.type === 'INSERT_HOST') {
    sendToOffscreen('INSERT_HOST', message.payload)
      .then(response => sendResponse({ hostId: response?.hostId || response }))
      .catch(err => sendResponse({ error: err.message }));
    return true;
  }

  if (message.type === 'INSERT_LINK') {
    sendToOffscreen('INSERT_LINK', message.payload)
      .then(response => sendResponse({ linkId: response?.linkId || response }))
      .catch(err => sendResponse({ error: err.message }));
    return true;
  }

  if (message.type === 'DELETE_HOST') {
    sendToOffscreen('DELETE_HOST', message.payload)
      .then(() => sendResponse({ success: true }))
      .catch(err => sendResponse({ error: err.message }));
    return true;
  }

  if (message.type === 'EXPORT_DB') {
    sendToOffscreen('EXPORT_DB')
      .then(response => sendResponse({ data: response.data }))
      .catch(err => sendResponse({ error: err.message }));
    return true;
  }

  if (message.type === 'IMPORT_DB') {
    sendToOffscreen('IMPORT_DB', message.payload)
      .then(async (response) => {
        if (response?.success) {
          const domainsResp = await sendToOffscreen('GET_BLOCKED_DOMAINS');
          const domains = Array.isArray(domainsResp) ? domainsResp : domainsResp?.domains || [];
          await updateRules(domains);
        }
        sendResponse(response);
      })
      .catch(err => sendResponse({ error: err.message }));
    return true;
  }
});

async function updateRules(domains: string[]) {
  // QUIRK: Deduplicate domains to prevent duplicate rule IDs which throws a fatal Chrome DNR error ("Rule identifiers must be unique").
  const uniqueDomains = [...new Set(domains || [])].filter(Boolean);
  const existingRules = await chrome.declarativeNetRequest.getDynamicRules();
  const removeRuleIds = existingRules.map(rule => rule.id);

  const RULE_ID_BASE = 1000;
  const addRules = uniqueDomains.map((domain, index) => ({
    id: RULE_ID_BASE + index,
    priority: 1,
    action: { type: 'block' as const },
    condition: {
      urlFilter: `||${domain}`,
      resourceTypes: [
        'main_frame', 'sub_frame', 'script', 'xmlhttprequest',
        'image', 'stylesheet', 'font', 'object', 'ping',
        'media', 'websocket', 'webtransport', 'webbundle', 'other'
      ]
    }
  }));

  await chrome.declarativeNetRequest.updateDynamicRules({ removeRuleIds, addRules });
}

chrome.runtime.onInstalled.addListener(async () => {
  await sendToOffscreen('INIT_DB');
  const response = await sendToOffscreen('GET_BLOCKED_DOMAINS');
  if (response.domains) {
    await updateRules(response.domains);
  }
});
