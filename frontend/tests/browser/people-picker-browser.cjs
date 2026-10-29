const { chromium } = require('../.browser-tools/node_modules/playwright');
const { createTestUsers } = require('../support/test-users.cjs');
const { spawnSync } = require('node:child_process');
const path = require('node:path');
const assert = require('node:assert/strict');
const base = process.env.PLATFORM_BASE_URL || 'http://127.0.0.1:5173';

(async () => {
  const fixture = createTestUsers(3); let browser;
  try {
    const seed = `import asyncio,sys
from app.core.database import async_session_maker
from app.db.models import User
from app.db.organization import Department
from app.db.access import UserRole
async def main():
    async with async_session_maker() as db:
        db.add(UserRole(user_id=sys.argv[1],role_id='access_admin'))
        for user_id,name in zip(sys.argv[1:],['Quản lý thử nghiệm','Nguyễn Hoàng Minh Anh có tên rất dài để kiểm tra hiển thị','Trần Minh Châu']):
            user=await db.get(User,user_id)
            user.full_name=name
        await db.commit()
asyncio.run(main())`;
    const result = spawnSync('docker', ['compose', 'exec', '-T', 'platform-backend', 'python', '-c', seed, ...fixture.accounts.map(user => user.id)], { cwd: path.resolve(__dirname, '../../..'), encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
    browser = await chromium.launch({ channel: 'msedge', headless: true });
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
    page.setDefaultTimeout(15000);
    page.setDefaultNavigationTimeout(60000);
    const errors = []; page.on('pageerror', error => errors.push(error.message));
    await page.route(/fonts\.(googleapis|gstatic)\.com/, route => route.abort());
    await page.goto(base + '/login');
    await page.getByLabel('Tên đăng nhập hoặc Email').fill(fixture.accounts[0].username);
    await page.getByLabel('Mật khẩu', { exact: true }).fill(fixture.accounts[0].password);
    await page.getByRole('button', { name: 'Đăng nhập hệ thống' }).click();
    await page.waitForURL('**/homepage');
    const token = await page.evaluate(() => localStorage.getItem('dtl_platform_token'));
    const api = async (method, url, data) => {
      const response = await page.request.fetch(base + '/api/' + url, { method, data, headers: { Authorization: `Bearer ${token}` } });
      assert.ok(response.ok(), await response.text()); return response.json();
    };
    await page.goto(base + '/tasks');
    {
      const form = page.locator('.task-quick-form');
      const name = form.getByLabel('Tên việc mới', { exact: true });
      let creations = 0;
      const countCreation = request => {
        if (request.method() === 'POST' && new URL(request.url()).pathname === '/api/tasks') creations++;
      };
      page.on('request', countCreation);
      await name.fill('QA click-only task');
      await name.press('Enter');
      await page.waitForTimeout(350);
      assert.equal(creations, 0, 'Enter in the title must not create a task');
      assert.equal(await name.inputValue(), 'QA click-only task');
      await form.getByRole('button', { name: 'Thêm công việc', exact: true }).click();
      await page.getByRole('status').filter({ hasText: 'Đã thêm công việc thành công.' }).waitFor();
      assert.equal(creations, 1, 'The add button creates exactly one task');
      page.off('request', countCreation);
    }
    const task = await api('POST', 'tasks', { title: 'QA picker task', assignee_id: fixture.accounts[1].id, follower_ids: [fixture.accounts[2].id] });
    await page.goto(base + '/tasks');
    await page.locator('.task-item').filter({ hasText: task.title }).getByRole('button', { name: /Sửa|Chi tiết|Mở/ }).first().click();
    const detail = page.getByRole('dialog', { name: 'Chi tiết công việc', exact: true });
    await detail.waitFor();
    const assignee = detail.locator('.people-picker').filter({ has: page.getByLabel('Giao cho', { exact: true }) });
    const followers = detail.locator('.people-picker').filter({ has: page.getByLabel('Người theo dõi', { exact: true }) });
    assert.equal(await assignee.locator('.people-chip button').count(), 1, 'Edit assignee can be cleared');
    assert.equal(await followers.locator('.people-chip button').count(), 1, 'Followers remain removable');
    // Add the old recipient as a follower while changing to the existing
    // follower. No chip is removed manually during either role swap.
    await assignee.getByLabel('Giao cho', { exact: true }).fill(fixture.accounts[2].username);
    await assignee.getByRole('option').filter({ hasText: '@' + fixture.accounts[2].username }).click();
    await followers.getByLabel('Người theo dõi', { exact: true }).fill(fixture.accounts[1].username);
    await followers.getByRole('option').filter({ hasText: '@' + fixture.accounts[1].username }).click();
    assert.equal(await followers.locator('.people-chip').count(), 2);
    const saveUrl = '**/api/tasks/' + task.id;
    let savedRepliesLost = 0;
    const loseReply = async route => {
      if (route.request().method() === 'PATCH' && savedRepliesLost === 0) {
        const response = await route.fetch();
        assert.equal(response.status(), 200);
        savedRepliesLost++;
        await route.abort('failed');
      } else await route.continue();
    };
    await page.route(saveUrl, loseReply);
    await detail.getByRole('button', { name: 'Lưu công việc', exact: true }).click();
    await detail.waitFor({ state: 'hidden' });
    await page.unroute(saveUrl, loseReply);
    assert.equal(savedRepliesLost, 1);
    let swapped = await api('GET', 'tasks/' + task.id);
    assert.equal(swapped.assignee_id, fixture.accounts[2].id);
    assert.deepEqual(swapped.followers.filter(user => user.id !== fixture.accounts[0].id).map(user => user.id), [fixture.accounts[1].id]);
    await page.locator('.task-item').filter({ hasText: task.title }).getByRole('button', { name: /Sửa|Chi tiết|Mở/ }).first().click();
    await detail.waitFor();
    await assignee.getByLabel('Giao cho', { exact: true }).fill(fixture.accounts[1].username);
    await assignee.getByRole('option').filter({ hasText: '@' + fixture.accounts[1].username }).click();
    await followers.getByLabel('Người theo dõi', { exact: true }).fill(fixture.accounts[2].username);
    await followers.getByRole('option').filter({ hasText: '@' + fixture.accounts[2].username }).click();
    await detail.getByRole('button', { name: 'Lưu công việc', exact: true }).click();
    await detail.waitFor({ state: 'hidden' });
    swapped = await api('GET', 'tasks/' + task.id);
    assert.equal(swapped.assignee_id, fixture.accounts[1].id);
    assert.deepEqual(swapped.followers.filter(user => user.id !== fixture.accounts[0].id).map(user => user.id), [fixture.accounts[2].id]);
    await page.locator('.task-item').filter({ hasText: task.title }).getByRole('button', { name: /Sửa|Chi tiết|Mở/ }).first().click();
    await detail.waitFor();
    await detail.screenshot({ path: path.resolve(__dirname, '../.browser-tools/people-picker-task.png') });
    const pickerBoxes = await detail.locator('.people-picker').evaluateAll(nodes => nodes.map(node => ({ x: node.getBoundingClientRect().x, y: node.getBoundingClientRect().y })));
    assert.equal(pickerBoxes[0].y, pickerBoxes[1].y, 'Desktop fields share one row');
    await page.setViewportSize({ width: 390, height: 844 });
    await detail.screenshot({ path: path.resolve(__dirname, '../.browser-tools/people-picker-mobile.png') });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    await assignee.locator('.people-chip button').click();
    assert.equal(await assignee.locator('.people-chip').count(), 0);
    await detail.getByRole('status').filter({ hasText: 'Để trống sẽ giao lại cho người tạo công việc.' }).waitFor();
    await followers.locator('.people-chip button').click();
    await detail.getByRole('button', { name: 'Lưu công việc', exact: true }).click();
    await detail.waitFor({ state: 'hidden' });
    const saved = await api('GET', 'tasks/' + task.id);
    assert.equal(saved.assignee_id, fixture.accounts[0].id);
    assert.equal(saved.followers.some(user => user.id === fixture.accounts[2].id), false);

    await page.locator('.task-item').filter({ hasText: task.title }).getByRole('button', { name: /Sửa|Chi tiết|Mở/ }).first().click();
    await detail.waitFor();
    assert.equal(await assignee.locator('.people-chip-name').innerText(), 'Quản lý thử nghiệm');
    await assignee.getByLabel('Giao cho', { exact: true }).fill(fixture.accounts[1].username);
    await assignee.getByRole('option').filter({ hasText: '@' + fixture.accounts[1].username }).waitFor();
    await assignee.getByLabel('Giao cho', { exact: true }).press('Enter');
    await detail.getByRole('button', { name: 'Lưu công việc', exact: true }).click();
    await detail.waitFor({ state: 'hidden' });
    assert.equal((await api('GET', 'tasks/' + task.id)).assignee_id, fixture.accounts[1].id);

    await page.locator('.task-item').filter({ hasText: task.title }).getByRole('button', { name: /Sửa|Chi tiết|Mở/ }).first().click();
    await detail.waitFor();
    await assignee.locator('.people-chip button').click();
    await assignee.getByLabel('Giao cho', { exact: true }).fill(fixture.accounts[2].username);
    await assignee.getByRole('option').filter({ hasText: '@' + fixture.accounts[2].username }).click();
    await detail.getByRole('button', { name: 'Lưu công việc', exact: true }).click();
    await detail.waitFor({ state: 'hidden' });
    assert.equal((await api('GET', 'tasks/' + task.id)).assignee_id, fixture.accounts[2].id, 'Explicit replacement wins over the creator fallback');

    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.goto(base + '/calendar');
    await page.getByRole('button', { name: 'Tạo sự kiện', exact: true }).click();
    const event = page.getByRole('dialog', { name: 'Tạo sự kiện mới', exact: true });
    const following = event.locator('.people-picker');
    await following.getByLabel('Người theo dõi', { exact: true }).fill(fixture.accounts[2].username);
    await following.getByRole('option').filter({ hasText: '@' + fixture.accounts[2].username }).click();
    assert.equal(await following.locator('.people-chip button').count(), 1);
    await following.getByLabel('Người theo dõi', { exact: true }).fill(fixture.accounts[1].username);
    await following.getByRole('option').filter({ hasText: '@' + fixture.accounts[1].username }).waitFor();
    await following.getByLabel('Người theo dõi', { exact: true }).press('Escape');
    assert.equal(await following.getByRole('listbox').count(), 0);
    assert.equal(await event.evaluate(node => node.open), true, 'Escape only closes the search results');
    await following.getByLabel('Người theo dõi', { exact: true }).fill('');
    await event.screenshot({ path: path.resolve(__dirname, '../.browser-tools/people-picker-event.png') });
    await following.locator('.people-chip button').click();
    assert.equal(await following.locator('.people-chip').count(), 0);
    assert.deepEqual(errors, []);
    console.log('PASS: Enter never creates a task; add button creates once; add-only role swaps preserve followers, including lost save replies; clearing recipient returns to creator; desktop/mobile layout.');
  } finally { await browser?.close(); fixture.cleanup(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
