const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const crypto = require('node:crypto');
const ts = require('typescript');
const source = ts.transpileModule(fs.readFileSync(path.resolve(__dirname, '../../src/services/requestId.ts'), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText;
function load(provider) {
  const context = { exports: {}, crypto: provider, Uint8Array };
  vm.runInNewContext(source, context);
  return context.exports.createRequestId;
}
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
test('request ID prefers the native UUID method with the correct Crypto receiver', () => {
  const provider = { randomUUID() { assert.equal(this, provider); return 'native'; } };
  assert.equal(load(provider)(), 'native');
});
test('HTTP fallback produces RFC 4122 version/variant bits and zero-padded hex', () => {
  assert.equal(load({ getRandomValues: bytes => bytes.fill(0) })(), '00000000-0000-4000-8000-000000000000');
  assert.equal(load({ getRandomValues: bytes => bytes.fill(255) })(), 'ffffffff-ffff-4fff-bfff-ffffffffffff');
});
test('HTTP fallback uses secure random bytes and distinct IDs for separate requests', () => {
  const create = load({ getRandomValues: bytes => crypto.webcrypto.getRandomValues(bytes) });
  const ids = Array.from({ length: 2000 }, create);
  assert.ok(ids.every(id => uuid.test(id)));
  assert.equal(new Set(ids).size, ids.length);
});
test('missing browser crypto produces a readable error instead of weak request IDs', () => {
  assert.throws(load(undefined), /Trình duyệt chưa hỗ trợ tạo mã yêu cầu/);
});
