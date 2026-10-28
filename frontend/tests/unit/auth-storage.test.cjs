const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const context = { exports: {} };
vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.resolve(__dirname, '../../src/services/authStorage.ts'), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
}).outputText, context);
const { TOKEN_KEY, USER_KEY, storedUserId, authStorageChanged } = context.exports;

test('existing storage keys remain compatible and cookie account changes invalidate other tabs', () => {
  assert.equal(TOKEN_KEY, 'dtl_platform_token');
  assert.equal(USER_KEY, 'dtl_platform_user');
  assert.equal(authStorageChanged({ key: TOKEN_KEY, oldValue: '', newValue: '' }), false);
  assert.equal(authStorageChanged({ key: USER_KEY, oldValue: '{"id":"admin"}', newValue: '{"id":"employee"}' }), true);
});
test('logout, login and bearer replacement invalidate the previous tab session', () => {
  for (const event of [
    { key: USER_KEY, oldValue: '{"id":"admin"}', newValue: null },
    { key: USER_KEY, oldValue: null, newValue: '{"id":"employee"}' },
    { key: TOKEN_KEY, oldValue: 'old', newValue: 'new' },
    { key: null, oldValue: null, newValue: null },
  ]) assert.equal(authStorageChanged(event), true);
});
test('profile metadata and theme changes do not reload an unchanged account', () => {
  assert.equal(authStorageChanged({ key: USER_KEY, oldValue: '{"id":"same","full_name":"Old"}',
    newValue: '{"id":"same","full_name":"New"}' }), false);
  assert.equal(authStorageChanged({ key: 'theme', oldValue: 'light', newValue: 'dark' }), false);
});
test('malformed stored metadata is handled without trusting an invalid account id', () => {
  for (const value of [null, '', 'not-json', '{}', '{"id":42}']) assert.equal(storedUserId(value), '');
  assert.equal(storedUserId('{"id":"account"}'), 'account');
});
