---
name: chrome-ext-api
description: >
  Reference for the Chrome Extensions APIs used in this project (Manifest V3):
  chrome.runtime, chrome.offscreen, chrome.declarativeNetRequest, and the
  browser.* namespace via webextension-polyfill. Use this skill whenever you add,
  change, or debug extension API usage — message passing, service worker lifecycle,
  offscreen documents, dynamic/session/static DNR rules, request blocking, rule
  limits, or the browser namespace. Trigger on mentions of: 'chrome.runtime',
  'runtime.sendMessage', 'onMessage', 'onInstalled', 'getURL', 'chrome.offscreen',
  'offscreen document', 'createDocument', 'declarativeNetRequest', 'updateDynamicRules',
  'getDynamicRules', 'urlFilter', 'requestDomains', 'resourceTypes', 'dynamic rules',
  'browser namespace', 'webextension-polyfill', or 'manifest permissions'.
---

# Chrome Extensions API (used in this project)

Authoritative source: https://developer.chrome.com/docs/extensions/reference/api

This project is Manifest V3. The extension's background is a **service worker**
(no DOM, can be terminated at any time). All extension APIs are async and return
promises (Chrome 99+ for `runtime`/most MV3 APIs).

## APIs used here

| API | Where | Purpose |
|-----|-------|---------|
| `chrome.runtime` | background, offscreen, worker | messaging, `getURL`, lifecycle |
| `chrome.offscreen` | background | host DOM/Worker (SQLite + OPFS) |
| `chrome.declarativeNetRequest` | background | block requests by domain (dynamic rules) |
| `browser.runtime` (`webextension-polyfill`) | popup | promise-based messaging |

Manifest pieces that enable them:

```json
{
  "background": { "service_worker": "src/background/index.js", "type": "module" },
  "permissions": ["declarativeNetRequest", "offscreen"],
  "host_permissions": ["<all_urls>"]
}
```

---

## chrome.runtime

No permission needed for the members used here.

| Member | Notes |
|--------|-------|
| `runtime.id` | extension ID |
| `runtime.getURL(path)` | relative path -> `chrome-extension://<id>/...` |
| `runtime.sendMessage(message)` | Promise<response>; broadcasts to **all** extension frames except the sender |
| `runtime.onMessage.addListener(fn)` | `fn(message, sender, sendResponse)`; return `true` to respond asynchronously |
| `runtime.onInstalled.addListener(fn)` | `fn({ reason, previousVersion? })`; reasons: `install`, `update`, `chrome_update`, `shared_module_update` |
| `runtime.getContexts(filter)` | Chrome 116+; find popup/offscreen/SW contexts |
| `runtime.lastError` | only set inside callback-style calls; promises don't set it |

### Message passing (this project's pattern)

`sendMessage` broadcasts to every context, so namespace offscreen-bound messages:

```ts
// background/index.ts
async function sendToOffscreen(type: string, payload: any = {}) {
  await ensureOffscreenDocument();
  return chrome.runtime.sendMessage({ type: 'OFFSCREEN_' + type, payload });
}

// offscreen/index.ts — filter, then respond
chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (!message.type?.startsWith('OFFSCREEN_')) return;
  handleOffscreenMessage(message.type.slice('OFFSCREEN_'.length), message.payload)
    .then(sendResponse)
    .catch(err => sendResponse({ error: err.message }));
  return true; // REQUIRED: keeps the channel open for the async response
});
```

**Gotchas**
- Forgetting `return true` in an async `onMessage` listener closes the channel; the sender's promise resolves `undefined`.
- `sendMessage` cannot reach content scripts (use `tabs.sendMessage` for that).
- The background's own listener also receives its `OFFSCREEN_*` messages — filter them out.
- Reloading an unpacked extension fires `onInstalled` with reason `"update"`.

---

## chrome.offscreen

Chrome 109+ MV3+, permission `"offscreen"`. Gives a hidden document DOM/Worker access
(needed because service workers have no DOM and OPFS `createSyncAccessHandle()` needs a
Worker). **Only `chrome.runtime` is available inside an offscreen document.**

| Member | Notes |
|--------|-------|
| `offscreen.createDocument({ url, reasons, justification })` | Promise; `url` must be a bundled static HTML file |
| `offscreen.closeDocument()` | Promise; closes the current document |
| `offscreen.hasDocument()` | Chrome 150+; on older Chrome use `runtime.getContexts()` |
| `offscreen.Reason` | enum, see below |

### Reasons (enum) and lifespan

`TESTING`, `AUDIO_PLAYBACK`, `IFRAME_SCRIPTING`, `DOM_SCRAPING`, `BLOBS`,
`DOM_PARSER`, `USER_MEDIA`, `DISPLAY_MEDIA`, `WEB_RTC`, `CLIPBOARD`,
`LOCAL_STORAGE`, `WORKERS`, `BATTERY_STATUS`, `MATCH_MEDIA`, `GEOLOCATION`.

- `AUDIO_PLAYBACK` auto-closes after 30s without audio; all other reasons have no lifetime limit.
- Only **one** offscreen document may be open per extension (normal + incognito count separately).

### Lifecycle guard (recommended, Chrome 116+)

Prefer `runtime.getContexts()` over `hasDocument()` for compatibility:

```ts
let creating: Promise<void> | null = null;

async function ensureOffscreenDocument() {
  const url = chrome.runtime.getURL('src/offscreen/index.html');
  const existing = await chrome.runtime.getContexts({
    contextTypes: ['OFFSCREEN_DOCUMENT'],
    documentUrls: [url],
  });
  if (existing.length > 0) return;

  if (creating) { await creating; return; }   // avoid concurrent createDocument()
  creating = chrome.offscreen.createDocument({
    url,
    reasons: [chrome.offscreen.Reason.WORKERS],
    justification: 'Run SQLite WASM with OPFS',
  });
  await creating;
  creating = null;
}
```

