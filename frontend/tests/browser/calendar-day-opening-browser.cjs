const { chromium } = require('../.browser-tools/node_modules/playwright');
const { createTestUsers } = require('../support/test-users.cjs');
const assert = require('node:assert/strict');
const base = process.env.PLATFORM_BASE_URL || 'http://127.0.0.1:5173';

(async () => {
  const fixture = createTestUsers(1);
  let browser;
  try {
    browser = await chromium.launch({ channel: 'msedge', headless: true });
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
    page.setDefaultTimeout(15000);
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.route(/fonts\.(googleapis|gstatic)\.com/, route => route.abort());
    await page.goto(base + '/login');
    await page.getByLabel('Tên đăng nhập hoặc Email').fill(fixture.accounts[0].username);
    await page.getByLabel('Mật khẩu', { exact: true }).fill(fixture.accounts[0].password);
    await page.getByRole('button', { name: 'Đăng nhập hệ thống' }).click();
    await page.waitForURL('**/homepage');
    const token = await page.evaluate(() => localStorage.getItem('dtl_platform_token'));
    const api = async (method, endpoint, data) => {
      const response = await page.request.fetch(base + '/api/' + endpoint, { method, headers: { Authorization: `Bearer ${token}` }, data });
      assert.ok(response.ok(), await response.text());
      return response.json();
    };
    const day = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Ho_Chi_Minh', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
    const schedule = { starts_at: day + 'T09:00:00+07:00', ends_at: day + 'T10:00:00+07:00', is_all_day: false };
    const first = await api('POST', 'calendar/events', { title: 'QA open event A', ...schedule });
    const second = await api('POST', 'calendar/events', { title: 'QA open event B', ...schedule });
    const note = await api('POST', 'notes', { title: 'QA open note', calendar_schedule: schedule });
    const task = await api('POST', 'tasks', { title: 'QA open task', due_date: day });
    const list = page.locator('.calendar-day-dialog');
    const row = title => list.getByRole('button').filter({ hasText: title });
    const showDay = async () => {
      await page.locator('.calendar-week-day button').filter({ hasText: new RegExp(`^${Number(day.slice(-2))}$`) }).click();
      await row(first.title).waitFor();
    };
    await page.goto(`${base}/calendar?date=${day}`);
    await showDay();
    const cases = [
      { title: first.title, endpoint: 'calendar/events/' + first.id, detail: 'Chi tiết sự kiện', close: 'Đóng' },
      { title: note.title, endpoint: 'calendar/events/' + note.calendar_schedule.event_id, detail: 'Ghi chú', close: 'Đóng ghi chú' },
      { title: task.title, endpoint: 'tasks/' + task.id, detail: 'Chi tiết công việc', close: 'Đóng công việc' },
    ];
    const buttonCount = await list.getByRole('button').count();
    for (const item of cases) {
      const url = '**/api/' + item.endpoint;
      const fail = route => route.fulfill({ status: 404, contentType: 'application/json', body: JSON.stringify({ detail: 'Mục này không còn khả dụng.' }) });
      await page.route(url, fail);
      await row(item.title).click();
      await row(item.title).getByRole('alert').filter({ hasText: 'Bấm lại mục này để thử lại.' }).waitFor();
      assert.equal(await list.getByRole('button').count(), buttonCount, 'No retry button is added');
      assert.equal(await row(item.title).getAttribute('aria-busy'), 'false');
      await page.unroute(url, fail);
      await row(item.title).click();
      const detail = page.getByRole('dialog', { name: item.detail, exact: true });
      await detail.waitFor();
      await detail.getByRole('button', { name: item.close, exact: true }).click();
      assert.equal(await list.evaluate(node => node.open), true);
    }

    // Delay an actual response; release it only after closing or changing selection.
    const delay = async endpoint => {
      const payload = await api('GET', endpoint);
      let release, started, finished, count = 0;
      const gate = new Promise(resolve => { release = resolve; });
      const intercepted = new Promise(resolve => { started = resolve; });
      const completed = new Promise(resolve => { finished = resolve; });
      const url = '**/api/' + endpoint;
      const handler = async route => {
        count++; started(); await gate;
        try { await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(payload) }); }
        finally { finished(); }
      };
      await page.route(url, handler);
      return { intercepted, count: () => count, release: async () => { release(); await completed; await page.unroute(url, handler); await page.waitForTimeout(150); } };
    };
    for (const [index, item] of cases.entries()) {
      if (index === 1) await page.setViewportSize({ width: 390, height: 844 });
      const delayed = await delay(item.endpoint);
      await row(item.title).click();
      await delayed.intercepted;
      await row(item.title).getByRole('status').filter({ hasText: 'Đang mở chi tiết…' }).waitFor();
      await row(item.title).evaluate(node => { node.click(); node.click(); });
      await page.waitForTimeout(100);
      assert.equal(delayed.count(), 1, 'Repeated clicks do not duplicate requests');
      if (index === 1) await page.keyboard.press('Escape');
      else await list.getByRole('button', { name: 'Đóng danh sách trong ngày', exact: true }).click();
      await showDay();
      await delayed.release();
      assert.equal(await page.getByRole('dialog', { name: item.detail, exact: true }).count(), 0, 'Closed request never reopens detail');
      assert.equal(await list.locator('.calendar-day-opening').count(), 0, 'New list has no stale status');
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    }
    await page.setViewportSize({ width: 1440, height: 1000 });
    for (const item of [cases[0], cases[2]]) {
      const delayed = await delay(item.endpoint);
      await row(item.title).click(); await delayed.intercepted;
      await row(second.title).click();
      const detail = page.getByRole('dialog', { name: 'Chi tiết sự kiện', exact: true });
      await detail.getByLabel('Tên sự kiện').waitFor();
      assert.equal(await detail.getByLabel('Tên sự kiện').inputValue(), second.title);
      await delayed.release();
      assert.equal(await detail.getByLabel('Tên sự kiện').inputValue(), second.title, 'Latest selection wins across item types');
      assert.equal(await page.getByRole('dialog', { name: 'Chi tiết công việc', exact: true }).count(), 0);
      await detail.getByRole('button', { name: 'Đóng', exact: true }).click();
    }
    const delayed = await delay(cases[0].endpoint);
    await row(first.title).click(); await delayed.intercepted;
    await list.getByRole('button', { name: 'Tạo sự kiện', exact: true }).click();
    await page.getByRole('dialog', { name: 'Tạo sự kiện mới', exact: true }).waitFor();
    await delayed.release();
    assert.equal(await page.getByRole('dialog', { name: 'Chi tiết sự kiện', exact: true }).count(), 0);
    assert.deepEqual(errors, []);
    console.log('PASS: event/note/task inline errors and row retry; no new buttons; pending deduplication; close/Escape/reopen cancellation; latest item wins; create cancels pending detail; mobile layout.');
  } finally {
    await browser?.close(); fixture.cleanup();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
