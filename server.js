// Zero-dependency server: serves ./public and exposes
//   GET  /api/status   -> which LLM providers are configured (via .env)
//   POST /api/generate -> asks the chosen provider (Claude, Gemini, OpenAI, Groq, …) for test cases
// API keys stay on the server — they are never sent to the browser.
const http = require('http');
const fs = require('fs');
const path = require('path');

// minimal .env loader (no dependency)
try {
  for (const line of fs.readFileSync(path.join(__dirname, '.env'), 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/i);
    if (m && !m[0].trim().startsWith('#') && !(m[1] in process.env)) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
} catch { /* no .env file */ }

// Trust the operating system's certificate store as well (corporate proxies / antivirus that re-sign HTTPS
// install their root CA there). Needs Node 22.19+/24.5+; older versions can use NODE_EXTRA_CA_CERTS or --use-system-ca.
try {
  const tls = require('tls');
  if (tls.getCACertificates && tls.setDefaultCACertificates) tls.setDefaultCACertificates([...tls.getCACertificates('default'), ...tls.getCACertificates('system')]);
} catch { /* keep Node's built-in CAs */ }

const PORT = process.env.PORT || 3000;
const PUBLIC = path.join(__dirname, 'public');
const DB_FILE = path.join(__dirname, (process.env.DB_FILE || '').trim() || 'testcase.db');
const env = k => (process.env[k] || '').trim();

/* ---------- provider registry (add a line here to support another OpenAI-compatible LLM) ---------- */
const PROVIDERS = {
  gemini:     { label: 'Google Gemini',        kind: 'gemini',    keys: ['GEMINI_API_KEY', 'GOOGLE_API_KEY'], modelEnv: 'GEMINI_MODEL',     model: 'gemini-3.8-flash' },
  anthropic:  { label: 'Claude (Anthropic)',   kind: 'anthropic', keys: ['ANTHROPIC_API_KEY'],                modelEnv: 'ANTHROPIC_MODEL',  model: 'claude-sonnet-5-5' },
  openai:     { label: 'OpenAI',               kind: 'openai',    keys: ['OPENAI_API_KEY'],                   modelEnv: 'OPENAI_MODEL',     model: 'gpt-4.1-mini',  base: 'https://api.openai.com/v1', baseEnv: 'OPENAI_BASE_URL' },
  groq:       { label: 'Groq',                 kind: 'openai',    keys: ['GROQ_API_KEY'],                     modelEnv: 'GROQ_MODEL',       model: 'llama-3.3-70b-versatile', base: 'https://api.groq.com/openai/v1' },
  mistral:    { label: 'Mistral',              kind: 'openai',    keys: ['MISTRAL_API_KEY'],                  modelEnv: 'MISTRAL_MODEL',    model: 'mistral-large-latest',    base: 'https://api.mistral.ai/v1' },
  deepseek:   { label: 'DeepSeek',             kind: 'openai',    keys: ['DEEPSEEK_API_KEY'],                 modelEnv: 'DEEPSEEK_MODEL',   model: 'deepseek-chat',           base: 'https://api.deepseek.com/v1' },
  openrouter: { label: 'OpenRouter',           kind: 'openai',    keys: ['OPENROUTER_API_KEY'],               modelEnv: 'OPENROUTER_MODEL', model: 'openai/gpt-4o-mini',      base: 'https://openrouter.ai/api/v1' },
  ollama:     { label: 'Ollama (local)',       kind: 'openai',    keys: [],                                   modelEnv: 'OLLAMA_MODEL',     model: 'llama3.1',                base: 'http://localhost:11434/v1', baseEnv: 'OLLAMA_BASE_URL', noKey: true },
};
const keyOf = p => PROVIDERS[p].keys.map(env).find(Boolean) || '';
const modelOf = p => env(PROVIDERS[p].modelEnv) || PROVIDERS[p].model;
const baseOf = p => env(PROVIDERS[p].baseEnv || '') || PROVIDERS[p].base;
// ollama counts as configured only if the user opted in via .env
const configured = p => PROVIDERS[p].noKey ? !!(env('OLLAMA_MODEL') || env('OLLAMA_BASE_URL')) : !!keyOf(p);
const defaultProvider = () => {
  const want = env('LLM_PROVIDER').toLowerCase();
  if (PROVIDERS[want]) return want;
  return Object.keys(PROVIDERS).find(configured) || 'gemini';
};

/* ---------- prompt + schema ---------- */
const CASE_PROPS = {
  category: { type: 'string', description: 'e.g. Business Rule, Boundary, Required Field, Security, Response Validation' },
  title: { type: 'string', description: 'Short, specific test case name' },
  type: { type: 'string', enum: ['Positive', 'Negative'] },
  request: { type: 'string', description: 'Exact input: headers/query/path values and the JSON request body to send (as text)' },
  status: { type: 'string', description: 'Expected HTTP status, e.g. "400 Bad Request"' },
  expected: { type: 'string', description: 'Expected response/behaviour to assert' },
  priority: { type: 'string', enum: ['High', 'Medium', 'Low'] },
};
const CASE_KEYS = Object.keys(CASE_PROPS);
const JSON_SCHEMA = {
  type: 'object',
  properties: { cases: { type: 'array', items: { type: 'object', properties: CASE_PROPS, required: CASE_KEYS } } },
  required: ['cases'],
};
// Gemini's responseSchema wants upper-case type names and no extra keywords
const toGemini = s => Array.isArray(s) ? s.map(toGemini) : (s && typeof s === 'object')
  ? Object.fromEntries(Object.entries(s).map(([k, v]) => [k, k === 'type' && typeof v === 'string' ? v.toUpperCase() : toGemini(v)])) : s;

const SYSTEM = `You are a senior QA engineer designing API test cases.
Given an HTTP method, endpoint, and sample request/response JSON bodies, produce a thorough, non-redundant test suite.
- Infer business rules from field names and sample values (e.g. age -> minimum age, status -> allowed enum values, email -> uniqueness/format, ids, money, dates) and test them.
- Cover: happy path, required/missing fields, null, wrong types, boundaries, invalid formats, business-rule violations, auth/authorization, security (injection, mass assignment, IDOR), idempotency, and response-contract checks (fields, types, values, echoed request data).
- For GET there is no request body: base everything on the response body, path/query parameters and auth.
- Each "request" must be concrete and runnable (real values, not placeholders like "invalid value").
- Aim for 30-60 high-value cases. Do not pad with near-duplicates.
Reply with ONLY a JSON object of the form {"cases":[{"category":"","title":"","type":"Positive|Negative","request":"","status":"","expected":"","priority":"High|Medium|Low"}]} — no markdown, no commentary.`;

const buildPrompt = ({ method, endpoint, headers, request, response, notes }) => [
  `Method: ${method}`,
  `Endpoint: ${endpoint}`,
  Array.isArray(headers) && headers.length ? `Request headers (secret values redacted):\n${headers.slice(0, 30).map(h => `${String(h.name).slice(0, 100)}: ${String(h.value).slice(0, 200)}`).join('\n')}` : '',
  request !== undefined ? `Request body:\n${JSON.stringify(request, null, 2)}` : 'Request body: (none)',
  response !== undefined ? `Response body (success):\n${JSON.stringify(response, null, 2)}` : 'Response body: (not provided)',
  notes ? `Business rules / extra instructions from the user:\n${notes}` : '',
].filter(Boolean).join('\n\n');

/* ---------- provider calls (plain fetch) ---------- */
async function post(url, headers, body) {
  let r;
  try {
    r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body), signal: AbortSignal.timeout(240000) });
  } catch (e) { throw new Error(`Could not reach ${new URL(url).host}: ${e.message}`); }
  const text = await r.text();
  let data; try { data = JSON.parse(text); } catch { data = null; }
  if (!r.ok) throw Object.assign(new Error(data?.error?.message || data?.error || data?.message || `Provider returned HTTP ${r.status}`), { status: r.status === 401 || r.status === 403 ? 401 : 502 });
  return data;
}

