import browser from 'webextension-polyfill';

const urlInput = document.getElementById('urlInput') as HTMLInputElement;
const addBtn = document.getElementById('addBtn') as HTMLButtonElement;
const blockedList = document.getElementById('blockedList') as HTMLUListElement;
const exportBtn = document.getElementById('exportBtn') as HTMLButtonElement;
const importBtn = document.getElementById('importBtn') as HTMLButtonElement;
const importFile = document.getElementById('importFile') as HTMLInputElement;
const statusEl = document.getElementById('status') as HTMLDivElement;

async function sendMessage(type: string, payload: any = {}) {
  return browser.runtime.sendMessage({ type, payload });
}

function showStatus(message: string, isError = false, isSuccess = false) {
  statusEl.textContent = message;
  statusEl.className = isError ? 'error' : isSuccess ? 'success' : '';
  setTimeout(() => { statusEl.textContent = ''; statusEl.className = ''; }, 3000);
}

async function loadBlockedDomains() {
  const response = await sendMessage('GET_BLOCKED_DOMAINS');
  if (Array.isArray(response)) return response;
  return response?.domains || [];
}

async function saveBlockedDomains(domains: string[]) {
  await sendMessage('UPDATE_RULES', { domains });
}

function renderBlockedDomains(domains: string[]) {
  blockedList.innerHTML = '';
  if (domains.length === 0) {
    blockedList.innerHTML = '<li class="empty-state">No domains blocked</li>';
    return;
  }
  domains.forEach((domain) => {
    const li = document.createElement('li');
    li.className = 'blocked-item';
    li.innerHTML = `
      <div class="domain-info">
        <span class="domain-name">${domain}</span>
        <span class="domain-sub">Host</span>
      </div>
      <button class="remove-btn danger" data-host="${domain}">Remove</button>
    `;
    blockedList.appendChild(li);
  });
}

function parseUrl(rawUrl: string) {
  let url = rawUrl.trim();
  if (!url) return null;
  if (!/^https?:\/\//i.test(url)) url = 'http://' + url;
  try {
    const parsed = new URL(url);
    const hostname = parsed.hostname.toLowerCase();
    const parts = hostname.split('.').filter(Boolean);
    if (parts.length < 2) return null;
    return { normalizedUrl: parsed.href, hostname };
  } catch {
    return null;
  }
}

async function addUrl() {
  const rawUrl = urlInput.value.trim();
  if (!rawUrl) return;

  addBtn.disabled = true;
  addBtn.textContent = 'Blocking...';

  const parsed = parseUrl(rawUrl);
  if (!parsed) {
    showStatus('Invalid URL', true);
    addBtn.disabled = false;
    addBtn.textContent = 'Block URL';
    return;
  }

  try {
    const hostResponse = await sendMessage('INSERT_HOST', { host: parsed.hostname });
    const hostId = hostResponse.hostId;

    if (hostId) {
      await sendMessage('INSERT_LINK', {
        url: parsed.normalizedUrl,
        hostId,
        title: parsed.hostname,
      });
    }

    const domains = await loadBlockedDomains();
    if (!domains.includes(parsed.hostname)) {
      domains.push(parsed.hostname);
      await saveBlockedDomains(domains);
    }

    urlInput.value = '';
    renderBlockedDomains(await loadBlockedDomains());
    showStatus(`Blocked ${parsed.hostname}`, false, true);
  } catch (e: any) {
    showStatus('Error: ' + e.message, true);
  } finally {
    addBtn.disabled = false;
    addBtn.textContent = 'Block URL';
  }
}

blockedList.addEventListener('click', async (e) => {
  const target = e.target as HTMLButtonElement;
  if (target.classList.contains('remove-btn')) {
    const host = target.dataset.host!;
    const domains = await loadBlockedDomains();
    const index = domains.indexOf(host);
    if (index !== -1) domains.splice(index, 1);
    await saveBlockedDomains(domains);
    await sendMessage('DELETE_HOST', { host });
    renderBlockedDomains(await loadBlockedDomains());
    showStatus('Removed ' + host, false, true);
  }
});

exportBtn.addEventListener('click', async () => {
  try {
    const response = await sendMessage('EXPORT_DB');
    const blob = new Blob([JSON.stringify(response.data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'boker-backup.json';
    a.click();
    URL.revokeObjectURL(url);
    showStatus('Database exported (JSON)', false, true);
  } catch (e: any) {
    showStatus('Export failed: ' + e.message, true);
  }
});

importBtn.addEventListener('click', () => importFile.click());

importFile.addEventListener('change', async (e) => {
  const file = e.target.files?.[0];
  if (!file) return;
  try {
    const text = await file.text();
    const data = JSON.parse(text);
    const response = await sendMessage('IMPORT_DB', { data });
    if (response.success) {
      renderBlockedDomains(await loadBlockedDomains());
      showStatus('Database imported', false, true);
    } else {
      showStatus('Import failed', true);
    }
  } catch (err: any) {
    showStatus('Import error: ' + err.message, true);
  }
  importFile.value = '';
});

urlInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') addBtn.click(); });
addBtn.addEventListener('click', addUrl);

document.addEventListener('DOMContentLoaded', async () => {
  renderBlockedDomains(await loadBlockedDomains());
});