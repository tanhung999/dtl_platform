const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), Module = require('node:module'), ts = require('typescript');
const filename = path.resolve(__dirname, '../../src/features/rescheduling/api.ts');
const compiled = new Module(filename, module); compiled.paths = module.paths;
compiled.require = name => name.includes('useWorkspaceRealtime') ? { WORKSPACE_CHANGED: 'workspace:changed' } : {};
compiled._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText, filename);
test('ordinary event moves only invalidate Calendar, Notes moves also invalidate Notes', () => {
  const previousWindow = global.window, previousEvent = global.CustomEvent, seen = [];
  try {
    global.window = { dispatchEvent: event => seen.push(event.detail) };
    global.CustomEvent = class { constructor(type, options) { this.type = type; this.detail = options.detail; } };
    for (const kind of ['event', 'note', 'task']) compiled.exports.notifyMoved(kind);
    assert.deepEqual(seen, [['calendar'], ['notes', 'calendar'], ['tasks', 'calendar', 'notifications']]);
  } finally { global.window = previousWindow; global.CustomEvent = previousEvent; }
});
