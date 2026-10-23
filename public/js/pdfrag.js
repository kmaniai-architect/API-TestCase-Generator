/* ---------- AI-assisted PDF reading (RAG) + learning from earlier PDFs ----------
   The built-in readers run first. When something important is missing — or nothing is found — the document text is cut into passages,
   the server picks the passages that describe APIs, adds the most similar EARLIER examples (PDFs read cleanly before, endpoints the user
   confirmed) as few-shot guidance, and asks the configured LLM to extract the APIs. Results are merged with what the readers found. */
let impCtx=null;   // the PDF currently shown: {rows,chunks,ops,layout,note,base,aiDone,aiNote,doc}

/* passages: one per API section when the headings are recognisable, otherwise page by page; long ones are split (tables flattened to "a | b | c") */
function impChunks(rows){
  const clean=impDropEdges(rows), lines=clean.map(r=>({page:r.page,text:r.cells.map(c=>c.text).join(' | ')}));
  let bounds=[]; try{ bounds=impFindHeadings(clean).map(h=>h.i); }catch{}
  if(!bounds.length) lines.forEach((l,i)=>{ if(i===0||l.page!==lines[i-1].page) bounds.push(i); });
  if(bounds[0]!==0) bounds.unshift(0);
  const out=[];
  bounds.forEach((b,k)=>{
    const part=lines.slice(b,k+1<bounds.length?bounds[k+1]:lines.length); let buf='';
    part.forEach(l=>{ if(buf.length+l.text.length>3500){ out.push(buf); buf=''; } buf+=(buf?'\n':'')+l.text; });
    if(buf.trim()) out.push(buf);
  });
  return out;
}
/* remember which passage each endpoint came from (this is what gets stored as a learning example) */
function impAttachSources(ops,chunks){
  ops.forEach(o=>{
    if(o.src) return;
    const path=o.url.replace(/^https?:\/\/[^/]+/i,'').split('?')[0], tail=(path.split('/').filter(s=>s&&!/[{:]/.test(s)).pop()||path).toLowerCase();
    const hit=chunks.filter(c=>tail&&c.toLowerCase().includes(tail)).sort((a,b)=>(/(method|endpoint|request|response)/i.test(b)?1:0)-(/(method|endpoint|request|response)/i.test(a)?1:0)||a.length-b.length)[0];
    if(hit) o.src=hit.slice(0,3000);
  });
}
const impOpForLearning=o=>({method:o.method,url:o.url,request:o.req,response:o.res});
function impLearn(items,kind,doc){
  const list=items.filter(i=>i.chunk).map(i=>({chunk:i.chunk,op:i.op,kind}));
  if(!list.length) return Promise.resolve();
  return fetch('/api/pdf/learn',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({doc,items:list})}).then(r=>r.json()).then(refreshLearned).catch(()=>{});
}
async function refreshLearned(s){
  try{ s=s&&s.examples!==undefined?s:await (await fetch('/api/pdf/stats')).json(); }catch{ return; }
  $('impLearned').innerHTML=s.examples?`🧠 Learned from ${s.documents} earlier PDF${s.documents===1?'':'s'} · ${s.examples} example${s.examples===1?'':'s'} (${s.confirmed} confirmed by you) — used to read new layouts <button class="link" id="impForget" type="button">forget</button>`:'';
}

