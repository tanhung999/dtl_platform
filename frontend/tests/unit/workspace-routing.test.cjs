const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), Module = require('node:module'), ts = require('typescript');
const filename = path.resolve(__dirname, '../../src/features/dashboard/navigation.ts');
const compiled = new Module(filename, module);
compiled._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
}).outputText, filename);
const { loginDestination, pageForPath } = compiled.exports;

test('login return destination keeps known internal deep links and their query', () => {
  assert.equal(loginDestination('/calendar?date=2026-10-23&owner=someone'), '/calendar?date=2026-10-23&owner=someone');
  assert.equal(loginDestination('/search?q=project%20report'), '/search?q=project%20report');
  assert.equal(pageForPath('/CALENDAR/'), 'calendar');
  assert.equal(pageForPath('/calendar/unknown'), undefined);
});

test('login cannot redirect outside the workspace or back into the login screen', () => {
  for (const input of [undefined, null, {}, '', '/', '/login', '/login?from=/login', '//example.com/calendar', '/\\example.com/calendar', 'https://example.com/calendar', 'javascript:alert(1)', '/unknown', '/bookmarks', '/link']) {
    assert.equal(loginDestination(input), '/homepage', String(input));
  }
});
