const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const ts = require('typescript');
function compile(file, dependencies = {}) {
  const filename = path.resolve(__dirname, '../../src/features/' + file + '.ts'), compiled = new Module(filename, module);
  compiled.require = name => dependencies[name] || Module.createRequire(filename)(name);
  compiled._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText, filename);
  return compiled.exports;
}
const { eventSchedule, slotMinute } = compile('calendar-dnd/eventSchedule', { '../calendar/dateUtils': compile('calendar/dateUtils') });
const timed = { starts_at: '2026-10-13T09:00:00+07:00', ends_at: '2026-10-13T10:00:00+07:00', is_all_day: false };
const data = (event, action = 'move', sourceDay = '2026-10-13') => ({ event, action, sourceDay });
test('15-minute snapping includes the midnight boundary and preserves duration across days', () => {
  const target = { type: 'calendar-slot', date: '2026-10-15', time: '23:00' };
  assert.equal(slotMinute(target, 117, { top: 60, height: 60 }), 1440);
  const moved = eventSchedule(data(timed), target, 1440);
  assert.equal(Date.parse(moved.starts_at), Date.parse('2026-10-16T00:00:00+07:00'));
  assert.equal(Date.parse(moved.ends_at) - Date.parse(moved.starts_at), 3600000);
  assert.equal(timed.starts_at, '2026-10-13T09:00:00+07:00');
});
test('moving the middle of a multi-day bar shifts the whole interval by the grabbed day', () => {
  const event = { starts_at: '2026-10-13T00:00:00+07:00', ends_at: '2026-10-16T00:00:00+07:00', is_all_day: true };
  const moved = eventSchedule(data(event, 'move', '2026-10-14'), { type: 'calendar-all-day', date: '2026-10-15' });
  assert.equal(Date.parse(moved.starts_at), Date.parse('2026-10-14T00:00:00+07:00'));
  assert.equal(Date.parse(moved.ends_at), Date.parse('2026-10-17T00:00:00+07:00'));
});
test('all-day right edge includes the target day through exclusive next midnight', () => {
  const event = { starts_at: '2026-10-13T00:00:00+07:00', ends_at: '2026-10-16T00:00:00+07:00', is_all_day: true };
  const resized = eventSchedule(data(event, 'end'), { type: 'calendar-all-day', date: '2026-10-18' });
  assert.equal(Date.parse(resized.ends_at), Date.parse('2026-10-19T00:00:00+07:00'));
  assert.equal(resized.is_all_day, true);
});
test('resize keeps the other edge and enforces positive minimum duration', () => {
  const resized = eventSchedule(data(timed, 'start'), { type: 'calendar-slot', date: '2026-10-15', time: '11:00' }, 660);
  assert.equal(Date.parse(resized.ends_at), Date.parse(timed.ends_at));
  assert.equal(Date.parse(resized.ends_at) - Date.parse(resized.starts_at), 15 * 60000);
});
