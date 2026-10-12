import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import test from 'node:test';
import { createRuntimeApi, openRuntimeDatabase } from './runtime-api.mjs';

function dispatch(server, method, url, body, token) {
  return new Promise((resolve, reject) => {
    const request = Readable.from(body ? [Buffer.from(JSON.stringify(body))] : []);
    Object.assign(request, { method, url, headers: { ...(token ? { authorization: `Bearer ${token}` } : {}) } });
    const chunks = [];
    const response = {
      writeHead(status) { this.status = status; },
      end(chunk) { if (chunk) chunks.push(chunk); resolve({ status: this.status, data: JSON.parse(Buffer.concat(chunks.map(item => Buffer.from(item))).toString()) }); },
      on() { return this; },
    };
    server.emit('request', request, response);
    request.on('error', reject);
  });
}

test('saved provider output is available only through authenticated history', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'pdf-reader-history-'));
  const db = openRuntimeDatabase(join(directory, 'runtime.sqlite'), { email: 'fixture@example.invalid', password: 'fixture-only-password-123', displayName: 'Fixture User' });
  const content = JSON.stringify({ review: { approved: false, count: 0, note: '' }, items: [{ name: 'First', ready: false }] });
  const server = createRuntimeApi({ db, openRouter: async () => ({ content, receipt: { requestId: 'fixture-request', model: 'fixture-model', provider: 'openrouter' } }) });
  try {
    const prior = { email: process.env.BOOTSTRAP_ADMIN_EMAIL, password: process.env.BOOTSTRAP_ADMIN_PASSWORD, mode: process.env.NODE_ENV };
    process.env.BOOTSTRAP_ADMIN_EMAIL = 'fixture@example.invalid';
    process.env.BOOTSTRAP_ADMIN_PASSWORD = 'fixture-only-password-123';
    process.env.NODE_ENV = 'test';
    try {
      const demo = await dispatch(server, 'GET', '/api/auth/demo-credentials');
      assert.equal(demo.status, 200);
      assert.equal(demo.data.email, 'fixture@example.invalid');
      assert.equal(demo.data.password, 'fixture-only-password-123');
    } finally {
      for (const [key, value] of Object.entries({ BOOTSTRAP_ADMIN_EMAIL: prior.email, BOOTSTRAP_ADMIN_PASSWORD: prior.password, NODE_ENV: prior.mode })) {
        if (value === undefined) delete process.env[key]; else process.env[key] = value;
      }
    }
    const login = await dispatch(server, 'POST', '/api/auth/login', { email: 'fixture@example.invalid', password: 'fixture-only-password-123' });
    assert.equal(login.status, 200);
    assert.equal((await dispatch(server, 'GET', '/api/runtime-ai/history')).status, 401);
    const generated = await dispatch(server, 'POST', '/api/runtime-ai/document-readiness', { workflowSummary: 'Fixture workflow summary for document readiness review.' }, login.data.token);
    assert.equal(generated.status, 200);
    assert.equal(generated.data.result, content);
    const history = await dispatch(server, 'GET', '/api/runtime-ai/history', null, login.data.token);
    assert.equal(history.status, 200);
    assert.equal(history.data.history.length, 1);
    assert.equal(history.data.history[0].result, content);
  } finally {
    server.close();
    db.close();
    rmSync(directory, { recursive: true, force: true });
  }
});
