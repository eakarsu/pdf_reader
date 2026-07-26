import { createHash, randomBytes, randomUUID, scryptSync, timingSafeEqual } from 'node:crypto';
import { chmodSync } from 'node:fs';
import { createServer } from 'node:http';
import { DatabaseSync } from 'node:sqlite';

const canonicalBaseUrl = 'https://openrouter.ai/api/v1';

function required(value, name, minimum = 1) {
  const normalized = typeof value === 'string' ? value.trim() : '';
  if (normalized.length < minimum) throw new Error(`${name} is required and must contain at least ${minimum} characters`);
  return normalized;
}

function json(response, status, payload, extraHeaders = {}) {
  const body = JSON.stringify(payload);
  response.writeHead(status, {
    'Cache-Control': 'no-store',
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'X-Content-Type-Options': 'nosniff',
    ...extraHeaders,
  });
  response.end(body);
}

async function bodyJson(request) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > 16_384) throw Object.assign(new Error('Request body is too large'), { status: 413 });
    chunks.push(chunk);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
  } catch {
    throw Object.assign(new Error('Request body must be valid JSON'), { status: 400 });
  }
}

function passwordDigest(password, salt) {
  return scryptSync(password, salt, 64);
}

function tokenDigest(token) {
  return createHash('sha256').update(token).digest('hex');
}

export function openRuntimeDatabase(databasePath, admin) {
  const resolvedDatabasePath = required(databasePath, 'DB_PATH');
  const db = new DatabaseSync(resolvedDatabasePath);
  chmodSync(resolvedDatabasePath, 0o600);
  db.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA foreign_keys = ON;
    CREATE TABLE IF NOT EXISTS runtime_users (
      id TEXT PRIMARY KEY,
      email TEXT UNIQUE NOT NULL,
      display_name TEXT NOT NULL,
      password_salt TEXT NOT NULL,
      password_hash TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS runtime_sessions (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES runtime_users(id) ON DELETE CASCADE,
      token_hash TEXT UNIQUE NOT NULL,
      expires_at TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS runtime_ai_results (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES runtime_users(id) ON DELETE RESTRICT,
      feature TEXT NOT NULL CHECK (feature = 'document-readiness'),
      input_json TEXT NOT NULL,
      provider_request_id TEXT NOT NULL,
      provider_model TEXT NOT NULL,
      result_text TEXT NOT NULL CHECK (length(result_text) >= 40),
      provider_receipt_json TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE TRIGGER IF NOT EXISTS runtime_ai_results_no_update
      BEFORE UPDATE ON runtime_ai_results BEGIN SELECT RAISE(ABORT, 'runtime AI evidence is append-only'); END;
    CREATE TRIGGER IF NOT EXISTS runtime_ai_results_no_delete
      BEFORE DELETE ON runtime_ai_results BEGIN SELECT RAISE(ABORT, 'runtime AI evidence is append-only'); END;
  `);
  const email = required(admin.email, 'BOOTSTRAP_ADMIN_EMAIL').toLowerCase();
  const password = required(admin.password, 'BOOTSTRAP_ADMIN_PASSWORD', 16);
  const displayName = required(admin.displayName, 'BOOTSTRAP_ADMIN_NAME');
  const existing = db.prepare('SELECT id FROM runtime_users WHERE email = ?').get(email);
  if (!existing) {
    const salt = randomBytes(16).toString('hex');
    db.prepare('INSERT INTO runtime_users(id,email,display_name,password_salt,password_hash,created_at) VALUES (?,?,?,?,?,?)')
      .run(randomUUID(), email, displayName, salt, passwordDigest(password, salt).toString('hex'), new Date().toISOString());
  }
  return db;
}

export async function callOpenRouter(workflowSummary, config) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 45_000);
  try {
    const response = await fetch(`${config.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${config.apiKey}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': 'http://localhost',
        'X-Title': 'Local PDF Reader Runtime Verification',
      },
      body: JSON.stringify({
        model: config.model,
        temperature: 0.1,
        messages: [
          {
            role: 'system',
            content: 'You are an operations-readiness assistant for a local PDF extraction utility. Review only the deidentified administrative summary. Never request document text or bytes, infer PDF content, make legal decisions, or claim an extraction succeeded. Return concise controls, gaps, and human review questions.',
          },
          { role: 'user', content: workflowSummary },
        ],
      }),
      signal: controller.signal,
    });
    const payload = await response.json();
    if (!response.ok) throw new Error(`OpenRouter request failed with HTTP ${response.status}`);
    const requestId = typeof payload.id === 'string' ? payload.id.trim() : '';
    const model = typeof payload.model === 'string' ? payload.model.trim() : config.model;
    const content = typeof payload.choices?.[0]?.message?.content === 'string' ? payload.choices[0].message.content.trim() : '';
    if (!requestId || !model || content.length < 40) throw new Error('OpenRouter returned incomplete evidence');
    return { content, receipt: { requestId, model, provider: 'openrouter' } };
  } finally {
    clearTimeout(timeout);
  }
}

