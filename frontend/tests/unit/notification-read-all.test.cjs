const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), Module = require('node:module'), ts = require('typescript');

function load(responses) {
  const filename = path.resolve(__dirname, '../../src/features/notifications/api.ts');
  const compiled = new Module(filename, module), calls = [];
  let session = 'original-session';
  class ApiError extends Error { constructor(status) { super(`HTTP ${status}`); this.status = status; } }
  compiled.require = name => {
    if (name === '../../services/api') return { ApiError, getSessionKey: () => session };
    if (name === '../../services/requestTimeout') return { requestWithTimeout: async (url, options) => {
      calls.push({ url, ...options });
      const result = responses.shift();
      if (typeof result === 'number') throw new ApiError(result);
      if (typeof result === 'function') return result(() => { session = 'different-session'; }, ApiError);
      return result;
    } };
    throw new Error(`Unexpected dependency: ${name}`);
  };
  compiled._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText, filename);
  return { api: compiled.exports.notificationsApi, calls };
}

test('read-all retries a transient 503 once with exactly the same cutoff', async () => {
  const { api, calls } = load([503, undefined]);
  await api.readAll('2026-10-29T01:00:00Z');
  assert.equal(calls.length, 2);
  assert.deepEqual(calls[1], calls[0]);
  assert.deepEqual(JSON.parse(calls[0].body), { through: '2026-10-29T01:00:00Z' });
});

test('persistent 503 is reported after two attempts', async () => {
  const { api, calls } = load([503, 503]);
  await assert.rejects(api.readAll('2026-10-29T01:00:00Z'), error => error.status === 503);
  assert.equal(calls.length, 2);
});

test('other errors are not retried', async () => {
  const { api, calls } = load([403]);
  await assert.rejects(api.readAll('2026-10-29T01:00:00Z'), error => error.status === 403);
  assert.equal(calls.length, 1);
});

test('retry cannot mark notices read under a different login session', async () => {
  const { api, calls } = load([(changeSession, ApiError) => { changeSession(); throw new ApiError(503); }]);
  await assert.rejects(api.readAll('2026-10-29T01:00:00Z'), error => error.name === 'AbortError');
  assert.equal(calls.length, 1);
});
