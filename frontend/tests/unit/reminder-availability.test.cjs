const {test}=require('node:test');const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),Module=require('node:module'),ts=require('typescript');
const filename=path.resolve(__dirname,'../../src/features/reminders/reminderUtils.ts');const compiled=new Module(filename,module);
compiled._compile(ts.transpileModule(fs.readFileSync(filename,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020}}).outputText,filename);
const {reminderAvailable,reminderBeyondLimit}=compiled.exports;
const now=Date.parse('2026-10-21T12:00:00+07:00');
test('missing, invalid and expired deadline/start disable reminder selection',()=>{
 for(const anchor of [null,undefined,'','invalid','2026-10-20T09:00:00+07:00','2026-10-21T12:00:00+07:00'])assert.equal(reminderAvailable(anchor,false,now),false,anchor);
});
test('a future date with an elapsed hour stays disabled until the time is future',()=>{
 assert.equal(reminderAvailable('2026-10-21T11:59:00+07:00',false,now),false);
 assert.equal(reminderAvailable('2026-10-21T12:01:00+07:00',false,now),true);
});
test('ongoing timed event allows a custom reminder until its exclusive end',()=>{
 assert.equal(reminderAvailable('2026-10-21T11:00:00+07:00',false,now,'2026-10-21T14:00:00+07:00'),true);
});
test('date-only tasks expire at the next Vietnam midnight',()=>{
 assert.equal(reminderAvailable('2026-10-21T00:00:00+07:00',true,now),true);
 assert.equal(reminderAvailable('2026-10-20T00:00:00+07:00',true,now),false);
 assert.equal(reminderAvailable('2026-10-21T00:00:00+07:00',true,Date.parse('2026-10-22T00:00:00+07:00')),false);
});
test('multi-day all-day notes/events use their whole exclusive date range',()=>{
 const start='2026-10-19T00:00:00+07:00',end='2026-10-23T00:00:00+07:00';
 assert.equal(reminderAvailable(start,true,now,end),true);
 assert.equal(reminderAvailable(start,true,Date.parse(end),end),false);
 assert.equal(reminderAvailable(start,true,now,'invalid'),false);
 assert.equal(reminderAvailable(end,true,now,start),false);
});

test('reminder limits distinguish exact task deadlines, date-only tasks and exclusive appointment ends',()=>{
 const start='2026-10-21T11:00:00+07:00',end='2026-10-21T14:00:00+07:00';
 assert.equal(reminderAvailable(start,false,Date.parse(end),end),false);
 assert.equal(reminderBeyondLimit('2026-10-21T13:59:00+07:00',start,false,end),false);
 assert.equal(reminderBeyondLimit(end,start,false,end),true);
 assert.equal(reminderBeyondLimit('2026-10-22T09:00:00+07:00',start,false,end),true);
 assert.equal(reminderBeyondLimit(start,start,false),false);
 assert.equal(reminderBeyondLimit('2026-10-21T11:01:00+07:00',start,false),true);
 assert.equal(reminderBeyondLimit('2026-10-22T00:00:00+07:00','2026-10-21T00:00:00+07:00',true),true);
});
