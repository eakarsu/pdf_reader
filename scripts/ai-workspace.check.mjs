import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { JSDOM } from 'jsdom';

const html = readFileSync(new URL('./ai-workspace.html', import.meta.url), 'utf8');
const report = JSON.stringify({ review: { approved: false, issueCount: 0, note: '' }, items: [{ name: 'First', ready: false }, { name: 'Second', ready: true }] });
const tick = () => new Promise(resolve => setTimeout(resolve, 0));

test('demo fill, presets, returned report and saved detail render without provider calls', async () => {
  const calls = [];
  const dom = new JSDOM(html, {
    url: 'http://example.invalid/ai-workspace',
    runScripts: 'dangerously',
    beforeParse(window) {
      window.fetch = async (path, options = {}) => {
        calls.push({ path, method: options.method || 'GET' });
        let payload;
        if (path === '/api/auth/demo-credentials') payload = { email: 'fixture@example.invalid', password: 'fixture-only-password' };
        else if (path === '/api/auth/login') payload = { token: 'fixture-token' };
        else if (path === '/api/auth/me') payload = { user: { email: 'fixture@example.invalid' } };
        else if (path === '/api/runtime-ai/history') payload = { history: [{ id: 'existing-result', feature: 'document-readiness', result: report, model: 'fixture-model', createdAt: '2026-01-01' }] };
        else if (path === '/api/runtime-ai/document-readiness') payload = { analysisId: 'fixture-result', result: report, documentBytesShared: false };
        else throw new Error(`Unexpected path ${path}`);
        return { ok: true, json: async () => payload };
      };
    },
  });
  try {
    const { document } = dom.window;
    document.getElementById('native-demo-fill').click();
    await tick();
    const login = document.getElementById('native-login-form');
    assert.equal(login.elements.email.value, 'fixture@example.invalid');
    assert.equal(login.elements.password.value, 'fixture-only-password');
    assert.deepEqual(calls.map(call => call.path), ['/api/auth/demo-credentials']);
    login.requestSubmit();
    await tick();
    await tick();
    assert.equal(document.querySelectorAll('[data-action=preset]').length, 3);
    const prompts = [];
    for (let index = 0; index < 3; index++) {
      document.querySelectorAll('[data-action=preset]')[index].click();
      const fields = [...document.querySelectorAll('[data-native-ai-form] textarea')];
      assert.equal(fields.length, 10);
      assert.ok(fields.every(field => field.value.trim()));
      prompts.push(document.querySelector('[name=prompt]').value);
    }
    assert.equal(new Set(prompts).size, 3);
    assert.equal(calls.filter(call => call.path === '/api/runtime-ai/document-readiness').length, 0);
    document.querySelector('[data-native-ai-form]').requestSubmit();
    await tick();
    const returned = document.querySelector('[data-report-body]');
    assert.ok(returned.textContent.includes('Approved'));
    assert.ok(returned.textContent.includes('false'));
    assert.ok(returned.textContent.includes('0'));
    assert.ok(returned.innerHTML.includes('<code>""</code>'));
    assert.ok(returned.querySelector('table'));
    document.querySelector('#native-history-list button').click();
    const saved = document.querySelector('.native-vanilla-dialog .browser-ai-report');
    assert.ok(saved.textContent.includes('false'));
    assert.ok(saved.textContent.includes('0'));
    assert.ok(saved.innerHTML.includes('<code>""</code>'));
    assert.ok(saved.querySelector('table'));
  } finally {
    dom.window.close();
  }
});
