/* ---------- dashboard ---------- */
function countUp(el,to){
  const reduce=matchMedia('(prefers-reduced-motion:reduce)').matches; if(reduce){ el.textContent=to; return; }
  const t0=performance.now(); (function f(t){ const p=Math.min((t-t0)/900,1); el.textContent=Math.round(to*(1-Math.pow(1-p,3))); if(p<1) requestAnimationFrame(f); })(t0);
}
function buildDash(){
  const c=k=>cases.filter(x=>x.type===k).length, s=k=>cases.filter(x=>x.source===k).length;
  const items=[[cases.length,'Total test cases'],[c('Positive'),'Positive'],[c('Negative'),'Negative'],[s('AI'),'Written by AI'],[s('Request')+s('Response'),'Rule-based (bodies)'],[cases.filter(x=>x.priority==='High').length,'High priority']];
  $('dash').innerHTML=items.map((it,i)=>`<div class="stat" style="animation-delay:${i*70}ms"><b data-n="${it[0]}">0</b><span>${it[1]}</span></div>`).join('')+
   `<div class="stat ringbox" style="animation-delay:420ms"><svg class="ring" width="56" height="56" viewBox="0 0 56 56"><circle class="bg" cx="28" cy="28" r="24"/><circle class="fg" id="ringFg" cx="28" cy="28" r="24" stroke-dasharray="150.8" stroke-dashoffset="150.8"/></svg><div><b id="execPct">0%</b><span>Executed (<span id="execN">0</span>/${cases.length})</span></div></div>`;
  $('dash').querySelectorAll('b[data-n]').forEach(b=>countUp(b,+b.dataset.n));
}
function updateRing(){
  const done=Object.keys(results).length, pct=cases.length?Math.round(done/cases.length*100):0;
  $('ringFg').style.strokeDashoffset=150.8*(1-pct/100); $('execPct').textContent=pct+'%'; $('execN').textContent=done;
  if(typeof persistResults==='function') persistResults();
}
function buildCats(){
  const counts={}; cases.forEach(x=>counts[x.category]=(counts[x.category]||0)+1);
  const ai=cases.filter(x=>x.source==='AI'), llms=[...new Set(ai.map(x=>x.llm).filter(Boolean))];
  $('cats').innerHTML=`<button class="cat on" data-c="">All<em>${cases.length}</em></button>`+
    (ai.length?`<button class="cat ai" data-c="${AI_CAT}" title="${esc(llms.join(', ')||'Written by the LLM')}">🤖 AI generated${llms.length===1?' · '+esc(llms[0].split(' · ')[0].replace(/ \(.*\)/,'')):''}<em>${ai.length}</em></button>`:'')+
    Object.entries(counts).map(([k,v],i)=>`<button class="cat" data-c="${esc(k)}" style="animation-delay:${i*40}ms">${esc(k)}<em>${v}</em></button>`).join('');
}
$('cats').onclick=e=>{ const b=e.target.closest('.cat'); if(!b) return; catFilter=b.dataset.c;
  document.querySelectorAll('.cat').forEach(x=>x.classList.toggle('on',x===b)); render(); };

