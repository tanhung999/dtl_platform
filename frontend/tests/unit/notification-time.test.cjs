const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const ts = require('typescript');
const filename = path.resolve(__dirname, '../../src/features/notifications/notificationTime.ts');
const compiled = new Module(filename, module);
compiled.paths = module.paths;
compiled._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
}).outputText, filename);
const { notificationTime } = compiled.exports;

test('each external source displays original history dates, including earlier years', () => {
  for (const source of ['workflows', 'itam', 'bookingreports']) {
    assert.equal(notificationTime({ source, occurred_at: '2025-09-08T08:48:18Z', created_at: '2026-11-06T09:05:00Z' }), '2025-09-08T08:48:18Z');
  }
});

test('internal reminder display keeps its existing delivery time', () => {
  assert.equal(notificationTime({ source: 'platform', occurred_at: '2026-11-05T09:00:00Z', created_at: '2026-11-06T09:05:00Z' }), '2026-11-06T09:05:00Z');
});

test('older API data with unavailable source time has a safe fallback', () => {
  assert.equal(notificationTime({ source: 'itam', occurred_at: '', created_at: '2026-11-06T09:05:00Z' }), '2026-11-06T09:05:00Z');
});

test('source date grouping crosses Vietnam midnight correctly', () => {
  const value = notificationTime({ source: 'workflows', occurred_at: '2025-12-31T18:00:00Z', created_at: '2026-11-06T09:05:00Z' });
  assert.equal(new Date(value).toLocaleDateString('en-CA', { timeZone: 'Asia/Ho_Chi_Minh' }), '2026-01-01');
});
