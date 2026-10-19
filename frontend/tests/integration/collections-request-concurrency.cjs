const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { createDragUsers } = require('../support/test-users.cjs');
(async () => {
  const fixture = createDragUsers(1);
  try {
    const base = 'http://127.0.0.1:8000/api';
    const login = await fetch(base + '/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(fixture.accounts[0]) });
    assert.equal(login.status, 200);
    const { access_token } = await login.json();
    const send = (method, path, body) => fetch(base + path, { method, headers: { Authorization: `Bearer ${access_token}`, 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
    for (const [path, input] of [['/tasks', { title: 'Concurrent task' }], ['/calendar/events', {
      title: 'Concurrent event', starts_at: '2026-10-16T09:00:00+07:00', ends_at: '2026-10-16T10:00:00+07:00',
    }]]) {
      const payload = { ...input, client_request_id: randomUUID() };
      const responses = await Promise.all(Array.from({ length: 8 }, () => send('POST', path, payload)));
      assert.ok(responses.every(response => response.status === 201));
      const rows = await Promise.all(responses.map(response => response.json()));
      assert.equal(new Set(rows.map(row => row.id)).size, 1);
      assert.equal((await send('POST', path, { ...payload, title: 'Different' })).status, 409);
      const row = rows[0];
      const guard = new URLSearchParams(path === '/tasks' ? { expected_version: String(row.version) } : { expected_updated_at: row.updated_at });
      assert.equal((await send('DELETE', `${path}/${row.id}?${guard}`)).status, 204);
      assert.equal((await send('POST', path, payload)).status, 410);
    }
    console.log('PASS: PostgreSQL parallel creates return one Task/Event per request UUID; mismatched payloads conflict and deleted creates stay deleted.');
  } finally { fixture.cleanup(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