/* ---------- table ---------- */
function render(){
  const q=$('q').value.toLowerCase(),t=$('fType').value,p=$('fPri').value,s=$('fSrc').value;
  const rows=cases.filter(x=>(!catFilter||(catFilter===AI_CAT?x.source==='AI':x.category===catFilter))&&(!t||x.type===t)&&(!p||x.priority===p)&&(!s||x.source===s)&&
    (!q||(x.id+x.title+x.category+x.expected+x.status).toLowerCase().includes(q)));
  $('tbody').innerHTML=rows.length?rows.map((x,i)=>{
    const open=openIds.has(x.id), r=results[x.id]||'';
    const steps=[`Send <b>${x.method}</b> request to <code>${esc(x.endpoint)}</code>`,'Apply the request / input shown on the left',`Assert status is <b>${esc(x.status)}</b>`,`Assert: ${esc(x.expected)}`];
    return `<tr class="tc ${open?'open':''} ${r}" data-id="${x.id}" style="animation-delay:${Math.min(i,25)*25}ms">
      <td class="selcol"><input type="checkbox" class="sel" data-id="${x.id}" ${selectedIds.has(x.id)?'checked':''}></td>
      <td><span class="caret">▶</span></td><td>${x.id}</td><td>${esc(x.category)}</td><td>${esc(x.title)}</td>
      <td class="${x.type}">${x.type}</td><td><span class="src ${x.source==='AI'?'ai':''}"${x.llm?` title="${esc(x.llm)}"`:''}>${x.source}</span></td>
      <td><span class="m ${x.method}">${x.method}</span><br><code>${esc(x.endpoint)}</code></td>
      <td>${esc(x.status)}</td><td><span class="pri ${x.priority}">${x.priority}</span></td>
      <td>${r?({pass:'✅ Pass',fail:'❌ Fail',blocked:'⏸ Blocked'})[r]:'<span style="color:var(--mute)">—</span>'}</td></tr>
      <tr class="detail ${open?'open':''}" data-for="${x.id}"><td colspan="11"><div class="dwrap"><div class="dinner"><div class="dgrid">
        <div><h4>Request / Input</h4><pre>${esc(pretty(x.request))}</pre></div>
        <div><h4>Test steps</h4><ol>${steps.map(z=>`<li>${z}</li>`).join('')}</ol></div>
        <div><h4>Expected result</h4><p style="margin:0"><b>${esc(x.status)}</b><br>${esc(x.expected)}</p>
          <div class="seg" data-id="${x.id}">
            <button class="pass ${r==='pass'?'on':''}" data-r="pass">✓ Pass</button>
            <button class="fail ${r==='fail'?'on':''}" data-r="fail">✗ Fail</button>
            <button class="blocked ${r==='blocked'?'on':''}" data-r="blocked">⏸ Blocked</button></div></div>
      </div></div></div></td></tr>`;
  }).join(''):'<tr><td colspan="11" class="empty">No matching test cases 🙈</td></tr>';
  visibleIds=rows.map(x=>x.id);
  updateSelUI();
  updateRing();
}
let visibleIds=[];
function updateSelUI(){
  selectedIds.forEach(id=>{ if(!cases.some(x=>x.id===id)) selectedIds.delete(id); });
  $('csv').textContent=`⬇ CSV (${selectedIds.size} selected)`;
  $('postman').textContent=`⬇ Postman (${selectedIds.size} selected)`;
  const n=visibleIds.filter(id=>selectedIds.has(id)).length, a=$('selAll');
  a.checked=!!visibleIds.length&&n===visibleIds.length; a.indeterminate=n>0&&n<visibleIds.length;
}
$('selAll').onchange=e=>{ visibleIds.forEach(id=>e.target.checked?selectedIds.add(id):selectedIds.delete(id)); render(); };
$('tbody').onchange=e=>{ const c=e.target.closest('input.sel'); if(!c) return; c.checked?selectedIds.add(c.dataset.id):selectedIds.delete(c.dataset.id); updateSelUI(); };
$('tbody').onclick=e=>{
  if(e.target.closest('.selcol')) return;
  const seg=e.target.closest('.seg button');
  if(seg){ const id=seg.parentElement.dataset.id; results[id]=results[id]===seg.dataset.r?undefined:seg.dataset.r; if(!results[id]) delete results[id];
    const tr=document.querySelector(`tr.tc[data-id="${id}"]`), r=results[id]||'';
    tr.className=`tc open ${r}`; tr.style.animation='none';
    tr.lastElementChild.innerHTML=r?({pass:'✅ Pass',fail:'❌ Fail',blocked:'⏸ Blocked'})[r]:'<span style="color:var(--mute)">—</span>';
    seg.parentElement.querySelectorAll('button').forEach(b=>b.classList.toggle('on',b.dataset.r===r)); updateRing(); return; }
  const tr=e.target.closest('tr.tc'); if(!tr) return;
  const id=tr.dataset.id, d=document.querySelector(`tr.detail[data-for="${id}"]`), o=!tr.classList.contains('open');
  tr.classList.toggle('open',o); d.classList.toggle('open',o); o?openIds.add(id):openIds.delete(id);
};
['q','fType','fPri','fSrc'].forEach(id=>$(id).addEventListener('input',render));
$('toggleAll').onclick=()=>{ allOpen=!allOpen; openIds=new Set(allOpen?cases.map(x=>x.id):[]); $('toggleAll').textContent=allOpen?'Collapse all':'Expand all'; render(); };
