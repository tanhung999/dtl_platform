const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),Module=require('node:module'),ts=require('typescript');
const filename=path.resolve(__dirname,'../../src/features/notes/noteView.ts');
const compiled=new Module(filename,module);compiled.paths=module.paths;
compiled._compile(ts.transpileModule(fs.readFileSync(filename,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020}}).outputText,filename);
const {shortNoteDate}=compiled.exports;

test('compact footer dates always use slashes and Vietnam day boundaries',()=>{
 assert.equal(shortNoteDate('2026-10-15T17:30:00Z'),'16/10');
});

test('creation time after Vietnam midnight stays on the 22nd regardless of device timezone', () => {
 const previous = process.env.TZ;
 try {
  for (const zone of ['Asia/Ho_Chi_Minh', 'UTC', 'America/Los_Angeles', 'Asia/Tokyo', 'Pacific/Kiritimati']) {
   process.env.TZ = zone;
   assert.equal(shortNoteDate('2026-10-21T18:00:00Z'), '22/10');
  }
 } finally { if (previous === undefined) delete process.env.TZ; else process.env.TZ = previous; }
});
