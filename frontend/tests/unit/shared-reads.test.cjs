const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),Module=require('node:module'),ts=require('typescript');
const filename=path.resolve(__dirname,'../../src/services/sharedReads.ts'),m=new Module(filename,module);m._compile(ts.transpileModule(fs.readFileSync(filename,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020}}).outputText,filename);
const {SharedReads}=m.exports;
function deferred(){let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return{promise,resolve,reject};}
const flush=()=>new Promise(resolve=>setImmediate(resolve));
test('B: one consumer cancels, the other receives one shared fetch',async()=>{
 const pool=new SharedReads(),job=deferred(),a=new AbortController(),b=new AbortController();let calls=0,aborts=0;
 const start=signal=>{calls++;signal.addEventListener('abort',()=>aborts++);return job.promise;};
 const first=pool.run('key','a',a.signal,start),second=pool.run('key','a',b.signal,start);await flush();a.abort();await assert.rejects(first,{name:'AbortError'});job.resolve(42);assert.equal(await second,42);assert.equal(calls,1);assert.equal(aborts,0);assert.equal(pool.size,0);
});
test('B: all consumers cancel once; a new filter has a separate request',async()=>{
 const pool=new SharedReads(),a=new AbortController(),b=new AbortController(),job=deferred();let aborts=0;
 const start=signal=>{signal.addEventListener('abort',()=>aborts++);return job.promise;};
 const first=pool.run('old','a',a.signal,start),second=pool.run('old','a',b.signal,start);await flush();a.abort();await assert.rejects(first,{name:'AbortError'});
 assert.equal(await pool.run('new','a',undefined,async()=>9),9);assert.equal(pool.size,1);b.abort();await assert.rejects(second,{name:'AbortError'});await flush();assert.equal(aborts,1);assert.equal(pool.size,0);
});
test('B: failed and completed promises are removed; logout rejects late results',async()=>{
 const pool=new SharedReads();await assert.rejects(pool.run('x','a',undefined,async()=>{throw Error('offline');}));assert.equal(pool.size,0);
 assert.equal(await pool.run('x','a',undefined,async()=>2),2);assert.equal(await pool.run('x','a',undefined,async()=>3),3);
 const old=deferred(),pending=pool.run('x','a',undefined,()=>old.promise);await flush();pool.setSession('b');await assert.rejects(pending,{name:'AbortError'});old.resolve(1);await flush();assert.equal(pool.size,0);assert.equal(await pool.run('x','b',undefined,async()=>4),4);
});
test('StrictMode cleanup/remount in the same turn reuses the active transport',async()=>{
 const pool=new SharedReads(),job=deferred(),a=new AbortController();let calls=0;
 const start=()=>{calls++;return job.promise;};const first=pool.run('x','a',a.signal,start);a.abort();const second=pool.run('x','a',undefined,start);
 await assert.rejects(first,{name:'AbortError'});job.resolve(1);assert.equal(await second,1);assert.equal(calls,1);
});
