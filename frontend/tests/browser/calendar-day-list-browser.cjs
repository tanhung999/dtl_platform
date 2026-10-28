// Isolated UI fixtures: API requests are intercepted; no production data is used.
const { chromium } = require('../.browser-tools/node_modules/playwright');
const assert = require('node:assert/strict');
const base = process.env.CALENDAR_TEST_URL || 'http://127.0.0.1:5173';
assert.match(base, /^http:\/\/(localhost|127\.0\.0\.1):\d+$/);

(async () => {
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  const errors = [], reads = [];
  page.on('pageerror', error => { errors.push(error.message); console.error(error.message); });
  const event = { id: 'event', user_id: 'qa', title: 'Họp kế hoạch', description: '', location: 'Phòng A',
    starts_at: '2026-10-28T09:00:00+07:00', ends_at: '2026-10-28T10:00:00+07:00', is_all_day: false,
    color: '#2563eb', recurrence: 'DAILY', created_at: '2026-10-01T00:00:00Z', updated_at: '2026-10-01T00:00:00Z' };
  const note = { ...event, id: 'note-event', title: 'Ghi chú nhiều ngày', scheduled_note_id: 'note', is_all_day: true,
    starts_at: '2026-10-27T00:00:00+07:00', ends_at: '2026-10-30T00:00:00+07:00' };
  const task = { id: 'task', title: 'Hoàn tất hồ sơ', description: '', due_date: '2026-10-28', due_time: '11:00',
    priority: 'HIGH', is_completed: true, version: 1, deadline_version: 1, can_edit: true, can_complete: true };
  let failDay = false;
  try {
    await page.route('**/__calendar_day_qa', route => route.fulfill({ contentType: 'text/html', body: `
      <html lang="vi"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1"></head><body><div id="root"></div><script type="module">
      import RefreshRuntime from '/@react-refresh';
      RefreshRuntime.injectIntoGlobalHook(window); window.$RefreshReg$=()=>{}; window.$RefreshSig$=()=>type=>type;
      window.__vite_plugin_react_preamble_installed__=true;
      const React = (await import('/node_modules/.vite/deps/react.js')).default;
      const client=await import('/node_modules/.vite/deps/react-dom_client.js');
      const createRoot=client.createRoot || client.default.createRoot;
      const {CalendarPage}=await import('/src/features/calendar/CalendarPage.tsx');
      const {TasksProvider}=await import('/src/features/tasks/context/TasksContext.tsx');
      await import('/src/index.css'); await import('/src/themes.css');
      const {renderThemeStyles}=await import('/src/theme/catalog.ts');
      const themeStyle=document.createElement('style'); themeStyle.textContent=renderThemeStyles(); document.head.appendChild(themeStyle);
      const {initialTheme}=await import('/src/theme/runtime.ts'); initialTheme();
      localStorage.setItem('dtl_platform_user', JSON.stringify({id:'qa'}));
      createRoot(document.getElementById('root')).render(React.createElement(TasksProvider,{collectionEnabled:false},React.createElement(CalendarPage,{initialDate:new Date('2026-10-28T00:00:00Z'),userId:'qa',userName:'QA'})));
      </script></body></html>` }));
    await page.route('**/api/**', route => {
      const url = new URL(route.request().url()); reads.push(url);
      const dayRange = url.searchParams.get('start') === '2026-10-27T17:00:00.000Z';
      if (failDay && dayRange && url.pathname.endsWith('/collection')) return route.fulfill({ status: 503, json: { detail: 'Không tải được lịch thử nghiệm.' } });
      let json = {};
      if (url.pathname === '/api/calendar/events/collection') {
        const start = Date.parse(url.searchParams.get('start')), end = Date.parse(url.searchParams.get('end'));
        const items = [event, note].filter(item => Date.parse(item.starts_at) < end && Date.parse(item.ends_at) > start)
          .filter(item => item.scheduled_note_id ? url.searchParams.get('include_notes') === 'true' : url.searchParams.get('include_events') === 'true');
        json = { items, total: items.length, event_total: items.filter(item => !item.scheduled_note_id).length,
          note_total: items.filter(item => item.scheduled_note_id).length, truncated: false };
      } else if (url.pathname === '/api/tasks/calendar/page') json = { items: url.searchParams.get('start') <= task.due_date && url.searchParams.get('end') > task.due_date ? [task] : [], total: 1, truncated: false };
      else if (url.pathname === '/api/calendar/events/event') json = event;
      return route.fulfill({ json });
    });
    await page.goto(base + '/__calendar_day_qa');
    const openDay = () => page.locator('.calendar-week-day button').filter({ hasText: /^28$/ }).click();
    await openDay();
    const dialog = page.locator('.calendar-day-dialog'); await dialog.waitFor();
    await dialog.getByText(event.title, { exact: true }).waitFor();
    await dialog.getByText(note.title, { exact: true }).waitFor();
    await dialog.getByText(task.title, { exact: true }).waitFor();
    assert.equal(await page.locator('.calendar-event-dialog').count(), 0);
    assert.match(await dialog.locator('.is-event .calendar-day-item-meta').innerText(), /09:00.*10:00/);
    assert.match(await dialog.locator('.is-note .calendar-day-item-meta').innerText(), /Cả ngày/);
    assert.equal(await dialog.locator('.is-completed').count(), 1);
    assert.ok(reads.some(url => url.pathname.endsWith('/collection') && url.searchParams.get('start') === '2026-10-27T17:00:00.000Z'));
    await page.screenshot({ path: '../.audit-backups/calendar-day-desktop.png' });
    await page.setViewportSize({ width: 390, height: 844 });
    assert.ok(await dialog.evaluate(element => element.getBoundingClientRect().width <= innerWidth));
    assert.ok(await dialog.evaluate(element => element.scrollWidth <= element.clientWidth + 1));
    await page.screenshot({ path: '../.audit-backups/calendar-day-mobile.png' });
    await page.keyboard.press('Escape'); await dialog.waitFor({ state: 'detached' });
    await page.setViewportSize({ width: 1440, height: 1000 });
    await openDay(); await dialog.getByText(event.title, { exact: true }).click();
    await page.locator('.calendar-event-dialog').waitFor();
    assert.equal(await dialog.count(), 0);
    const detail = page.locator('.calendar-event-dialog');
    const moveButton = detail.getByRole('button', { name: 'Dời lịch / Thông báo', exact: true });
    assert.ok(await moveButton.isEnabled(), 'Owner can reschedule an event from a legacy API without capability fields');
    await moveButton.click();
    const moveDialog = page.getByRole('dialog', { name: 'Dời lịch / Thông báo', exact: true });
    await moveDialog.waitFor();
    await moveDialog.getByRole('button', { name: 'Đóng dời lịch', exact: true }).click();
    await page.locator('.calendar-event-dialog').getByRole('button', { name: 'Đóng', exact: true }).click();
    for (const restricted of [{ can_edit: false, user_id: 'qa' }, { can_edit: undefined, user_id: 'other-owner' }]) {
      Object.assign(event, restricted);
      await openDay(); await dialog.getByText(event.title, { exact: true }).click();
      await detail.waitFor();
      assert.ok(await moveButton.isDisabled(), 'Explicit denial and another owner remain read-only');
      await detail.getByRole('button', { name: 'Đóng', exact: true }).click();
    }
    Object.assign(event, { can_edit: undefined, user_id: 'qa' });
    await page.getByRole('checkbox', { name: 'Hiện ghi chú', exact: true }).uncheck();
    await openDay();
    await dialog.getByText(event.title, { exact: true }).waitFor();
    assert.equal(await dialog.locator('.is-note').count(), 0);
    await page.keyboard.press('Escape');
    await page.getByRole('button', { name: 'Tháng', exact: true }).click();
    await page.locator('.calendar-month-cell[data-date="2026-10-26"] .calendar-day-number').click();
    await dialog.locator('.calendar-day-empty').waitFor();
    assert.equal(await page.locator('.calendar-event-dialog').count(), 0);
    await page.keyboard.press('Escape');
    failDay = true;
    await page.locator('.calendar-month-cell[data-date="2026-10-28"] .calendar-day-number').click();
    await dialog.getByText('Không tải được lịch thử nghiệm.', { exact: true }).waitFor();
    assert.equal(await dialog.locator('.calendar-day-empty').count(), 0);
    failDay = false;
    await dialog.getByRole('button', { name: 'Thử lại', exact: true }).click();
    await dialog.locator('.calendar-error-state').waitFor({ state: 'detached' });
    assert.deepEqual(errors, []);
    console.log('PASS week/month day list, daily query, multi-day note, completion, details, filters, empty day, error/retry, Escape and mobile layout');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
