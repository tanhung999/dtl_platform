const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), Module = require('node:module'), ts = require('typescript');
const filename = path.resolve(__dirname, '../../src/features/calendar/occurrenceSchedule.ts');
const loaded = new Module(filename, module);
loaded._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText, filename);
const { occurrenceSchedule } = loaded.exports;

test('selected occurrence displays its date without mutating the saved series or notification', () => {
  const original = Object.freeze({ starts_at: '2026-11-02T09:00:00+07:00', ends_at: '2026-11-02T10:00:00+07:00', recurrence: 'WEEKLY', reminder_repeat: true, reminder_at: '2026-11-02T08:30:00+07:00' });
  const displayed = occurrenceSchedule(original, '2026-11-09T09:00:00+07:00');
  assert.equal(displayed.starts_at, '2026-11-09T09:00:00+07:00');
  assert.equal(Date.parse(displayed.ends_at), Date.parse('2026-11-09T10:00:00+07:00'));
  assert.equal(original.starts_at, '2026-11-02T09:00:00+07:00');
  assert.equal(displayed.reminder_at, original.reminder_at);
  assert.equal(displayed.reminder_repeat, true);
});

test('all-day occurrence preserves its inclusive covered dates and exclusive end', () => {
  const value = { starts_at: '2026-11-02T00:00:00+07:00', ends_at: '2026-11-05T00:00:00+07:00', recurrence: 'WEEKLY' };
  const displayed = occurrenceSchedule(value, '2026-11-09T00:00:00+07:00');
  assert.equal(Date.parse(displayed.ends_at), Date.parse('2026-11-12T00:00:00+07:00'));
});

test('individually edited instances retain their actual saved dates', () => {
  const value = { starts_at: '2026-11-10T11:00:00+07:00', ends_at: '2026-11-10T12:00:00+07:00', recurrence: 'NONE' };
  assert.equal(occurrenceSchedule(value, '2026-11-09T09:00:00+07:00'), value);
  assert.equal(occurrenceSchedule(value), value);
});
