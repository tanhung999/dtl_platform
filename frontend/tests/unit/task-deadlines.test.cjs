const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const ts = require('typescript');
const filename = path.resolve(__dirname, '../../src/features/tasks/deadlineUtils.ts');
const compiled = new Module(filename, module);
compiled.paths = module.paths;
compiled._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
}).outputText, filename);
const { vietnamDay, isOverdue, sortTasks, deadlineLabel, overdueLabel } = compiled.exports;
const task = (id, values = {}) => ({ id, title: id, priority: 'MEDIUM', due_date: null, due_time: null, is_completed: false, display_order: 0, ...values });

test('date-only deadlines last through the Vietnam day; completed and undated never overdue', () => {
  const due = task('due', { due_date: '2026-10-12' });
  assert.equal(vietnamDay(new Date('2026-10-11T17:00:00Z')), '2026-10-12');
  assert.equal(isOverdue(due, new Date('2026-10-12T16:59:59Z')), false);
  assert.equal(isOverdue(due, new Date('2026-10-12T17:00:00Z')), true);
  assert.equal(isOverdue({ ...due, due_time: '09:00' }, new Date('2026-10-12T02:00:00Z')), true);
  assert.equal(isOverdue({ ...due, is_completed: true }, new Date('2026-10-13T00:00:00Z')), false);
  assert.equal(isOverdue(task('none'), new Date()), false);
});
test('tasks sort by completion, actual deadline and priority without mutating input', () => {
  const tasks = [task('undated', { priority: 'URGENT' }), task('done', { due_date: '2026-10-10', is_completed: true }),
    task('low', { due_date: '2026-10-12', priority: 'LOW' }), task('high', { due_date: '2026-10-12', priority: 'HIGH' }),
    task('timed', { due_date: '2026-10-12', due_time: '09:00' }), task('overdue', { due_date: '2026-10-11' })];
  assert.deepEqual(sortTasks(tasks).map(t => t.id), ['overdue', 'timed', 'high', 'low', 'undated', 'done']);
  assert.equal(tasks[0].id, 'undated');
});
test('deadline rows distinguish dates and optional times', () => {
  assert.equal(deadlineLabel(task('x', { due_date: '2026-10-12', due_time: '09:00' })), 'Hạn 09:00');
  assert.equal(deadlineLabel(task('x', { due_date: '2026-10-12' })), 'Hạn');
  assert.equal(deadlineLabel(task('x')), 'Không hạn');
});
test('overdue severity uses Vietnam calendar days for untimed tasks and elapsed time for timed tasks', () => {
  const now = new Date('2026-10-13T01:30:00Z');
  assert.equal(overdueLabel(task('date', { due_date: '2026-10-11' }), now), 'trễ 2 ngày');
  assert.equal(overdueLabel(task('date', { due_date: '2026-10-12' }), new Date('2026-10-12T17:00:00Z')), 'trễ 1 ngày');
  assert.equal(overdueLabel(task('time', { due_date: '2026-10-13', due_time: '08:00' }), now), 'trễ 30 phút');
  assert.equal(overdueLabel(task('time', { due_date: '2026-10-13', due_time: '06:00' }), now), 'trễ 2 giờ');
  assert.equal(overdueLabel(task('time', { due_date: '2026-10-13', due_time: '08:30' }), now), 'vừa quá hạn');
  assert.equal(overdueLabel(task('future', { due_date: '2026-10-14' }), now), '');
  assert.equal(overdueLabel(task('done', { due_date: '2026-10-11', is_completed: true }), now), '');
});
