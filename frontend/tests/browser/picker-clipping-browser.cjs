const { chromium } = require('../.browser-tools/node_modules/playwright');
const { createTestUsers } = require('../support/test-users.cjs');
const assert = require('node:assert/strict');
(async () => {
  const fixture = createTestUsers(1); let browser;
  try {
    browser = await chromium.launch({ channel: 'msedge', headless: true });
    const page = await browser.newPage({ viewport: { width: 854, height: 850 } });
    await page.route(/fonts\.(googleapis|gstatic)\.com/, route => route.abort());
    await page.goto('http://127.0.0.1:5173');
    await page.getByLabel('Tên đăng nhập hoặc Email').fill(fixture.accounts[0].username);
    await page.getByLabel('Mật khẩu', { exact: true }).fill(fixture.accounts[0].password);
    await page.getByRole('button', { name: 'Đăng nhập hệ thống' }).click();
    await page.locator('.calendar-widget').waitFor();
    const check = async (scope) => {
      const pickers = scope.locator('.app-date-picker, .app-time-picker');
      for (let i = 0; i < await pickers.count(); i++) {
        const picker = pickers.nth(i);
        await picker.locator('button').first().click();
        const panel = picker.locator('.app-date-popover, .app-time-popover');
        await panel.waitFor({ state: 'visible' });
        const geometry = await panel.evaluate(el => {
          const r = el.getBoundingClientRect();
          const points = [[r.left+5,r.top+5],[r.right-5,r.bottom-5]];
          return { topLayer: el.matches(':popover-open'), inside: r.left>=0 && r.top>=0 && r.right<=innerWidth && r.bottom<=innerHeight,
            clickable: points.every(([x,y]) => el.contains(document.elementFromPoint(x,y))) };
        });
        assert.deepEqual(geometry, { topLayer:true, inside:true, clickable:true });
        if (await picker.locator('.app-time-popover').count()) {
          await panel.getByLabel('Chọn giờ', { exact:true }).selectOption('09');
          await panel.getByLabel('Chọn phút', { exact:true }).selectOption('30');
          await panel.getByRole('button', {name:'Xong',exact:true}).click();
        } else {
          await panel.locator('.app-date-grid button:not([disabled])').nth(20).click();
        }
        await panel.waitFor({ state:'hidden' });
      }
    };
    await check(page.locator('.tasks-widget .task-quick-form'));
    await page.getByTitle('Tạo ghi chú mới', { exact:true }).click();
    const note = page.getByRole('dialog', { name:'Ghi chú', exact:true });
    await note.getByPlaceholder('Tiêu đề ghi chú...').fill('Picker clipping QA');
    await note.getByRole('button', {name:'Gắn vào lịch',exact:true}).click();
    for (const viewport of [{width:854,height:850},{width:390,height:650}]) {
      await page.setViewportSize(viewport);
      await check(note);
      assert.equal(await note.locator('.note-schedule-fields').evaluate(el => getComputedStyle(el).backgroundColor), 'rgba(255, 255, 255, 0.333)');
    }
    await page.setViewportSize({width:854,height:850});
    const response = page.waitForResponse(r => /\/api\/notes$/.test(r.url()) && r.request().method()==='POST');
    await note.getByRole('button',{name:'Lưu ghi chú',exact:true}).click();
    assert.equal((await response).status(),201);
    await page.locator('.note-card').filter({hasText:'Picker clipping QA'}).click();
    await note.getByRole('button',{name:'Dời lịch / Thông báo',exact:true}).click();
    const move = page.locator('.reschedule-dialog');
    await check(move);
    await move.getByRole('button',{name:'Đóng dời lịch',exact:true}).click();
    await note.getByRole('button',{name:'Đóng ghi chú',exact:true}).click();
    await page.locator('.calendar-widget').getByRole('button',{name:'Tạo sự kiện',exact:true}).click();
    await check(page.getByRole('dialog',{name:'Tạo sự kiện mới',exact:true}));
    console.log('PASS: picker top layer, viewport bounds, hit testing and selection in Tasks, Note, nested Reschedule and Event forms; desktop/mobile.');
  } finally { if(browser) await browser.close(); fixture.cleanup(); }
})().catch(e => { console.error(e); process.exitCode=1; });
