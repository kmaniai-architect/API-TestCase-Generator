/* ---------- postman export: auth + live header dialog ---------- */
const HDR_NAME=/^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/;
const SECRET_HDR=/^(authorization|proxy-authorization|cookie|x-api-key)$/i;
let hdrVarVals={}, hdrRows=[{on:true,k:'Content-Type',v:'application/json'},{on:true,k:'Accept',v:'application/json'}], showSecrets=false;
const originOf=u=>(String(u).match(/^https?:\/\/[^/?#\s]+/i)||[''])[0];
const baseVal=()=>$('pmBase').value.trim().replace(/\/+$/,'');
/* endpoint -> Postman url object; with a base-URL variable only the path stays */
function pmUrl(endpoint){
  let u=String(endpoint||'').replace(/\{(\w+)\}/g,'{{$1}}');
  if($('pmUseEnv').checked){
    const v='{{'+$('pmVar').value.trim()+'}}', o=originOf(u);
    const b=baseVal();
    if(o&&b&&u.toLowerCase().startsWith(b.toLowerCase())&&/^([/?#]|$)/.test(u.slice(b.length))) u=v+u.slice(b.length);
    else if(o===''&&!u.startsWith('{{')) u=v+(u.startsWith('/')?'':'/')+u;
  }
  const [pathPart,query]=u.split(/\?(.*)/s), m=pathPart.match(/^((?:https?:\/\/)?[^/]+)(.*)$/);
  const out={raw:u};
  if(m){ out.host=[m[1]]; out.path=m[2].split('/').filter(Boolean); }
  if(query!==undefined) out.query=query.split('&').filter(Boolean).map(q=>{ const [key,...r]=q.split('='); return {key,value:r.join('=')}; });
  return out;
}
const b64=s=>btoa(unescape(encodeURIComponent(s)));

/* Auth as a Postman variable: the header carries {{name}}; the real value (optional) goes only to the environment file */
const authVarOn=()=>$('pmAuth').value!=='none'&&$('pmAuthVar').checked, authVarName=()=>$('pmAuthVarName').value.trim();
function authHeader(){
  const t=$('pmAuth').value, g=id=>$(id).value.trim(), hv=x=>x.includes('{{');
  if(t==='none') return null;
  const asVar=authVarOn()?'{{'+authVarName()+'}}':null;
  let a;
  if(t==='bearer'){ const k=g('pmToken'); a={k:'Authorization',real:k,v:'Bearer '+k,need:['pmToken'],fields:['pmToken']}; }
  else if(t==='apikey'){ const k=g('pmKeyVal'); a={k:g('pmKeyName'),real:k,v:k,need:['pmKeyName','pmKeyVal'],fields:['pmKeyVal']}; }
  else { const u=g('pmUser'), p=$('pmPass').value; a={k:'Authorization',real:u||p?b64(u+':'+p):'',need:['pmUser','pmPass'],fields:['pmUser','pmPass']};
    if(hv(u)||hv(p)) a.basic={u,p}; else a.v='Basic '+a.real; }
  a.typed=a.fields.some(id=>hv($(id).value));   // the user typed {{variables}} straight into the auth fields
  if(!a.typed&&asVar){ a.v=(t==='bearer'?'Bearer ':t==='basic'?'Basic ':'')+asVar; a.need=t==='apikey'?['pmKeyName']:[]; a.isVar=true; }   // checkbox: secret itself is optional
  return a;
}
const pmFileBase=()=>$('pmName').value.trim().replace(/[\\\/:*?"<>|\x00-\x1f]+/g,'_').replace(/\s+/g,'_').slice(0,80)||'collection';
const VARRE=/\{\{\s*([^{}\s]+)\s*\}\}/g;
function pmState(){
  const errs=[], dlg=[], rowErr=hdrRows.map(()=>''), list=[], seen=new Set(), envVars=[], hdrVars=new Map(); let basicAuth=null;
  const add=(k,v,i,isVar)=>{
    if(seen.has(k.toLowerCase())){ const m=`Duplicate header "${k}"`; errs.push(m); if(i>=0) rowErr[i]=m; return; }
    seen.add(k.toLowerCase()); list.push({k,v,secret:!isVar&&SECRET_HDR.test(k)&&!v.includes('{{')});
  };
  const nmEl=$('pmName'); nmEl.classList.remove('bad');
  if(!nmEl.value.trim()){ nmEl.classList.add('bad'); dlg.push('Collection name is required'); }
  ['pmToken','pmKeyName','pmKeyVal','pmUser','pmPass','pmAuthVarName'].forEach(id=>$(id).classList.remove('bad'));
  const on=$('hdrOn').checked, au=on?authHeader():null;
  if(au){
    let ok=true;
    au.need.forEach(id=>{ if(!$(id).value.trim()){ ok=false; $(id).classList.add('bad'); errs.push(`Authentication: ${$(id).dataset.label} is required`); } });
    if(ok&&!HDR_NAME.test(au.k)){ ok=false; $('pmKeyName').classList.add('bad'); errs.push(`Authentication: "${au.k}" is not a valid header name`); }
    if(au.isVar&&!/^[A-Za-z_]\w*$/.test(authVarName())){ ok=false; $('pmAuthVarName').classList.add('bad'); errs.push('Authentication: variable name must be letters, digits or _ (e.g. authToken)'); }
    if(au.typed) au.fields.forEach(id=>{
      const val=$(id).value;
      if(/[{}]/.test(val.replace(VARRE,''))){ ok=false; $(id).classList.add('bad'); errs.push(`Authentication: ${$(id).dataset.label} has a broken variable — write it as {{name}}`); }
      else for(const m of val.matchAll(VARRE)) hdrVars.set(m[1],true);
    });
    if(ok&&au.basic){   // Basic needs base64, which a header can't compute -> exported as Postman's own Basic auth with the variables
      const hv=x=>x.includes('{{');
      basicAuth=au.basic; seen.add('authorization');
      list.push({k:'Authorization',v:`Basic (${au.basic.u} : ${hv(au.basic.p)?au.basic.p:'••••'})`,secret:false,display:true});
    } else if(ok){ add(au.k,au.v,-1,au.isVar||au.typed); if(au.isVar) envVars.push({key:authVarName(),value:au.real,secret:true}); }
  }
  if($('pmUseEnv').checked){
    const nm=$('pmVar'), bv=$('pmBase');
    nm.classList.remove('bad'); bv.classList.remove('bad');
    if(!/^[A-Za-z_]\w*$/.test(nm.value.trim())){ nm.classList.add('bad'); dlg.push('Variable name must be letters, digits or _ (e.g. baseUrl)'); }
    if(!/^https?:\/\/[^\s/?#]+(\/[^\s?#]*)?$/i.test(baseVal())){ bv.classList.add('bad'); dlg.push('Base URL must look like https://host[/prefix]'); }
  }
  hdrRows.forEach((r,i)=>{
    if(!on||!r.on) return;
    const k=r.k.trim(), v=r.v.trim(); if(!k&&!v) return;
    let m='';
    if(!k) m='Header name is required';
    else if(!HDR_NAME.test(k)) m=`"${k}" is not a valid header name`;
    else if(!v) m=`"${k}" has no value`;
    else if(/[\r\n]/.test(r.v)) m=`"${k}" value cannot contain line breaks`;
    else {   // {{variable}} references: collect them, reject broken braces
      const left=v.replace(/\{\{\s*([^{}\s]+)\s*\}\}/g,(x,n)=>{ if(!hdrVars.has(n)) hdrVars.set(n,SECRET_HDR.test(k)); return ''; });
      if(/\{\{|\}\}|[{}]/.test(left)) m=`"${k}" has a broken variable — write it as {{name}}`;
    }
    if(m){ rowErr[i]=m; errs.push(m); return; }
    add(k,v,i);
  });
  const envCount=($('pmUseEnv').checked?1:0)+envVars.length+hdrVars.size;
  const wantCol=$('pmDlCol').checked, wantEnv=$('pmDlEnv').checked&&envCount>0;
  if(!wantCol&&!wantEnv) dlg.push('Select at least one file to download');
  // variables already provided elsewhere are not asked for again
  const known=new Set(envVars.map(v=>v.key)); if($('pmUseEnv').checked) known.add($('pmVar').value.trim());
  const hv=[...hdrVars].filter(([n])=>!known.has(n)).map(([key,secret])=>({key,secret}));
  return {errs,dlg,rowErr,list,envVars,hdrVars:hv,basicAuth,envCount,wantCol,wantEnv};
}
const maskVal=v=>v.replace(/^((?:Bearer|Basic) )?(.{0,4}).*$/,(m,a,c)=>(a||'')+c+'••••••••');
function pmRender(rebuild){
  if(rebuild) $('pmRows').innerHTML=hdrRows.map((r,i)=>`<div class="hrow" data-i="${i}"><input type="checkbox" class="hon" ${r.on?'checked':''} title="Include">
    <input class="hk" placeholder="Header name" value="${esc(r.k)}" autocomplete="off"><input class="hv" placeholder="Value or {{variable}}" value="${esc(r.v)}" autocomplete="off">
    <button class="link hdel" type="button" title="Remove">✕</button><div class="herr"></div></div>`).join('');
  const st=pmState();
  $('pmRows').querySelectorAll('.hrow').forEach((el,i)=>{ el.querySelector('.herr').textContent=st.rowErr[i]; el.classList.toggle('bad',!!st.rowErr[i]); });
  $('pmLive').innerHTML=st.list.length?st.list.map(h=>`<div><b>${esc(h.k)}</b>: ${esc(h.secret&&!showSecrets?maskVal(h.v):h.v)}</div>`).join(''):'<i>No headers</i>';
  const status=e=>e.length?`<span class="no">✗ ${e.length} issue${e.length>1?'s':''} — ${esc(e[0])}</span>`:`<span class="yes">✓ Valid · ${st.list.length} header${st.list.length===1?'':'s'}</span>`;
  $('hdrBody').hidden=!$('hdrOn').checked;
  $('pmStatus').innerHTML=$('hdrOn').checked?status(st.errs):'<span class="off">Headers off — not validated, exported or sent to the AI</span>';
 $('pmStatusDlg').innerHTML=status(st.errs.concat(st.dlg)).replace(/Valid · \d+ headers?/,$('hdrOn').checked?'$&':'Ready to export');
  $('pmEnvBox').hidden=!$('pmUseEnv').checked;
  const first=cases.find(x=>selectedIds.has(x.id));
  if(first&&!st.dlg.some(e=>/^(Variable|Base)/.test(e))){
    const raw=String(first.endpoint).replace(/\{(\w+)\}/g,'{{$1}}');
    $('pmUrlLive').innerHTML=`<span class="u">${esc(raw)}</span><span class="u">→ <b>${esc(pmUrl(first.endpoint).raw)}</b></span>`;
  } else $('pmUrlLive').innerHTML='<i>—</i>';
  $('pmGo').disabled=!!(st.errs.length||st.dlg.length);
  $('pmRevealBtn').textContent=showSecrets?'Hide secrets':'Show secrets';
  document.querySelectorAll('.pmf').forEach(f=>f.hidden=f.dataset.for!==$('pmAuth').value);
  $('pmCredHint').textContent=authVarOn()?'The auth value stays out of the collection — it is only in the environment file (marked secret).':'Credentials are written into the downloaded file — do not share it.';
  const names=st.hdrVars.map(v=>v.key).join('|'), box=$('pmVarsList');
  $('pmVarsBox').hidden=!$('hdrOn').checked||!st.hdrVars.length;
  if(box.dataset.names!==names){   // rebuild only when the set of variables changes, so typing keeps focus
    box.dataset.names=names;
    box.innerHTML=st.hdrVars.map(v=>`<div class="varrow"><code>{{${esc(v.key)}}}</code><input data-var="${esc(v.key)}" type="${v.secret?'password':'text'}" placeholder="value (optional)" value="${esc(hdrVarVals[v.key]||'')}" autocomplete="off"></div>`).join('');
  }
  ['pmToken','pmKeyVal','pmPass'].forEach(id=>{ const el=$(id); el.type=el.value.includes('{{')?'text':'password'; });   // a typed {{variable}} is not a secret: show it
  $('pmDlEnv').disabled=!st.envCount;
  $('pmDlEnvNote').textContent=!st.envCount?'(no variables to export)':!$('pmDlEnv').checked&&st.envVars.length+st.hdrVars.length?'(variable values will have to be set in Postman by hand)':'';
  const fb=pmFileBase();
  $('pmColFile').textContent=fb+'.postman_collection.json'; $('pmEnvFileName').textContent=fb+'.postman_environment.json';
  $('pmAuthVarRow').hidden=$('pmAuth').value==='none'; $('pmAuthVarBox').hidden=!authVarOn();
  return st;
}
$('postman').onclick=()=>{
  if(!cases.some(x=>selectedIds.has(x.id))){ toast('Tick at least one test case to export to Postman'); return; }
  $('pmCount').textContent=selectedIds.size;
  $('hdrOn').checked=true;   // exporting to Postman turns the headers section on
  if(!$('pmName').dataset.init){ $('pmName').dataset.init=1; try{ $('pmName').value=localStorage.getItem('pmName')||$('pmName').value; }catch(e){} }
  if(!$('pmBase').value){ const f=cases.find(x=>selectedIds.has(x.id)); $('pmBase').value=f?originOf(f.endpoint):''; }
  // the full headers & auth editor moves into the dialog while it is open (same elements, so one shared state)
  const card=$('hdrCard'); if(!hdrHome){ hdrHome={parent:card.parentNode,next:card.nextSibling}; }
  $('pmHdrSlot').appendChild(card); $('pmDlg').hidden=false; pmRender(false);
};
try{ $('hdrOn').checked=localStorage.getItem('hdrOn')==='1'; }catch(e){}
$('hdrOn').addEventListener('change',()=>{ try{ localStorage.setItem('hdrOn',$('hdrOn').checked?'1':'0'); }catch(e){} pmRender(false); });
$('hdrCard').addEventListener('input',e=>{
  if(e.target.dataset&&e.target.dataset.var){ hdrVarVals[e.target.dataset.var]=e.target.value; return; }
  const row=e.target.closest('.hrow');
  if(row){ const r=hdrRows[+row.dataset.i], c=e.target.classList;
    if(c.contains('hk')) r.k=e.target.value; else if(c.contains('hv')) r.v=e.target.value; else if(c.contains('hon')) r.on=e.target.checked; }
  pmRender(false);
});
$('pmDlg').addEventListener('input',()=>pmRender(false));
$('hdrCard').addEventListener('click',e=>{
  const row=e.target.closest('.hrow'), id=e.target.id;
  if(e.target.classList.contains('hdel')&&row){ hdrRows.splice(+row.dataset.i,1); pmRender(true); }
  if(id==='pmAdd'){ hdrRows.push({on:true,k:'',v:''}); pmRender(true); $('pmRows').querySelector('.hrow:last-child .hk').focus(); }
  if(id==='pmRevealBtn'){ showSecrets=!showSecrets; pmRender(false); }
});
let hdrHome=null;
function closePm(){ $('pmDlg').hidden=true; if(hdrHome) hdrHome.parent.insertBefore($('hdrCard'),hdrHome.next); }   // headers editor goes back to the main form
$('pmDlg').addEventListener('click',e=>{ if(e.target.id==='pmCancel'||e.target===$('pmDlg')) closePm(); });
document.addEventListener('keydown',e=>{ if(e.key==='Escape'&&!$('pmDlg').hidden) closePm(); });

$('pmGo').onclick=()=>{
  const st=pmRender(false); if(st.errs.length||st.dlg.length) return;
  const colName=$('pmName').value.trim(), fileBase=colName.replace(/[\\\/:*?"<>|\x00-\x1f]+/g,'_').replace(/\s+/g,'_').slice(0,80)||'collection';
  try{ localStorage.setItem('pmName',colName); }catch(e){}
  const sel=cases.filter(x=>selectedIds.has(x.id)), folders={}, header=st.list.filter(h=>!h.display).map(h=>({key:h.k,value:h.v}));
  sel.forEach(x=>{
    const hasBody=!['GET','HEAD','DELETE'].includes(x.method)&&x.request!==undefined&&x.request!==null&&x.request!=='';
    const raw=hasBody?(typeof x.request==='string'?x.request:JSON.stringify(x.request,null,2)):'';
    const code=parseInt(x.status,10);
    const req={method:x.method,header:header.map(h=>({...h})),url:pmUrl(x.endpoint),
      description:`${x.type} · ${x.priority} priority · ${x.source}\n\nExpected: ${x.status} — ${x.expected}\n\nSteps (${stepFmt==='gherkin'?'Gherkin':'Standard'}):\n${stepsText(x)}`};
    if(hasBody) req.body={mode:'raw',raw,options:{raw:{language:'json'}}};
    const item={name:`${x.id} - ${x.title}`,request:req};
    if(code) item.event=[{listen:'test',script:{type:'text/javascript',exec:[
      `pm.test(${JSON.stringify('Status is '+x.status)}, function () {`,`    pm.response.to.have.status(${code});`,'});']}}];
    (folders[x.category]=folders[x.category]||[]).push(item);
  });
  const col={info:{name:colName,schema:'https://schema.getpostman.com/json/collection/v2.1.0/collection.json'},
    item:Object.entries(folders).map(([name,item])=>({name,item}))};
  if(st.basicAuth) col.auth={type:'basic',basic:[{key:'username',value:st.basicAuth.u,type:'string'},{key:'password',value:st.basicAuth.p,type:'string'}]};
  const useEnv=$('pmUseEnv').checked, vn=$('pmVar').value.trim();
  if(useEnv) col.variable=[{key:vn,value:baseVal(),type:'string'}];
  if(st.wantCol) download(fileBase+'.postman_collection.json',JSON.stringify(col,null,2),'application/json');
  if(st.wantEnv){
    const values=(useEnv?[{key:vn,value:baseVal(),type:'default',enabled:true}]:[]).concat(st.envVars.map(v=>({key:v.key,value:v.value,type:'secret',enabled:true})),st.hdrVars.map(v=>({key:v.key,value:hdrVarVals[v.key]||'',type:v.secret?'secret':'default',enabled:true})));
    const env={id:crypto.randomUUID?crypto.randomUUID():String(Date.now()),name:colName+' - Environment',values,_postman_variable_scope:'environment'};
    setTimeout(()=>download(fileBase+'.postman_environment.json',JSON.stringify(env,null,2),'application/json'),st.wantCol?300:0);
  }
  closePm();
};
pmRender(true);
