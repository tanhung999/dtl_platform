const { chromium } = require('../.browser-tools/node_modules/playwright');
const { createTestUsers } = require('../support/test-users.cjs');
const assert = require('node:assert/strict');
const http = require('node:http');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const dist = path.resolve(__dirname, '../../dist');
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const mime = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.svg': 'image/svg+xml' };

(async () => {
  const fixture = createTestUsers(1); let browser, server;
  try {
    // Serve the actual production build on a non-trustworthy HTTP hostname.
    server = http.createServer((req, res) => {
      if (req.url.startsWith('/api/')) {
        const upstream = http.request({ hostname: '127.0.0.1', port: 8000, path: req.url, method: req.method, headers: { ...req.headers, host: '127.0.0.1:8000' } }, reply => {
          res.writeHead(reply.statusCode, reply.headers); reply.pipe(res);
        });
        upstream.on('error', () => { if (!res.headersSent) res.writeHead(502); res.end(); });
        res.on('close', () => upstream.destroy()); req.pipe(upstream); return;
      }
      const file = path.resolve(dist, '.' + decodeURIComponent(new URL(req.url, 'http://test').pathname));
      const safe = file.startsWith(dist + path.sep) && fs.existsSync(file) && fs.statSync(file).isFile() ? file : path.join(dist, 'index.html');
      res.writeHead(200, { 'Content-Type': mime[path.extname(safe)] || 'application/octet-stream' }); fs.createReadStream(safe).pipe(res);
    });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const base = `http://dt-platform-http.test:${server.address().port}`;
    browser = await chromium.launch({ channel: 'msedge', headless: true, args: ['--host-resolver-rules=MAP dt-platform-http.test 127.0.0.1', '--no-proxy-server'] });
    const page = await browser.newPage({ viewport: { width: 1366, height: 950 } }); page.setDefaultTimeout(25000);
    const errors = []; page.on('pageerror', error => errors.push(error.message));
    await page.route(/fonts\.(googleapis|gstatic)\.com/, route => route.abort());
    await page.goto(base + '/calendar', { waitUntil: 'domcontentloaded' });
    await page.waitForURL(url => url.pathname === '/login');
    const cryptoState = await page.evaluate(() => ({ secure: isSecureContext, uuid: typeof crypto.randomUUID, random: typeof crypto.getRandomValues }));
    assert.deepEqual(cryptoState, { secure: false, uuid: 'undefined', random: 'function' });
    await page.getByLabel('Tên đăng nhập hoặc Email').fill(fixture.accounts[0].username);
    await page.getByLabel('Mật khẩu', { exact: true }).fill(fixture.accounts[0].password);
    await page.getByRole('button', { name: 'Đăng nhập hệ thống' }).click();
    await page.locator('.calendar-page').waitFor(); assert.equal(new URL(page.url()).pathname, '/calendar');
    const home = () => page.locator('.platform-navbar').getByRole('link', { name: 'Về trang chủ', exact: true }).click();
    const shortcut = label => page.locator('.workspace-shortcut-grid').getByRole('button', { name: label, exact: true }).click();
    const token = await page.evaluate(() => localStorage.getItem('dtl_platform_token'));
    const api = async url => { const r = await page.request.get(`http://127.0.0.1:${server.address().port}` + url, { headers: { Authorization: 'Bearer ' + token } }); assert.ok(r.ok(), await r.text()); return r.json(); };
    const waitWrite = (url, method) => page.waitForResponse(r => new URL(r.url()).pathname === url && r.request().method() === method);
    await home(); assert.equal(await page.locator('.workspace-sidebar').count(), 0);
    assert.equal(await page.locator('.nav-admin').count(), 0);
    const history = await page.evaluate(() => window.history.length);
    await shortcut('DT Link');
    const links = page.locator('.bookmarks-widget'); await links.getByRole('button', { name: 'Thêm', exact: true }).click();
    await links.getByLabel('Tên liên kết', { exact: true }).fill('HTTP Base link');
    await links.getByLabel('Địa chỉ liên kết', { exact: true }).fill('https://base.vn/');
    const bookmarkSaved = waitWrite('/api/bookmarks', 'POST');
    await links.getByRole('button', { name: 'Lưu', exact: true }).click();
    const bookmarkResponse = await bookmarkSaved; assert.ok(bookmarkResponse.ok()); assert.match(bookmarkResponse.request().postDataJSON().client_request_id, uuid);
    await links.getByRole('link', { name: /HTTP Base link/ }).waitFor();
    assert.equal(await page.evaluate(() => window.history.length), history);
    console.log('PASS real HTTP: secure context false, randomUUID unavailable; DT Link opens and saves with a valid UUID.');

    await shortcut('DT Task');
    await page.getByLabel('Tên việc mới', { exact: true }).fill('HTTP task');
    const taskSaved = waitWrite('/api/tasks', 'POST');
    await page.getByRole('button', { name: 'Tạo công việc', exact: true }).click();
    const taskResponse = await taskSaved; assert.ok(taskResponse.ok()); assert.match(taskResponse.request().postDataJSON().client_request_id, uuid);
    await home(); await shortcut('DT My Note');
    await page.locator('.notes-widget').getByRole('button', { name: 'Thêm', exact: true }).click();
    let detail = page.getByRole('dialog', { name: 'Ghi chú', exact: true });
    await detail.getByPlaceholder('Tiêu đề ghi chú...').fill('HTTP note'); await detail.getByPlaceholder('Nhập nội dung ghi chú ở đây...').fill('Saved on HTTP');
    const noteSaved = waitWrite('/api/notes', 'POST');
    await detail.getByRole('button', { name: 'Lưu ghi chú', exact: true }).click();
    const noteResponse = await noteSaved; assert.ok(noteResponse.ok()); assert.match(noteResponse.request().postDataJSON().request_id, uuid); await detail.waitFor({ state: 'hidden' });
    await home(); await shortcut('DT Calendar');
    await page.locator('.calendar-page').waitFor();
    assert.equal(await page.locator('.workspace-sidebar').count(), 0); assert.equal(await page.locator('.calendar-sidebar').count(), 1);
    await page.getByRole('button', { name: 'Tạo sự kiện', exact: true }).click(); detail = page.locator('.calendar-event-dialog');
    await detail.getByLabel('Tên sự kiện', { exact: true }).fill('HTTP repeating event');
    await detail.getByLabel('Ngày bắt đầu', { exact: true }).fill('01/11/2099');
    await detail.getByLabel('Lặp lại', { exact: true }).selectOption('DAILY');
    const eventSaved = waitWrite('/api/calendar/events', 'POST');
    await detail.getByRole('button', { name: 'Lưu sự kiện', exact: true }).click();
    const eventResponse = await eventSaved; assert.ok(eventResponse.ok()); assert.match(eventResponse.request().postDataJSON().client_request_id, uuid); const event = await eventResponse.json(); await detail.waitFor({ state: 'hidden' });
    await page.goto(base + '/calendar?date=2099-11-01', { waitUntil: 'domcontentloaded' });
    await page.getByRole('button', { name: 'Danh sách', exact: true }).click();
    await page.locator(`button[data-event-id="${event.id}@2099-11-01"]`).click();
    await detail.getByRole('button', { name: 'Dời lịch / Thông báo', exact: true }).click();
    const move = page.getByRole('dialog', { name: 'Dời lịch / Thông báo', exact: true });
    await move.getByLabel('Giờ bắt đầu mới', { exact: true }).fill('11:00'); await move.getByLabel('Giờ kết thúc mới', { exact: true }).fill('12:00');
    const moved = waitWrite('/api/schedule-changes/event/' + event.id, 'POST');
    await move.getByRole('button', { name: 'Áp dụng', exact: true }).click();
    const moveResponse = await moved; assert.ok(moveResponse.ok()); assert.match(moveResponse.request().postDataJSON().request_id, uuid); let change = await moveResponse.json(); await move.waitFor({ state: 'hidden' });
    await page.getByRole('button', { name: 'Hoàn tác', exact: true }).click();
    await page.locator('.reschedule-toast').waitFor({ state: 'hidden' });
    assert.equal(await detail.getByLabel('Giờ bắt đầu', { exact: true }).inputValue(), '09:00');
    await detail.getByRole('button', { name: 'Dời lịch / Thông báo', exact: true }).click();
    await move.getByLabel('Giờ bắt đầu mới', { exact: true }).fill('11:00'); await move.getByLabel('Giờ kết thúc mới', { exact: true }).fill('12:00');
    const movedAgain = waitWrite('/api/schedule-changes/event/' + event.id, 'POST');
    await move.getByRole('button', { name: 'Áp dụng', exact: true }).click();
    const againResponse = await movedAgain; assert.ok(againResponse.ok());
    assert.match(againResponse.request().postDataJSON().request_id, uuid);
    assert.notEqual(againResponse.request().postDataJSON().request_id, moveResponse.request().postDataJSON().request_id);
    change = await againResponse.json(); await move.waitFor({ state: 'hidden' });
    await detail.getByLabel('Tên sự kiện', { exact: true }).fill('HTTP occurrence renamed');
    await detail.getByRole('button', { name: 'Lưu sự kiện', exact: true }).click(); await detail.waitFor({ state: 'hidden' });
    assert.equal((await api('/api/calendar/events/' + event.id)).title, 'HTTP repeating event');
    assert.equal((await api('/api/calendar/events/' + change.editor.resource.id)).title, 'HTTP occurrence renamed');
    console.log('PASS real HTTP: task, note, recurring event creation; scoped move and rename use valid IDs and the correct occurrence.');

    await home();
    await page.locator('.enterprise-apps').getByRole('button', { name: 'Xem tất cả', exact: false }).click();
    await page.waitForURL(url => url.pathname === '/platform'); await page.reload({ waitUntil: 'domcontentloaded' });
    await page.locator('.enterprise-apps.is-detailed').waitFor();
    await page.getByRole('button', { name: /Hồ sơ của/ }).click(); await page.waitForURL(url => url.pathname === '/profile');
    await page.locator('.notification-bell').click();
    await page.getByRole('button', { name: 'Xem tất cả thông báo', exact: true }).click();
    await page.waitForURL(url => url.pathname === '/notifications');
    await home();
    const search = page.getByRole('searchbox', { name: 'Tìm kiếm toàn hệ thống' });
    await search.fill('HTTP'); await page.waitForURL(url => url.pathname === '/search');
    await page.getByRole('heading', { name: 'Tìm kiếm', exact: true }).waitFor();
    await search.fill('HTTP task'); await page.waitForURL(url => url.searchParams.get('q') === 'HTTP task');
    await page.reload({ waitUntil: 'domcontentloaded' }); assert.equal(await search.inputValue(), 'HTTP task');
    await home(); await page.goBack(); await page.waitForURL(url => url.pathname === '/search');
    await page.goForward(); await page.waitForURL(url => url.pathname === '/homepage');
    const [newTab] = await Promise.all([page.context().waitForEvent('page'), page.locator('.nav-home').click({ modifiers: ['Control'] })]);
    await newTab.locator('.workspace-home').waitFor(); await newTab.close();
    await page.goto(base + '/admin', { waitUntil: 'domcontentloaded' });
    await page.getByRole('alert').filter({ hasText: 'Bạn không có quyền truy cập trang quản trị.' }).waitFor();
    await page.goto(base + '/not-a-page', { waitUntil: 'domcontentloaded' });
    await page.getByRole('heading', { name: 'Không tìm thấy trang', exact: true }).waitFor();
    await home();
    for (const width of [1366, 1024, 790, 390, 320]) {
      await page.setViewportSize({ width, height: 950 });
      const geometry = await page.evaluate(() => ({ overflow: document.documentElement.scrollWidth - innerWidth, home: document.querySelector('.nav-home').getBoundingClientRect().toJSON() }));
      assert.ok(geometry.overflow <= 1, JSON.stringify({ width, ...geometry }));
      assert.ok(geometry.home.x >= 0 && geometry.home.right <= width + 1);
    }
    await page.screenshot({ path: '.audit-backups/http-mobile-home.png', fullPage: true });
    await page.setViewportSize({ width: 1366, height: 950 });
    await page.screenshot({ path: '.audit-backups/http-desktop-home.png', fullPage: true });
    assert.deepEqual(errors, []);
    const grantScript = `import asyncio,json,sys
from app.core.database import async_session_maker
from app.db.access import UserRole
async def run():
    account_id=json.load(sys.stdin)
    async with async_session_maker() as db:
        db.add(UserRole(user_id=account_id,role_id='access_admin'))
        await db.commit()
asyncio.run(run())`;
    const grant = spawnSync('docker', ['compose', 'exec', '-T', 'platform-backend', 'python', '-c', grantScript], { cwd: path.resolve(__dirname, '../../..'), input: JSON.stringify(fixture.accounts[0].id), encoding: 'utf8' });
    assert.equal(grant.status, 0, grant.stderr);
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.locator('.platform-navbar').getByRole('link', { name: 'Quản trị', exact: true }).click();
    await page.getByRole('heading', { name: 'Phân quyền tài khoản', exact: true }).waitFor();
    await home(); await shortcut('DT Calendar');
    await page.locator('.calendar-view-content').waitFor();
    for (const width of [1366, 790, 390, 320]) {
      await page.setViewportSize({ width, height: 950 });
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
      assert.ok((await page.locator('.calendar-view-content').boundingBox()).height > 100);
    }
    console.log('PASS authorized admin link remains accessible; calendar remains usable at desktop and mobile widths.');
    await page.getByRole('button', { name: 'Đăng xuất', exact: true }).click(); await page.waitForURL(url => url.pathname === '/login');
    console.log('PASS navigation: no global sidebar, prominent homepage link, retained calendar sidebar, platform/profile/logout, refresh and responsive layouts.');
  } finally {
    await browser?.close();
    server?.closeAllConnections();
    if (server) await new Promise(resolve => server.close(resolve));
    fixture.cleanup();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
