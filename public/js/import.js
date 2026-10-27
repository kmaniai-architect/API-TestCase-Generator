/* ---------- import: fill the inputs from an OpenAPI/Swagger URL, a sample-response URL, or a PDF ---------- */
const IMP_METHODS=['get','post','put','patch','delete'];
let impOpen=new Set(), impOps=[], impSrc=null, impFileName='', inMode='manual', impIsSpec=false;   // impSrc: where the form values came from (null = typed manually)

/* --- OpenAPI / Swagger (JSON) --- */
function impRef(spec,ref){ return String(ref).replace(/^#\//,'').split('/').reduce((o,k)=>o&&o[k.replace(/~1/g,'/').replace(/~0/g,'~')],spec); }
function impExample(spec,s,depth=0,seen=new Set()){
  if(!s||typeof s!=='object'||depth>6) return null;
  if(s.$ref){ if(seen.has(s.$ref)) return null; return impExample(spec,impRef(spec,s.$ref),depth+1,new Set(seen).add(s.$ref)); }
  if(s.example!==undefined) return s.example;
  if(s.default!==undefined) return s.default;
  if(Array.isArray(s.enum)&&s.enum.length) return s.enum[0];
  if(s.allOf) return Object.assign({},...s.allOf.map(x=>{ const v=impExample(spec,x,depth+1,seen); return v&&typeof v==='object'&&!Array.isArray(v)?v:{}; }));
  if(s.oneOf||s.anyOf) return impExample(spec,(s.oneOf||s.anyOf)[0],depth+1,seen);
  const t=s.type||(s.properties?'object':s.items?'array':'string');
  if(t==='object'){ const o={}; for(const [k,v] of Object.entries(s.properties||{})) o[k]=impExample(spec,v,depth+1,seen); return o; }
  if(t==='array') return [impExample(spec,s.items,depth+1,seen)];
  if(t==='integer') return s.minimum!==undefined?s.minimum:1;
  if(t==='number') return s.minimum!==undefined?s.minimum:1.5;
  if(t==='boolean') return true;
  const f=s.format;
  return f==='date-time'?'2026-01-01T00:00:00Z':f==='date'?'2026-01-01':f==='email'?'user@example.com':f==='uuid'?'3fa85f64-5717-4562-b3fc-2c963f66afa6':(f==='uri'||f==='url')?'https://example.com':'string';
}
function impBase(spec,specUrl){
  let b='';
  if(spec.openapi){
    const sv=(spec.servers||[])[0];
    if(sv){ b=String(sv.url).replace(/\{(\w+)\}/g,(m,k)=>sv.variables?.[k]?.default??m); }
  } else if(spec.host){
    b=((spec.schemes||[])[0]||'https')+'://'+spec.host+(spec.basePath||'');
  } else if(spec.basePath) b=spec.basePath;
  try{ return new URL(b||'/',specUrl).href.replace(/\/$/,''); }catch{ return b.replace(/\/$/,''); }
}
function impFromSpec(spec,specUrl){
  const base=impBase(spec,specUrl), ops=[];
  for(const [path,item] of Object.entries(spec.paths||{})){
    for(const m of IMP_METHODS){
      const op=item&&item[m]; if(!op) continue;
      let req, res;
      if(op.requestBody){
        const c=op.requestBody.content||{}, j=c['application/json']||c[Object.keys(c).find(k=>/json/i.test(k))];
        if(j){ const ex=j.examples&&Object.values(j.examples)[0]?.value; req=j.example!==undefined?j.example:ex!==undefined?ex:impExample(spec,j.schema); }
      } else {
        const bp=(op.parameters||item.parameters||[]).map(p=>p.$ref?impRef(spec,p.$ref):p).find(p=>p&&p.in==='body');
        if(bp) req=impExample(spec,bp.schema);
      }
      const codes=Object.keys(op.responses||{}).sort(), ok=codes.find(c=>/^2/.test(c))||codes.find(c=>c==='default');
      if(ok){ let r=op.responses[ok]; if(r.$ref) r=impRef(spec,r.$ref) || r;
        const c=r.content||{}, j=c['application/json']||c[Object.keys(c).find(k=>/json/i.test(k))];
        if(j) res=j.example!==undefined?j.example:impExample(spec,j.schema); else if(r.schema) res=impExample(spec,r.schema); }
      ops.push({method:m.toUpperCase(),url:base+path,summary:op.summary||op.operationId||'',req,res});
    }
  }
  return ops;
}

/* --- free text (PDF / HTML / plain text): find "GET /path" lines and JSON blocks --- */
function impJsonBlocks(text){
  const t=text.replace(/[“”]/g,'"').replace(/[‘’]/g,"'"), out=[];
  for(let i=0;i<t.length&&out.length<400;i++){
    if(t[i]!=='{') continue;
    let d=0,str=false,esc_=false,end=-1;
    for(let j=i;j<t.length&&j-i<20000;j++){
      const c=t[j];
      if(str){ if(esc_) esc_=false; else if(c==='\\') esc_=true; else if(c==='"') str=false; continue; }
      if(c==='"') str=true; else if(c==='{') d++; else if(c==='}'&&--d===0){ end=j; break; }
    }
    if(end<0) continue;
    try{ const v=JSON.parse(t.slice(i,end+1)); if(v&&Object.keys(v).length){ out.push({idx:i,val:v}); i=end; } }catch{}
  }
  return {blocks:out,text:t};
}
/* --- labeled layout: "API 1: / Endpoint : <url> / Method : Get / Request : {...} / Response : {...}" --- */
/* JS-object-style text -> JSON: single quotes, unquoted keys, trailing commas and raw line breaks inside strings are tolerated */
const BS=String.fromCharCode(92);
function impLoose(src){
  let out='', i=0; const n=src.length;
  while(i<n){
    const c=src[i];
    if(c==='"'||c==="'"){
      let j=i+1, body='';
      while(j<n&&src[j]!==c){
        if(src[j]===BS&&j+1<n){ const x=src[j+1]; body+=(x==="'"?"'":BS+x); j+=2; continue; }
        const ch=src[j]; body+=ch==='"'?'\\"':/[\r\n\t]/.test(ch)?' ':ch; j++;
      }
      out+='"'+body+'"'; i=j+1; continue;
    }
    if(/[A-Za-z_$]/.test(c)){
      let j=i; while(j<n&&/[\w$]/.test(src[j])) j++;
      const word=src.slice(i,j); let k=j; while(k<n&&/\s/.test(src[k])) k++;
      out+=src[k]===':'?'"'+word+'"':word; i=j; continue;
    }
    out+=c; i++;
  }
  return out.replace(/,\s*([}\]])/g,'$1');
}
function impParseLoose(raw){
  let s=raw.replace(/[\u201c\u201d]/g,'"').replace(/[\u2018\u2019]/g,"'").trim();
  for(let k=0;k<4;k++){
    try{ return JSON.parse(impLoose(s)); }catch{}
    const m=s.match(/^\{\s*([\[{][\s\S]*[\]}])\s*\}$/); if(!m) break; s=m[1].trim();   // "{ {...} }" -> "{...}"
  }
  return undefined;
}
/* first balanced {...} / [...] in text, string-aware (both quote styles) */
function impBalanced(t){
  const i=t.search(/[{[]/); if(i<0) return '';
  let d=0,q='';
  for(let j=i;j<t.length&&j-i<200000;j++){
    const c=t[j];
    if(q){ if(c===BS) j++; else if(c===q) q=''; continue; }
    if(c==='"'||c==="'") q=c; else if(c==='{'||c==='[') d++; else if((c==='}'||c===']')&&--d===0) return t.slice(i,j+1);
  }
  return '';
}
function impFromLabeled(text){
  const t=text.replace(/[\u201c\u201d]/g,'"').replace(/[\u2018\u2019]/g,"'");
  let parts=t.split(/\bAPI\s*#?\s*\d+\s*[:.\-–)]/i).slice(1);
  if(!parts.length) parts=t.split(/(?=\bEndpoint\s*:)/i).filter(p=>/\bEndpoint\s*:/i.test(p));
  const ops=[];
  for(const p of parts){
    const ep=p.match(/\b(?:Endpoint|URL)\s*:?\s*(https?:\/\/[^\s"'<>]+|\/[^\s"'<>]*)/i), me=p.match(/\bMethod\s*:?\s*(GET|POST|PUT|PATCH|DELETE)\b/i);
    if(!ep||!me) continue;
    const reqI=p.search(/\bRequest(?:\s*Body)?\s*:/i), resI=p.search(/\bResponse(?:\s*Body)?\s*:/i);
    const seg=(from,others)=>{ if(from<0) return undefined; const stop=others.filter(o=>o>from).sort((a,b)=>a-b)[0]; return p.slice(from,stop===undefined?undefined:stop); };
    const body=s=>{ if(s===undefined) return undefined; const b=impBalanced(s.replace(/^[^:]*:/,'')); return b?impParseLoose(b):undefined; };
    ops.push({method:me[1].toUpperCase(),url:ep[1].replace(/[.,;]+$/,''),summary:(p.match(/^\s*([^\n]{1,80})/)||[])[1]&&'',
      req:body(seg(reqI,[resI])),res:body(seg(resI,[reqI]))});
  }
  return ops;
}

function impFromText(text){
  const lab=impFromLabeled(text); if(lab.length) return {ops:lab,base:'',layout:'labelled'};
  const {blocks,text:t}=impJsonBlocks(text), ops=[], seen=new Set();
  const re=/\b(GET|POST|PUT|PATCH|DELETE)\s+(https?:\/\/[^\s"'<>]+|\/[A-Za-z0-9_\-.~\/{}:%@$&=?+]*)/g;
  const hits=[]; let m;
  while((m=re.exec(t))){
    const url=m[2].replace(/[.,;:)\]]+$/,''); if(url.length<2) continue;
    const key=m[1]+' '+url; if(seen.has(key)) continue; seen.add(key);
    hits.push({method:m[1],url,idx:m.index});
  }
  hits.forEach((h,i)=>{
    const next=i+1<hits.length?hits[i+1].idx:Infinity;
    const js=blocks.filter(b=>b.idx>h.idx&&b.idx<next).map(b=>b.val);
    const hasReq=['POST','PUT','PATCH'].includes(h.method);
    const two=hasReq&&js.length>1;   // one JSON block after a POST is almost always the sample response
    ops.push({method:h.method,url:h.url,summary:'',req:two?js[0]:undefined,res:two?js[1]:js[0]});
  });
  const b=t.match(/(?:base\s*url|server|host)[^\n]{0,30}?(https?:\/\/[^\s"'<>)]+)/i);
  return {ops,base:b?b[1].replace(/[.,;/]+$/,''):''};
}

/* --- UI --- */
function impMsg(html,kind){ const m=$('impMsg'); m.className='hint '+(kind||''); m.innerHTML=html; }
function impShow(ops,base){
  impOpen=new Set(); impOps=ops; $('impBaseRow').hidden=!ops.some(o=>o.url.startsWith('/'));
  if(base&&!$('impBase').value) $('impBase').value=base;
  $('impFilter').hidden=ops.length<6; $('impFilter').value='';
  impList();
}
function impList(){
  const q=$('impFilter').value.toLowerCase();
  const rows=impOps.map((o,i)=>[o,i]).filter(([o])=>!q||(o.method+o.url+o.summary).toLowerCase().includes(q));
  const cell=(v,show)=>!show?'<span class="na">n/a</span>':v===undefined?'<span class="na">not found</span>':`<pre>${esc(JSON.stringify(v,null,2))}</pre>`;
  $('impList').innerHTML=rows.length?`<div class="imptwrap"><table class="imptable"><thead><tr><th>#</th><th>Method</th><th>Endpoint</th><th>Request</th><th>Response</th><th></th></tr></thead><tbody>`+
    rows.map(([o,i])=>`<tr data-i="${i}"><td>${i+1}</td><td><span class="m ${o.method}">${o.method}</span></td>
      <td class="impu"><code>${esc(o.url)}</code>${o.detail||(o.issues&&o.issues.length)?`<button class="link impdetbtn" type="button">${impOpen.has(i)?'Hide details':'Details'}${o.issues&&o.issues.length?' · ⚠ '+o.issues.length:''}</button>`:''}${o.summary?`<small>${esc(o.summary)}</small>`:''}${o.gaps&&o.gaps.length?`<small class="gap">⚠ missing: ${esc(o.gaps.join(', '))}</small>`:''}${o.meta?[['Header',o.meta.headers],['Source',o.meta.source],['Destination',o.meta.destination]].filter(m=>m[1]).map(m=>`<small><b>${m[0]}:</b> ${esc(m[1])}</small>`).join(''):''}</td>
      <td>${cell(o.req,['POST','PUT','PATCH'].includes(o.method))}</td><td>${cell(o.res,true)}</td>
      <td><button type="button" class="btn ghost impuse">Use</button></td></tr>${impOpen.has(i)?`<tr class="impdet"><td></td><td colspan="5">${impDetailHtml(o)}</td></tr>`:''}`).join('')+'</tbody></table></div>'
    :'<div class="hint">No match</div>';
  $('impCount').textContent=impOps.length?`${rows.length} of ${impOps.length} endpoints`:'';
}
function impUse(o){
  let url=o.url;
  if(url.startsWith('/')){
    const b=$('impBase').value.trim().replace(/\/+$/,'');
    if(b) url=b+url; else { impMsg('This operation has a relative path — enter a <b>Base URL</b> above first.','err'); $('impBase').focus(); return; }
  }
  method=o.method; syncMethod();
  $('endpoint').value=url;
  impSrc=inMode==='manual'?null:{type:inMode==='url'&&impIsSpec?'swagger':inMode,name:inMode==='pdf'?impFileName:$('impUrl').value.trim(),endpoint:url,method:o.method,chunk:o.src||''};
  const j=v=>v===undefined?'':JSON.stringify(v,null,2);
  $('reqBody').value=['POST','PUT','PATCH'].includes(o.method)?j(o.req):'';
  $('resBody').value=j(o.res);
  ['reqBody','resBody','endpoint'].forEach(i=>$(i).dispatchEvent(new Event('input')));
  toast(`Filled ${o.method} ${url.length>60?url.slice(0,57)+'…':url}`); window.scrollTo({top:0,behavior:'smooth'});
}
$('impList').onclick=e=>{
  const d=e.target.closest('.impdetbtn'); if(d){ const i=+d.closest('tr').dataset.i; impOpen.has(i)?impOpen.delete(i):impOpen.add(i); impList(); return; }
  const b=e.target.closest('.impuse'); if(b) impUse(impOps[+b.closest('tr').dataset.i]);
};
$('impFilter').oninput=impList;

const IN_NOTES={manual:'Type the endpoint and bodies below.',pdf:'Pick an API documentation PDF — the inputs below are filled from the operation you choose.',url:'Paste an OpenAPI/Swagger JSON URL or an endpoint that returns JSON.'};
function impReset(){ impSrc=null; }
/* filling in {id} or adding a query string must not turn an imported endpoint back into a manual one */
function impStillMatches(tpl,cur){
  const re=tpl.split(/(\{[^}]+\})/).map(p=>/^\{[^}]+\}$/.test(p)?'[^/?#]+':p.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')).join('');
  return new RegExp('^'+re+'(\\?.*)?$').test(cur);
}
/* each Input Mode tab keeps its own form values, import results and generated suite, so nothing leaks from one tab into another */
const tabState={manual:null,pdf:null,url:null};
function tabSnapshot(){
  return {
    form:{method,endpoint:$('endpoint').value,req:$('reqBody').value,res:$('resBody').value},
    imp:{ops:impOps,src:impSrc,file:impFileName,isSpec:impIsSpec,msgHtml:$('impMsg').innerHTML,msgClass:$('impMsg').className,steps:$('impSteps').innerHTML,stepsHidden:$('impSteps').hidden,
         chip:$('impChip').innerHTML,chipHidden:$('impChip').hidden,count:$('impCount').textContent,base:$('impBase').value,baseHidden:$('impBaseRow').hidden,filter:$('impFilter').value,filterHidden:$('impFilter').hidden,url:$('impUrl').value,ctx:impCtx},
    suite:{cases,results,open:[...openIds],selected:[...selectedIds],allOpen,hid:currentHistoryId,pending:pendingSuite}
  };
}
const tabBlank=()=>({
  form:{method:'POST',endpoint:'',req:'',res:''},
  imp:{ops:[],src:null,file:'',isSpec:false,msgHtml:'',msgClass:'hint',steps:'',stepsHidden:true,chip:'',chipHidden:true,count:'',base:'',baseHidden:true,filter:'',filterHidden:true,url:'',ctx:null},
  suite:{cases:[],results:{},open:[],selected:[],allOpen:false,hid:null,pending:null}
});
function tabRestore(st){
  const f=st.form, i=st.imp, s=st.suite;
  method=f.method; syncMethod(); $('endpoint').value=f.endpoint; $('reqBody').value=f.req; $('resBody').value=f.res;
  ['reqBody','resBody','endpoint'].forEach(id=>$(id).dispatchEvent(new Event('input')));
  impCtx=i.ctx||null; impOps=i.ops; impSrc=i.src; impFileName=i.file; impIsSpec=i.isSpec;
  $('impMsg').innerHTML=i.msgHtml; $('impMsg').className=i.msgClass; $('impSteps').innerHTML=i.steps; $('impSteps').hidden=i.stepsHidden;
  $('impBase').value=i.base; $('impBaseRow').hidden=i.baseHidden; $('impFilter').value=i.filter; $('impFilter').hidden=i.filterHidden; $('impUrl').value=i.url;
  if(impOps.length) impList(); else { $('impList').innerHTML=''; $('impCount').textContent=''; }
  if(impOps.length) $('impCount').textContent=i.count;
  $('impFile').value=''; $('impChip').innerHTML=i.chip||''; $('impChip').hidden=i.chipHidden!==false;
  cases=s.cases; results=s.results; openIds=new Set(s.open); selectedIds=new Set(s.selected); allOpen=s.allOpen; catFilter=new Set(); currentHistoryId=s.hid; pendingSuite=s.pending;
  if(cases.length){ buildDash(); buildCats(); $('toggleAll').textContent=allOpen?'Collapse all':'Expand all'; render(); $('results').hidden=false; }
  else $('results').hidden=true;
  $('err').textContent='';
  renderHistory(); updateSaveBtn();
}
let tabsReady=false;
function setInputMode(k){
  if(tabsReady&&k!==inMode){ tabState[inMode]=tabSnapshot(); tabRestore(tabState[k]||tabBlank()); }
  tabsReady=true;
  inMode=k; $('inmodeBox').dataset.k=k;
  document.querySelectorAll('#inTabs .tab').forEach(t=>{ const on=t.dataset.imp===k; t.classList.toggle('on',on); t.setAttribute('aria-selected',on); });
  $('impPanel').hidden=k==='manual';
  document.querySelectorAll('[data-imp-pane]').forEach(p=>p.hidden=p.dataset.impPane!==k);
  $('inNote').textContent=IN_NOTES[k];
  if(k==='url') $('impUrl').focus();
  try{ localStorage.setItem('inMode',k); }catch{}
}
document.querySelectorAll('#inTabs .tab').forEach(b=>b.onclick=()=>setInputMode(b.dataset.imp));

async function impFromUrl(){
  const url=$('impUrl').value.trim(); if(!url){ impMsg('Enter a URL first.','err'); return; }
  impIsSpec=false; impMsg('⏳ Fetching…'); $('impList').innerHTML=''; $('impFetch').disabled=true;
  try{
    const r=await fetch('/api/fetch-url',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({url})});
    const d=await r.json().catch(()=>({})); if(!r.ok) throw new Error(d.error||'HTTP '+r.status);
    let json; try{ json=JSON.parse(d.text); }catch{}
    if(json&&(json.openapi||json.swagger)&&json.paths){
      impIsSpec=true; const ops=impFromSpec(json,d.url); if(!ops.length) throw new Error('The spec has no operations.');
      impMsg(`✓ ${esc(json.info?.title||'API spec')} — ${ops.length} operation${ops.length>1?'s':''}. Click one to fill the form.`,'ok'); impShow(ops,''); return;
    }
    if(json!==undefined&&d.status<400){
      impMsg(`✓ Got a JSON response (HTTP ${d.status}). Click to use it as the expected response of <b>GET</b> ${esc(d.url)}.`,'ok');
      impShow([{method:'GET',url:d.url,summary:'Live response from this URL',res:json}],''); return;
    }
    const t=impFromText(d.text);
    if(t.ops.length){ impMsg(`✓ Found ${t.ops.length} operation${t.ops.length>1?'s':''} in the page text. Click one to fill the form.`,'ok'); impShow(t.ops,t.base); return; }
    throw new Error(d.status>=400?`The URL answered HTTP ${d.status}.`:'Nothing usable found. Use a JSON OpenAPI/Swagger URL (YAML specs are not supported yet) or an endpoint that returns JSON.');
  }catch(e){ impMsg('✗ '+esc(e.message),'err'); }
  finally{ $('impFetch').disabled=false; }
}
$('impFetch').onclick=impFromUrl;
$('impUrl').onkeydown=e=>{ if(e.key==='Enter') impFromUrl(); };

const PDFJS='https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/';
function impLoadPdfJs(){
  if(window.pdfjsLib) return Promise.resolve();
  return new Promise((ok,no)=>{ const s=document.createElement('script'); s.src=PDFJS+'pdf.min.js'; s.onload=()=>{ pdfjsLib.GlobalWorkerOptions.workerSrc=PDFJS+'pdf.worker.min.js'; ok(); };
    s.onerror=()=>no(new Error('Could not load the PDF reader (needs internet access to cdnjs.cloudflare.com)')); document.head.appendChild(s); });
}
/* nothing recognised: say why, and show exactly what was read so the layout can be diagnosed */
function impNoOps(rows){
  const dump=rows.slice(0,80).map(r=>`p${r.page} │ `+r.cells.map(c=>`${c.text} [x${Math.round(c.x)}]`).join(' │ ')).join('\n');
  $('impMsg').className='hint err';
  $('impMsg').innerHTML=rows.length
    ?`✗ No endpoints found. The reader looks for a table with <b>Endpoint</b> and <b>Method</b> columns (or Endpoint / Method / Header / Source / Destination labels down the left), or lines like <code>POST /v1/users</code>.
       <details style="margin-top:6px"><summary>What was read from the PDF (first ${Math.min(rows.length,80)} lines) — send this if it still fails</summary><pre style="max-height:220px;overflow:auto;white-space:pre-wrap">${esc(dump)}</pre></details>`
    :'✗ This PDF has no selectable text — it looks like scanned images, which cannot be read.';
}
/* ---- PDF upload: load -> check the file -> read the text -> verify the content, each step shown as it happens ---- */
const IMP_STEPS=['Upload','Check the PDF file','Read the text','Verify the content','AI assist (RAG)'];
function impStep(i,state,text){   // state: run | ok | warn | fail
  const el=$('impSteps'); el.hidden=false;
  if(!el.children.length) el.innerHTML=IMP_STEPS.map((n,k)=>`<li data-s="${k}" class="pend"><i></i><div><b>${n}</b><small></small></div></li>`).join('');
  const li=el.children[i]; li.className=state; li.querySelector('small').innerHTML=text||'';
}
/* the chosen file stays visible: name + size, with a remove link */
function impChipShow(name,size){ const c=$('impChip'); c.hidden=false; c.innerHTML=`📄 <b>${esc(name)}</b> · ${impFmtSize(size)} <button class="link" id="impChipX" type="button">✕ remove</button>`; }
$('impChip').addEventListener('click',e=>{ if(e.target.id!=='impChipX') return;
  $('impFile').value=''; $('impChip').hidden=true; $('impChip').innerHTML=''; impFileName=''; impStepsReset(); impCtx=null; impOps=[]; impSrc=null;
  $('impList').innerHTML=''; $('impCount').textContent=''; impMsg(''); $('impBaseRow').hidden=true; $('impFilter').hidden=true; });
$('impFile').addEventListener('click',function(){ this.value=''; });   // choosing the same file again must still count as a change
const impStepsReset=()=>{ $('impSteps').innerHTML=''; $('impSteps').hidden=true; };
const impFmtSize=n=>n<1024?n+' B':n<1048576?(n/1024).toFixed(1)+' KB':(n/1048576).toFixed(1)+' MB';

function impReadFile(f){   // FileReader so the upload step can show real progress
  return new Promise((ok,no)=>{
    const fr=new FileReader();
    fr.onprogress=ev=>{ if(ev.lengthComputable) impStep(0,'run',`${esc(f.name)} — ${Math.round(ev.loaded/ev.total*100)}%`); };
    fr.onload=()=>ok(fr.result); fr.onerror=()=>no(new Error('The file could not be read.'));
    fr.readAsArrayBuffer(f);
  });
}

/* what did the content check find? returns {level:'ok'|'warn', lines:[...]} */
function impVerify(ops,layout,note){
  const body=o=>['POST','PUT','PATCH'].includes(o.method), warn=[];
  const noReq=ops.filter(o=>body(o)&&o.req===undefined).length, noRes=ops.filter(o=>o.res===undefined).length;
  const seen=new Set(), dup=ops.filter(o=>{ const k=o.method+' '+o.url; if(seen.has(k)) return true; seen.add(k); return false; }).length;
  const rel=ops.filter(o=>o.url.startsWith('/')).length, bad=ops.filter(o=>!/^(https?:\/\/|\/)/i.test(o.url)).length;
  if(noReq) warn.push(`${noReq} of ${ops.filter(body).length} POST/PUT/PATCH endpoint${noReq>1?'s have':' has'} no request body`);
  if(noRes) warn.push(`${noRes} of ${ops.length} endpoint${noRes>1?'s have':' has'} no response sample`);
  if(dup) warn.push(`${dup} duplicate endpoint${dup>1?'s':''} (same method + URL)`);
  if(rel) warn.push(`${rel} relative path${rel>1?'s':''} — enter the Base URL below`);
  if(bad) warn.push(`${bad} endpoint${bad>1?'s have':' has'} a URL that doesn't look like http(s)://… or /path`);
  if(note) warn.push(note.trim());
  const iss=ops.filter(o=>o.issues&&o.issues.length).length; if(iss) warn.push(`${iss} endpoint${iss>1?'s have':' has'} scrutiny notes — open Details`);
  const KIND={ai:'AI-assisted reading',sections:'per-API sections (Attribute/Value, header, request-field, response-field tables and sample response)',table:'a table',['key-value']:'label | value tables',labelled:'labelled blocks (Endpoint : … Method : …)',lines:'plain lines (POST /v1/users)'}; const kind=layout.split('+').map(l=>KIND[l]||'the text').join(' + ');
  return {level:warn.length?'warn':'ok',text:`${ops.length} endpoint${ops.length>1?'s':''} found in ${kind}`+(warn.length?' — '+warn.map(esc).join('; '):' — each has its request/response data'),};
}

$('impFile').onchange=async e=>{
  const f=e.target.files[0]; if(!f) return;
  impFileName=f.name; impChipShow(f.name,f.size); impStepsReset(); $('impList').innerHTML=''; $('impCount').textContent=''; impMsg('');
  const stop=(i,msg)=>{ impStep(i,'fail',msg); impMsg('✗ '+msg,'err'); };
  try{
    // 1) upload (into the browser — the file is never sent to a server)
    impStep(0,'run',`${esc(f.name)} — 0%`);
    if(!/\.pdf$/i.test(f.name)&&f.type!=='application/pdf') return stop(0,`“${esc(f.name)}” is not a PDF file (choose a .pdf).`);
    if(f.size===0) return stop(0,'The file is empty.');
    if(f.size>25e6) return stop(0,`The file is ${impFmtSize(f.size)} — the limit is 25 MB.`);
    const buf=await impReadFile(f);
    impStep(0,'ok',`${esc(f.name)} · ${impFmtSize(f.size)} loaded (stays in your browser)`);
    // 2) file check: real PDF header, not encrypted, pages
    impStep(1,'run','Checking…');
    const head=new TextDecoder('latin1').decode(new Uint8Array(buf.slice(0,1024))), m=head.match(/%PDF-(\d\.\d)/);
    if(!m) return stop(1,'This is not a valid PDF (no %PDF header) — the file may be renamed, damaged or a different format.');
    await impLoadPdfJs();
    let pdf;
    try{ pdf=await pdfjsLib.getDocument({data:new Uint8Array(buf)}).promise; }
    catch(err){ return stop(1,err&&err.name==='PasswordException'?'The PDF is password-protected — remove the password and try again.':'The PDF could not be opened ('+esc(err&&err.message||'damaged file')+').'); }
    impStep(1,'ok',`Valid PDF ${m[1]} · ${pdf.numPages} page${pdf.numPages>1?'s':''}${pdf.numPages>200?' (first 200 are read)':''}`);
    // 3) text
    impStep(2,'run','Reading…');
    const rows=await impPdfRows(pdf);
    if(!rows.length) return stop(2,'No selectable text — this looks like a scanned/image PDF, which cannot be read. Export it as a text PDF (or use OCR) and try again.');
    impStep(2,'ok',`${rows.length} text line${rows.length>1?'s':''} read`);
    // 4) content: run every reader — structured ones (sections / tables / label|value) decide which endpoints exist,
    //    the plain-text reader only fills gaps — then report what is still missing per endpoint
    impStep(3,'run','Looking for endpoints…');
    let text='';
    for(let p=1;p<=Math.min(pdf.numPages,200);p++){
      const c=await (await pdf.getPage(p)).getTextContent();
      text+=c.items.map(it=>it.str+(it.hasEOL?'\n':' ')).join('')+'\n';
    }
    const lists=[], sec=impFromSections(rows), tb=impFromTables(rows,true), tx=impFromText(text);
    if(sec.ops.length) lists.push({layout:'sections',ops:sec.ops});
    if(tb.ops.length) lists.push({layout:tb.layout||'table',ops:tb.ops});
    const ops=impMergeOps(lists,tx.ops), chunks=impChunks(rows);
    const note=(sec.ops.length?'':tb.note||'')+(ops.length?impFillFromJsonBlocks(ops,rows):''), layout=(sec.ops.length?'sections':lists.map(l=>l.layout).join('+'))||tx.layout||'lines';
    impAttachSources(ops,chunks);
    impValidateOps(ops); impAddGaps(ops);                                   // discard unreadable data, normalise URLs, list what is missing
    const q=impQuality(ops,text), ctx={rows,chunks,ops,layout,note,base:tx.base||'',doc:f.name,aiDone:false,q};
    const canAi=typeof llmReady==='function'&&llmReady();
    if(q.messy&&canAi&&ragOn()){                                                      // messy / incomplete: the AI reads, formats and scrutinises it right away
      impStep(3,'warn',!ops.length?'The built-in readers found no endpoints':`The built-in readers are not confident (${[q.junk&&`${q.junk} unreadable block${q.junk>1?'s':''} discarded`,q.missing.length&&`${q.missing.length} mentioned endpoint${q.missing.length>1?'s':''} not captured`,q.hard&&`${q.hard} endpoint${q.hard>1?'s':''} incomplete`].filter(Boolean).join(', ')})`);
      impCtx=ctx; await impRunAi(); return;
    }
    if(!ops.length){ impStep(3,'fail','The built-in readers found no endpoints'); impStep(4,'pend',canAi?'AI-assisted reading is off — use the button below to let the AI read this PDF':'Configure an LLM in .env to let the AI read PDFs the built-in readers cannot'); impCtx=ctx; impNoOps(rows);
      if(canAi) $('impMsg').insertAdjacentHTML('beforeend','<div style="margin-top:8px"><button id="impAiBtn" class="btn ghost" type="button" style="padding:4px 12px">✨ Use AI for this PDF</button></div>');
      return; }
    if(q.messy) ctx.note+=` This document looks messy${q.junk?` (${q.junk} unreadable block${q.junk>1?'s':''} discarded)`:''}${q.missing.length?` (${q.missing.length} mentioned endpoint${q.missing.length>1?'s':''} not captured: ${q.missing.slice(0,3).map(m=>m.method+' '+m.url).join(', ')})`:''} — configure an LLM in .env so the AI can read and format it.`;
    impPresent(ctx);
  }catch(err){ stop(3,esc(err.message)); }
};
setInputMode('manual');
