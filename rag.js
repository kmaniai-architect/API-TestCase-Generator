// RAG for reading API documents that the built-in PDF readers cannot fully understand.
//   segment  : the document is cut into passages (one per API section where possible)
//   retrieve : the passages most likely to describe APIs are picked (keyword/TF-IDF scoring) — large PDFs stay within the model's limit
//   learn    : every PDF read cleanly, and every endpoint the user confirmed, is stored as an (excerpt -> extracted API) example in testcase.db
//   augment  : the most similar earlier examples are put in front of the model as few-shot examples, so it follows the layouts it has already seen
//   format   : the model returns each API as NORMALISED TABLES (headers, request fields, response fields, status codes) — not free-form JSON
//   validate : the request/response JSON is then BUILT HERE from those tables (field names checked, types -> sample values, enums, nesting)
//   scrutinise: the result is cross-checked (sample vs field tables, required fields, method vs body, base URL) and issues are reported
// No dependencies: tokenising and TF-IDF cosine similarity are done here.
const crypto = require('crypto');

const STOP = new Set(['the', 'and', 'for', 'with', 'that', 'this', 'are', 'you', 'your', 'from', 'will', 'can', 'has', 'have', 'not', 'all', 'any', 'its', 'was', 'when']);
const tok = t => (String(t).toLowerCase().match(/\/[a-z0-9_{}\/.-]+|[a-z][a-z0-9_]+/g) || []).filter(w => !STOP.has(w));
const vec = (tokens, idf) => { const v = new Map(); tokens.forEach(t => v.set(t, (v.get(t) || 0) + 1)); v.forEach((c, t) => v.set(t, (1 + Math.log(c)) * (idf.get(t) || 1))); return v; };
const cos = (a, b) => { let d = 0, na = 0, nb = 0; a.forEach((w, t) => { na += w * w; if (b.has(t)) d += w * b.get(t); }); b.forEach(w => { nb += w * w; }); return na && nb ? d / Math.sqrt(na * nb) : 0; };

// how "API-like" is a passage? verbs, paths and the usual headings
const apiness = t => (t.match(/\b(GET|POST|PUT|PATCH|DELETE)\b/gi) || []).length * 3 + (t.match(/\s\/[A-Za-z0-9_{}:][A-Za-z0-9_{}:\/.-]*/g) || []).length +
  (t.match(/\b(end\s*-?point|method|request|response|header|payload|parameter|field|status|sample|url|body|json)\b/gi) || []).length;

const FIELD = { type: 'object', properties: {
  name: { type: 'string', description: 'Field name as a clean identifier; nested with dots (address.city) or [] for arrays (items[].productId). No spaces or punctuation.' },
  type: { type: 'string', description: 'string, integer, number, boolean, array, object, date, date-time, enum …' },
  required: { type: 'string', description: 'yes, no, or empty when not stated' },
  sample: { type: 'string', description: 'Sample/example value if the document shows one (first enum member, a default, e.g. 1-10 -> 1). Empty otherwise.' },
  description: { type: 'string' } }, required: ['name', 'type', 'required', 'sample', 'description'] };
