const {chromium}=require('../.browser-tools/node_modules/playwright');
const {createTestUsers}=require('../support/test-users.cjs');
const assert=require('node:assert/strict');const catalog=require('../../src/theme/catalog.json');
const base=process.env.PLATFORM_BASE_URL||'http://127.0.0.1:5173';
async function read(page,theme,area){return page.evaluate(({theme,area})=>{
 const canvas=document.createElement('canvas');canvas.width=canvas.height=1;const ctx=canvas.getContext('2d',{willReadFrequently:true});
 const rgba=color=>{ctx.clearRect(0,0,1,1);ctx.fillStyle=color;ctx.fillRect(0,0,1,1);return [...ctx.getImageData(0,0,1,1).data].map((n,i)=>i===3?n/255:n);};
 const over=(fg,bg)=>fg.slice(0,3).map((n,i)=>n*fg[3]+bg[i]*(1-fg[3])).concat(1);
 const bg=el=>{if(!el)return [255,255,255,1];return over(rgba(getComputedStyle(el).backgroundColor),bg(el.parentElement));};
 const lum=a=>a.slice(0,3).map(n=>n/255).map(n=>n<=.04045?n/12.92:((n+.055)/1.055)**2.4).reduce((v,n,i)=>v+n*[.2126,.7152,.0722][i],0);
 // Geometry of gradients is checked separately against every color stop in unit tests.
 const localGradient=el=>{for(let node=el;node&&node!==document.body;node=node.parentElement){const style=getComputedStyle(node);if(style.backgroundImage!=='none')return true;if(rgba(style.backgroundColor)[3]===1)return false;}return false;};
 const results=[];
 for(const el of document.querySelectorAll('body *')){
  if(['SCRIPT','STYLE','SVG','OPTION'].includes(el.tagName)||!el.getBoundingClientRect().width||!el.getBoundingClientRect().height||getComputedStyle(el).visibility==='hidden'||el.closest('[disabled]'))continue;
  if(localGradient(el))continue;
  const text=[...el.childNodes].filter(n=>n.nodeType===3).map(n=>n.textContent.trim()).filter(Boolean).join(' ');if(!text)continue;
  const s=getComputedStyle(el),b=bg(el),f=over(rgba(s.color),b);const ratio=(Math.max(lum(f),lum(b))+.05)/(Math.min(lum(f),lum(b))+.05);
  const large=parseFloat(s.fontSize)>=24||(parseFloat(s.fontSize)>=18.66&&Number(s.fontWeight)>=700);
  if(ratio<(large?3:4.5))results.push({theme,area,text:text.slice(0,75),tag:el.tagName,class:el.className,ratio:+ratio.toFixed(2),color:s.color,bg:b.slice(0,3).map(Math.round)});
 }
 return results;
},{theme,area});}
(async()=>{const fixture=createTestUsers(1);let browser;const out=[];try{
 browser=await chromium.launch({channel:'msedge',headless:true});const page=await browser.newPage({viewport:{width:1500,height:1100}});await page.route(/fonts\.(googleapis|gstatic)\.com/,r=>r.abort());
 for(const id of Object.keys(catalog.themes)){await page.goto(base);await page.evaluate(id=>localStorage.setItem('dtl_theme',id),id);await page.reload();out.push(...await read(page,id,'login'));}
 await page.getByLabel('Tên đăng nhập hoặc Email').fill(fixture.accounts[0].username);await page.getByLabel('Mật khẩu',{exact:true}).fill(fixture.accounts[0].password);await page.getByRole('button',{name:'Đăng nhập hệ thống'}).click();await page.locator('.calendar-widget').waitFor();
 const day=await page.evaluate(()=>new Date(Date.now()+86400000*2).toLocaleDateString('en-CA',{timeZone:'Asia/Ho_Chi_Minh'}));
 const note=await page.evaluate(async day=>{const r=await fetch('/api/notes',{method:'POST',headers:{Authorization:'Bearer '+localStorage.getItem('dtl_platform_token'),'Content-Type':'application/json'},body:JSON.stringify({title:'Reading note',content:'Nội dung ghi chú',calendar_schedule:{starts_at:day+'T09:00:00+07:00',ends_at:day+'T10:00:00+07:00'}})});return r.json();},day);
 for(const [id,theme]of Object.entries(catalog.themes)){
  await page.evaluate(id=>localStorage.setItem('dtl_theme',id),id);await page.reload();await page.locator('.calendar-widget').waitFor();out.push(...await read(page,id,'workspace'));
  await page.locator(`[data-note-id="${note.id}"] .note-title`).click();const editor=page.getByRole('dialog',{name:'Ghi chú',exact:true});await editor.getByLabel('Thời gian nhắc nhở',{exact:true}).selectOption('custom');await editor.getByLabel('Ngày nhắc hạn',{exact:true}).fill('01/01/2099');for(const color of ['Vàng','Xanh Lá','Xanh Biển','Hồng','Tím','Trắng']){await editor.getByTitle(color,{exact:true}).click();out.push(...await read(page,id,'note '+color));}await editor.getByRole('button',{name:'Đóng ghi chú',exact:true}).click();
  await page.getByRole('button',{name:'Profile',exact:true}).click();out.push(...await read(page,id,'profile'));await page.getByRole('button',{name:'Workspace',exact:true}).click();
 }
 assert.deepEqual(out,[],'Low contrast visible text: '+JSON.stringify(out));console.log('PASS: all nine themes keep login, workspace, profile and six Notes paper colors readable; helper text and reminder warnings included.');
}finally{if(browser)await browser.close();fixture.cleanup();}})().catch(e=>{console.error(e);process.exitCode=1;});
