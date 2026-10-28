// Mocked shared-calendar API only; no production or local database writes.
const { chromium } = require('../.browser-tools/node_modules/playwright');
const assert = require('node:assert/strict');
const base = process.env.CALENDAR_TEST_URL || 'http://127.0.0.1:5173';
assert.match(base, /^http:\/\/(localhost|127\.0\.0\.1):\d+$/);
(async () => {
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  const errors = [], requests = [];
  page.on('pageerror', error => errors.push(error.message));
  const items = [
    { id: 'event', kind: 'event', title: 'Cuộc họp được chia sẻ', starts_at: '2026-10-28T09:00:00+07:00', ends_at: '2026-10-28T10:00:00+07:00', recurrence: 'DAILY', content: 'Nội dung chỉ xem' },
    { id: 'note', note_id: 'note', kind: 'note', title: 'Ghi chú nhiều ngày', starts_at: '2026-10-27T00:00:00+07:00', ends_at: '2026-10-30T00:00:00+07:00', is_all_day: true },
    { id: 'task', kind: 'task', title: 'Công việc đã hoàn thành', due_date: '2026-10-28', due_time: '11:00', priority: 'URGENT', is_completed: true },
  ];
  let revoked = false;
  try {
    await page.route('**/__shared_day_qa', route => route.fulfill({ contentType: 'text/html', body: `
      <html lang="vi"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1"></head><body><div id="root"></div><script type="module">
      import RefreshRuntime from '/@react-refresh'; RefreshRuntime.injectIntoGlobalHook(window);
      window.$RefreshReg$=()=>{}; window.$RefreshSig$=()=>type=>type; window.__vite_plugin_react_preamble_installed__=true;
      const React=(await import('/node_modules/.vite/deps/react.js')).default;
      const client=await import('/node_modules/.vite/deps/react-dom_client.js'); const createRoot=client.createRoot||client.default.createRoot;
      const {SharedCalendarView}=await import('/src/features/calendar-sharing/SharedCalendarView.tsx');
      const {TasksProvider}=await import('/src/features/tasks/context/TasksContext.tsx');
      await import('/src/index.css'); await import('/src/themes.css');
      await import('/src/features/calendar/calendar.css'); await import('/src/features/calendar-sharing/calendar-sharing.css');
      const {renderThemeStyles}=await import('/src/theme/catalog.ts'); const style=document.createElement('style');style.textContent=renderThemeStyles();document.head.appendChild(style);
      (await import('/src/theme/runtime.ts')).initialTheme();
      function Fixture(){
        const [share,setShare]=React.useState({id:'share',owner_id:'owner',viewer_id:'qa',name:'Người chia sẻ',username:'owner',version:1,share_events:true,share_notes:true,share_tasks:true});
        const [epoch,setEpoch]=React.useState(0),[pending,setPending]=React.useState(false);
        window.qaShare=changes=>setShare(value=>({...value,...changes,version:value.version+1}));
        window.qaPending=setPending;window.qaVerify=()=>setEpoch(value=>value+1);
        return React.createElement(SharedCalendarView,{share,revision:0,accessEpoch:epoch,accessPending:pending,navigation:null,initialDate:React.useMemo(()=>new Date('2026-10-28T00:00:00Z'),[])});
      }
      createRoot(document.getElementById('root')).render(React.createElement(TasksProvider,{collectionEnabled:false},React.createElement(Fixture)));
      </script></body></html>` }));
    await page.route('**/api/**', route => {
      const request = route.request(), url = new URL(request.url()); requests.push({ path: url.pathname, method: request.method(), start: url.searchParams.get('start') });
      if (url.pathname === '/api/calendar-sharing/view/owner') {
        if (revoked) return route.fulfill({ status: 403, json: { detail: 'Quyền xem lịch đã bị thu hồi.' } });
        const start = Date.parse(url.searchParams.get('start')), end = Date.parse(url.searchParams.get('end'));
        const values = items.filter(item => item.kind === 'task' ? Date.parse(item.due_date + 'T00:00:00+07:00') >= start && Date.parse(item.due_date + 'T00:00:00+07:00') < end : Date.parse(item.starts_at) < end && Date.parse(item.ends_at) > start);
        const offset = Number(url.searchParams.get('offset'));
        return route.fulfill({ json: { items: values.slice(offset, offset + 2), total: values.length, truncated: offset + 2 < values.length, share_events: true, share_notes: true, share_tasks: true } });
      }
      if (url.pathname.startsWith('/api/calendar-sharing/view/owner/')) return route.fulfill({ json: items.find(item => url.pathname.endsWith('/' + item.id)) });
      return route.fulfill({ json: {} });
    });
    await page.goto(base + '/__shared_day_qa');
    const openDay = () => page.locator('.calendar-week-day button').filter({ hasText: /^28$/ }).click();
    await openDay(); const dialog = page.locator('.shared-day-dialog');
    await dialog.getByText(items[0].title, { exact: true }).waitFor();
    await dialog.getByText(items[1].title, { exact: true }).waitFor();
    await dialog.getByRole('button', { name: 'Tải thêm', exact: true }).click();
    await dialog.getByText(items[2].title, { exact: true }).waitFor();
    assert.equal(await dialog.locator('.is-completed').count(), 1);
    assert.equal(await dialog.locator('input, textarea').count(), 0);
    assert.equal(await dialog.getByRole('button', { name: /Tạo|Dời lịch|Áp dụng|Xóa/ }).count(), 0);
    assert.ok(requests.some(request => request.start === '2026-10-27T17:00:00.000Z'));
    await page.setViewportSize({ width: 390, height: 844 });
    assert.ok(await dialog.evaluate(node => node.scrollWidth <= node.clientWidth + 1));
    await page.screenshot({ path: '../.audit-backups/shared-day-mobile.png' });
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.evaluate(() => window.qaPending(true));
    await dialog.getByText(items[0].title, { exact: true }).waitFor({ state: 'detached' });
    await page.evaluate(() => { window.qaShare({ share_notes: false }); window.qaVerify(); window.qaPending(false); });
    await dialog.getByText(items[0].title, { exact: true }).waitFor();
    assert.equal(await dialog.locator('.is-note').count(), 0);
    await dialog.getByText(items[0].title, { exact: true }).click();
    const detail = page.getByRole('dialog', { name: 'Sự kiện · Chỉ xem', exact: true });
    await detail.getByText('Nội dung chỉ xem', { exact: true }).waitFor();
    assert.equal(await dialog.count(), 0);
    await detail.getByRole('button', { name: 'Đóng', exact: true }).click();
    await page.getByRole('button', { name: 'Tháng', exact: true }).click();
    await page.locator('[data-date="2026-10-26"] .shared-day-heading').click();
    await dialog.locator('.calendar-day-empty').waitFor();
    await page.keyboard.press('Escape');
    await page.locator('[data-date="2026-10-28"] .shared-day-heading').click();
    await dialog.getByText(items[0].title, { exact: true }).waitFor();
    revoked = true; await page.evaluate(() => window.qaVerify());
    await dialog.getByText('Quyền xem lịch đã bị thu hồi.', { exact: true }).waitFor();
    assert.equal(await dialog.locator('.calendar-day-item').count(), 0);
    assert.equal(await dialog.locator('.calendar-day-empty').count(), 0);
    assert.ok(requests.every(request => request.method === 'GET'));
    assert.ok(requests.filter(request => request.path.startsWith('/api/calendar')).every(request => request.path.startsWith('/api/calendar-sharing/')));
    assert.deepEqual(errors, []);
    console.log('PASS shared day list: week/month, daily query, pagination, read-only detail, mobile, scope reduction, permission recheck and revoked access');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
