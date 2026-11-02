const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),Module=require('node:module'),ts=require('typescript');
function load(relative,deps={}) {
 const filename=path.resolve(__dirname,'../../src/'+relative+'.ts'),m=new Module(filename,module);
 m.require=name=>deps[name]||Module.createRequire(filename)(name);
 m._compile(ts.transpileModule(fs.readFileSync(filename,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS}}).outputText,filename);
 return m.exports;
}
const reminders=load('features/reminders/reminderUtils');
const {sameFields,sameSchedule}=load('services/unchanged',{'../features/reminders/reminderUtils':reminders});
test('identical follower IDs and reverted values compare by content',()=>{
 assert.equal(sameFields({title:'Task',followers:['a','b'],description:''},{title:'Task',followers:['a','b'],description:null}),true);
 assert.equal(sameFields({followers:['a','c']},{followers:['a','b']}),false);
 assert.equal(sameFields({active:false},{active:true}),false);
});
test('repeating notification equality uses its clock while single reminders keep the date',()=>{
 const a={reminder_repeat:true,reminder_at:'2026-11-02T08:30:00+07:00'};
 const b={...a,reminder_at:'2026-11-09T08:30:00+07:00'};
 assert.equal(reminders.sameReminder(a,b),true);
 assert.equal(reminders.sameReminder({...a,reminder_repeat:false},{...b,reminder_repeat:false}),false);
 assert.equal(reminders.sameReminder(a,{...b,reminder_at:'2026-11-09T08:31:00+07:00'}),false);
 const schedule={starts_at:'2026-11-02T09:00:25+07:00',ends_at:'2026-11-02T10:00:45+07:00',is_all_day:false,recurrence:'WEEKLY'};
 assert.equal(sameSchedule({...schedule,...a},{...schedule,...b}),true);
});
