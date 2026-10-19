const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), Module = require('node:module'), ts = require('typescript');
const filename = path.resolve(__dirname, '../../src/features/dashboard-layout/widgetLayout.ts');
const compiled = new Module(filename, module); compiled.paths = module.paths;
compiled._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText, filename);
const { normalizeWidgetColumns, moveWidget } = compiled.exports;
test('old saved layouts reconcile missing/removed/duplicated widgets and invalid columns', () => {
  const actual = normalizeWidgetColumns({ launcher: ['calendar', 'calendar', 'retired'], tasks: ['apps'], invalid: ['notes'] });
  assert.deepEqual(actual, { launcher: ['calendar', 'bookmarks'], tasks: ['apps', 'tasks'], notes: ['notes'] });
  assert.deepEqual(normalizeWidgetColumns(actual), actual);
  assert.deepEqual(normalizeWidgetColumns(null), normalizeWidgetColumns({}));
});
test('moving a widget preserves all IDs once, supports empty columns and does not mutate original', () => {
  const original = normalizeWidgetColumns({});
  const moved = moveWidget(original, 'tasks', 'launcher', 'apps');
  assert.deepEqual(original.tasks, ['tasks']);
  assert.deepEqual(moved.launcher, ['tasks', 'apps', 'bookmarks']);
  assert.deepEqual(moved.tasks, []);
  const next = moveWidget(moved, 'calendar', 'tasks');
  assert.deepEqual(next.tasks, ['calendar']);
  assert.deepEqual(Object.values(next).flat().sort(), ['apps', 'bookmarks', 'calendar', 'notes', 'tasks']);
});
