const { chromium } = require('../.browser-tools/node_modules/playwright');
const { createDragUsers } = require('../support/test-users.cjs');
const assert = require('node:assert/strict');
async function main() {
  const fixture = createDragUsers();
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  const first = await browser.newContext({ viewport: { width: 1440, height: 1800 } }), second = await browser.newContext({ viewport: { width: 1440, height: 1800 } });
  const a = await first.newPage(), b = await second.newPage(), errors = [], base = 'http://127.0.0.1:5173';
  let token;
  for (const page of [a, b]) page.on('pageerror', error => errors.push(error.message));
  const api = async (method, path, data) => {
    const response = await first.request.fetch(base + '/api/' + path, { method, data, headers: { Authorization: `Bearer ${token}` } });
    assert.ok(response.ok(), `${path}: ${response.status()} ${await response.text()}`); return response.status() === 204 ? null : response.json();
  };
  const login = async (page, account) => { await page.goto(base); await page.getByLabel('Tên đăng nhập hoặc Email').fill(account.username); await page.getByLabel('Mật khẩu', { exact: true }).fill(account.password); await page.getByRole('button', { name: 'Đăng nhập hệ thống' }).click(); await page.locator('.calendar-widget').waitFor(); await page.locator('.dashboard-widget-handle:not(:disabled)').first().waitFor(); };
  const columns = page => page.locator('[data-widget-column]').evaluateAll(nodes => Object.fromEntries(nodes.map(node => [node.dataset.widgetColumn, [...node.querySelectorAll('[data-dashboard-widget]')].map(item => item.dataset.dashboardWidget)])));
  const frame = id => a.locator(`[data-dashboard-widget="${id}"]`);
  const drag = async (id, target) => {
    const handle = frame(id).locator('.dashboard-widget-handle'); await handle.scrollIntoViewIfNeeded(); await handle.hover();
    const s = await handle.boundingBox();
    await a.mouse.move(s.x + s.width / 2, s.y + s.height / 2); await a.mouse.down(); await a.mouse.move(s.x + s.width / 2 + 12, s.y + s.height / 2, { steps: 3 });
    await a.locator('.dashboard-widget-preview').waitFor();
    await target.scrollIntoViewIfNeeded(); const t = await target.boundingBox();
    await a.mouse.move(t.x + t.width / 2, t.y + Math.min(40, t.height / 2), { steps: 20 }); await a.mouse.up();
  };
  const waitColumn = (page, id, column) => page.waitForFunction(({ id, column }) => document.querySelector(`[data-widget-column="${column}"] [data-dashboard-widget="${id}"]`), { id, column });
  const saved = async () => { await a.locator('.widget-board-toast').getByRole('button', { name: 'Hoàn tác', exact: true }).waitFor(); await a.locator('.widget-board-toast').hover(); };
  try {
    await login(a, fixture.accounts[0]); await login(b, fixture.accounts[0]); token = await a.evaluate(() => localStorage.getItem('dtl_platform_token'));
    const initial = await columns(a);
    assert.deepEqual(initial, { launcher: ['apps', 'bookmarks'], tasks: ['tasks'], notes: ['calendar', 'notes'] });
    await a.getByLabel('Tên việc mới', { exact: true }).fill('Draft survives moving widgets');
    let release;
    const gate = new Promise(resolve => { release = resolve; });
    const delayed = async route => { if (route.request().method() === 'PUT') await gate; await route.continue(); };
    await a.route('**/api/workspace/widgets', delayed);
    await drag('tasks', frame('apps'));
    await waitColumn(a, 'tasks', 'launcher');
    assert.deepEqual((await api('GET', 'workspace/widgets')).columns, initial, 'UI moves before save completes');
    assert.equal(await a.getByLabel('Tên việc mới', { exact: true }).inputValue(), 'Draft survives moving widgets');
    release(); await saved(); await a.unroute('**/api/workspace/widgets', delayed);
    await waitColumn(b, 'tasks', 'launcher');
    await drag('calendar', a.locator('[data-widget-column="tasks"]')); await saved(); await waitColumn(b, 'calendar', 'tasks');
    assert.equal(await a.getByLabel('Tên việc mới', { exact: true }).inputValue(), 'Draft survives moving widgets');
    const beforeReorder = await columns(a);
    await drag('bookmarks', frame('tasks')); await saved();
    assert.equal((await columns(a)).launcher[0], 'bookmarks');
    await a.locator('.widget-board-toast').getByRole('button', { name: 'Hoàn tác', exact: true }).click();
    await a.getByText('Đã hoàn tác bố cục', { exact: true }).waitFor();
    assert.deepEqual(await columns(a), beforeReorder);
    const failing = async route => route.request().method() === 'PUT' ? route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ detail: 'QA failure' }) }) : route.continue();
    await a.route('**/api/workspace/widgets', failing);
    await drag('apps', frame('calendar')); await a.locator('.widget-board-toast.is-error').waitFor();
    assert.deepEqual(await columns(a), beforeReorder); await a.unroute('**/api/workspace/widgets', failing);
    assert.equal(await a.getByLabel('Tên việc mới', { exact: true }).inputValue(), 'Draft survives moving widgets');
    // Keyboard sorting uses the widget handle and preserves the draft too.
    const keys = frame('bookmarks').locator('.dashboard-widget-handle'); await keys.focus(); await a.keyboard.press('Space'); await a.locator('.dashboard-widget-preview').waitFor(); await a.evaluate(() => new Promise(requestAnimationFrame)); await a.keyboard.press('ArrowUp'); await a.locator('[data-dashboard-widget="apps"].is-drop-target').waitFor(); await a.keyboard.press('Space'); await saved();
    assert.notDeepEqual(await columns(a), beforeReorder);
    const afterKeyboard = await columns(a);
    // Undo must not overwrite a newer version from another session.
    const current = await api('GET', 'workspace/widgets');
    await api('PUT', 'workspace/widgets', { columns: current.columns, schema_version: 1, expected_version: current.version });
    await a.waitForFunction(version => Number(document.querySelector('.widget-board').dataset.widgetLayoutVersion) === version, current.version + 1);
    await a.locator('.widget-board-toast').getByRole('button', { name: 'Hoàn tác', exact: true }).click(); await a.locator('.widget-board-toast.is-error').waitFor();
    assert.deepEqual((await api('GET', 'workspace/widgets')).columns, afterKeyboard);
    await a.reload(); await a.locator('.dashboard-widget-handle:not(:disabled)').first().waitFor();
    assert.deepEqual(await columns(a), afterKeyboard);
    const other = await browser.newContext(); const c = await other.newPage(); await login(c, fixture.accounts[1]); assert.deepEqual(await columns(c), initial); await other.close();
    require('node:fs').mkdirSync('tests/artifacts', { recursive: true });
    await a.screenshot({ path: 'tests/artifacts/dashboard-widgets-desktop.png', fullPage: true });
    const version = (await api('GET', 'workspace/widgets')).version;
    await a.setViewportSize({ width: 390, height: 844 });
    assert.equal(await a.locator('.dashboard-widget-handle:visible').count(), 0);
    assert.ok(await a.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
    assert.deepEqual(await columns(a), afterKeyboard);
    await a.screenshot({ path: 'tests/artifacts/dashboard-widgets-mobile.png', fullPage: true });
    await a.setViewportSize({ width: 1440, height: 1800 });
    assert.equal((await api('GET', 'workspace/widgets')).version, version);
    assert.deepEqual(errors, []);
    console.log('PASS: widget cross-column/empty-column/order/keyboard drag, optimistic save, draft preserved, realtime, persistence, isolation, undo/stale guard, failure rollback and mobile.');
  } finally { await browser.close(); fixture.cleanup(); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
