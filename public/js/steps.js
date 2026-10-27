/* ---------- test step formats: Standard (numbered) or Gherkin (Given / When / Then) ----------
   The user picks the format with the "Steps" selector in the results toolbar (remembered). It controls the step view of every case and
   the "Test Steps" column / field of the CSV, JSON and Postman exports; "⬇ Gherkin" downloads the checked cases as a .feature file. */
let stepFmt='standard';
try{ stepFmt=localStorage.getItem('stepFmt')==='gherkin'?'gherkin':'standard'; }catch{}

/* the request data of a case as object / text / null */
function stepBodyOf(x){
  const r=x.request;
  if(r===undefined||r===null||r===''||r==='—') return null;
  if(typeof r==='object') return r;
  try{ const j=JSON.parse(r); if(j&&typeof j==='object') return j; }catch{}
  return String(r);
}
const stepPath=u=>String(u).replace(/^[a-z]+:\/\/[^/]+/i,'').split('?')[0]||'/';
const stepTag=s=>'@'+String(s||'').toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'');

/* Standard steps as plain text (HTML-free) */
function standardSteps(x){
  const body=stepBodyOf(x);
  return [`Send ${x.method} request to ${x.endpoint}`,body===null?'No request body / input':'Apply the request / input shown on the left',`Assert status is ${x.status}`,`Assert: ${x.expected}`];
}
/* Gherkin lines for one case (without the Feature line) */
function gherkinLines(x){
  const body=stepBodyOf(x), L=[], neg=x.type==='Negative';
  L.push(`  ${[stepTag(x.type),stepTag(x.priority),stepTag(x.category)].filter(t=>t.length>1).join(' ')}`);
  L.push(`  Scenario: ${x.id} - ${x.title}`);
  L.push(`    Given the API endpoint "${x.endpoint}" is reachable`);
  const block=(label,v)=>{ L.push(`    And ${label}`,'      """'); (typeof v==='string'?v:JSON.stringify(v,null,2)).split('\n').forEach(l=>L.push('      '+l)); L.push('      """'); };
  if(body&&typeof body==='object'&&!Array.isArray(body)&&['headers','body','query','path','params'].some(k=>k in body)&&Object.keys(body).every(k=>['headers','body','query','path','params'].includes(k))){
    // the generators describe a request as {headers, body, query, path}: one Gherkin step each
    if(body.headers) block('the request headers are',typeof body.headers==='string'?body.headers.replace(/\\n/g,'\n'):Object.entries(body.headers).map(([k,v])=>`${k}: ${v}`).join('\n'));
    if(body.path||body.params) block('the path parameters are',body.path||body.params);
    if(body.query) block('the query parameters are',body.query);
    if(body.body!==undefined) block('the request body is',body.body);
  }
  else if(body&&typeof body==='object') block('the request body is',body);
  else if(body) L.push(`    And the request input is "${String(body).replace(/\s+/g,' ')}"`);
  else L.push('    And no request body is sent');
  L.push(`    When I send a ${x.method} request to "${x.endpoint}"`);
  L.push(`    Then the response status should be "${x.status}"`);
  L.push(`    And ${neg?'the API should reject the request':'the response should be correct'}: ${x.expected}`);
  return L;
}
const gherkinFeature=(x)=>`Feature: ${x.method} ${stepPath(x.endpoint)}`;
/* one case's steps in the chosen format, as text (CSV / JSON / Postman) */
function stepsText(x,fmt=stepFmt){ return fmt==='gherkin'?gherkinLines(x).join('\n'):standardSteps(x).map((s,i)=>`${i+1}. ${s}`).join('\n'); }
/* a whole .feature file: one Feature per method + path */
function featureFile(list){
  const groups=new Map(); list.forEach(x=>{ const k=gherkinFeature(x); (groups.get(k)||groups.set(k,[]).get(k)).push(x); });
  return [...groups].map(([f,xs])=>[f,'',...xs.map(x=>gherkinLines(x).join('\n')+'\n')].join('\n')).join('\n');
}
/* coloured HTML for the details view */
function gherkinHtml(x){
  return gherkinLines(x).map(l=>{
    const e=esc(l);
    if(/^\s*@/.test(l)) return `<span class="gk-tag">${e}</span>`;
    return e.replace(/^(\s*)(Scenario:|Feature:|Given|When|Then|And|But)/,(m,sp,k)=>`${sp}<span class="gk-kw">${k}</span>`);
  }).join('\n');
}
