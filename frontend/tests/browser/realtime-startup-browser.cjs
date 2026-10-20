// Bản build production, API thật; trì hoãn SSE bằng cổng Promise.
const {chromium}=require('../.browser-tools/node_modules/playwright');
const {createTestUsers}=require('../support/test-users.cjs');
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
function gate(){let release;const promise=new Promise(resolve=>release=resolve);return{promise,release};}
(async()=>{const fixture=createTestUsers(1);let browser;const gates=[];
try{
 browser=await chromium.launch({channel:'msedge',headless:true});const page=await browser.newPage();page.setDefaultTimeout(20000);
 const dist=path.resolve(__dirname,'../../dist');
 let delayed,arrived,holdTask,taskArrived,streams=0;const counts={};
 await page.route('**/*',async route=>{const url=new URL(route.request().url());
  if(url.pathname==='/')return route.fulfill({contentType:'text/html',body:fs.readFileSync(path.join(dist,'index.html'))});
  if(url.pathname.startsWith('/assets/'))return route.fulfill({path:path.join(dist,'assets',path.basename(url.pathname))});
  if(url.pathname==='/api/workspace/stream'){
   streams++;if(delayed){const pending=delayed;arrived.release();await pending.promise;}
  }
  if(url.pathname==='/api/tasks/collection'&&holdTask){
   const pending=holdTask;holdTask=undefined;const response=await route.fetch();taskArrived.release();await pending.promise;
   try{await route.fulfill({response});}catch{/* Its last consumer may have cancelled the stale response. */}return;
  }
  await route.continue();
 });
 page.on('response',response=>{const url=new URL(response.url());if(url.pathname.startsWith('/api/')&&response.request().method()==='GET'&&response.status()===200)counts[url.pathname]=(counts[url.pathname]||0)+1;});
 await page.goto('http://127.0.0.1:5173',{waitUntil:'domcontentloaded'});
 await page.getByLabel('Tên đăng nhập hoặc Email').fill(fixture.accounts[0].username);await page.getByLabel('Mật khẩu',{exact:true}).fill(fixture.accounts[0].password);await page.getByRole('button',{name:'Đăng nhập hệ thống'}).click();
 await page.getByText('Chưa có công việc trong nhóm này.',{exact:true}).waitFor();
 const token=await page.evaluate(()=>localStorage.getItem('dtl_platform_token'));
 async function reloading(){for(const key of Object.keys(counts))delete counts[key];delayed=gate();arrived=gate();gates.push(delayed);await page.reload({waitUntil:'domcontentloaded'});await arrived.promise;}
 const waitTasks=()=>page.waitForFunction(()=>document.querySelector('.tasks-widget')?.textContent.includes('Chưa có công việc trong nhóm này.'));
 // A3: let the 1.5s timeout release reads; no changes before late ready.
 await reloading();await waitTasks();assert.equal(counts['/api/tasks/collection'],1);
 const ready=page.waitForResponse(response=>new URL(response.url()).pathname==='/api/workspace/stream');delayed.release();delayed=undefined;await ready;
 // Drain browser tasks and the 80ms invalidation window, not a commit-order sleep.
 await page.waitForTimeout(300);for(const [endpoint,count]of Object.entries(counts))assert.equal(count,1,endpoint+' loaded twice');
 // A1: finish reads, commit a task before releasing SSE, then recover only task scopes.
 await reloading();await waitTasks();const before={...counts};
 const created=await page.request.post('http://127.0.0.1:5173/api/tasks',{headers:{Authorization:'Bearer '+token},data:{title:'Committed before SSE connection'}});assert.equal(created.status(),201);
 delayed.release();delayed=undefined;await page.getByText('Committed before SSE connection',{exact:true}).waitFor();await page.waitForTimeout(300);
 assert.equal(counts['/api/tasks/collection'],2);
 for(const endpoint of ['/api/notes/collection/page','/api/notifications/summary','/api/access/me'])assert.equal(counts[endpoint],before[endpoint],endpoint+' unrelated reload');
 // Drop the connection, commit while offline, then reconnect against durable versions.
 await page.context().setOffline(true);
 const response=await fetch('http://127.0.0.1:8000/api/tasks',{method:'POST',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},body:JSON.stringify({title:'Committed while browser offline'})});assert.equal(response.status,201);
 const previousStreams=streams;
 const reconnected=page.waitForResponse(response=>new URL(response.url()).pathname==='/api/workspace/stream'&&response.status()===200);reconnected.catch(()=>{});
 await page.context().setOffline(false);await reconnected;await page.getByText('Committed while browser offline',{exact:true}).waitFor();assert.ok(streams>previousStreams);
 // An invalidation must start a fresh read even while an older snapshot is in flight.
 holdTask=gate();taskArrived=gate();const oldResponse=holdTask;gates.push(oldResponse);
 await page.reload({waitUntil:'domcontentloaded'});await taskArrived.promise;
 const third=await page.request.post('http://127.0.0.1:5173/api/tasks',{headers:{Authorization:'Bearer '+token},data:{title:'Fresh read beats old snapshot'}});assert.equal(third.status(),201);
 await page.getByText('Fresh read beats old snapshot',{exact:true}).waitFor();oldResponse.release();await page.waitForTimeout(300);assert.equal(await page.getByText('Fresh read beats old snapshot',{exact:true}).count(),1);
 console.log('PASS: production reload one request per endpoint, delayed SSE timeout, unchanged late ready, scoped gap recovery, reconnect recovery and stale in-flight read replacement.');
}finally{for(const item of gates)item.release();await browser?.close();fixture.cleanup();}})().catch(error=>{console.error(error);process.exitCode=1;});
