const { chromium } = require('../.browser-tools/node_modules/playwright');
const { createTestUsers } = require('../support/test-users.cjs');
const assert = require('node:assert/strict');
const base = process.env.PLATFORM_BASE_URL || 'http://127.0.0.1:5173';

(async () => {
  const fixture = createTestUsers(2);
  let browser;
  try {
    browser = await chromium.launch({ channel: 'msedge', headless: true });
    const context = await browser.newContext({ viewport: { width: 1550, height: 950 }, reducedMotion: 'reduce' });
    await context.route(/fonts\.(googleapis|gstatic)\.com/, route => route.abort());
    const page = await context.newPage();
    page.setDefaultTimeout(25000);
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    const path = value => new URL(value).pathname;
    const home = () => page.locator('.platform-navbar').getByRole('link', { name: 'Về trang chủ', exact: true }).click();
    const icons = new Map();
    async function brand(title, icon = 'dtone', target = page) {
      await target.waitForFunction(({ title, icon }) => {
        const link = document.querySelector('link[rel="icon"]');
        return document.title === title && link?.dataset.brand === icon &&
          (icon === 'dtone' ? link.href.endsWith('/dtone.png') : link.href.startsWith('data:image/png;base64,'));
      }, { title, icon });
      const url = await target.locator('link[rel="icon"]').getAttribute('href');
      if (icons.has(icon)) assert.equal(url, icons.get(icon)); else icons.set(icon, url);
    }
    async function login() {
      await page.getByLabel('Tên đăng nhập hoặc Email').fill(fixture.accounts[0].username);
      await page.getByLabel('Mật khẩu', { exact: true }).fill(fixture.accounts[0].password);
      await page.getByRole('button', { name: 'Đăng nhập hệ thống' }).click();
    }
    async function open(label, pathname, title, icon) {
      if (label === 'Trang chủ') await home();
      else if (label === 'Hồ sơ') await page.getByRole('button', { name: /Hồ sơ của/ }).click();
      else {
        await home();
        if (label === 'DT Platform') await page.locator('.enterprise-apps').getByRole('button', { name: 'Xem tất cả', exact: false }).click();
        else await page.locator('.workspace-shortcut-grid').getByRole('button', { name: label, exact: true }).click();
      }
      await page.waitForURL(url => url.pathname === pathname);
      await brand(title, icon);
      assert.equal(await page.locator('.workspace-sidebar').count(), 0);
    }

    // A protected deep link survives the login redirect.
    await page.goto(base + '/calendar', { waitUntil: 'domcontentloaded' });
    await page.waitForURL(url => url.pathname === '/login');
    await brand('Đông Tây One');
    await login();
    await page.waitForURL(url => url.pathname === '/calendar');
    await page.locator('.calendar-page').waitFor();
    await brand('DT Calendar', 'calendar');
    assert.equal(await page.locator('.nav-brand-logo').getAttribute('alt'), 'Đông Tây One');
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.locator('.calendar-page').waitFor();
    await brand('DT Calendar', 'calendar');
    console.log('PASS direct calendar link, login return, refresh and favicon');

    await open('DT Platform', '/platform', 'DT Platform', 'platform');
    await page.locator('.enterprise-apps.is-detailed').waitFor();
    await open('Trang chủ', '/homepage', 'Đông Tây One');
    const panel = page.getByRole('region', { name: 'DT Link', exact: true });
    assert.equal(await panel.count(), 0);
    const initialHistory = await page.evaluate(() => history.length);
    const homepageIcon = await page.locator('link[rel="icon"]').getAttribute('href');
    await page.locator('.workspace-shortcut-grid').getByRole('button', { name: 'DT Link', exact: true }).click();
    await panel.waitFor();
    await page.waitForFunction(() => document.activeElement?.id === 'dt-link-panel');
    assert.equal(path(page.url()), '/homepage');
    assert.equal(await page.evaluate(() => history.length), initialHistory);
    assert.equal(await page.locator('link[rel="icon"]').getAttribute('href'), homepageIcon);
    await brand('Đông Tây One');

    await open('DT Task', '/tasks', 'DT Task', 'tasks');
    await home();
    await page.locator('.workspace-shortcut-grid').getByRole('button', { name: 'DT Link', exact: true }).click();
    await page.waitForURL(url => url.pathname === '/homepage');
    await panel.waitFor();
    await brand('Đông Tây One');
    await open('DT My Note', '/notes', 'DT My Note', 'notes');
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.locator('.notes-page').waitFor();
    await brand('DT My Note', 'notes');
    console.log('PASS all module brands and DT Link homepage behavior');

    await open('DT Calendar', '/calendar', 'DT Calendar', 'calendar');
    await open('DT Task', '/tasks', 'DT Task', 'tasks');
    await page.goBack();
    await page.waitForURL(url => url.pathname === '/homepage');
    await brand('Đông Tây One');
    await page.goForward();
    await page.waitForURL(url => url.pathname === '/tasks');
    await brand('DT Task', 'tasks');
    const search = page.getByRole('searchbox', { name: 'Tìm kiếm toàn hệ thống' });
    await search.fill('router QA');
    await page.waitForURL(url => url.pathname === '/search' && url.searchParams.get('q') === 'router QA');
    const searchHistory = await page.evaluate(() => history.length);
    await search.fill('router QA updated');
    await page.waitForURL(url => url.searchParams.get('q') === 'router QA updated');
    assert.equal(await page.evaluate(() => history.length), searchHistory);
    await page.reload({ waitUntil: 'domcontentloaded' });
    assert.equal(await search.inputValue(), 'router QA updated');
    await brand('Tìm kiếm');
    await page.goBack();
    await page.waitForURL(url => url.pathname === '/tasks');
    await brand('DT Task', 'tasks');

    const [tab] = await Promise.all([
      context.waitForEvent('page'),
      page.locator('.nav-home').click({ modifiers: ['Control'] }),
    ]);
    await tab.locator('.workspace-home').waitFor();
    assert.equal(path(tab.url()), '/homepage');
    await brand('Đông Tây One', 'dtone', tab);
    await tab.close();
    assert.equal(path(page.url()), '/tasks');
    assert.equal(new Set([...icons.entries()].filter(([key]) => key !== 'dtone').map(([,value]) => value)).size, 4);
    console.log('PASS Back/Forward, search URL and new-tab navigation');

    await open('Hồ sơ', '/profile', 'Hồ sơ');
    await page.goto(base + '/admin', { waitUntil: 'domcontentloaded' });
    await page.getByRole('alert').filter({ hasText: 'Bạn không có quyền truy cập trang quản trị.' }).waitFor();
    await brand('Quản trị');
    await page.goto(base + '/not-a-real-page', { waitUntil: 'domcontentloaded' });
    await page.getByRole('heading', { name: 'Không tìm thấy trang', exact: true }).waitFor();
    await brand('Không tìm thấy trang · Đông Tây One');
    await home();
    await page.waitForURL(url => url.pathname === '/homepage');
    await brand('Đông Tây One');
    await page.goto(base + '/', { waitUntil: 'domcontentloaded' });
    await page.waitForURL(url => url.pathname === '/homepage');
    await page.screenshot({ path: '.audit-backups/router-homepage.png' });
    await page.setViewportSize({ width: 390, height: 844 });
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    assert.ok(await page.locator('.nav-home span').isVisible());
    await open('DT Calendar', '/calendar', 'DT Calendar', 'calendar');
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    await page.screenshot({ path: '.audit-backups/router-calendar-mobile.png' });

    await page.getByRole('button', { name: 'Đăng xuất', exact: true }).click();
    await page.waitForURL(url => url.pathname === '/login');
    await brand('Đông Tây One');
    await page.goBack();
    await page.waitForURL(url => url.pathname === '/login');
    assert.equal(await page.locator('.dashboard-app').count(), 0);
    await page.goto(base + '/calendar?date=2026-10-23', { waitUntil: 'domcontentloaded' });
    await page.waitForURL(url => url.pathname === '/login');
    await login();
    await page.waitForURL(url => url.pathname === '/calendar' && url.searchParams.get('date') === '2026-10-23');
    await brand('DT Calendar', 'calendar');
    await page.setViewportSize({ width: 1550, height: 950 });
    await page.locator('.calendar-mini-grid button[data-date="2026-10-26"]').click();
    await page.waitForURL(url => url.searchParams.get('date') === '2026-10-26');
    await page.reload({ waitUntil: 'domcontentloaded' });
    await brand('DT Calendar', 'calendar');
    assert.equal(await page.locator('.calendar-mini-grid button[data-date="2026-10-26"]').getAttribute('aria-pressed'), 'true');

    // Share only between this test's isolated accounts, then exercise owner URLs.
    const { spawnSync } = require('node:child_process');
    const role = spawnSync('docker', ['compose', 'exec', '-T', 'platform-backend', 'python', '-c', `import asyncio,json,sys
from app.core.database import async_session_maker
from app.db.models import User
from app.db.access import UserRole
async def main():
 account=json.load(sys.stdin)
 async with async_session_maker() as db:
  user=await db.get(User,account['id']);assert user.username==account['username'] and user.username.startswith('testqa_')
  db.add(UserRole(user_id=user.id,role_id='calendar_sharer'));await db.commit()
asyncio.run(main())`], { cwd: require('node:path').resolve(__dirname, '../../..'), input: JSON.stringify(fixture.accounts[1]), encoding: 'utf8' });
    assert.equal(role.status, 0, role.stderr);
    let response = await page.request.post(base + '/api/auth/login', { data: { username: fixture.accounts[1].username, password: fixture.accounts[1].password } });
    assert.ok(response.ok(), await response.text());
    const ownerToken = (await response.json()).access_token;
    response = await page.request.put(base + '/api/calendar-sharing/mine/' + fixture.accounts[0].id, { headers: { Authorization: 'Bearer ' + ownerToken }, data: { expected_version: 0, share_events: true, share_tasks: false, share_notes: false } });
    assert.ok(response.ok(), await response.text());
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.getByRole('button', { name: /Test QA.*Chỉ xem/ }).click();
    await page.waitForURL(url => url.searchParams.get('owner') === fixture.accounts[1].id);
    await page.locator('.shared-calendar-page').waitFor();
    await brand('DT Calendar', 'calendar');
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.locator('.shared-calendar-page').waitFor();
    await page.goBack();
    await page.waitForURL(url => !url.searchParams.has('owner'));
    await page.locator('.calendar-page:not(.shared-calendar-page)').waitFor();
    await page.goForward();
    await page.waitForURL(url => url.searchParams.get('owner') === fixture.accounts[1].id);
    await page.locator('.shared-calendar-page').waitFor();
    await page.getByRole('button', { name: 'Lịch của tôi', exact: true }).click();
    await page.waitForURL(url => !url.searchParams.has('owner'));
    await page.locator('.calendar-page:not(.shared-calendar-page)').waitFor();
    console.log('PASS selected date and shared calendar owner URLs survive refresh and Back/Forward');
    assert.deepEqual(errors, []);
    console.log('PASS English routes, permissions, 404, root redirect, mobile layout, logout protection and deep-link query restored after login');
  } finally {
    await browser?.close();
    fixture.cleanup();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
