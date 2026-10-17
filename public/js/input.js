/* ---------- input UI ---------- */
$('methods').innerHTML = METHODS.map(m=>`<button class="mbtn" data-m="${m}">${m}</button>`).join('');
$('methods').onclick = e => { const b=e.target.closest('.mbtn'); if(b){ method=b.dataset.m; syncMethod(); } };
function syncMethod(){
  document.querySelectorAll('.mbtn').forEach(b=>b.classList.toggle('on',b.dataset.m===method));
  const hasReq = ['POST','PUT','PATCH'].includes(method);
  $('reqPane').classList.toggle('off',!hasReq);
  $('resLabel').textContent = method==='GET' ? 'Response Body (JSON) — expected 200' : 'Response Body (JSON) — expected success';
  $('resHint').textContent = method==='GET' ? 'GET has no request body: the agent builds all tests from this response.'
    : method==='DELETE' ? 'Optional. Response returned on successful delete.'
    : 'The agent also cross-checks the response against the request (echoed fields, ids, types).';
}
function jsonState(id,badge){
  const el=$(id), b=$(badge), v=el.value.trim();
  el.classList.remove('good','bad'); b.className='badge';
  if(!v){ b.textContent='empty'; return; }
  try{ JSON.parse(v); el.classList.add('good'); b.classList.add('ok'); b.textContent='✓ valid JSON'; }
  catch(e){ el.classList.add('bad'); b.classList.add('err'); b.textContent='✗ invalid JSON'; }
}
$('reqBody').oninput=()=>jsonState('reqBody','reqBadge');
$('resBody').oninput=()=>jsonState('resBody','resBadge');
document.querySelectorAll('[data-fmt]').forEach(b=>b.onclick=()=>{
  const t=$(b.dataset.fmt); try{ t.value=JSON.stringify(JSON.parse(t.value),null,2); }catch{ toast('Cannot format: invalid JSON'); }
  t.dispatchEvent(new Event('input'));
});
function chips(){
  const v=$('endpoint').value.trim(), out=[];
  const params=[...v.matchAll(/\{([^}]+)\}/g)].map(m=>m[1]);
  try{ const u=new URL(v.replace(/\{[^}]+\}/g,'1')); out.push(['🌐 '+u.protocol.replace(':','').toUpperCase()],['📍 '+u.pathname]);
       u.searchParams.forEach((_,k)=>out.push(['❓ query: '+k])); }catch{ if(v) out.push(['⚠ not a valid URL']); }
  params.forEach(p=>out.push(['🔑 path param: '+p]));
  $('epChips').innerHTML=out.map(c=>`<span class="chip">${esc(c[0])}</span>`).join('');
}
$('endpoint').oninput=chips;
$('sample').onclick=()=>{
  const s=SAMPLES[method];
  if(method==='GET'||method==='DELETE'){ $('endpoint').value = method==='GET'?'https://api.example.com/v1/users/{id}':'https://api.example.com/v1/users/{id}'; }
  else $('endpoint').value = method==='POST'?'https://api.example.com/v1/users':'https://api.example.com/v1/users/{id}';
  $('reqBody').value = s.req?JSON.stringify(s.req,null,2):'';
  $('resBody').value = JSON.stringify(s.res,null,2);
  ['reqBody','resBody'].forEach(i=>$(i).dispatchEvent(new Event('input'))); chips();
};
$('clear').onclick=()=>{ $('reqBody').value=$('resBody').value=''; ['reqBody','resBody'].forEach(i=>$(i).dispatchEvent(new Event('input'))); $('results').hidden=true; };
