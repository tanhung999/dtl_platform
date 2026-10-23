const {test}=require('node:test');
const assert=require('node:assert/strict');
const catalog=require('../../src/theme/catalog.json');
const rgba=value=>{
 if(value.startsWith('#')){
  let h=value.slice(1);if(h.length===3||h.length===4)h=[...h].map(c=>c+c).join('');
  return [0,2,4].map(i=>parseInt(h.slice(i,i+2),16)/255).concat(h.length===8?parseInt(h.slice(6),16)/255:1);
 }
 const parts=value.match(/rgba?\(([^)]+)\)/)?.[1].split(/[, /]+/).map(Number);
 assert.ok(parts,'Unsupported color '+value);return parts.slice(0,3).map(n=>n/255).concat(parts[3]??1);
};
const over=(fg,bg)=>fg.slice(0,3).map((n,i)=>n*fg[3]+bg[i]*(1-fg[3])).concat(1);
const luminance=rgb=>rgb.slice(0,3).map(n=>n<=.04045?n/12.92:((n+.055)/1.055)**2.4).reduce((sum,n,i)=>sum+n*[.2126,.7152,.0722][i],0);
const ratio=(fg,bg)=>(Math.max(luminance(fg),luminance(bg))+.05)/(Math.min(luminance(fg),luminance(bg))+.05);
function colors(theme){
 const tokens={...catalog.common,...catalog.modes.light,...catalog.modes[theme.mode],...theme.tokens};
 const resolve=key=>tokens[key].startsWith('var(')?resolve(tokens[key].slice(4,-1)):tokens[key];
 return key=>rgba(resolve(key));
}
test('all nine themes keep body, secondary, helper and link text readable on their surfaces',()=>{
 for(const [id,theme]of Object.entries(catalog.themes)){
  const color=colors(theme);
  for(const surface of ['--bg-card-solid','--bg-surface','--bg-subtle','--input-bg','--primary-light']){
   const bg=over(color(surface),color('--bg-main'));
   for(const ink of ['--text-main','--text-secondary','--text-muted','--text-sub','--accent-text']){
    const contrast=ratio(over(color(ink),bg),bg);assert.ok(contrast>=4.5,`${id}: ${ink} on ${surface} = ${contrast.toFixed(2)}`);
   }
  }
 }
});
test('solid selected buttons and every gradient stop have readable foregrounds',()=>{
 for(const [id,theme]of Object.entries(catalog.themes)){
  const color=colors(theme);const tokens={...catalog.modes[theme.mode],...theme.tokens};
  for(const bg of [color('--accent'),...tokens['--accent-gradient'].match(/#[a-f\d]+/gi).map(rgba)]){
   assert.ok(ratio(color('--on-accent'),bg)>=4.5,id+' primary button');
  }
  assert.ok(ratio(color('--on-calendar-selected'),color('--calendar-selected-bg'))>=4.5,id+' selected calendar day');
 }
});
test('error, success, warning and event status text remain readable in both modes',()=>{
 for(const [id,theme]of Object.entries(catalog.themes)){
  const color=colors(theme);
  for(const [ink,surface]of [['--error','--error-bg'],['--success-text','--success-bg'],['--warning-text','--bg-surface']])assert.ok(ratio(color(ink),color(surface))>=4.5,id+' '+ink);
  for(const [key,tint]of [['ended','#16a34a'],['ongoing','#2563eb'],['upcoming','#eab308']]){
   const bg=over([...rgba(tint).slice(0,3),.208],color('--bg-card-solid'));
   assert.ok(ratio(color('--status-'+key+'-text'),bg)>=4.5,id+' '+key);
  }
 }
});

test('themed note actions remain readable on every light paper color',()=>{
 for(const [id,theme]of Object.entries(catalog.themes)){
  const color=colors(theme);
  assert.ok(ratio(color('--note-pin-color'),rgba('#ffffff'))>=4.5,id+' pin button');
  for(const paper of ['#fef08a','#bbf7d0','#bfdbfe','#fbcfe8','#e9d5ff','#ffffff']){
   const surface=over([1,1,1,.75],rgba(paper));
   assert.ok(ratio(color('--accent-on-paper'),surface)>=4.5,id+' note action on '+paper);
  }
 }
});
