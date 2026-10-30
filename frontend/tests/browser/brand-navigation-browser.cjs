const { chromium } = require('../.browser-tools/node_modules/playwright');
const { createTestUsers } = require('../support/test-users.cjs');
const assert = require('node:assert/strict');
const base = 'http://127.0.0.1:5173';

(async () => {
  const fixture = createTestUsers(1);
  let browser;
  try {
    browser = await chromium.launch({ channel: 'msedge', headless: true });
    const page = await browser.newPage({ viewport: { width: 1550, height: 950 }, reducedMotion: 'reduce' });
    page.setDefaultTimeout(20000);
    await page.route(/fonts\.(googleapis|gstatic)\.com/, route => route.abort());
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(base, { waitUntil: 'domcontentloaded' });
    assert.equal(await page.title(), 'Đông Tây One');
    await page.getByLabel('Tên đăng nhập hoặc Email').fill(fixture.accounts[0].username);
    await page.getByLabel('Mật khẩu', { exact: true }).fill(fixture.accounts[0].password);
    await page.getByRole('button', { name: 'Đăng nhập hệ thống' }).click();
    await page.locator('.workspace-home').waitFor();
    const nav = page.getByRole('navigation', { name: 'Điều hướng chính' });
    const panel = page.getByRole('region', { name: 'DT Link', exact: true });
    const shortcuts = page.locator('.workspace-shortcut-grid');
    assert.equal(await panel.count(), 0);
    assert.equal(await page.locator('.nav-brand-logo').getAttribute('alt'), 'Đông Tây One');
    assert.deepEqual(await shortcuts.getByRole('button').allTextContents(), ['DT My Note', 'DT Task', 'DT Calendar', 'DT Link']);
    assert.deepEqual(await page.locator('.enterprise-app-card strong').allTextContents(), ['Booking 360', 'DT Workflow', 'DT Assets', 'DT HRM', 'DT Sales Commission', 'DT Income Statement']);
    assert.equal(await page.locator('.enterprise-app-subtitle, .enterprise-app-description').count(), 0);
    assert.equal(await page.getByRole('button', { name: /DT HRM|DT Sales Commission|DT Income Statement/ }).count(), 3);
    const developmentPagePromise = page.waitForEvent('popup');
    await page.getByRole('button', { name: 'Mở DT HRM', exact: true }).click();
    const developmentPage = await developmentPagePromise;
    await developmentPage.getByRole('heading', { name: 'Hệ thống đang trong giai đoạn phát triển', exact: true }).waitFor();
    assert.match(developmentPage.url(), /\/system-development\?app=hrm/);
    await developmentPage.close();
    assert.ok(await nav.getByRole('link', { name: 'Hồ sơ', exact: true }).isVisible());
    await page.screenshot({ path: '.audit-backups/brand-dashboard.png' });
    await shortcuts.getByRole('button', { name: 'DT Link', exact: true }).click();
    await panel.waitFor();
    assert.equal(await panel.evaluate(el => document.activeElement === el), true);
    assert.equal(await shortcuts.getByRole('button', { name: 'DT Link', exact: true }).getAttribute('aria-expanded'), 'true');
    const panelPosition = await panel.boundingBox();
    assert.ok(panelPosition.y >= 60 && panelPosition.y + panelPosition.height < 950, JSON.stringify(panelPosition));
    await panel.getByRole('button', { name: 'Thêm', exact: true }).click();
    await panel.getByLabel('Tên liên kết', { exact: true }).fill('Brand navigation link');
    await panel.getByLabel('Địa chỉ liên kết', { exact: true }).fill('https://example.com/brand');
    await panel.getByRole('button', { name: 'Lưu', exact: true }).click();
    await panel.getByRole('link', { name: 'Brand navigation link', exact: true }).waitFor();
    await nav.getByRole('link', { name: 'DT Task', exact: true }).click();
    await page.getByRole('heading', { name: 'DT Task', exact: true }).waitFor();
    assert.equal(await page.title(), 'DT Task');
    await nav.getByRole('button', { name: 'DT Link', exact: true }).click();
    await panel.getByRole('link', { name: 'Brand navigation link', exact: true }).waitFor();
    assert.equal(await panel.evaluate(el => document.activeElement === el), true);
    await nav.getByRole('link', { name: 'DT My Note', exact: true }).click();
    await page.getByRole('heading', { name: 'DT My Note', exact: true }).waitFor();
    assert.equal(await page.title(), 'DT My Note');
    await nav.getByRole('link', { name: 'Trang chủ', exact: true }).click();
    assert.equal(await panel.count(), 0);
    await nav.getByRole('link', { name: 'DT Platform', exact: true }).click();
    assert.equal(await page.locator('.enterprise-app-subtitle, .enterprise-app-description').count(), 0);
    await nav.getByRole('link', { name: 'Trang chủ', exact: true }).click();
    for (const theme of ['dark', 'princess-pink']) {
      await page.locator('.theme-picker-trigger').click();
      await page.locator(`[data-choice="${theme}"]`).click();
      await page.locator('.theme-picker-close').click();
      await page.screenshot({ path: `.audit-backups/brand-dashboard-${theme}.png` });
    }
    await page.setViewportSize({ width: 390, height: 844 });
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    await shortcuts.getByRole('button', { name: 'DT Link', exact: true }).click();
    await panel.waitFor();
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    await page.screenshot({ path: '.audit-backups/brand-dashboard-mobile.png' });
    assert.deepEqual(errors, []);
    console.log('PASS branded navigation and page titles, five enterprise apps with development routing, DT Link behavior, bookmark persistence, desktop/mobile and dark/pink layouts');
  } finally {
    await browser?.close();
    fixture.cleanup();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });

