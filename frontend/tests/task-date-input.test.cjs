const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const ts = require('typescript');
const filename = path.resolve(__dirname, '../src/features/tasks/dateInputUtils.ts');
const compiled = new Module(filename, module);
compiled._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
}).outputText, filename);
const { displayTaskDate, parseTaskDate } = compiled.exports;

test('Vietnam date input keeps day/month order and converts to ISO without time zones', () => {
  assert.equal(displayTaskDate('2026-10-13'), '13/10/2026');
  assert.equal(parseTaskDate('04/05/2026'), '2026-05-04');
  assert.equal(parseTaskDate(''), '');
  assert.equal(displayTaskDate(''), '');
});
test('date input rejects impossible dates, incomplete dates and invalid leap days', () => {
  assert.equal(parseTaskDate('29/02/2028'), '2028-02-29');
  for (const value of ['29/02/2026', '31/04/2026', '00/10/2026', '13/00/2026', '13/13/2026', '13/10/0000', '13/10/20', '2026-10-13']) assert.equal(parseTaskDate(value), null, value);
});
