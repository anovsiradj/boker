---
name: chrome-ext-testing
description: >
  Write end-to-end (E2E) tests for Chrome Extensions (Manifest V3). Use this skill
  whenever the user asks to test, automate, or verify a Chrome extension in a real
  browser — loading an unpacked extension, testing the popup/side panel/options pages,
  driving content scripts, asserting service worker state, testing service worker
  termination, fixing flaky extension tests, or setting a stable extension ID for tests.
  Trigger on mentions of: 'Playwright', 'Puppeteer', 'Selenium', 'WebDriverIO',
  'launchPersistentContext', 'load-extension', 'serviceworker', 'chrome-extension://',
  'end-to-end test', 'e2e extension', 'headless extension test'. Also use when adding a
  `key` to the manifest to pin the extension ID, or when a test needs to read extension
  storage / execute code in an extension context.
---

# End-to-End Testing for Chrome Extensions

E2E testing builds the extension, loads it into a real browser, and drives the same
flows a user would: opening the popup, typing in inputs, and observing page/network
state. Prefer E2E over unit tests for anything that depends on the browser (DNR rules,
storage, service worker lifecycle, content scripts).

Source: https://developer.chrome.com/docs/extensions/how-to/test/end-to-end-testing

## When to Use

- Verifying behavior that only exists in a real browser (blocking, redirects, DNR)
- Testing extension pages, popups, side panels, options, and content scripts
- Asserting service worker state or storage values
- Testing service worker termination / cold start
- CI pipelines that must run without a display (headless)

## Library Support

| Library | Guidance |
|---------|----------|
| Playwright | Recommended for this project. Native MV3 support, `serviceWorkers()`, tracing. |
| Puppeteer | https://pptr.dev/guides/chrome-extensions |
| Selenium | Load via `ChromeOptions`; cannot read the service worker directly. |
| WebDriverIO | https://webdriver.io/docs/extension-testing/web-extensions/ |

## Playwright Setup (Manifest V3)

Extensions require a persistent context. Use `chromium.launchPersistentContext`, not
`chromium.launch()`.

```ts
import { test, expect, chromium } from '@playwright/test';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const extensionPath = path.resolve(__dirname, '../dist');

test('blocks a URL after adding it', async () => {
  const context = await chromium.launchPersistentContext('', {
    // Use 'chromium' channel for NEW headless mode; MV3 extensions are not
    // supported in the legacy headless mode.
    channel: 'chromium',
    args: [
      `--disable-extensions-except=${extensionPath}`,
      `--load-extension=${extensionPath}`,
    ],
  });

  // MV3 background is a service worker, NOT a background page.
  let [sw] = context.serviceWorkers();
  if (!sw) sw = await context.waitForEvent('serviceworker');
  const extensionId = sw.url().split('/')[2];

  const page = await context.newPage();
  await page.goto(`chrome-extension://${extensionId}/src/popup/index.html`);
  await page.fill('#urlInput', 'https://example.com');
  await page.click('#addBtn');
  await expect(page.locator('.domain-name', { hasText: 'example.com' })).toBeVisible();

  await context.close();
});
```

**Do NOT use `context.backgroundPages()` for MV3** — it only returns MV2 background
pages and is always empty for a service-worker extension. Use `context.serviceWorkers()`.

## Running Headless

- Chrome must run in **new headless** (`--headless=new`); old headless cannot load extensions.
- In Playwright, set `channel: 'chromium'` (uses new headless) or pass `--headless=new`.
- In CI, build first, then test: `npm run build && npm run test`.

## Pinning the Extension ID

A random ID every run breaks tests that hardcode `chrome-extension://<id>/...` or need
server allow-listing. Pin it with a `key` in `manifest.json`:

```bash
openssl genrsa 2048 | openssl pkcs8 -topk8 -inform PEM -outform DER -out key.pem -nocrypt
openssl rsa -in key.pem -pubout -outform DER | base64 > public.key.base64
```

```json
{
  "manifest_version": 3,
  "key": "BASE64_PUBLIC_KEY_HERE"
}
```

Reload the extension, copy the resulting ID, and use it in tests. Prefer deriving the ID
at runtime from the service worker URL (see above) when you don't need a fixed origin.

## Testing Extension Pages

Navigate directly to the page URL — no special API needed:

```ts
await page.goto(`chrome-extension://${extensionId}/src/popup/index.html`);
```

## Testing the Popup

Option A — open it programmatically and grab the new context/page:

```ts
const popup = await context.newPage();
await sw.evaluate(() => chrome.action.openPopup());
// then locate the popup page via context.pages() / waitForEvent('page')
```

Option B — open the popup URL in a tab. If the popup reads the active tab, add an
override so tests can pass a tab ID explicitly:

```ts
const URL_PARAMS = new URLSearchParams(window.location.search);

async function getActiveTab() {
  // Open popup.html?tab=5 to use tab ID 5
  if (URL_PARAMS.has('tab')) {
    return await chrome.tabs.get(parseInt(URL_PARAMS.get('tab')!));
  }
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab;
}
```

## Inspecting Extension State

Best practice: assert on user-visible behavior, not internal state, so refactors don't
break tests. When you must read internals, execute code in the extension context.

Playwright (service worker):

```ts
const value = await sw.evaluate(async () => {
  const { foo } = await chrome.storage.local.get('foo');
  return foo;
});
```

Selenium (no service worker access — open an extension page instead):

```js
await driver.get('chrome-extension://<id>/popup.html');
await driver.executeAsyncScript(
  'const cb = arguments[arguments.length - 1];' +
  'chrome.storage.local.get("foo").then(cb);'
);
```

## Testing Service Worker Termination

Some frameworks keep the service worker alive. Selenium/ChromeDriver attaches a debugger
to all service workers, preventing termination. Playwright can stop it explicitly:

```ts
// Force termination, then trigger a wake-up and assert state persisted.
await sw.evaluate(() => self.registration.unregister()); // or use CDP to stop the worker
```

See the official sample: https://github.com/GoogleChrome/chrome-extensions-samples/tree/main/functional-samples/tutorial.terminate-sw

## Common Issues

| Issue | Cause | Fix |
|-------|-------|-----|
| `context.backgroundPages()` empty | MV3 uses a service worker | Use `context.serviceWorkers()` |
| Extension not loaded | Used `chromium.launch()` | Use `chromium.launchPersistentContext()` |
| Extension not loaded in headless | Old headless mode | Use `channel: 'chromium'` or `--headless=new` |
| Extension ID changes each run | No `key` in manifest | Add `key` (see Pinning the Extension ID) |
| Test passes locally, fails in CI | No build before test | Run `npm run build` first |
| Popup uses wrong tab | Popup reads active tab | Add `?tab=<id>` override |
| `page.goto` to blocked URL hangs | Navigation is aborted by DNR | Wrap in `.catch(() => null)` and assert on final URL |

## Project Notes (boker)

- Build output is `dist/`; load that path as the extension.
- Run tests with `npm run test` (Playwright). Build first with `npm run build`.
- See `tests/blocking.spec.ts` and `TESTING.md` for the existing flow.
- This project has no `playwright.config.ts` yet; create one when you need multiple
  projects, retries, or a shared `launchPersistentContext` fixture.
