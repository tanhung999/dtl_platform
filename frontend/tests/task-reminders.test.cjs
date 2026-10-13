const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const ts = require('typescript');
function compile(name, dependencies = {}) {
  const filename = path.resolve(__dirname, '../src/features/tasks/' + name + '.ts');
  const compiled = new Module(filename, module);
  compiled.paths = module.paths;
  const requireLocal = Module.createRequire(filename);
  compiled.require = name => dependencies[name] || requireLocal(name);
  compiled._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText, filename);
  return compiled.exports;
}
const utils = compile('reminderUtils', { './deadlineUtils': compile('deadlineUtils') });
const task = (id, due_date, due_time = null, more = {}) => ({ id, due_date, due_time, deadline_version: 0, is_completed: false, priority: 'MEDIUM', ...more });
const notice = task => ({ ...task, task_id: task.id, kind: 'day' });

test('banner excludes overdue, completed, stale and dates beyond tomorrow; today times come first', () => {
  const now = new Date('2026-10-13T01:00:00Z');
  const tasks = [task('tomorrow', '2026-10-14'), task('whole-day', '2026-10-13'), task('late', '2026-10-13', '16:56'),
    task('early', '2026-10-13', '09:00'), task('overdue', '2026-10-12'), task('finished', '2026-10-13', null, { is_completed: true }),
    task('later', '2026-10-15'), task('stale', '2026-10-13', null, { deadline_version: 1 })];
  const notices = tasks.map(notice); notices.find(n => n.task_id === 'stale').deadline_version = 0;
  assert.deepEqual(utils.upcomingReminders(notices, tasks, now).map(r => r.task_id), ['early', 'late', 'whole-day', 'tomorrow']);
});
test('two-line labels use Vietnam dates and keep optional deadline time', () => {
  const now = new Date('2026-10-12T17:00:00Z');
  assert.equal(utils.reminderDayLabel(notice(task('today', '2026-10-13', '16:56')), now), 'Hôm nay 16:56');
  assert.equal(utils.reminderDayLabel(notice(task('today', '2026-10-13')), now), 'Hôm nay · Hết ngày');
  assert.equal(utils.reminderDayLabel(notice(task('tomorrow', '2026-10-14', '09:00')), now), 'Ngày mai 09:00');
});