/* the clean "tabular" view of one endpoint: headers, request fields, response fields, status codes, scrutiny notes */
function impDetailHtml(o){
  const d=o.detail||{}, t=(title,cols,rows)=>rows&&rows.length?`<div class="dt"><h5>${title}</h5><table><thead><tr>${cols.map(c=>`<th>${c}</th>`).join('')}</tr></thead><tbody>${rows.map(r=>`<tr>${r.map(x=>`<td>${esc(x||'')}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`:'';
  const html=t('Headers',['Name','Value','Required'],(d.headers||[]).map(h=>[h.name,h.value,h.required]))+
    t('Request fields',['Field','Type','Required','Sample','Description'],(d.reqFields||[]).map(f=>[f.name,f.type,f.required,f.sample,f.description]))+
    t('Response fields',['Field','Type','Required','Sample','Description'],(d.resFields||[]).map(f=>[f.name,f.type,f.required,f.sample,f.description]))+
    t('Status codes',['Code','Meaning'],(d.statusCodes||[]).map(s=>[s.code,s.meaning]));
  const iss=(o.issues||[]).length?`<div class="dt iss"><h5>Scrutiny notes</h5><ul>${o.issues.map(i=>`<li>${esc(i)}</li>`).join('')}</ul></div>`:'';
  return `<div class="dgrid2">${html||'<div class="hint">No tables were captured for this endpoint.</div>'}${iss}</div>`;
}

/* show a result: verification step, AI-assist step, message, endpoint table; learn from clean reads */
function impPresent(c){
  impCtx=c; const ops=impAddGaps(c.ops), layout=(c.layout||'')+(c.aiDone?'+ai':''), v=impVerify(ops,layout,c.note);
  impStep(3,v.level,v.text);
  const hard=ops.filter(o=>o.gaps.some(g=>g!=='headers')).length, canAi=typeof llmReady==='function'&&llmReady();
  if(c.aiDone) impStep(4,'ok',c.aiNote);
  else if(!hard) impStep(4,'ok','Not needed — nothing important is missing');
  else if(canAi) impStep(4,'warn',`Details are missing for ${hard} endpoint${hard>1?'s':''} — the AI can read the PDF text (relevant passages + earlier examples) to fill them`);
  else impStep(4,'pend','Details are missing — configure an LLM in .env to let the AI fill them');
  const btn=hard&&canAi&&!c.aiDone?' <button id="impAiBtn" class="btn ghost" type="button" style="padding:4px 12px">✨ Fill the gaps with AI</button>':'';
  impMsg((v.level==='ok'?`✓ Verified — ${ops.length} endpoint${ops.length>1?'s':''}. Click <b>Use</b> on one to fill the form.`:`⚠ Read with warnings — see the checklist above, then click <b>Use</b> on an endpoint.`)+btn,v.level==='ok'?'ok':'');
  impShow(ops,c.base);
  if(!hard&&!c.aiDone&&ops.length) impLearn(ops.slice(0,12).filter(o=>o.src).map(o=>({chunk:o.src,op:impOpForLearning(o)})),'auto',c.doc);   // weak supervision: a clean read teaches the layout
}

async function impRunAi(){
  const c=impCtx; if(!c) return;
  impStep(4,'run',`Selecting the relevant passages and asking ${esc(typeof llmName==='function'?llmName():'the AI')}…`);
  impMsg('⏳ AI is reading the document…'); const b=$('impAiBtn'); if(b) b.disabled=true;
  try{
    const headers={'Content-Type':'application/json'};
    const r=await fetch('/api/pdf/extract',{method:'POST',headers,body:JSON.stringify({chunks:c.chunks.map(t=>({text:t})),known:c.ops.map(o=>({method:o.method,url:o.url}))})});
    const d=await r.json().catch(()=>({})); if(!r.ok) throw new Error(d.error||'HTTP '+r.status);
    // the AI result is the primary one (it formatted and scrutinised the document); the built-in readers only fill what it left out
    const merged=impMergeOps([{ops:d.ops},{ops:c.ops}],[]), added=merged.filter(m=>!c.ops.some(o=>impSameApi(o,m))).length;
    const docBase=impDocBase(c.rows.map(impRowText).join('\n'));   // the document's own Base URL completes bare paths
    if(docBase) merged.forEach(o=>{ if(o.url.startsWith('/')){ o.url=docBase.replace(/\/+$/,'')+o.url; o.issues=(o.issues||[]).filter(i=>!/^URL has no host/.test(i)); } });
    impValidateOps(merged); impAttachSources(merged,c.chunks); impAddGaps(merged);
    const notes=merged.reduce((n,o)=>n+(o.issues?o.issues.length:0),0);
    c.ops=merged; c.aiDone=true;
    c.aiNote=`${esc(d.llm)} read ${d.passages} of ${d.of} passages using ${d.examples} earlier example${d.examples===1?'':'s'} — ${merged.length} endpoint${merged.length===1?'':'s'} formatted into tables (${added} the built-in readers had missed), ${notes} scrutiny note${notes===1?'':'s'}`;
    if(!c.ops.length){ impStep(4,'fail','The AI found no API operations in this document.'); impNoOps(c.rows); return; }
    impPresent(c);
  }catch(e){
    impStep(4,'fail',esc(e.message));
    // keep what the built-in readers found, and let the user retry (provider overloads are usually temporary)
    if(c.ops.length){ impShow(c.ops,c.base); impMsg('⚠ The AI step failed (see the checklist) — the built-in result is shown. <button id="impAiBtn" class="btn ghost" type="button" style="padding:4px 12px">↻ Try the AI again</button>','err'); }
    else impMsg('✗ '+esc(e.message)+' <button id="impAiBtn" class="btn ghost" type="button" style="padding:4px 12px">↻ Try again</button>','err');
  }
}
$('impMsg').addEventListener('click',e=>{ if(e.target.id==='impAiBtn') impRunAi(); });
$('impLearned').addEventListener('click',async e=>{ if(e.target.id==='impForget'&&confirm('Forget everything learned from earlier PDFs?')){ try{ refreshLearned(await (await fetch('/api/pdf/learned',{method:'DELETE'})).json()); }catch{} } });
refreshLearned();
