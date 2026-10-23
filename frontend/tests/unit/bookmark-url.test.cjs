const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),Module=require('node:module'),ts=require('typescript');
const filename=path.resolve(__dirname,'../../src/features/bookmarks/bookmarkUrl.ts');
const compiled=new Module(filename,module);
compiled._compile(ts.transpileModule(fs.readFileSync(filename,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020}}).outputText,filename);
const {bookmarkUrl}=compiled.exports;
test('bookmark URLs normalize domains, internal hosts and HTTP(S) protocols',()=>{
 for(const [input,expected] of [[' example.com ','https://example.com/'],['HTTPS://example.com','https://example.com/'],['localhost:8000/path','https://localhost:8000/path'],['http://10.0.0.1:8080','http://10.0.0.1:8080/']])assert.equal(bookmarkUrl(input),expected);
});
test('bookmark URLs reject scripts, credentials, invalid ports and database overflow',()=>{
 for(const input of ['javascript:alert(1)','data:text/html,test','ftp://example.com','https://user:password@example.com','https://','https://example.com:99999','https://example.com/'+'x'.repeat(500)])assert.throws(()=>bookmarkUrl(input),input);
});
