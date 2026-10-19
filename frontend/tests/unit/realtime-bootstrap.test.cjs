const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),Module=require('node:module'),ts=require('typescript');
function load(file){const filename=path.resolve(__dirname,'../../src/services',file),m=new Module(filename,module);m.require=Module.createRequire(filename);m._compile(ts.transpileModule(fs.readFileSync(filename,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020}}).outputText,filename);return m.exports;}
const {RealtimeBootstrap}=load('realtimeBootstrap.ts');
const flush=()=>new Promise(resolve=>setImmediate(resolve));
test('A: fallback snapshot N then commit N+1 before ready reloads only changed scope',async()=>{
 const changes=[],boot=new RealtimeBootstrap(topics=>changes.push(topics),0);boot.setSession('a');
 await boot.wait();boot.observeRead('tasks',{tasks:4});boot.observeRead('notes',{notes:7});
 boot.receive({kind:'ready',versions:{tasks:5,notes:7}});await flush();assert.deepEqual(changes,[['tasks']]);
 boot.receive({kind:'change',versions:{tasks:5}});await flush();assert.equal(changes.length,1);boot.dispose();
});
test('A: commit between subscribe and ready is not applied twice through NOTIFY',async()=>{
 const changes=[],boot=new RealtimeBootstrap(topics=>changes.push(topics),0);boot.setSession('a');await boot.wait();boot.observeRead('tasks',{tasks:1});
 boot.receive({kind:'ready',versions:{tasks:2}});boot.receive({kind:'change',versions:{tasks:2}});await flush();assert.deepEqual(changes,[['tasks']]);boot.dispose();
});
test('A: late unchanged ready and in-flight current snapshot do not reload',async()=>{
 const changes=[],boot=new RealtimeBootstrap(topics=>changes.push(topics),0);boot.setSession('a');await boot.wait();
 boot.observeRead('notes',{notes:8});boot.receive({kind:'ready',versions:{notes:8,tasks:3}});boot.observeRead('tasks',{tasks:3});await flush();assert.deepEqual(changes,[]);boot.dispose();
});
test('ready opens the gate; repeated reconnect snapshots only invalidate newer versions',async()=>{
 const changes=[],boot=new RealtimeBootstrap(topics=>changes.push(topics),1500);boot.setSession('a');let opened=false;
 const pending=boot.wait().then(()=>opened=true);await flush();assert.equal(opened,false);
 boot.receive({kind:'ready',versions:{tasks:4}});await pending;
 boot.receive({kind:'ready',versions:{tasks:4}});boot.receive({kind:'ready',versions:{tasks:5}});boot.receive({kind:'change',versions:{tasks:5}});await flush();assert.deepEqual(changes,[['tasks']]);boot.dispose();
});
test('fallback response N arriving after ready N+1 still triggers scoped recovery',async()=>{
 const changes=[],boot=new RealtimeBootstrap(topics=>changes.push(topics),0);boot.setSession('a');await boot.wait();
 boot.receive({kind:'ready',versions:{tasks:3,notes:2}});boot.observeRead('old-task-response',{tasks:2});boot.observeRead('current-notes-response',{notes:2});
 await flush();assert.deepEqual(changes,[['tasks']]);boot.dispose();
});
test('logout cancels startup waits and drops previous-session snapshots',async()=>{
 const changes=[],boot=new RealtimeBootstrap(topics=>changes.push(topics));boot.setSession('a');const pending=boot.wait();boot.setSession('b');await assert.rejects(pending,{name:'AbortError'});boot.receive({kind:'ready',versions:{tasks:0}});await flush();assert.deepEqual(changes,[]);boot.dispose();
});