const CALLS = {
  async anthropic({ key, model, prompt }) {
    const d = await post('https://api.anthropic.com/v1/messages', { 'x-api-key': key, 'anthropic-version': '2023-06-01' }, {
      model, max_tokens: 12000, system: SYSTEM,
      tools: [{ name: 'submit_test_cases', description: 'Submit the complete list of API test cases.', input_schema: JSON_SCHEMA }],
      tool_choice: { type: 'tool', name: 'submit_test_cases' },
      messages: [{ role: 'user', content: prompt }],
    });
    return d.content?.find(b => b.type === 'tool_use')?.input;
  },
  async gemini({ key, model, prompt }) {
    const d = await post(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`, { 'x-goog-api-key': key }, {
      systemInstruction: { parts: [{ text: SYSTEM }] },
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      generationConfig: { responseMimeType: 'application/json', responseSchema: toGemini(JSON_SCHEMA), maxOutputTokens: 16000, temperature: 0.4 },
    });
    const text = d.candidates?.[0]?.content?.parts?.map(p => p.text || '').join('') || '';
    if (!text) throw new Error(d.promptFeedback?.blockReason ? `Blocked by Gemini: ${d.promptFeedback.blockReason}` : 'Gemini returned no content');
    return parseJson(text);
  },
  async openai({ key, model, prompt, base }) {
    const d = await post(`${base.replace(/\/$/, '')}/chat/completions`, key ? { Authorization: `Bearer ${key}` } : {}, {
      model, temperature: 0.4, response_format: { type: 'json_object' },
      messages: [{ role: 'system', content: SYSTEM }, { role: 'user', content: prompt }],
    });
    return parseJson(d.choices?.[0]?.message?.content || '');
  },
};

function parseJson(text) {
  if (typeof text !== 'string') return text;
  const t = text.trim().replace(/^```(?:json)?\s*|\s*```$/g, '');
  try { return JSON.parse(t); } catch { /* fall through */ }
  const s = t.indexOf('{'), e = t.lastIndexOf('}');
  if (s >= 0 && e > s) { try { return JSON.parse(t.slice(s, e + 1)); } catch { /* fall through */ } }
  throw new Error('The model did not return valid JSON (it may have been cut off). Try again or pick another model.');
}

async function generate(body, headerKey) {
  const provider = PROVIDERS[body.provider] ? body.provider : defaultProvider();
  const P = PROVIDERS[provider];
  const key = keyOf(provider) || (headerKey || '').trim();
  if (!key && !P.noKey) throw Object.assign(new Error(`No API key for ${P.label}: set ${P.keys[0]} in .env or enter a key in the page.`), { status: 400 });
  const model = (body.model || '').trim() || modelOf(provider);
  const out = await CALLS[P.kind]({ key, model, base: baseOf(provider), prompt: buildPrompt(body) });
  const cases = Array.isArray(out?.cases) ? out.cases : Array.isArray(out) ? out : null;
  if (!cases || !cases.length) throw new Error(`${P.label} returned no test cases.`);
  const pick = (v, allowed, d) => (allowed.includes(v) ? v : d);
  return cases.map(c => ({
    category: String(c.category || 'General'),
    title: String(c.title || 'Untitled'),
    type: pick(c.type, ['Positive', 'Negative'], 'Negative'),
    source: 'AI', llm: `${P.label} · ${model}`,
    method: body.method, endpoint: body.endpoint,
    request: typeof c.request === 'string' ? c.request : JSON.stringify(c.request ?? '—', null, 2),
    status: String(c.status || ''),
    expected: String(c.expected || ''),
    priority: pick(c.priority, ['High', 'Medium', 'Low'], 'Medium'),
  }));
}

/* ---------- saved suites: SQLite (testcase.db, built into Node 22.5+) ---------- */
const { DatabaseSync } = require('node:sqlite');
const db = new DatabaseSync(DB_FILE);
db.exec(`
  PRAGMA foreign_keys = ON;
  CREATE TABLE IF NOT EXISTS suites (
    id TEXT PRIMARY KEY, title TEXT, method TEXT NOT NULL, endpoint TEXT NOT NULL, mode TEXT,
    notes TEXT, request_body TEXT, response_body TEXT, created_at INTEGER, updated_at INTEGER NOT NULL, input_type TEXT, input_name TEXT);
  CREATE TABLE IF NOT EXISTS test_cases (
    suite_id TEXT NOT NULL REFERENCES suites(id) ON DELETE CASCADE, id TEXT NOT NULL, position INTEGER,
    category TEXT, title TEXT, type TEXT, source TEXT, method TEXT, endpoint TEXT, request TEXT,
    status TEXT, expected TEXT, priority TEXT, steps TEXT, result TEXT, llm TEXT,
    PRIMARY KEY (suite_id, id));
`);
// databases created before the llm column existed
for (const col of ['input_type', 'input_name']) if (!db.prepare('PRAGMA table_info(suites)').all().some(c => c.name === col)) db.exec(`ALTER TABLE suites ADD COLUMN ${col} TEXT`);
if (!db.prepare('PRAGMA table_info(test_cases)').all().some(c => c.name === 'llm')) db.exec('ALTER TABLE test_cases ADD COLUMN llm TEXT');
const json = v => v === undefined ? null : JSON.stringify(v);
const unjson = t => t == null ? undefined : JSON.parse(t);
const q = {
  suites: db.prepare('SELECT * FROM suites ORDER BY updated_at DESC'),
  cases: db.prepare('SELECT * FROM test_cases WHERE suite_id = ? ORDER BY position'),
  upsert: db.prepare(`INSERT INTO suites (id, title, method, endpoint, mode, notes, request_body, response_body, created_at, updated_at, input_type, input_name)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET title = excluded.title, method = excluded.method,
    endpoint = excluded.endpoint, mode = excluded.mode, notes = excluded.notes, request_body = excluded.request_body,
    response_body = excluded.response_body, updated_at = excluded.updated_at, input_type = excluded.input_type, input_name = excluded.input_name`),
  dropCases: db.prepare('DELETE FROM test_cases WHERE suite_id = ?'),
  addCase: db.prepare(`INSERT INTO test_cases (suite_id, id, position, category, title, type, source, method, endpoint, request, status, expected, priority, steps, result, llm)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`),
  del: db.prepare('DELETE FROM suites WHERE id = ?'),
};
const tx = fn => { db.exec('BEGIN'); try { fn(); db.exec('COMMIT'); } catch (e) { db.exec('ROLLBACK'); throw e; } };
const str = v => v == null ? null : typeof v === 'string' ? v : JSON.stringify(v);

function listSuites() {
  return q.suites.all().map(s => {
    const results = {};
    const cases = q.cases.all(s.id).map(c => {
      if (c.result) results[c.id] = c.result;
      return { id: c.id, category: c.category, title: c.title, type: c.type, source: c.source, method: c.method, endpoint: c.endpoint,
        request: c.request, status: c.status, expected: c.expected, priority: c.priority, steps: unjson(c.steps), llm: c.llm || undefined };
    });
    return { id: s.id, title: s.title, method: s.method, endpoint: s.endpoint, mode: s.mode, notes: s.notes,
      req: unjson(s.request_body), res: unjson(s.response_body), ts: s.updated_at, cases, results,
      input: s.input_type ? { type: s.input_type, name: s.input_name || undefined } : undefined };
  });
}
function saveSuite(s) {
  const results = s.results || {};
  tx(() => {
    q.upsert.run(s.id, str(s.title), s.method, s.endpoint, str(s.mode), str(s.notes), json(s.req), json(s.res), s.ts || Date.now(), s.ts || Date.now(), str(s.input?.type), str(s.input?.name));
    q.dropCases.run(s.id);
    s.cases.forEach((c, i) => q.addCase.run(s.id, String(c.id ?? i + 1), i, str(c.category), str(c.title), str(c.type), str(c.source),
      str(c.method), str(c.endpoint), str(c.request), str(c.status), str(c.expected), str(c.priority), json(c.steps), results[c.id] || null, str(c.llm)));
  });
}
const deleteSuite = id => q.del.run(id);
const clearSuites = () => db.exec('DELETE FROM suites');

/* ---------- fetch a URL on behalf of the page (OpenAPI spec / sample response), GET only, size + time capped ---------- */
async function fetchForImport(url) {
  let u; try { u = new URL(String(url)); } catch { throw Object.assign(new Error('Enter a valid http(s) URL'), { status: 400 }); }
  if (!/^https?:$/.test(u.protocol)) throw Object.assign(new Error('Only http(s) URLs are supported'), { status: 400 });
  if (/^(1|true|yes)$/i.test(env('IMPORT_INSECURE_TLS'))) return fetchInsecure(u);   // opt-in escape hatch (see .env.example)
  let r;
  try { r = await fetch(u, { headers: { Accept: 'application/json, text/plain;q=0.9, */*;q=0.5' }, signal: AbortSignal.timeout(15000) }); }
  catch (e) {
    const code = e.cause?.code || e.message;
    throw Object.assign(new Error(`Could not reach ${u.host}: ${code}` + (TLS_CODES.test(code) ? TLS_HELP : '')), { status: 502 });
  }
  const MAX = 3e6, chunks = []; let size = 0;
  for await (const c of r.body) { size += c.length; if (size > MAX) throw Object.assign(new Error('Response is larger than 3 MB'), { status: 413 }); chunks.push(c); }
  return { url: r.url, status: r.status, contentType: r.headers.get('content-type') || '', text: Buffer.concat(chunks).toString('utf8') };
}
const TLS_CODES = /CERT|SELF_SIGNED|ISSUER|TLS|SSL|UNABLE_TO_VERIFY|SIGNATURE/i;
const TLS_HELP = " — the server could not verify the site's HTTPS certificate. This usually means a corporate proxy or antivirus is re-signing HTTPS traffic. " +
  "Fix: point Node at your organisation's root CA before starting (PowerShell: $env:NODE_EXTRA_CA_CERTS='C:/certs/corp-root.pem'; npm start), " +
  "or start with: node --use-system-ca server.js. For local testing only you can set IMPORT_INSECURE_TLS=true in .env to skip certificate checks for URL imports.";
// URL import without certificate verification — only used when IMPORT_INSECURE_TLS=true; GET only, size/time capped, follows up to 5 redirects
function fetchInsecure(u, hops = 0) {
  const lib = u.protocol === 'https:' ? require('https') : require('http');
  return new Promise((resolve, reject) => {
    const fail = e => reject(Object.assign(new Error(`Could not reach ${u.host}: ${e.code || e.message}`), { status: 502 }));
    const req = lib.get(u, { rejectUnauthorized: false, timeout: 15000, headers: { Accept: 'application/json, text/plain;q=0.9, */*;q=0.5' } }, res => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location && hops < 5) {
        res.resume();
        try { return resolve(fetchInsecure(new URL(res.headers.location, u), hops + 1)); } catch (e) { return fail(e); }
      }
      const MAX = 3e6, chunks = []; let size = 0;
      res.on('data', c => { size += c.length; if (size > MAX) { req.destroy(); reject(Object.assign(new Error('Response is larger than 3 MB'), { status: 413 })); } else chunks.push(c); });
      res.on('end', () => resolve({ url: u.href, status: res.statusCode, contentType: res.headers['content-type'] || '', text: Buffer.concat(chunks).toString('utf8') }));
      res.on('error', fail);
    });
    req.on('timeout', () => req.destroy(Object.assign(new Error('timed out'), { code: 'ETIMEDOUT' })));
    req.on('error', fail);
  });
}

/* ---------- http server ---------- */
const MIME = { '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript', '.json': 'application/json', '.svg': 'image/svg+xml', '.ico': 'image/x-icon' };
const send = (res, code, body, type = 'application/json') => { res.writeHead(code, { 'Content-Type': type }); res.end(typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body)); };

http.createServer(async (req, res) => {
  try {
    if (req.method === 'GET' && req.url === '/api/status') {
      return send(res, 200, {
        default: defaultProvider(),
        providers: Object.keys(PROVIDERS).map(id => ({ id, label: PROVIDERS[id].label, configured: configured(id), needsKey: !PROVIDERS[id].noKey, model: modelOf(id) })),
      });
    }
    if (req.url.startsWith('/api/suites')) {
      const id = decodeURIComponent(req.url.split('?')[0].slice('/api/suites/'.length));
      if (req.method === 'GET' && !id) return send(res, 200, { suites: listSuites() });
      if (req.method === 'DELETE') { id ? deleteSuite(id) : clearSuites(); return send(res, 200, { ok: true }); }
      if (req.method === 'PUT' && id) {
        let raw = '';
        for await (const chunk of req) { raw += chunk; if (raw.length > 20e6) return send(res, 413, { error: 'Payload too large' }); }
        let body; try { body = JSON.parse(raw); } catch { return send(res, 400, { error: 'Invalid JSON body' }); }
        if (!body.method || !body.endpoint || !Array.isArray(body.cases)) return send(res, 400, { error: 'method, endpoint and cases are required' });
        saveSuite({ ...body, id });
        return send(res, 200, { ok: true });
      }
    }
    if (req.method === 'POST' && req.url === '/api/generate') {
      let raw = '';
      for await (const chunk of req) { raw += chunk; if (raw.length > 2e6) return send(res, 413, { error: 'Payload too large' }); }
      let body; try { body = JSON.parse(raw); } catch { return send(res, 400, { error: 'Invalid JSON body' }); }
      if (!body.method || !body.endpoint) return send(res, 400, { error: 'method and endpoint are required' });
      return send(res, 200, { cases: await generate(body, req.headers['x-api-key']) });
    }
    if (req.method === 'POST' && req.url === '/api/fetch-url') {
      let raw = '';
      for await (const chunk of req) { raw += chunk; if (raw.length > 1e5) return send(res, 413, { error: 'Payload too large' }); }
      let body; try { body = JSON.parse(raw); } catch { return send(res, 400, { error: 'Invalid JSON body' }); }
      return send(res, 200, await fetchForImport(body.url));
    }
    if (req.method === 'GET') {
      const rel = decodeURIComponent(new URL(req.url, 'http://x').pathname);
      const file = path.join(PUBLIC, rel === '/' ? 'index.html' : rel);
      if (!file.startsWith(PUBLIC)) return send(res, 403, 'Forbidden', 'text/plain');
      return fs.readFile(file, (err, data) => err ? send(res, 404, 'Not found', 'text/plain') : send(res, 200, data, MIME[path.extname(file)] || 'application/octet-stream'));
    }
    send(res, 405, { error: 'Method not allowed' });
  } catch (e) {
    console.error(e.message);
    send(res, e.status || 500, { error: e.message || 'Server error' });
  }
}).listen(PORT, () => {
  const ready = Object.keys(PROVIDERS).filter(configured).map(p => PROVIDERS[p].label);
  console.log(`API Test Case Generator → http://localhost:${PORT}`);
  console.log(`Saved suites → ${DB_FILE}`);
  console.log(`LLM providers ready: ${ready.length ? ready.join(', ') : 'none (Manual mode only — add a key to .env)'}  | default: ${defaultProvider()}`);
});
