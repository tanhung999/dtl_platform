const { chromium } = require('../.browser-tools/node_modules/playwright');
const { createTestUsers } = require('../support/test-users.cjs');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const base = process.env.PLATFORM_BASE_URL || 'http://127.0.0.1:5173';
const catalog = require('../../src/theme/catalog.json');
const { measureGlass } = require('../support/theme-performance.cjs');
(async () => {
  const fixture = createTestUsers(1); let browser;
  try {
    browser = await chromium.launch({ channel: 'msedge', headless: true });
    const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
    page.setDefaultTimeout(20000);
    const measurements = [];
    const errors = []; page.on('pageerror', e => errors.push(e.message));
    await page.route(/fonts\.(googleapis|gstatic)\.com/, route => route.abort());
    await page.goto(base, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.getByLabel('Tên đăng nhập hoặc Email').fill(fixture.accounts[0].username);
    await page.getByLabel('Mật khẩu', { exact: true }).fill(fixture.accounts[0].password);
    await page.getByRole('button', { name: 'Đăng nhập hệ thống' }).click();
    await page.locator('.platform-navbar').waitFor();
    const token = await page.evaluate(() => localStorage.getItem('dtl_platform_token'));
    const response = await page.request.post(base + '/api/notes', { headers: { Authorization: 'Bearer ' + token }, data: { title: 'Theme QA note', content: 'Màu ghi chú giữ nguyên trên mọi giao diện.', color: '#fef08a' } });
    assert.ok(response.ok());
    const note = page.locator('.note-card').filter({ hasText: 'Theme QA note' }); await note.waitFor();
    const color = await note.evaluate(el => getComputedStyle(el).backgroundColor);
    let reads = 0;
    page.on('request', request => { if (request.method() === 'GET' && new URL(request.url()).pathname.startsWith('/api/')) reads++; });
    const trigger = page.getByRole('button', { name: 'Chọn giao diện', exact: true });
    await trigger.click();
    const dialog = page.getByRole('dialog', { name: 'Theme' });
    assert.equal(await dialog.getByRole('radio').count(), Object.keys(catalog.themes).length);
    const backgrounds = new Set();
    for (const [id, { name, mode }] of Object.entries(catalog.themes)) {
      const before = reads;
      await dialog.getByRole('radio', { name: new RegExp(name) }).click();
      await page.waitForFunction(value => document.documentElement.dataset.theme === value, id);
      await page.waitForTimeout(300);
      assert.equal(await page.evaluate(() => localStorage.getItem('dtl_theme')), id);
      assert.equal(await note.evaluate(el => getComputedStyle(el).backgroundColor), color);
      assert.equal(await page.evaluate(() => document.documentElement.style.colorScheme), mode);
      backgrounds.add(await page.evaluate(() => getComputedStyle(document.body).backgroundImage));
      assert.equal(reads, before, 'Theme switch must not reload data');
      fs.mkdirSync('../.audit-backups/theme-previews', { recursive: true });
      await page.screenshot({ path: '../.audit-backups/theme-previews/' + id + '.png' });
    }
    assert.equal(backgrounds.size, Object.keys(catalog.themes).length);
    await page.keyboard.press('Escape'); assert.equal(await dialog.count(), 1); await page.locator('.widget-title').first().click(); assert.equal(await dialog.count(), 1); await dialog.getByRole('button', { name: 'Đóng chọn giao diện' }).click(); await trigger.focus();
    await trigger.click(); await page.locator('[data-choice="obsidian"]').click(); await dialog.getByRole('button', { name: 'Đóng chọn giao diện' }).click();
    await page.getByLabel('Ngày đến hạn', { exact: true }).fill('19/10/2026');
    await page.getByRole('button', { name: 'Chọn ngày đến hạn', exact: true }).click();
    const selectedDate = page.locator('.app-date-grid button[aria-pressed="true"]');
    assert.equal(await selectedDate.evaluate(el => getComputedStyle(el).color), 'rgb(9, 44, 43)');
    await page.keyboard.press('Escape');
    await trigger.click(); await page.locator('.widget-title').first().click(); assert.equal(await dialog.count(), 1); await dialog.getByRole('button', { name: 'Đóng chọn giao diện' }).click();
    await trigger.click(); await page.keyboard.press('Home'); await page.keyboard.press('ArrowRight');
    await page.waitForFunction(() => document.documentElement.dataset.theme === 'dark');
    await dialog.getByRole('button', { name: 'Đóng chọn giao diện' }).click();
    assert.equal(await trigger.evaluate(el => document.activeElement === el), true);
    await page.reload(); await page.locator('.platform-navbar').waitFor();
    assert.equal(await page.evaluate(() => document.documentElement.dataset.theme), 'dark');
    await page.getByRole('button', { name: 'Lịch', exact: true }).click();
    await page.locator('.calendar-shell').waitFor();
    await trigger.click(); await page.getByRole('radio', { name: /Ivory & Forest/ }).click(); await dialog.getByRole('button', { name: 'Đóng chọn giao diện' }).click();
    assert.equal(await page.locator('.calendar-shell').evaluate(el => getComputedStyle(el).backgroundColor), 'rgb(255, 254, 250)');
    await trigger.click(); await page.getByRole('radio', { name: /Emerald Aurora/ }).click(); await dialog.getByRole('button', { name: 'Đóng chọn giao diện' }).click();
    await page.reload(); await page.locator('.platform-navbar').waitFor();
    assert.equal(await page.evaluate(() => document.documentElement.dataset.theme), 'emerald');
    await page.setViewportSize({ width: 390, height: 844 });
    await trigger.click();
    await page.getByRole('radio', { name: /Sunset Coral Glass/ }).click();
    await page.getByRole('radio', { name: /Obsidian Titanium/ }).click();
    assert.equal(await page.evaluate(() => document.documentElement.style.colorScheme), 'dark');
    await page.getByRole('radio', { name: /Rose Quartz/ }).click();
    assert.equal(await page.evaluate(() => document.documentElement.style.colorScheme), 'light');
    await page.getByRole('radio', { name: /Lavender Aura/ }).click();
    assert.equal(await page.evaluate(() => localStorage.getItem('dtl_theme')), 'fairy-purple');
    const box = await dialog.boundingBox(); assert.ok(box.x >= 0 && box.x + box.width <= 390 && box.y >= 0 && box.y + box.height <= 844);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    await page.screenshot({ path: '../.audit-backups/theme-previews/mobile.png' });
    await dialog.getByRole('button', { name: 'Đóng chọn giao diện' }).click();
    assert.deepEqual(errors, []);
    // No app JavaScript: saved theme and palette must already be in the HTML.
    const early = await browser.newPage();
    await early.route('**/*', route => route.request().resourceType() === 'script' ? route.abort() : route.continue());
    await early.addInitScript(() => localStorage.setItem('dtl_theme', new URL(location.href).searchParams.get('theme')));
    for (const [id, { mode }] of Object.entries(catalog.themes)) {
      await early.goto(base + '/?theme=' + id, { waitUntil: 'domcontentloaded', timeout: 60000 });
      assert.equal(await early.evaluate(() => document.documentElement.dataset.theme), id);
      assert.equal(await early.evaluate(() => document.documentElement.style.colorScheme), mode);
      assert.ok(await early.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--bg-main').trim()));
      assert.equal(await early.locator('#root > *').count(), 0);
    }
    await early.close();
    if (fs.existsSync('dist/index.html')) {
      const built = await browser.newPage(), html = fs.readFileSync('dist/index.html', 'utf8');
      await built.route('**/*', route => route.request().isNavigationRequest() ? route.fulfill({ contentType: 'text/html', body: html }) : route.abort());
      await built.addInitScript(() => localStorage.setItem('dtl_theme', new URL(location.href).searchParams.get('theme')));
      for (const [id, { mode }] of Object.entries(catalog.themes)) {
        await built.goto('http://theme.invalid/?theme=' + id, { waitUntil: 'domcontentloaded' });
        assert.equal(await built.evaluate(() => document.documentElement.dataset.theme), id);
        assert.equal(await built.evaluate(() => document.documentElement.dataset.colorMode), mode);
        assert.ok(await built.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--bg-main').trim()));
      }
      await built.close();
    }
    if (process.env.THEME_PERF === '1') {
      await page.setViewportSize({ width: 1600, height: 1000 });
      await page.getByRole('button', { name: 'Workspace', exact: true }).click(); await note.waitFor();
      for (const id of ['aurora', 'sunset', 'emerald']) {
        await trigger.click(); await page.locator('[data-choice="' + id + '"]').click(); await dialog.getByRole('button', { name: 'Đóng chọn giao diện' }).click();
        measurements.push(await measureGlass(page, id));
      }
      fs.writeFileSync('../.audit-backups/theme-performance-20261019.json', JSON.stringify({ environment: 'Headless Edge on current machine; CPU x4; not a GPU or low-end device simulation', measurements }, null, 2));
      console.log('Glass diagnostic:', JSON.stringify(measurements));
    }
    // A fresh visit handles unavailable theme persistence.
    const blocked = await browser.newPage();
    await blocked.addInitScript(() => { const get = Storage.prototype.getItem, set = Storage.prototype.setItem; Storage.prototype.getItem = function(key) { if (key === 'dtl_theme') throw new Error('blocked'); return get.call(this, key); }; Storage.prototype.setItem = function(key, value) { if (key === 'dtl_theme') throw new Error('blocked'); return set.call(this, key, value); }; });
    await blocked.goto('http://127.0.0.1:5173', { waitUntil: 'domcontentloaded', timeout: 60000 }); await blocked.getByRole('button', { name: 'Chọn giao diện' }).click();
    await blocked.getByRole('radio', { name: /Aurora Glass/ }).click();
    assert.equal(await blocked.evaluate(() => document.documentElement.dataset.theme), 'aurora'); await blocked.close();
    console.log('PASS: catalog themes, palette distinction, no API reload, note colors, persistence, keyboard selection and X-only dismissal, full Calendar, mobile bounds and disabled storage.');
  } finally { await browser?.close(); fixture.cleanup(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
