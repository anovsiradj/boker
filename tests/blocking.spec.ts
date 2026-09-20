import { test, expect, chromium } from '@playwright/test';
import path from 'path';

import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

test('Extension should block a URL after adding it', async () => {
  const extensionPath = path.resolve(__dirname, '../dist');
  
  // Launch browser with extension loaded
  const browserContext = await chromium.launchPersistentContext('', {
    headless: false,
    args: [
      `--disable-extensions-except=${extensionPath}`,
      `--load-extension=${extensionPath}`
    ]
  });

  // Wait for background page to load
  let backgroundPage = browserContext.backgroundPages()[0];
  while (!backgroundPage) {
    await new Promise(r => setTimeout(r, 500));
    backgroundPage = browserContext.backgroundPages()[0];
  }
  const extensionId = backgroundPage.url().split('/')[2];
  
  const page = await browserContext.newPage();
  
  // 1. Add URL to block
  await page.goto(`chrome-extension://${extensionId}/src/popup/index.html`);
  await page.fill('#urlInput', 'https://example.com');
  await page.click('#addBtn');

  // 2. Verify blocked host rendered
  const blockedItem = await page.locator('.domain-name', { hasText: 'example.com' });
  await expect(blockedItem).toBeVisible();

  // 3. Verify blocking (navigation should be blocked)
  const targetPage = await browserContext.newPage();
  // Expect navigation to example.com to fail/be blocked
  const response = await targetPage.goto('https://example.com').catch(() => null);
  
  // DNR blocking for main_frame usually navigates to an error page or fails
  // Verifying by checking if the page URL changed to example.com
  expect(targetPage.url()).not.toBe('https://example.com/');

  await browserContext.close();
});