**Gotchas**
- Calling `createDocument()` twice throws "Only a single offscreen document may be created"; the `creating` promise guard prevents the race.
- The offscreen document outlives the service worker — don't assume it was recreated.
- Offscreen documents can't be focused; `window.opener` is always `null`.

---

## chrome.declarativeNetRequest (DNR)

Chrome 84+. Blocks/modifies requests declaratively without reading them.

| Permission | Behavior |
|------------|----------|
| `declarativeNetRequest` | install-time warning; implicit access to `block`/`allow`/`allowAllRequests` (used here) |
| `declarativeNetRequestWithHostAccess` | no warning, but requires host permissions for any action |
| `declarativeNetRequestFeedback` | enables `getMatchedRules()` / `onRuleMatchedDebug` (unpacked only) |

### Ruleset types

| Type | Managed | Persistence |
|------|---------|-------------|
| Dynamic | `updateDynamicRules()` | across sessions & upgrades |
| Session | `updateSessionRules()` | cleared on browser shutdown / extension update |
| Static | manifest `declarative_net_request.rule_resources` | packaged with the extension |

### Read / write dynamic rules

```ts
const existing = await chrome.declarativeNetRequest.getDynamicRules();
const removeRuleIds = existing.map(r => r.id);

const addRules = domains.map((domain, index) => ({
  id: 1000 + index,
  priority: 1,
  action: { type: 'block' as const },
  condition: {
    requestDomains: [domain],
    resourceTypes: [
      'main_frame', 'sub_frame', 'script', 'xmlhttprequest', 'image',
      'stylesheet', 'font', 'object', 'ping', 'csp_report', 'media',
      'websocket', 'webtransport', 'webbundle', 'other',
    ],
  },
}));

await chrome.declarativeNetRequest.updateDynamicRules({ removeRuleIds, addRules });
```

### Matching conditions

- `requestDomains: [domain]` — matches the domain **and its subdomains**, exact. **Preferred.**
- `urlFilter: "||domain"` — substring/anchor syntax; per docs `||google.com` **incorrectly matches
  `https://google.company`**. If you must use it, anchor with a slash: `"||domain/"`.
- `initiatorDomains` / `excludedRequestDomains` / `excludedInitiatorDomains` (Chrome 101+).
- `regexFilter` — max 1000 regex rules total, each < 2KB compiled.

`ResourceType` enum: `main_frame`, `sub_frame`, `stylesheet`, `script`, `image`, `font`,
`object`, `xmlhttprequest`, `ping`, `csp_report`, `media`, `websocket`, `webtransport`,
`webbundle`, `other`.

### Rule evaluation & limits

- Priority: higher `priority` wins; ties resolved by action order `allow`/`allowAllRequests` > `block` > `upgradeScheme` > `redirect`.
- Dynamic rules: >= 5,000 unsafe (`MAX_NUMBER_OF_UNSAFE_DYNAMIC_RULES`); **30,000** safe rules from Chrome 121 (`MAX_NUMBER_OF_DYNAMIC_RULES`). Safe = `block`/`allow`/`allowAllRequests`/`upgradeScheme`.
- Session rules: up to 5,000. Static: >= 30,000 guaranteed, max 50 enabled rulesets.
- `updateDynamicRules` is idempotent if you always remove-then-add from your source of truth (the DB here).

**Gotchas**
- Duplicate rule `id`s throw a fatal error — dedupe domains first.
- DNR does **not** affect responses generated by a service worker or `CacheStorage`; it does affect `fetch()` from a service worker.
- DNR rules apply only to requests that reach the network stack; a page already loaded won't be blocked retroactively.

---

## browser.* namespace (webextension-polyfill)

The popup uses `import browser from 'webextension-polyfill'` for promise-based APIs:

```ts
const response = await browser.runtime.sendMessage({ type: 'GET_BLOCKED_DOMAINS', payload: {} });
```

Chrome now also exposes the standardized `browser.*` namespace natively (Chrome 148+), so
the polyfill is mainly for older Chrome. Don't mix `browser.*` and callback-style
`chrome.*` in the same call chain expecting the same error semantics — `browser.*`
rejects promises instead of setting `runtime.lastError`.

---

## Common issues

| Symptom | Cause | Fix |
|---------|-------|-----|
| `sendMessage` resolves `undefined` | async `onMessage` didn't `return true` | add `return true` in the listener |
| `Only a single offscreen document may be created` | concurrent `createDocument()` | guard with a shared `creating` promise + `getContexts()` |
| `chrome.offscreen.hasDocument` undefined | Chrome < 150 | use `runtime.getContexts({ contextTypes: ['OFFSCREEN_DOCUMENT'] })` |
| DNR rule never applies | rules only written on install/import | call `updateDynamicRules()` whenever the DB changes |
| Rule blocks a look-alike domain | `urlFilter: "||x.com"` matches `x.company` | use `requestDomains: ["x.com"]` |
| Fatal "Rule identifiers must be unique" | duplicate rule IDs | dedupe domains before mapping IDs |
| Extension API missing in offscreen | only `runtime` is supported there | route calls through the background via messaging |
| `runtime.lastError` never set | using promise-style calls | use the callback form or catch the rejected promise |

## References

- API index: https://developer.chrome.com/docs/extensions/reference/api
- runtime: https://developer.chrome.com/docs/extensions/reference/api/runtime
- offscreen: https://developer.chrome.com/docs/extensions/reference/api/offscreen
- declarativeNetRequest: https://developer.chrome.com/docs/extensions/reference/api/declarativeNetRequest
- Permissions list: https://developer.chrome.com/docs/extensions/reference/permissions-list