const SCHEMA = {
  type: 'object',
  properties: { apis: { type: 'array', items: { type: 'object', properties: {
    method: { type: 'string', description: 'GET, POST, PUT, PATCH or DELETE (decide from the document; "patch?" means PATCH)' },
    url: { type: 'string', description: 'Full URL: the document-level base URL (add https:// if missing) joined with the path. Keep {placeholders}; write :id as {id}.' },
    summary: { type: 'string', description: 'Short name / purpose of the API' },
    auth: { type: 'string', description: 'Authentication needed (e.g. Bearer token, admin only, none)' },
    headers: { type: 'array', items: { type: 'object', properties: { name: { type: 'string' }, value: { type: 'string' }, required: { type: 'string' } }, required: ['name', 'value', 'required'] },
      description: 'Request headers for THIS api, including document-wide rules that apply to it (e.g. "all apis need token except login")' },
    requestFields: { type: 'array', items: FIELD, description: 'One row per request body field. Empty if the API has no body.' },
    responseFields: { type: 'array', items: FIELD, description: 'One row per response field.' },
    sampleRequest: { type: 'string', description: 'A request body JSON ONLY if the document literally shows one, else empty' },
    sampleResponse: { type: 'string', description: 'A response JSON ONLY if the document literally shows one (repair line-wrap damage), else empty' },
    statusCodes: { type: 'array', items: { type: 'object', properties: { code: { type: 'string' }, meaning: { type: 'string' } }, required: ['code', 'meaning'] } },
    notes: { type: 'string', description: 'Anything unclear, contradictory or missing for this API' },
  }, required: ['method', 'url', 'summary', 'auth', 'headers', 'requestFields', 'responseFields', 'sampleRequest', 'sampleResponse', 'statusCodes', 'notes'] } } },
  required: ['apis'],
};
const SYSTEM = `You turn messy API documentation (PDF text; tables are flattened to "column | column" lines, free text and bullet lists are mixed in) into clean, normalised records.
Work in this order for every API in the document:
1. SECTION: find the part of the text that describes the API (a heading like "2. Create user [POST] /users", a prose paragraph, a table row, or a list entry). A summary table that merely lists APIs is not a description — merge it with the section that describes the same API.
2. FORMAT: fill the record — method, full url, auth, headers, requestFields and responseFields as TABLE ROWS (name, type, required, sample, description), statusCodes. Field names must be clean identifiers; never copy sentences or bullets into a name.
   - A table may mix request and response fields (a column such as Req/Resp tells which): split them.
   - Shorthand such as "name, email, role - same as above": expand it to real rows.
   - Types like str/int/bool/obj/datetime are normalised (string/integer/boolean/object/date-time). An enum written as A/B/C: the sample is the first member.
   - Document-wide notes (base url, "all apis need token except login & products", content-type) apply to the APIs they cover.
3. SAMPLES: copy sample JSON only when the document literally shows it; repair breaks caused by line wrapping or page breaks; never make it up.
4. SCRUTINISE: put in notes anything contradictory or missing (e.g. "fields will be documented later", "method uncertain (patch?)", staging vs production URL).
Rules: report every API once; never invent APIs, fields or values; leave a string empty when the document does not say. Previously confirmed examples (if shown) tell you how this kind of layout maps to the output.
Return only the JSON object.`;

const NAME_OK = /^[A-Za-z_$][\w$-]{0,48}(\[\d*\])?(\.[A-Za-z_$][\w$-]{0,48}(\[\d*\])?)*$/;
const TYPE_MAP = [[/^(str|string|text|varchar|char)/i, 'string'], [/^(int|integer|long)/i, 'integer'], [/^(num|number|float|double|decimal)/i, 'number'], [/^bool/i, 'boolean'],
  [/^(arr|list)/i, 'array'], [/^(obj|object|map|dict)/i, 'object'], [/^(date-?time|datetime|timestamp)/i, 'date-time'], [/^date/i, 'date'], [/^uuid/i, 'uuid'], [/^enum/i, 'enum']];
const normType = t => { const s = String(t || '').trim(); const m = TYPE_MAP.find(([re]) => re.test(s)); return m ? m[1] : s.toLowerCase(); };

