/* Optional browser QA against the local Docker stack. Run with Playwright installed:
 * npm install --prefix tests/.browser-tools --no-save --package-lock=false playwright
 * node tests/calendar-browser.cjs
 * Uses installed Edge (override CALENDAR_BROWSER_CHANNEL if needed).
 * Creates marked test events and deletes them in finally; existing events are untouched.
 */
const { chromium } = require('./.browser-tools/node_modules/playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

async function main() {
  const base = process.env.CALENDAR_TEST_URL || 'http://localhost:5173';
  const artifacts = path.join(__dirname, 'artifacts');
  fs.mkdirSync(artifacts, { recursive: true });
  const browser = await chromium.launch({ channel: process.env.CALENDAR_BROWSER_CHANNEL || 'msedge', headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, locale: 'vi-VN', timezoneId: 'America/New_York' });
  const page = await context.newPage();
  const failures = [];
  page.on('pageerror', error => failures.push(error.message));
  const eventIds = [];
  let token;
  const marker = `[QA ${Date.now()}]`;

  async function saveDialog() {
    const responsePromise = page.waitForResponse(response => response.url().includes('/api/calendar/events') && ['POST', 'PUT'].includes(response.request().method()));
    await page.getByRole('button', { name: 'Lưu sự kiện', exact: true }).click();
    const response = await responsePromise;
    assert.ok(response.ok(), `Save event: HTTP ${response.status()}`);
    const event = await response.json();
    if (!eventIds.includes(event.id)) eventIds.push(event.id);
    await page.getByRole('dialog').waitFor({ state: 'hidden' });
    return event;
  }

  try {
    console.log('Browser QA: sign in and check Workspace widget');
    await page.goto(base);
    await page.getByLabel('Tên đăng nhập hoặc Email').fill(process.env.CALENDAR_TEST_USERNAME || 'admin');
    await page.getByLabel('Mật khẩu', { exact: true }).fill(process.env.CALENDAR_TEST_PASSWORD || 'admin123');
    await page.getByRole('button', { name: 'Đăng nhập hệ thống' }).click();
    await page.locator('.calendar-widget').waitFor();
    token = await page.evaluate(() => localStorage.getItem('dtl_platform_token'));
    const todo = await page.locator('.col-notes > .widget-box').first().boundingBox();
    const widget = await page.locator('.calendar-widget').boundingBox();
    assert.ok(todo && widget && widget.y > todo.y + todo.height, 'Calendar widget sits below Notes');
    assert.equal(Math.round(todo.x), Math.round(widget.x));

    await page.locator('.calendar-widget').getByRole('button', { name: 'Tạo sự kiện', exact: true }).click();
    await page.getByLabel('Tên sự kiện').fill(`${marker} Họp kế hoạch tuần`);
    await page.getByLabel('Giờ bắt đầu').fill('09:00');
    await page.getByLabel('Giờ kết thúc').fill('10:00');
    await page.getByLabel('Địa điểm').fill('Phòng họp DTL');
    await page.getByLabel('Mô tả').fill('Kiểm thử tạo lịch cá nhân.');
    const timed = await saveDialog();
    console.log('Browser QA: create timed, overlapping and all-day events');
    await page.locator('.calendar-widget-event').filter({ hasText: `${marker} Họp kế hoạch tuần` }).waitFor();

    await page.getByRole('button', { name: 'Mở lịch đầy đủ' }).click();
    await page.locator('.calendar-week').waitFor();
    assert.equal(await page.locator('.calendar-mobile-create').isVisible(), false);
    await page.getByRole('button', { name: 'Tạo sự kiện', exact: true }).click();
    await page.getByLabel('Tên sự kiện').fill(`${marker} Lịch trùng giờ`);
    await page.getByLabel('Giờ bắt đầu').fill('09:30');
    await page.getByLabel('Giờ kết thúc').fill('10:30');
    await saveDialog();
    await page.getByRole('button', { name: 'Tạo sự kiện', exact: true }).click();
    await page.getByLabel('Tên sự kiện').fill(`${marker} Ngày làm việc cá nhân`);
    await page.getByRole('checkbox', { name: 'Sự kiện cả ngày', exact: true }).check();
    await page.getByRole('dialog').getByLabel('Màu trạng thái sự kiện').waitFor();
    const allDay = await saveDialog();
    assert.equal(allDay.is_all_day, true);
    assert.equal(new Date(allDay.ends_at) - new Date(allDay.starts_at), 86400000);
    const allDayCard = page.locator('.calendar-week-all-day .calendar-event').filter({ hasText: `${marker} Ngày làm việc cá nhân` });
    await allDayCard.waitFor();
    assert.ok((await allDayCard.innerText()).includes('Cả ngày'));
    await page.locator('.calendar-time-column .calendar-event').filter({ hasText: `${marker} Lịch trùng giờ` }).waitFor();
    const overlapping = page.locator('.calendar-time-column .calendar-event').filter({ hasText: `${marker} Họp kế hoạch tuần` });
    const eventBox = await overlapping.boundingBox();
    const columnBox = await overlapping.evaluate(el => { const rect = el.closest('.calendar-time-column').getBoundingClientRect(); return { width: rect.width }; });
    assert.ok(eventBox.width < columnBox.width * 0.65, 'Overlapping events have separate lanes');
    await page.screenshot({ path: path.join(artifacts, 'calendar-week.png'), fullPage: true });
    console.log('Browser QA: edit and switch views');

    await overlapping.click();
    await page.getByLabel('Tên sự kiện').fill(`${marker} Họp đã cập nhật`);
    await page.getByLabel('Giờ kết thúc').fill('09:00');
    await page.getByRole('button', { name: 'Lưu sự kiện', exact: true }).click();
    await page.getByRole('alert').filter({ hasText: 'Thời gian kết thúc phải sau' }).waitFor();
    await page.getByLabel('Giờ kết thúc').fill('10:00');
    await saveDialog();

    await page.getByRole('button', { name: 'Tháng', exact: true }).click();
    await page.locator('.calendar-month').waitFor();
    assert.equal(await page.locator('.calendar-month-cell').count(), 42);
    const monthEvent = page.locator('.calendar-month').getByText(`${marker} Họp đã cập nhật`, { exact: false });
    if (!await monthEvent.count()) {
      const day = new Date(Date.now() + 7 * 3600000).toISOString().slice(0, 10);
      const label = new Date(day + 'T00:00:00Z').toLocaleDateString('vi-VN', { timeZone: 'UTC' });
      await page.getByRole('button', { name: `Thêm sự kiện ngày ${label}`, exact: true }).locator('..').locator('.calendar-more').waitFor();
    }
    await page.screenshot({ path: path.join(artifacts, 'calendar-month.png'), fullPage: true });
    await page.getByRole('button', { name: 'Danh sách', exact: true }).click();
    await page.locator('.calendar-agenda').waitFor();
    assert.equal(await page.evaluate(() => window.scrollY), 0, 'Tab navigation starts at top');
    await page.locator('.calendar-agenda-event').filter({ hasText: `${marker} Họp đã cập nhật` }).waitFor();
    await page.getByRole('button', { name: 'Toggle dark/light theme' }).click();
    await page.screenshot({ path: path.join(artifacts, 'calendar-dark.png'), fullPage: true });
    await page.getByRole('button', { name: 'Toggle dark/light theme' }).click();

    await page.reload();
    console.log('Browser QA: persistence, mobile and deletion');
    await page.locator('.calendar-widget-event').filter({ hasText: `${marker} Họp đã cập nhật` }).waitFor();
    await page.screenshot({ path: path.join(artifacts, 'calendar-workspace.png'), fullPage: true });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.getByRole('button', { name: 'Mở lịch đầy đủ' }).click();
    await page.locator('.calendar-agenda').waitFor();
    const dimensions = await page.evaluate(() => ({ width: window.innerWidth, content: document.documentElement.scrollWidth }));
    assert.ok(dimensions.content <= dimensions.width + 1, `Mobile horizontal overflow: ${JSON.stringify(dimensions)}`);
    await page.screenshot({ path: path.join(artifacts, 'calendar-mobile.png'), fullPage: true });
    await page.getByRole('button', { name: 'Tạo', exact: true }).click();
    await page.getByRole('dialog').waitFor();
    await page.keyboard.press('Escape');
    await page.getByRole('dialog').waitFor({ state: 'hidden' });

    await page.locator('.calendar-agenda-event').filter({ hasText: `${marker} Họp đã cập nhật` }).click();
    await page.getByRole('button', { name: 'Xóa', exact: true }).click();
    const deleteResponse = page.waitForResponse(response => response.request().method() === 'DELETE' && response.url().includes(timed.id));
    await page.getByRole('button', { name: 'Xác nhận xóa' }).click();
    assert.equal((await deleteResponse).status(), 204);
    await page.getByRole('dialog').waitFor({ state: 'hidden' });
    assert.deepEqual(failures, [], 'No browser runtime errors');
    console.log('PASS: Workspace placement, CRUD, all-day, overlap lanes, week/month/agenda, persistence, dark mode, mobile and Escape.');
  } catch (error) {
    await page.screenshot({ path: path.join(artifacts, 'calendar-failure.png'), fullPage: true }).catch(() => {});
    if (failures.length) console.error('Browser errors:', failures.join('\n'));
    throw error;
  } finally {
    if (token) {
      for (const id of eventIds) {
        const response = await context.request.delete(`${base}/api/calendar/events/${id}`, { headers: { Authorization: `Bearer ${token}` } });
        if (![204, 404].includes(response.status())) console.error(`Cleanup failed: HTTP ${response.status()}`);
      }
    }
    await browser.close();
  }
}

main().catch(error => { console.error(error.message); process.exitCode = 1; });
