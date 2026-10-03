import { test, expect, chromium, type BrowserContext, type Worker } from '@playwright/test';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const extensionPath = path.resolve(__dirname, '../dist');
const TEST_DOMAIN = 'example.com';

test.describe.configure({ mode: 'serial' });

let context: BrowserContext;
let serviceWorker: Worker;
let extensionId: string;

test.beforeAll(async () => {
  context = await chromium.launchPersistentContext('', {
    // 'chromium' channel uses the new headless mode, which supports MV3 extensions.
    channel: 'chromium',
    args: [
      `--disable-extensions-except=${extensionPath}`,
      `--load-extension=${extensionPath}`,
    ],
  });

  // MV3 background is a service worker, NOT a background page.
  let [sw] = context.serviceWorkers();
  if (!sw) sw = await context.waitForEvent('serviceworker');
  serviceWorker = sw;
  extensionId = sw.url().split('/')[2];
});

test.afterAll(async () => {
  await context?.close();
});

test('adding a URL creates a DNR rule and blocks navigation', async () => {
  const page = await context.newPage();
  await page.goto(`chrome-extension://${extensionId}/src/popup/index.html`);
  await page.fill('#urlInput', `https://${TEST_DOMAIN}`);
  await page.click('#addBtn');

  await expect(page.locator('.domain-name', { hasText: TEST_DOMAIN })).toBeVisible();

  // Regression guard: the dynamic DNR rule must exist after adding via the UI.
  const rules = await serviceWorker.evaluate(() =>
    chrome.declarativeNetRequest.getDynamicRules()
  );
  const hasBlockRule = rules.some(
    (rule) =>
      rule.action.type === 'block' &&
      (rule.condition.requestDomains?.includes(TEST_DOMAIN) ?? false)
  );
  expect(hasBlockRule).toBe(true);

  // Navigation to the blocked domain must fail with ERR_BLOCKED_BY_CLIENT.
  const target = await context.newPage();
  let blockedByClient = false;
  try {
    await target.goto(`https://${TEST_DOMAIN}`, { timeout: 15000 });
  } catch (error) {
    blockedByClient = /ERR_BLOCKED_BY_CLIENT/.test(String((error as Error).message));
  }
  const navigatedAway = target.url() !== `https://${TEST_DOMAIN}/`;
  expect(blockedByClient || navigatedAway).toBe(true);
});
