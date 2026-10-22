const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), Module = require('node:module'), ts = require('typescript');
function compile(name, dependencies = {}) {
 const filename=path.resolve(__dirname,'../../src/features/'+name+'.ts');
 const compiled=new Module(filename,module);
 compiled.require=name=>dependencies[name]||Module.createRequire(filename)(name);
 compiled._compile(ts.transpileModule(fs.readFileSync(filename,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020}}).outputText,filename);
 return compiled.exports;
}
const {eventTooltip,taskTooltip}=compile('calendar/itemTooltip',{
 './dateUtils':compile('calendar/dateUtils'),'./eventStatus':compile('calendar/eventStatus'),'../tasks/deadlineUtils':compile('tasks/deadlineUtils')});
const now=new Date('2026-10-21T05:00:00Z');
const span={title:'bbb',starts_at:'2026-10-14T00:00:00+07:00',ends_at:'2026-10-26T00:00:00+07:00',is_all_day:true};
test('all-day span matches the compact example and excludes next midnight',()=>{
 assert.equal(eventTooltip(span,now),'bbb\nCả ngày · 14/10 – 25/10 (12 ngày)\n● Đang diễn ra · ngày thứ 8/12');
 assert.equal(eventTooltip(span,new Date('2026-10-26T00:00:00+07:00')),'bbb\nCả ngày · 14/10 – 25/10 (12 ngày)\n● Đã kết thúc');
});
test('single-day upcoming note/event is concise without progress or repeated dates',()=>{
 assert.equal(eventTooltip({...span,starts_at:'2026-10-24T00:00:00+07:00',ends_at:'2026-10-25T00:00:00+07:00'},now),'bbb\nCả ngày · 24/10\n● Sắp diễn ra');
});
test('timed interval keeps the actual hours, including overnight midnight',()=>{
 assert.equal(eventTooltip({...span,is_all_day:false,starts_at:'2026-10-21T09:00:00+07:00',ends_at:'2026-10-21T14:00:00+07:00'},now),'bbb\n21/10 · 09:00 – 14:00\n● Đang diễn ra');
 assert.equal(eventTooltip({...span,is_all_day:false,starts_at:'2026-10-21T23:00:00+07:00',ends_at:'2026-10-22T00:00:00+07:00'},now),'bbb\n21/10 · 23:00 – 22/10 · 00:00\n● Sắp diễn ra');
});
test('cross-year spans show both years and progress uses Vietnam midnight',()=>{
 const event={...span,starts_at:'2026-12-31T00:00:00+07:00',ends_at:'2027-01-03T00:00:00+07:00'};
 assert.equal(eventTooltip(event,new Date('2026-12-31T17:00:00Z')),'bbb\nCả ngày · 31/12/2026 – 02/01/2027 (3 ngày)\n● Đang diễn ra · ngày thứ 2/3');
});
test('tasks distinguish no deadline, overdue and completed without implying a start time',()=>{
 const task={title:'Báo cáo',priority:'HIGH',is_completed:false,due_date:null,due_time:null};
 assert.equal(taskTooltip(task,now),'Báo cáo\nChưa đặt hạn\n● Chưa hoàn thành · Ưu tiên Trung bình');
 assert.equal(taskTooltip({...task,due_date:'2026-10-20'},now),'Báo cáo\nHạn · 20/10 · Cả ngày\n● Quá hạn · trễ 1 ngày · Ưu tiên Trung bình');
 assert.equal(taskTooltip({...task,is_completed:true,due_date:'2026-10-20',due_time:'09:00'},now),'Báo cáo\nHạn · 20/10 · 09:00\n● Đã hoàn thành · Ưu tiên Trung bình');
});
