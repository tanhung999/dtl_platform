const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const ts = require('typescript');
const filename = path.resolve(__dirname, '../../src/features/calendar/eventStatus.ts');
const compiled = new Module(filename, module);
compiled.paths = module.paths;
compiled._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
}).outputText, filename);
const { eventStatus } = compiled.exports;

test('status switches exactly at start and exclusive end regardless of stored custom color', () => {
  const event = { starts_at: '2026-10-12T09:00:00+07:00', ends_at: '2026-10-12T10:00:00+07:00', color: '#be123c' };
  assert.deepEqual(eventStatus(event, new Date('2026-10-12T01:59:59Z'), '2026-10-12'), { key: 'upcoming', label: 'Sắp tới', color: '#EAB308' });
  assert.deepEqual(eventStatus(event, new Date('2026-10-12T02:00:00Z'), '2026-10-12'), { key: 'ongoing', label: 'Đang diễn ra', color: '#2563EB' });
  assert.deepEqual(eventStatus(event, new Date('2026-10-12T03:00:00Z'), '2026-10-12'), { key: 'ended', label: 'Đã kết thúc', color: '#16A34A' });
});
test('same multi-day event has distinct colors for past, current and future Vietnam days', () => {
  const event = { starts_at: '2026-10-11T17:00:00Z', ends_at: '2026-10-13T17:00:00Z' };
  const now = new Date('2026-10-12T17:00:00Z'); // Vietnam: midnight on the 13th.
  assert.equal(eventStatus(event, now, '2026-10-12').key, 'ended');
  assert.equal(eventStatus(event, now, '2026-10-13').key, 'ongoing');
  const longer = { ...event, ends_at: '2026-10-15T17:00:00Z' };
  assert.equal(eventStatus(longer, now, '2026-10-14').key, 'upcoming');
  assert.equal(eventStatus(event, new Date('2026-10-13T16:59:59Z'), '2026-10-13').key, 'ongoing');
  assert.equal(eventStatus(event, new Date('2026-10-13T17:00:00Z'), '2026-10-13').key, 'ended');
});
