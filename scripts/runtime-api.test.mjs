import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { createRuntimeApi, openRuntimeDatabase } from './runtime-api.mjs';

test('authenticates a database identity, rejects anonymous AI, and persists provider evidence', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'pdf-reader-api-'));
  const db = openRuntimeDatabase(join(directory, 'runtime.sqlite'), { email: 'admin@test.invalid', password: 'Strong-runtime-password-123', displayName: 'Runtime Admin' });
  const openRouter = async () => ({ content: 'Review provenance, failure handling, retention, and explicit human acceptance controls.', receipt: { requestId: 'request-test-1', model: 'provider/model', provider: 'openrouter' } });
  const server = createRuntimeApi({ db, openRouter, allowedOrigin: 'http://127.0.0.1:30941' });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  const base = `http://127.0.0.1:${address.port}`;
  try {
    assert.equal((await fetch(`${base}/api/health/ready`)).status, 200);
    assert.equal((await fetch(`${base}/api/runtime-ai/document-readiness`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ workflowSummary: 'Deidentified operational workflow summary.' }) })).status, 401);
    const login = await fetch(`${base}/api/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: 'admin@test.invalid', password: 'Strong-runtime-password-123' }) });
    assert.equal(login.status, 200);
    const identity = await login.json();
    const me = await fetch(`${base}/api/auth/me`, { headers: { Authorization: `Bearer ${identity.token}` } });
    assert.equal((await me.json()).user.id, identity.user.id);
    const ai = await fetch(`${base}/api/runtime-ai/document-readiness`, { method: 'POST', headers: { Authorization: `Bearer ${identity.token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ workflowSummary: 'Deidentified document operations retain local bytes and require human review.' }) });
    assert.equal(ai.status, 200);
    const result = await ai.json();
    assert.equal(result.providerReceipt.requestId, 'request-test-1');
    assert.equal(db.prepare('SELECT count(*) count FROM runtime_ai_results').get().count, 1);
  } finally {
    await new Promise(resolve => server.close(resolve));
    db.close();
    rmSync(directory, { recursive: true, force: true });
  }
});
