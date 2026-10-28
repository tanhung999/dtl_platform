// Isolated CalendarWidget fixture; no real accounts or backend writes.
const { chromium } = require('../.browser-tools/node_modules/playwright');
const assert = require('node:assert/strict');
const catalog = require('../../src/theme/catalog.json');
const base = process.env.CALENDAR_TEST_URL || 'http://127.0.0.1:5173';
assert.match(base, /^http:\/\/(localhost|127\.0\.0\.1):\d+$/);
(async () => {
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  const page = await browser.newPage({ viewport: { width: 1000, height: 900 } });
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  try {
    await page.route('**/__home_calendar_qa', route => route.fulfill({ contentType: 'text/html', body: `
      <html lang="vi"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1"></head><body><div id="root"></div><script type="module">
      import RefreshRuntime from '/@react-refresh'; RefreshRuntime.injectIntoGlobalHook(window);
      window.$RefreshReg$=()=>{};window.$RefreshSig$=()=>type=>type;window.__vite_plugin_react_preamble_installed__=true;
      const React=(await import('/node_modules/.vite/deps/react.js')).default;
      const client=await import('/node_modules/.vite/deps/react-dom_client.js');const createRoot=client.createRoot||client.default.createRoot;
      const {CalendarWidget}=await import('/src/features/calendar/CalendarWidget.tsx');
      const {TasksProvider}=await import('/src/features/tasks/context/TasksContext.tsx');
      await import('/src/index.css');await import('/src/themes.css');
      const {renderThemeStyles}=await import('/src/theme/catalog.ts');const style=document.createElement('style');style.textContent=renderThemeStyles();document.head.appendChild(style);
      const runtime=await import('/src/theme/runtime.ts');runtime.initialTheme();window.qaTheme=runtime.applyTheme;
      createRoot(document.getElementById('root')).render(React.createElement(TasksProvider,{collectionEnabled:false},React.createElement(CalendarWidget,{onOpenCalendar:()=>{}})));
      </script></body></html>` }));
    await page.route('**/api/**', route => {
      const path = new URL(route.request().url()).pathname;
      return route.fulfill({ json: path.endsWith('/collection') ? { items: [], total: 0, event_total: 0, note_total: 0, truncated: false }
        : path.includes('/tasks/calendar/') ? { items: [], total: 0, truncated: false } : {} });
    });
    await page.goto(base + '/__home_calendar_qa');
    const selected = page.locator('.calendar-widget-week .is-selected'); await selected.waitFor();
    const colors = locator => locator.evaluate(node => ({ bg: getComputedStyle(node).backgroundColor, fg: getComputedStyle(node).color }));
    for (const theme of Object.keys(catalog.themes)) {
      await page.mouse.move(990, 890);
      await page.evaluate(theme => window.qaTheme(theme), theme);
      const normal = await colors(selected);
      await selected.hover();
      assert.deepEqual(await colors(selected), normal, `Selected date changes to an unreadable hover in ${theme}`);
      await page.locator('.calendar-widget-week button:not(.is-selected)').first().hover();
      assert.deepEqual(await colors(selected), normal);
    }
    await page.evaluate(() => window.qaTheme('light'));
    await selected.hover();
    await page.screenshot({ path: '../.audit-backups/home-calendar-hover.png' });
    await page.setViewportSize({ width: 390, height: 844 });
    assert.ok(await page.locator('.calendar-widget-week').evaluate(node => node.scrollWidth <= node.clientWidth + 1));
    assert.deepEqual(errors, []);
    console.log('PASS homepage selected-day hover preserves readable colors in every theme; mobile layout fits');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
