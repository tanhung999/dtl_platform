const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const ts = require('typescript');
const cache = new Map();
function load(relative) {
  const filename = path.resolve(__dirname, '../../src/features/calendar', relative);
  if (cache.has(filename)) return cache.get(filename).exports;
  const compiled = new Module(filename, module);
  cache.set(filename, compiled);
  compiled.paths = module.paths;
  const original = compiled.require.bind(compiled);
  compiled.require = name => name.startsWith('.') ? load(path.relative(path.resolve(__dirname, '../../src/features/calendar'), path.resolve(path.dirname(filename), name)) + '.ts') : original(name);
  compiled._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText, filename);
  return compiled.exports;
}
const { calendarDayGroups } = load('dayGroups.ts');
const { parseDate, dateKey, eventsOnDay } = load('dateUtils.ts');
const event = (id, starts_at, ends_at, is_all_day = false) => ({ id, starts_at, ends_at, is_all_day });

test('day buckets respect Vietnam midnight, exclusive ends and multi-day clipping', () => {
  const first = parseDate('2026-10-23');
  const events = [
    event('overnight', '2026-10-22T16:00:00Z', '2026-10-22T17:00:00Z'),
    event('all-day', '2026-10-22T17:00:00Z', '2026-10-24T17:00:00Z', true),
    event('spanning', '2026-10-21T02:00:00Z', '2026-10-26T03:00:00Z'),
    event('one-second', '2026-10-23T16:59:59Z', '2026-10-23T17:00:01Z'),
  ];
  const groups = calendarDayGroups(events, [], first, 3);
  for (const group of groups) assert.deepEqual(group.events, eventsOnDay(events, group.day));
  assert.ok(groups.every(group => !group.events.some(value => value.id === 'overnight')));
  assert.ok(!groups[2].events.some(value => value.id === 'all-day'));
  assert.equal(groups.filter(group => group.events.some(value => value.id === 'one-second')).length, 2);
});

test('large calendar buckets preserve displayed events, order and task date assignment', () => {
  const first = parseDate('2026-10-01');
  const base = Date.parse('2026-09-20T17:00:00Z');
  const events = Array.from({ length: 1030 }, (_, index) => {
    const start = base + (index * 977) % (60 * 24 * 60) * 60000;
    return event(String(index), new Date(start).toISOString(), new Date(start + ((index % 10) + 1) * 3600000).toISOString(), index % 7 === 0);
  });
  const tasks = Array.from({ length: 80 }, (_, index) => ({ id: String(index), due_date: index % 5 ? `2026-10-${String(index % 31 + 1).padStart(2, '0')}` : null }));
  const original = JSON.stringify({ events, tasks });
  const groups = calendarDayGroups(events, tasks, first, 42);
  for (const group of groups) {
    assert.deepEqual(group.events, eventsOnDay(events, group.day));
    assert.deepEqual(group.tasks, tasks.filter(task => task.due_date === dateKey(group.day)));
  }
  assert.equal(JSON.stringify({ events, tasks }), original);
});
