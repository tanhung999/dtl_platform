const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), Module = require('node:module'), ts = require('typescript');
const filename = path.resolve(__dirname, '../../src/features/tasks/api.ts');
const compiled = new Module(filename, module);
compiled.require = name => {
  if (name === '../../services/requestTimeout') return { requestWithTimeout: () => {} };
  if (name === '../../services/mutationRecovery') return { recoverMutation: (_write, _read, matches) => matches };
  throw new Error(`Unexpected import: ${name}`);
};
compiled._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
}).outputText, filename);
const { tasksApi } = compiled.exports;

test('recovery compares explicit followers against the final recipient after a role swap', () => {
  const matches = tasksApi.update('task', { expected_version: 0, assignee_id: 'ha', follower_ids: ['ha', 'minh-anh'] });
  const task = { version: 1, user_id: 'creator', assignee_id: 'ha', followers: [{ id: 'creator' }, { id: 'minh-anh' }] };
  assert.equal(matches(task), true);
  assert.equal(matches({ ...task, followers: [{ id: 'creator' }] }), false);
  assert.equal(matches({ ...task, assignee_id: 'minh-anh' }), false);
  assert.equal(matches({ ...task, followers: [...task.followers, { id: 'other' }] }), false);
});

test('recovery accepts an empty recipient only when the task returned to its creator', () => {
  const matches = tasksApi.update('task', { expected_version: 0, assignee_id: null, follower_ids: [] });
  assert.equal(matches({ version: 1, user_id: 'creator', assignee_id: 'creator', followers: [] }), true);
  assert.equal(matches({ version: 1, user_id: 'creator', assignee_id: 'old-recipient', followers: [{ id: 'creator' }] }), false);
});
