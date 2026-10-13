/* Verify actual rendered priority labels, both themes and completed opacity.
 * WebAIM receives only the public foreground/background hex color pairs.
 */
const { chromium } = require('./.browser-tools/node_modules/playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const luminance = rgb => rgb.map(value => {
  const s = value / 255;
  return s <= .04045 ? s / 12.92 : ((s + .055) / 1.055) ** 2.4;
}).reduce((sum, value, index) => sum + value * [.2126, .7152, .0722][index], 0);
const contrast = (a, b) => (Math.max(luminance(a), luminance(b)) + .05) / (Math.min(luminance(a), luminance(b)) + .05);
const hex = rgb => rgb.map(value => Math.round(value).toString(16).padStart(2, '0')).join('');

async function main() {
  const base = process.env.CALENDAR_TEST_URL || 'http://localhost:5173';
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const page = await context.newPage();
  const ids = [], measurements = [];
  let token;
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  try {
    await page.goto(base);
    await page.getByLabel('Tên đăng nhập hoặc Email').fill(process.env.CALENDAR_TEST_USERNAME || 'admin');
    await page.getByLabel('Mật khẩu', { exact: true }).fill(process.env.CALENDAR_TEST_PASSWORD || 'admin123');
    await page.getByRole('button', { name: 'Đăng nhập hệ thống' }).click();
    await page.locator('.tasks-widget').waitFor();
    token = await page.evaluate(() => localStorage.getItem('dtl_platform_token'));
    const headers = { Authorization: `Bearer ${token}` };
    for (const priority of ['URGENT', 'HIGH', 'MEDIUM', 'LOW']) {
      for (const completed of [false, true]) {
        const created = await context.request.post(base + '/api/tasks', { headers, data: { title: `[Priority QA ${Date.now()}] ${priority}`, priority } });
        assert.equal(created.status(), 201);
        const task = await created.json(); ids.push(task.id);
        if (completed) assert.ok((await context.request.patch(base + '/api/tasks/' + task.id, { headers, data: { is_completed: true } })).ok());
        await page.locator(`[data-task-id="${task.id}"] .priority-tag`).waitFor();
      }
    }
    for (const theme of ['light', 'dark']) {
      if (await page.evaluate(() => document.body.dataset.theme) !== theme) await page.getByRole('button', { name: 'Toggle dark/light theme' }).click();
      await page.waitForFunction(theme => document.body.dataset.theme === theme && document.documentElement.dataset.theme === theme, theme);
      for (const id of ids) {
        const badge = page.locator(`[data-task-id="${id}"] .priority-tag`);
        const result = await badge.evaluate(el => {
          const canvas = document.createElement('canvas'); canvas.width = canvas.height = 1;
          const ctx = canvas.getContext('2d');
          const rgba = color => { ctx.clearRect(0, 0, 1, 1); ctx.fillStyle = color; ctx.fillRect(0, 0, 1, 1); return [...ctx.getImageData(0, 0, 1, 1).data]; };
          const blend = (foreground, background, alpha) => foreground.slice(0, 3).map((v, i) => v * alpha + background[i] * (1 - alpha));
          const ancestors = []; let parent = el.parentElement;
          while (parent) { ancestors.unshift(parent); parent = parent.parentElement; }
          let behind = [255, 255, 255];
          for (const ancestor of ancestors) { const bg = rgba(getComputedStyle(ancestor).backgroundColor); behind = blend(bg, behind, bg[3] / 255); }
          const style = getComputedStyle(el), opacity = Number(style.opacity);
          return { fg: blend(rgba(style.color), behind, opacity), bg: blend(rgba(style.backgroundColor), behind, opacity), opacity,
            text: el.textContent, completed: el.closest('.task-item').classList.contains('completed'), symbolHidden: el.firstElementChild?.getAttribute('aria-hidden') === 'true' };
        });
        assert.ok(result.symbolHidden, 'Decorative symbol is hidden from assistive technology');
        assert.ok(/[⚑▲●▼]/u.test(result.text));
        const ratio = contrast(result.fg, result.bg);
        assert.ok(ratio >= 4.5, `${theme} ${result.text} completed=${result.completed}: ${ratio}`);
        assert.equal(result.opacity, result.completed ? .85 : 1);
        measurements.push({ theme, label: result.text, completed: result.completed, foreground: hex(result.fg), background: hex(result.bg), ratio: +ratio.toFixed(2) });
      }
      await page.locator('.tasks-list').evaluate(el => { el.scrollTop = 0; });
      fs.mkdirSync(path.join(__dirname, 'artifacts'), { recursive: true });
      await page.screenshot({ path: path.join(__dirname, `artifacts/task-priorities-${theme}.png`), fullPage: true });
    }
    const unique = [...new Map(measurements.map(m => [m.foreground + m.background, m])).values()];
    const webaim = await Promise.all(unique.map(async m => {
      const response = await context.request.get(`https://webaim.org/resources/contrastchecker/?fcolor=${m.foreground}&bcolor=${m.background}&api`, { timeout: 20000 });
      assert.ok(response.ok(), `WebAIM HTTP ${response.status()}`);
      const result = await response.json();
      assert.equal(result.AA, 'pass', JSON.stringify(result));
      return { ...m, webaim: result };
    }));
    fs.writeFileSync(path.join(__dirname, 'artifacts/task-priority-contrast.json'), JSON.stringify({ measurements, webaim }, null, 2));
    assert.deepEqual(errors, []);
    console.log(`PASS: ${measurements.length} rendered labels across light/dark and completion; minimum contrast ${Math.min(...measurements.map(m => m.ratio))}:1; WebAIM AA passed for ${unique.length} color pairs.`);
  } finally {
    if (token) for (const id of ids) await context.request.delete(base + '/api/tasks/' + id, { headers: { Authorization: `Bearer ${token}` } });
    await browser.close();
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
