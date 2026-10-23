const { test }=require('node:test');const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),Module=require('node:module'),ts=require('typescript');
function compile(relative,deps={}){const filename=path.resolve(__dirname,'../../src/features',relative);const result=new Module(filename,module);result.require=name=>deps[name]||Module.createRequire(filename)(name);result._compile(ts.transpileModule(fs.readFileSync(filename,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020}}).outputText,filename);return result.exports;}
const dates=compile('calendar/dateUtils.ts');
const tips=compile('calendar/itemTooltip.ts',{'./dateUtils':dates,'./eventStatus':compile('calendar/eventStatus.ts'),'../tasks/deadlineUtils':compile('tasks/deadlineUtils.ts')});
const shared=compile('calendar-sharing/sharedItemUtils.ts',{'../calendar/dateUtils':dates,'../calendar/itemTooltip':tips});
test('shared details show the complete multi-day Vietnam range',()=>{
 const previous=process.env.TZ;try{for(const zone of ['UTC','America/New_York']){process.env.TZ=zone;assert.equal(shared.sharedRangeLabel({kind:'event',starts_at:'2026-10-17T02:00:00Z',ends_at:'2026-10-19T03:00:00Z'}),'17/10/2026 09:00 – 19/10/2026 10:00');}}finally{if(previous===undefined)delete process.env.TZ;else process.env.TZ=previous;}
});
test('shared all-day end dates remain exclusive and timed deadlines remain points',()=>{
 assert.equal(shared.sharedRangeLabel({kind:'note',is_all_day:true,starts_at:'2026-10-16T17:00:00Z',ends_at:'2026-10-18T17:00:00Z'}),'17/10/2026 – 18/10/2026 · Cả ngày');
 const task=shared.sharedTask({id:'a',kind:'task',title:'Deadline',due_date:'2026-10-18',due_time:'16:56'});assert.equal(task.due_time,'16:56');assert.equal(task.is_completed,false);assert.equal(task.starts_at,undefined);
});
test('shared scope filtering distinguishes scheduled notes, events and deadlines',()=>{
 const scope={share_events:true,share_notes:false,share_tasks:false};assert.equal(shared.permitted({kind:'note'},scope),false);assert.equal(shared.permitted({kind:'event'},scope),true);assert.equal(shared.permitted({kind:'task'},scope),false);
 const items=[{id:'a',kind:'event',starts_at:'2026-10-17T17:00:00Z',ends_at:'2026-10-18T17:00:00Z'},{id:'b',kind:'task',due_date:'2026-10-18'}];assert.equal(shared.sharedItemsOnDay(items,dates.parseDate('2026-10-18')).length,2);assert.equal(shared.sharedItemsOnDay(items,dates.parseDate('2026-10-19')).length,0);
});

test('shared calendar uses the same concise tooltip as the owner calendar',()=>{
 const item={id:'span',kind:'note',title:'bbb',is_all_day:true,starts_at:'2026-10-14T00:00:00+07:00',ends_at:'2026-10-26T00:00:00+07:00'};
 assert.equal(shared.sharedItemTooltip(item,new Date('2026-10-21T05:00:00Z')),'bbb\nCả ngày · 14/10 – 25/10 (12 ngày)\n● Đang diễn ra · ngày thứ 8/12');
});