export function createRuntimeApi({ db, openRouter, allowedOrigin }) {
  const authenticate = (request) => {
    const authorization = request.headers.authorization || '';
    if (!authorization.startsWith('Bearer ')) return null;
    return db.prepare(`SELECT u.id,u.email,u.display_name displayName
      FROM runtime_sessions s JOIN runtime_users u ON u.id=s.user_id
      WHERE s.token_hash=? AND s.expires_at>?`).get(tokenDigest(authorization.slice(7)), new Date().toISOString()) || null;
  };
  return createServer(async (request, response) => {
    const origin = request.headers.origin;
    const corsHeaders = origin && origin === allowedOrigin ? { 'Access-Control-Allow-Origin': origin, Vary: 'Origin' } : {};
    if (request.method === 'OPTIONS') {
      response.writeHead(204, { ...corsHeaders, 'Access-Control-Allow-Headers': 'Authorization, Content-Type', 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS' });
      response.end();
      return;
    }
    const url = new URL(request.url, 'http://localhost');
    try {
      if (request.method === 'GET' && url.pathname === '/api/health/ready') {
        db.prepare('SELECT 1').get();
        json(response, 200, { status: 'ready', database: 'connected' }, corsHeaders);
        return;
      }
      if (request.method === 'GET' && url.pathname === '/api/auth/demo-credentials') {
        if (process.env.NODE_ENV === 'production') return json(response, 404, { error: 'Not found' }, corsHeaders);
        const email = process.env.PROVISION_ADMIN_EMAIL || process.env.BOOTSTRAP_ADMIN_EMAIL || process.env.ADMIN_EMAIL || '';
        const password = process.env.PROVISION_ADMIN_PASSWORD || process.env.BOOTSTRAP_ADMIN_PASSWORD || process.env.ADMIN_PASSWORD || '';
        return email && password ? json(response, 200, { email, password }, corsHeaders) : json(response, 503, { error: 'Demo credentials unavailable' }, corsHeaders);
      }
      if (request.method === 'POST' && url.pathname === '/api/auth/login') {
        const body = await bodyJson(request);
        const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
        const password = typeof body.password === 'string' ? body.password : '';
        const user = db.prepare('SELECT id,email,display_name displayName,password_salt passwordSalt,password_hash passwordHash FROM runtime_users WHERE email=?').get(email);
        const actual = user ? passwordDigest(password, user.passwordSalt) : Buffer.alloc(64);
        const expected = user ? Buffer.from(user.passwordHash, 'hex') : Buffer.alloc(64, 1);
        if (!user || !timingSafeEqual(actual, expected)) {
          json(response, 401, { error: { code: 'INVALID_CREDENTIALS', message: 'Invalid credentials' } }, corsHeaders);
          return;
        }
        const token = randomBytes(32).toString('base64url');
        db.prepare('INSERT INTO runtime_sessions(id,user_id,token_hash,expires_at,created_at) VALUES (?,?,?,?,?)')
          .run(randomUUID(), user.id, tokenDigest(token), new Date(Date.now() + 8 * 60 * 60_000).toISOString(), new Date().toISOString());
        json(response, 200, { token, user: { id: user.id, email: user.email, displayName: user.displayName } }, corsHeaders);
        return;
      }
      if (request.method === 'GET' && url.pathname === '/api/auth/me') {
        const user = authenticate(request);
        if (!user) { json(response, 401, { error: { code: 'UNAUTHORIZED', message: 'Bearer token required' } }, corsHeaders); return; }
        json(response, 200, { user }, corsHeaders);
        return;
      }
      if (request.method === 'POST' && url.pathname === '/api/runtime-ai/document-readiness') {
        const user = authenticate(request);
        if (!user) { json(response, 401, { error: { code: 'UNAUTHORIZED', message: 'Bearer token required' } }, corsHeaders); return; }
        const body = await bodyJson(request);
        const workflowSummary = typeof body.workflowSummary === 'string' ? body.workflowSummary.trim() : '';
        if (workflowSummary.length < 20 || workflowSummary.length > 2000) throw Object.assign(new Error('workflowSummary must contain 20 to 2000 characters'), { status: 400 });
        const evidence = await openRouter(workflowSummary);
        const analysisId = randomUUID();
        db.prepare(`INSERT INTO runtime_ai_results(id,user_id,feature,input_json,provider_request_id,provider_model,result_text,provider_receipt_json,created_at)
          VALUES (?,?,'document-readiness',?,?,?,?,?,?)`).run(analysisId, user.id, JSON.stringify({ workflowSummary }), evidence.receipt.requestId, evidence.receipt.model, evidence.content, JSON.stringify(evidence.receipt), new Date().toISOString());
        json(response, 200, { analysisId, result: evidence.content, providerReceipt: evidence.receipt, documentBytesShared: false }, corsHeaders);
        return;
      }
      json(response, 404, { error: { code: 'NOT_FOUND', message: 'Route not found' } }, corsHeaders);
    } catch (error) {
      const status = Number.isInteger(error.status) ? error.status : error.message?.startsWith('OpenRouter') ? 502 : 500;
      if (status === 500) console.error(JSON.stringify({ level: 'error', event: 'request_failed', path: url.pathname }));
      json(response, status, { error: { code: status === 502 ? 'AI_PROVIDER_ERROR' : status === 500 ? 'INTERNAL_ERROR' : 'BAD_REQUEST', message: status >= 500 ? 'Request failed' : error.message } }, corsHeaders);
    }
  });
}

export function startRuntimeApi(environment = process.env) {
  const config = {
    apiKey: required(environment.OPENROUTER_API_KEY, 'OPENROUTER_API_KEY', 20),
    model: required(environment.OPENROUTER_MODEL, 'OPENROUTER_MODEL'),
    baseUrl: required(environment.OPENROUTER_BASE_URL, 'OPENROUTER_BASE_URL'),
  };
  if (config.baseUrl !== canonicalBaseUrl) throw new Error(`OPENROUTER_BASE_URL must be ${canonicalBaseUrl}`);
  required(environment.AUTH_SESSION_SECRET, 'AUTH_SESSION_SECRET', 32);
  const db = openRuntimeDatabase(environment.DB_PATH, {
    email: environment.BOOTSTRAP_ADMIN_EMAIL,
    password: environment.BOOTSTRAP_ADMIN_PASSWORD,
    displayName: environment.BOOTSTRAP_ADMIN_NAME,
  });
  const port = Number(environment.API_PORT || 30940);
  const host = environment.API_HOST || '127.0.0.1';
  const server = createRuntimeApi({ db, openRouter: summary => callOpenRouter(summary, config), allowedOrigin: `http://${environment.UI_HOST || '127.0.0.1'}:${environment.UI_PORT || 30941}` });
  server.listen(port, host, () => console.log(`PDF Reader runtime API listening on ${host}:${port}`));
  const shutdown = () => server.close(() => { db.close(); process.exit(0); });
  process.once('SIGINT', shutdown);
  process.once('SIGTERM', shutdown);
  return server;
}