function coerce(sample, type) {
  const v = String(sample ?? '').trim();
  if (!v) return undefined;
  try { return JSON.parse(v); } catch { /* not JSON */ }
  const q = v.match(/^['"“‘](.*)['"”’]$/s); if (q) return q[1];
  const m = v.match(/^(-?\d+)\s*[-–]\s*\d+$/);   // "1-10" -> 1
  if (m && /int|num/.test(type)) return Number(m[1]);
  return v;
}
function fallbackValue(name, type) {
  const n = String(name).split(/[.\[\]]+/).filter(Boolean).pop() || name;
  switch (type) {
    case 'integer': return 1; case 'number': return 99.5; case 'boolean': return true; case 'array': return []; case 'object': return {};
    case 'date-time': return '2026-01-01T00:00:00Z'; case 'date': return '2026-01-01'; case 'uuid': return '3fa85f64-5717-4562-b3fc-2c963f66afa6';
    default: return /e-?mail/i.test(n) ? 'user@example.com' : /phone|mobile/i.test(n) ? '+919876543210' : /pass/i.test(n) ? 'Passw0rd!23' : /pin|zip|postal/i.test(n) ? '600001' : /city/i.test(n) ? 'Chennai' : /name/i.test(n) ? 'John Doe' : /coupon/i.test(n) ? 'SAVE10' : /sku|productid/i.test(n) ? 'SKU-1001' : 'string';
  }
}
function setPath(obj, path, val) {
  const toks = [...path.matchAll(/([^.\[\]]+)|\[(\d*)\]/g)].map(m => m[1] !== undefined ? m[1] : Number(m[2] || 0)); if (!toks.length) return;
  let cur = obj;
  toks.forEach((k, i) => {
    if (i === toks.length - 1) { cur[k] = val; return; }
    if (cur[k] === undefined || typeof cur[k] !== 'object') cur[k] = typeof toks[i + 1] === 'number' ? [] : {};
    cur = cur[k];
  });
}
// field table -> { json, dropped: [names that were not clean identifiers] }
function buildJson(fields) {
  const obj = {}, dropped = [];
  (fields || []).forEach(f => {
    const name = String(f.name || '').replace(/\s+/g, '');
    if (!name) return;
    if (!NAME_OK.test(name)) { dropped.push(name.slice(0, 30)); return; }
    let val = coerce(f.sample, f.type);
    if (val === undefined) { const en = String(f.description || '').match(/^([A-Za-z0-9_-]+(?:\s*[|\/]\s*[A-Za-z0-9_-]+)+)$/); val = en ? en[1].split(/[|\/]/)[0].trim() : fallbackValue(name, f.type); }
    setPath(obj, name, val);
  });
  return { json: Object.keys(obj).length ? obj : undefined, dropped };
}
const keysOf = (v, p = '') => v && typeof v === 'object' ? (Array.isArray(v) ? keysOf(v[0], p + '[]') : Object.entries(v).flatMap(([k, x]) => [p ? p + '.' + k : k, ...keysOf(x, p ? p + '.' + k : k)])) : [];
const leafKeys = v => keysOf(v).map(k => k.replace(/\[\]/g, ''));
const cleanName = n => String(n).replace(/\[\]/g, '').replace(/\s+/g, '');

function scrutinize(a, req, res, reqFields, resFields) {
  const issues = [];
  const body = ['POST', 'PUT', 'PATCH'].includes(a.method);
  if (!body && (reqFields.length || a.sampleRequest)) issues.push(`${a.method} normally has no request body, but body fields were documented`);
  if (body && req === undefined) issues.push('no request body could be built (no fields or sample documented)');
  if (res === undefined) issues.push('no response sample or response fields documented');
  if (body && req && reqFields.length) {
    const have = new Set(leafKeys(req)), miss = reqFields.filter(f => /^y/i.test(f.required || '') && !have.has(cleanName(f.name))).map(f => f.name);
    if (miss.length) issues.push(`required request field(s) missing from the request JSON: ${miss.slice(0, 5).join(', ')}`);
  }
  if (res && resFields.length) {
    const sample = leafKeys(res), sset = new Set(sample), tbl = resFields.map(f => cleanName(f.name)), tset = new Set(tbl);
    const onlyS = sample.filter(k => !tset.has(k) && !tbl.some(t => t.startsWith(k + '.'))).slice(0, 4), onlyT = tbl.filter(k => !sset.has(k) && !sample.some(s => s.startsWith(k + '.'))).slice(0, 4);
    if (onlyS.length || onlyT.length) issues.push(`response sample and field table differ${onlyS.length ? ' — only in sample: ' + onlyS.join(', ') : ''}${onlyT.length ? ' — only in table: ' + onlyT.join(', ') : ''}`);
  }
  if (!/^https?:\/\//i.test(a.url)) issues.push('URL has no host — set the Base URL');
  if (!a.statusCodes.length) issues.push('no status codes documented');
  if (a.notes) issues.push(a.notes);
  return issues;
}

module.exports = function createRag({ db, runLLM, parseJson }) {
  db.exec(`CREATE TABLE IF NOT EXISTS pdf_examples (
    id INTEGER PRIMARY KEY AUTOINCREMENT, hash TEXT UNIQUE, doc TEXT, chunk TEXT, op TEXT, kind TEXT, created_at INTEGER)`);
  const upsert = db.prepare(`INSERT INTO pdf_examples (hash, doc, chunk, op, kind, created_at) VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(hash) DO UPDATE SET op = excluded.op, created_at = excluded.created_at,
      kind = CASE WHEN excluded.kind = 'confirmed' OR pdf_examples.kind = 'confirmed' THEN 'confirmed' ELSE excluded.kind END`);
  const recent = db.prepare('SELECT chunk, op, kind FROM pdf_examples ORDER BY (kind = \'confirmed\') DESC, created_at DESC LIMIT 400');
  const count = db.prepare('SELECT COUNT(*) AS n, SUM(kind = \'confirmed\') AS c, COUNT(DISTINCT doc) AS d FROM pdf_examples');

  const clean = o => ({
    method: String(o.method || '').toUpperCase(), url: String(o.url || '').trim(),
    request: o.request === undefined || o.request === null ? '' : typeof o.request === 'string' ? o.request : JSON.stringify(o.request),
    response: o.response === undefined || o.response === null ? '' : typeof o.response === 'string' ? o.response : JSON.stringify(o.response),
  });

  function learn({ doc, items }) {
    let n = 0;
    for (const it of (Array.isArray(items) ? items : []).slice(0, 40)) {
      const op = clean(it.op || {});
      if (!/^(GET|POST|PUT|PATCH|DELETE)$/.test(op.method) || !op.url || !it.chunk) continue;
      const chunk = String(it.chunk).slice(0, 4000);
      upsert.run(crypto.createHash('md5').update(chunk + op.method + op.url).digest('hex'), String(doc || '').slice(0, 200), chunk, JSON.stringify(op), it.kind === 'confirmed' ? 'confirmed' : 'auto', Date.now());
      n++;
    }
    return { stored: n, ...stats() };
  }
  function stats() { const r = count.get(); return { examples: r.n || 0, confirmed: r.c || 0, documents: r.d || 0 }; }

  // the earlier examples most similar to this document's text
  function similar(query, k = 3) {
    const rows = recent.all();
    if (!rows.length) return [];
    const docs = rows.map(r => tok(r.chunk)), q = tok(query), df = new Map();
    [...docs, q].forEach(ts => new Set(ts).forEach(t => df.set(t, (df.get(t) || 0) + 1)));
    const N = docs.length + 1, idf = new Map([...df].map(([t, c]) => [t, Math.log(1 + N / c)])), qv = vec(q, idf);
    return rows.map((r, i) => ({ r, s: cos(qv, vec(docs[i], idf)) * (r.kind === 'confirmed' ? 1.25 : 1) })).filter(x => x.s > 0.08).sort((a, b) => b.s - a.s).slice(0, k).map(x => x.r);
  }

  // keep the passages most likely to describe APIs, within a size budget, in document order
  function select(chunks, budget = 28000) {
    const items = chunks.map((c, i) => ({ i, text: String(c.text || c), s: apiness(String(c.text || c)) })).filter(c => c.text.trim());
    const total = items.reduce((a, c) => a + c.text.length, 0);
    if (total <= budget) return items;
    const picked = []; let used = 0;
    items.slice().sort((a, b) => b.s - a.s).forEach(c => { if (used + c.text.length <= budget) { picked.push(c); used += c.text.length; } });
    return picked.sort((a, b) => a.i - b.i);
  }

  const json = t => { if (!t || !String(t).trim()) return undefined; try { return parseJson(String(t)); } catch { return undefined; } };
  const rowsOf = a => (Array.isArray(a) ? a : []).filter(f => f && typeof f === 'object').map(f => ({
    name: String(f.name || '').trim(), type: normType(f.type), required: String(f.required || '').trim(), sample: String(f.sample ?? '').trim(), description: String(f.description || '').trim() }));

  // one model record -> a clean operation (JSON built + validated here) with its scrutiny notes
  function normalise(a) {
    const method = String(a.method || '').toUpperCase().match(/GET|POST|PUT|PATCH|DELETE/)?.[0] || '';
    let url = String(a.url || '').trim().replace(/\/:(\w+)/g, '/{$1}').replace(/\s+/g, '');
    if (url && !/^https?:\/\//i.test(url) && /^[\w.-]+\.[a-z]{2,}(:\d+)?(\/|$)/i.test(url)) url = 'https://' + url;   // "api.example.com/v1" -> https://…
    const reqFields = rowsOf(a.requestFields), resFields = rowsOf(a.responseFields), body = ['POST', 'PUT', 'PATCH'].includes(method);
    const sReq = json(a.sampleRequest), sRes = json(a.sampleResponse), bq = buildJson(reqFields), bs = buildJson(resFields);
    const req = body ? (sReq !== undefined && typeof sReq === 'object' ? sReq : bq.json) : undefined;
    const res = sRes !== undefined && typeof sRes === 'object' ? sRes : bs.json;
    const headers = (Array.isArray(a.headers) ? a.headers : []).filter(h => h && h.name).map(h => ({ name: String(h.name).trim(), value: String(h.value || '').trim(), required: String(h.required || '').trim() }));
    const statusCodes = (Array.isArray(a.statusCodes) ? a.statusCodes : []).filter(s => s && s.code).map(s => ({ code: String(s.code).trim(), meaning: String(s.meaning || '').trim() }));
    const issues = scrutinize({ method, url, sampleRequest: a.sampleRequest, statusCodes, notes: String(a.notes || '').trim() }, req, res, reqFields, resFields);
    const dropped = [...bq.dropped, ...bs.dropped]; if (dropped.length) issues.push(`field names that were not clean identifiers were skipped: ${dropped.slice(0, 4).join(', ')}`);
    const ok = statusCodes.find(s => /^2\d\d$/.test(s.code));
    return { method, url, summary: String(a.summary || ''), req, res,
      meta: { headers: headers.filter(h => !/^no/i.test(h.required)).map(h => h.name + (h.value ? ': ' + h.value : '')).join(', '), source: a.auth ? 'Auth: ' + a.auth : 'AI-assisted read', destination: ok ? 'Success: ' + ok.code : '' },
      detail: { headers, reqFields, resFields, statusCodes, auth: String(a.auth || '') }, issues };
  }

  async function extract(body, headerKey) {
    const chunks = Array.isArray(body.chunks) ? body.chunks.slice(0, 400) : [];
    if (!chunks.length) throw Object.assign(new Error('No document text to read.'), { status: 400 });
    const sel = select(chunks), excerpt = sel.map((c, k) => `[passage ${k + 1}]\n${c.text}`).join('\n\n');
    const ex = similar(sel.slice(0, 4).map(c => c.text).join('\n').slice(0, 6000));
    const examples = ex.map((e, k) => `EXAMPLE ${k + 1} (${e.kind === 'confirmed' ? 'confirmed by the user' : 'read earlier'})\n--- document excerpt ---\n${e.chunk.slice(0, 1800)}\n--- correct extraction ---\n${e.op}`).join('\n\n');
    const known = Array.isArray(body.known) && body.known.length ? `\nThe built-in reader found these (some may be wrong or incomplete — decide from the text): ${body.known.slice(0, 60).map(k => `${k.method} ${k.url}`).join('; ')}\n` : '';
    const prompt = (examples ? `PREVIOUSLY SEEN LAYOUTS\n${examples}\n\n` : '') + `DOCUMENT EXCERPTS${known}\n${excerpt}`;
    const { out, P, usedModel } = await runLLM(body, headerKey, { prompt, system: SYSTEM, schema: SCHEMA, tool: 'submit_apis' });
    const apis = Array.isArray(out?.apis) ? out.apis : Array.isArray(out) ? out : [];
    const ops = apis.map(normalise).filter(o => /^(GET|POST|PUT|PATCH|DELETE)$/.test(o.method) && o.url);
    return { ops, llm: `${P.label} · ${usedModel}`, passages: sel.length, of: chunks.length, examples: ex.length };
  }
  const clear = () => db.exec('DELETE FROM pdf_examples');
  return { extract, learn, stats, clear };
};
