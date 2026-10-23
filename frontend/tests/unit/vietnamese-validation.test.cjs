const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),Module=require('node:module'),ts=require('typescript');
function load(file){const filename=path.resolve(__dirname,'../../src/services/'+file+'.ts'),m=new Module(filename,module);m._compile(ts.transpileModule(fs.readFileSync(filename,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020}}).outputText,filename);return m.exports;}
const {vietnameseValidationMessage:message}=load('formValidation');
const {apiErrorMessage}=load('validationErrors');
test('native validation messages use Vietnamese for empty, malformed and constrained fields',()=>{
 assert.equal(message({valueMissing:true},{label:'Tên sự kiện',type:'text'}),'Vui lòng nhập tên sự kiện.');
 assert.equal(message({valueMissing:true},{label:'Mức ưu tiên',type:'select-one'}),'Vui lòng chọn mức ưu tiên.');
 assert.match(message({valueMissing:true},{type:'checkbox'}),/tích vào ô/);
 assert.match(message({typeMismatch:true},{type:'email'}),/email hợp lệ/);
 assert.match(message({typeMismatch:true},{type:'url'}),/liên kết hợp lệ/);
 assert.match(message({tooShort:true},{minLength:6}),/ít nhất 6 ký tự/);
 assert.match(message({tooLong:true},{maxLength:120}),/tối đa 120 ký tự/);
 assert.match(message({rangeUnderflow:true},{min:'1'}),/lớn hơn hoặc bằng 1/);
 assert.match(message({rangeOverflow:true},{max:'10'}),/nhỏ hơn hoặc bằng 10/);
 assert.match(message({patternMismatch:true},{label:'Số điện thoại'}),/định dạng số điện thoại/);
 assert.equal(message({valid:true}), '');
});
test('API validation errors never expose English schema errors or JSON and preserve Vietnamese business errors',()=>{
 assert.equal(apiErrorMessage([{type:'missing',loc:['body','title'],msg:'Field required'}],422),'Tiêu đề: Vui lòng nhập thông tin bắt buộc.');
 assert.match(apiErrorMessage([{type:'string_too_short',loc:['body','new_password'],ctx:{min_length:6},msg:'String should have at least 6 characters'}],422),/Mật khẩu mới:.*6 ký tự/);
 assert.match(apiErrorMessage([{type:'string_too_long',loc:['body','full_name'],ctx:{max_length:120}}],422),/Họ và tên:.*120 ký tự/);
 assert.match(apiErrorMessage([{type:'url_parsing',loc:['body','url'],msg:'Input should be a valid URL'}],422),/http hoặc https hợp lệ/);
 assert.equal(apiErrorMessage([{type:'value_error',msg:'Value error, Giờ kết thúc phải sau giờ bắt đầu.'}],422),'Giờ kết thúc phải sau giờ bắt đầu.');
 assert.equal(apiErrorMessage([{type:'literal_error',loc:['body','priority'],msg:'Input should be LOW'}],422),'Mức ưu tiên: Thông tin chưa hợp lệ. Vui lòng kiểm tra lại.');
 assert.equal(apiErrorMessage({message:'Công việc đã thay đổi.',current:{version:2}},409),'Công việc đã thay đổi.');
 assert.match(apiErrorMessage(null,500),/Không thể thực hiện yêu cầu/);
});
