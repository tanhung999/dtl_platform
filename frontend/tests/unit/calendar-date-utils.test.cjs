const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const ts = require('typescript');

// Exercise the actual date utilities with the existing TypeScript compiler;
// no extra test dependencies or emitted files are required.
const filename = path.resolve(__dirname, '../../src/features/calendar/dateUtils.ts');
const compiled = new Module(filename, module);
compiled.paths = module.paths;
compiled._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
}).outputText, filename);
const dates = compiled.exports;

function event(id, starts_at, ends_at, is_all_day = false) {
  return { id, starts_at, ends_at, is_all_day };
}

test('Vietnam dates and timestamps are independent of the machine time zone', () => {
  const previous = process.env.TZ;
  try {
    for (const tz of ['UTC', 'America/New_York', 'Asia/Tokyo']) {
      process.env.TZ = tz;
      assert.equal(dates.dateKey(dates.eventDate('2026-10-11T17:30:00Z')), '2026-10-12');
      assert.equal(dates.eventTime('2026-10-11T17:30:00Z'), '00:30');
      assert.equal(dates.toTimestamp(dates.parseDate('2026-10-12'), '09:00'), '2026-10-12T02:00:00.000Z');
    }
  } finally {
    if (previous === undefined) delete process.env.TZ;
    else process.env.TZ = previous;
  }
});

test('month navigation clamps dates and keeps Monday-first complete weeks', () => {
  assert.equal(dates.dateKey(dates.addMonths(dates.parseDate('2026-01-31'), 1)), '2026-02-28');
  assert.equal(dates.dateKey(dates.addMonths(dates.parseDate('2024-01-31'), 1)), '2024-02-29');
  assert.equal(dates.dateKey(dates.startOfWeek(dates.parseDate('2026-10-18'))), '2026-10-12');
  const month = dates.monthDays(dates.parseDate('2026-11-01'));
  assert.equal(month.length, 42);
  assert.equal(month[0].getUTCDay(), 1);
  assert.equal(month[41].getUTCDay(), 0);
});

test('all-day and midnight-ending events use exclusive end boundaries', () => {
  const events = [event('all-day', '2026-10-11T17:00:00Z', '2026-10-12T17:00:00Z', true),
    event('overnight', '2026-10-11T16:00:00Z', '2026-10-11T17:00:00Z')];
  assert.deepEqual(dates.eventsOnDay(events, dates.parseDate('2026-10-12')).map(item => item.id), ['all-day']);
  assert.deepEqual(dates.eventsOnDay(events, dates.parseDate('2026-10-13')), []);
});

test('overlapping events get separate lanes, including short painted blocks', () => {
  const events = [
    event('a', '2026-10-12T02:00:00Z', '2026-10-12T03:00:00Z'),
    event('b', '2026-10-12T02:30:00Z', '2026-10-12T04:00:00Z'),
    event('c', '2026-10-12T04:00:00Z', '2026-10-12T04:05:00Z'),
    event('d', '2026-10-12T04:10:00Z', '2026-10-12T04:15:00Z'),
  ];
  const placed = dates.timedPlacements(events, dates.parseDate('2026-10-12'));
  assert.notEqual(placed[0].lane, placed[1].lane);
  assert.equal(placed[0].lanes, 2);
  assert.notEqual(placed[2].lane, placed[3].lane);
  assert.equal(placed[2].lanes, 2);
});

test('multi-day timed events are clipped to each day in the week grid', () => {
  const overnight = event('night', '2026-10-12T16:00:00Z', '2026-10-12T18:00:00Z');
  const first = dates.timedPlacements([overnight], dates.parseDate('2026-10-12'))[0];
  const second = dates.timedPlacements([overnight], dates.parseDate('2026-10-13'))[0];
  assert.equal(first.start, 1380);
  assert.equal(first.end, 1440);
  assert.equal(second.start, 0);
  assert.equal(second.end, 60);
});


test('multi-day timed labels describe the visible Vietnam day, including exclusive midnight', () => {
  const item = event('note', '2026-10-16T09:03:00+07:00', '2026-10-18T09:33:00+07:00');
  assert.equal(dates.eventDayLabel(item, '2026-10-16'), 'Từ 09:03');
  assert.equal(dates.eventDayLabel(item, '2026-10-17'), 'Tiếp tục từ ngày trước');
  assert.equal(dates.eventDayLabel(item, '2026-10-17', true), 'Tiếp tục');
  assert.equal(dates.eventDayLabel(item, '2026-10-18'), 'Đến 09:33');
  assert.equal(dates.eventDayLabel({ ...item, ends_at: '2026-10-17T00:00:00+07:00' }, '2026-10-16'), '09:03 – 24:00');
  assert.equal(dates.eventDayLabel({ ...item, is_all_day: true }, '2026-10-17'), 'Cả ngày');
});

test('continuation markers explain clipping at hidden hours and previous days', () => {
  const item = event('note', '2026-10-16T09:03:00+07:00', '2026-10-18T09:33:00+07:00');
  assert.equal(dates.eventContinuation(item, '2026-10-16', 360), undefined);
  assert.equal(dates.eventContinuation(item, '2026-10-17', 360), 'Tiếp tục từ trước 06:00');
  assert.equal(dates.eventContinuation(item, '2026-10-18'), 'Tiếp tục từ ngày trước');
  assert.equal(dates.eventContinuation({ ...item, starts_at: '2026-10-16T05:00:00+07:00' }, '2026-10-16', 360), 'Tiếp tục từ trước 06:00');
  assert.equal(dates.eventContinuation({ ...item, ends_at: '2026-10-16T06:00:00+07:00' }, '2026-10-16', 360), undefined);
  assert.equal(dates.eventContinuation({ ...item, is_all_day: true }, '2026-10-17', 360), undefined);
});


test('bottom continuation arrows appear only when a timed interval extends beyond next midnight', () => {
  const item = event('note', '2026-10-16T09:03:00+07:00', '2026-10-18T09:33:00+07:00');
  assert.equal(dates.eventContinuesNextDay(item, '2026-10-16'), true);
  assert.equal(dates.eventContinuesNextDay(item, '2026-10-17'), true);
  assert.equal(dates.eventContinuesNextDay(item, '2026-10-18'), false);
  assert.equal(dates.eventContinuesNextDay({ ...item, ends_at: '2026-10-17T00:00:00+07:00' }, '2026-10-16'), false);
  assert.equal(dates.eventContinuesNextDay({ ...item, is_all_day: true }, '2026-10-16'), false);
});
