const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), Module = require('node:module'), ts = require('typescript');

const filename = path.resolve(__dirname, '../../src/features/apps/navigation.ts');
const compiled = new Module(filename, module);
compiled._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
}).outputText, filename);

const { applicationHomePath } = compiled.exports;

test('Income Statement launches directly into its dashboard', () => {
  assert.equal(applicationHomePath('bookingreports'), '/dashboard');
  assert.equal(applicationHomePath(' BookingReports '), '/dashboard');
});

test('applications without a configured landing page keep their root route', () => {
  assert.equal(applicationHomePath('workflows'), '/');
  assert.equal(applicationHomePath('itam'), '/');
});
