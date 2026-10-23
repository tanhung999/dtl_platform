const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const ts = require('typescript');
function compile(name, dependencies = {}) {
  const filename = path.resolve(__dirname, '../../src/features/calendar/' + name + '.ts');
  const compiled = new Module(filename, module);
  compiled.require = name => dependencies[name] || Module.createRequire(filename)(name);
  compiled._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText, filename);
  return compiled.exports;
}
const { weekTimedPlacements } = compile('deadlinePlacements', { './dateUtils': compile('dateUtils') });
const { allDayPlacements } = compile('allDayPlacements', { './dateUtils': compile('dateUtils') });
const date = new Date('2026-10-13T00:00:00Z');
const task = (id, due_time, due_date = '2026-10-13') => ({ id, due_date, due_time });
test('week timeline includes only deadlines with a time on the selected Vietnam date', () => {
  const items = weekTimedPlacements([], [task('all-day', null), task('midnight', '00:00'), task('late', '23:59'), task('other-day', '10:00', '2026-10-14'), task('undated', '10:00', null)], date);
  assert.deepEqual(items.map(item => [item.task.id, item.start]), [['midnight', 0], ['late', 1439]]);
  assert.ok(items.every(item => item.end - item.start === 24));
});
test('events and simultaneous deadlines share overlap lanes without changing task completion', () => {
  const event = { id: 'event', starts_at: '2026-10-13T10:00:00+07:00', ends_at: '2026-10-13T11:00:00+07:00', is_all_day: false };
  const done = { ...task('done', '10:10'), is_completed: true };
  const items = weekTimedPlacements([event], [task('first', '10:00'), done], date);
  assert.equal(items.length, 3);
  assert.equal(new Set(items.map(item => item.lane)).size, 3);
  assert.ok(items.every(item => item.lanes === 3));
  assert.equal(items.find(item => item.kind === 'deadline' && item.task.id === 'done').task.is_completed, true);
});
test('all-day multi-day events occupy one continuous span, with exclusive end and shared row packing', () => {
  const events = [{ id: 'span', is_all_day: true, starts_at: '2026-10-11T00:00:00+07:00', ends_at: '2026-10-16T00:00:00+07:00' }];
  const items = allDayPlacements(events, Array.from({ length: 4 }, (_, i) => task('task-' + i, null)), date);
  const span = items.find(item => item.kind === 'event');
  assert.deepEqual([span.start, span.end, span.lane], [0, 3, 0]);
  assert.equal(items.filter(item => item.start <= 1 && item.end >= 1 && item.lane >= 4).length, 1);
});
test('hidden early hours clip overnight events and retain deadlines at the visible boundary', () => {
  const events = [{ id: 'overnight', is_all_day: false, starts_at: '2026-10-13T04:00:00+07:00', ends_at: '2026-10-13T07:00:00+07:00' }];
  const items = weekTimedPlacements(events, [task('early', '05:59'), task('visible', '06:00')], date, 360);
  assert.equal(items.find(item => item.kind === 'event').start, 360);
  assert.equal(items.filter(item => item.kind === 'deadline').length, 1);
});


test('a note expands through free lanes instead of inheriting a later crowded hour', () => {
  const event = (id, start, end) => ({ id, is_all_day: false, starts_at: `2026-10-13T${start}:00+07:00`, ends_at: `2026-10-13T${end}:00+07:00` });
  const items = weekTimedPlacements([event('long', '08:00', '18:00'), { ...event('note', '11:00', '11:30'), scheduled_note_id: 'note-id' },
    ...Array.from({ length: 8 }, (_, i) => event('busy-' + i, '12:00', '13:00'))], [], date);
  const note = items.find(item => item.kind === 'event' && item.event.id === 'note');
  assert.equal(note.lanes, 9);
  assert.equal(note.laneSpan, 8);
  assert.equal(note.lane, 1);
  // No expanded rectangle may intersect another item in both time and horizontal space.
  for (let i = 0; i < items.length; i++) for (let j = i + 1; j < items.length; j++) {
    const a = items[i], b = items[j];
    const overlapTime = a.start < Math.max(b.end, b.start + (b.minimumHeight ?? 48)) && b.start < Math.max(a.end, a.start + (a.minimumHeight ?? 48));
    if (overlapTime) assert.ok(a.lane + a.laneSpan <= b.lane || b.lane + b.laneSpan <= a.lane);
  }
  const lone = weekTimedPlacements([event('only-note', '11:00', '11:30')], [], date)[0];
  assert.equal(lone.laneSpan / lone.lanes, 1);
});
