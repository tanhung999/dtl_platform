const {test}=require('node:test');const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),Module=require('node:module'),ts=require('typescript');
const filename=path.resolve(__dirname,'../../src/features/reminders/reminderUtils.ts');const compiled=new Module(filename,module);
compiled._compile(ts.transpileModule(fs.readFileSync(filename,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020}}).outputText,filename);
const {reminderAvailable,reminderBeyondLimit,nextReminderMinute}=compiled.exports;
const now=Date.parse('2026-10-21T12:00:00+07:00');
test('invalid dates are blocked while expired dates allow a future custom reminder',()=>{
 assert.equal(reminderAvailable('invalid',false,now),false);
 for(const anchor of ['2026-10-20T09:00:00+07:00','2026-10-21T12:00:00+07:00'])assert.equal(reminderAvailable(anchor,false,now),true,anchor);
});
test('custom reminders remain editable before and after the deadline',()=>{
 assert.equal(reminderAvailable('2026-10-21T11:59:00+07:00',false,now),true);
 assert.equal(reminderAvailable('2026-10-21T12:01:00+07:00',false,now),true);
});
test('ongoing timed event allows a custom reminder until its exclusive end',()=>{
 assert.equal(reminderAvailable('2026-10-21T11:00:00+07:00',false,now,'2026-10-21T14:00:00+07:00'),true);
});
test('date-only tasks keep custom reminders editable after their date',()=>{
 assert.equal(reminderAvailable('2026-10-21T00:00:00+07:00',true,now),true);
 assert.equal(reminderAvailable('2026-10-20T00:00:00+07:00',true,now),true);
 assert.equal(reminderAvailable('2026-10-21T00:00:00+07:00',true,Date.parse('2026-10-22T00:00:00+07:00')),true);
});
test('multi-day all-day notes/events use their whole exclusive date range',()=>{
 const start='2026-10-19T00:00:00+07:00',end='2026-10-23T00:00:00+07:00';
 assert.equal(reminderAvailable(start,true,now,end),true);
 assert.equal(reminderAvailable(start,true,Date.parse(end),end),true);
 assert.equal(reminderAvailable(start,true,now,'invalid'),false);
 assert.equal(reminderAvailable(end,true,now,start),false);
});

test('reminder limits distinguish exact task deadlines, date-only tasks and exclusive appointment ends',()=>{
 const start='2026-10-21T11:00:00+07:00',end='2026-10-21T14:00:00+07:00';
 assert.equal(reminderAvailable(start,false,Date.parse(end),end),true);
 assert.equal(reminderBeyondLimit('2026-10-21T13:59:00+07:00',start,false,end,now),false);
 assert.equal(reminderBeyondLimit(end,start,false,end,now),true);
 assert.equal(reminderBeyondLimit('2026-10-22T09:00:00+07:00',start,false,end,now),true);
 assert.equal(reminderBeyondLimit(start,start,false,undefined,Date.parse(start)-1),false);
 assert.equal(reminderBeyondLimit('2026-10-21T11:01:00+07:00',start,false,undefined,Date.parse(start)-1),true);
 assert.equal(reminderBeyondLimit('2026-10-22T00:00:00+07:00','2026-10-21T00:00:00+07:00',true,undefined,now),true);
});


test('no deadline allows an absolute reminder without inventing a cutoff',()=>{
 for(const anchor of [null,undefined,'']) {
  assert.equal(reminderAvailable(anchor,false,now),true);
  assert.equal(reminderBeyondLimit('2099-01-01T09:00:00+07:00',anchor,false),false);
 }
 assert.equal(reminderAvailable(null,false,now,'invalid'),false);
});


test('a past task/event can remind after its old cutoff without changing the schedule',()=>{
 const past='2026-10-20T09:00:00+07:00',end='2026-10-20T10:00:00+07:00',future='2026-10-22T09:00:00+07:00';
 assert.equal(reminderBeyondLimit(future,past,false,undefined,now),false);
 assert.equal(reminderBeyondLimit(future,past,false,end,now),false);
 assert.equal(reminderBeyondLimit(future,past,true,end,now),false);
});


test('custom defaults respect whole-minute precision near an exclusive end',()=>{
 const at=Date.parse('2099-01-01T09:59:30+07:00'),end=Date.parse('2099-01-01T10:00:00+07:00');
 assert.equal(nextReminderMinute(end-30*60000,at,end,true),null);
 assert.equal(nextReminderMinute(end-30*60000,at,end,false),end);
 assert.equal(nextReminderMinute(at+30*60000,at,null,false)%60000,0);
 assert.ok(nextReminderMinute(end-30*60000,end+1,end,true)>end+1);
});
