const { chromium } = require('../.browser-tools/node_modules/playwright');
const { createTestUsers } = require('../support/test-users.cjs');
const { randomUUID } = require('node:crypto');
const assert = require('node:assert/strict');

(async () => {
  const fixture = createTestUsers(1); let browser, release;
  try {
    browser = await chromium.launch({ channel: 'msedge', headless: true });
    const page = await browser.newPage(); page.setDefaultTimeout(15000);
    const errors = []; page.on('pageerror', error => errors.push(error.message));
    await page.route(/^https:\/\/fonts\.(googleapis|gstatic)\.com\//, route => route.abort());
    await page.goto('http://127.0.0.1:5173'); await page.locator('#username').fill(fixture.accounts[0].username); await page.locator('#password').fill(fixture.accounts[0].password); await page.locator('button[type=submit]').click(); await page.locator('.calendar-widget').waitFor();
    const token = await page.evaluate(() => localStorage.getItem('dtl_platform_token'));
    const api = async (method, path, data) => { const response = await page.request.fetch('http://127.0.0.1:5173/api/' + path, { method, data, headers: { Authorization: 'Bearer ' + token } }); assert.ok(response.ok(), await response.text()); return response.json(); };
    const show = value => page.evaluate(detail => window.dispatchEvent(new CustomEvent('schedule:moved', { detail })), value);
    for (const failure of [false, true]) {
      const a = await api('POST', 'tasks', { title: 'Undo A', due_date: '2050-01-01' });
      const b = await api('POST', 'tasks', { title: 'Undo B', due_date: '2050-01-01' });
      const first = await api('POST', 'schedule-changes/task/' + a.id, { request_id: randomUUID(), expected_version: a.version, due_date: '2050-01-02' }); await show(first);
      let reached; const waiting = new Promise(resolve => { reached = resolve; }); const gate = new Promise(resolve => { release = resolve; });
      const route = '**/api/schedule-changes/records/' + first.id + '/undo';
      await page.route(route, async interception => { const response = failure ? undefined : await interception.fetch(); reached(); await gate;
        if (failure) await interception.fulfill({ status: 409, contentType: 'application/json', body: JSON.stringify({ detail: 'Old failure must not replace the new toast' }) });
        else await interception.fulfill({ response });
      });
      await page.locator('.reschedule-toast').getByRole('button', { name: 'Hoàn tác', exact: true }).click(); await waiting;
      const second = await api('POST', 'schedule-changes/task/' + b.id, { request_id: randomUUID(), expected_version: b.version, due_date: '2050-02-02' }); await show(second);
      const toast = page.locator('.reschedule-toast'); await toast.filter({ hasText: '02/02/2050' }).waitFor();
      const settled = page.waitForResponse(value => value.url().endsWith('/records/' + first.id + '/undo')); release(); await settled;
      // Barrier: the server response has arrived; UI must still belong to B, including its button.
      await page.waitForFunction(() => document.querySelector('.reschedule-toast')?.textContent.includes('02/02/2050'));
      await toast.getByRole('button', { name: 'Hoàn tác', exact: true }).click(); await toast.waitFor({ state: 'hidden' });
      assert.equal((await api('GET', 'tasks/' + b.id)).due_date, '2050-01-01'); await page.unroute(route);
    }
    assert.deepEqual(errors, []); console.log('PASS: delayed Undo success and failure never remove/replace a newer toast; newer Undo still works.');
  } finally { release?.(); if (browser) await browser.close(); fixture.cleanup(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
