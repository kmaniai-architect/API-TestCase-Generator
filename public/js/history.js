/* ---------- history: chat-style sidebar of saved test suites ----------
   Every suite (inputs, test cases, Pass/Fail marks) is saved by the server in testcase.db (SQLite),
   so the sidebar comes back after a restart, a new port or cleared browser data. */
const LEGACY_KEY='tcHistory';         // older builds kept suites in localStorage; migrated into the db once
let hist=[], currentHistoryId=null;

function loadHistory(){ return hist; }
const api=(path,opts)=>fetch('/api/suites'+path,opts).then(r=>{ if(!r.ok) throw new Error('HTTP '+r.status); return r; });
let saveWarned=false;
const saveFailed=()=>{ if(!saveWarned){ saveWarned=true; toast('⚠ Could not save to testcase.db — is the server running?'); } };
const saveTimers={};
function putSuite(e,delay=0){          // debounced per suite so rapid Pass/Fail clicks become one write
  clearTimeout(saveTimers[e.id]);
  saveTimers[e.id]=setTimeout(()=>{
    delete saveTimers[e.id];
    api('/'+encodeURIComponent(e.id),{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify(e),keepalive:true})
      .then(()=>{ saveWarned=false; }).catch(saveFailed);
  },delay);
}
const deleteSuite=id=>api('/'+encodeURIComponent(id),{method:'DELETE'}).catch(saveFailed);
async function syncHistory(){
  try{ hist=(await (await api('')).json()).suites||[]; }catch{ saveFailed(); return; }
  let legacy=[]; try{ legacy=JSON.parse(localStorage.getItem(LEGACY_KEY))||[]; }catch{}
  const missing=legacy.filter(l=>l&&l.id&&Array.isArray(l.cases)&&!hist.some(h=>h.id===l.id));
  if(missing.length){
    await Promise.all(missing.map(e=>api('/'+encodeURIComponent(e.id),{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify(e)}).catch(()=>{})));
    try{ hist=(await (await api('')).json()).suites||hist; }catch{}
  }
  if(legacy.length&&legacy.every(l=>hist.some(h=>h.id===l.id))) try{ localStorage.removeItem(LEGACY_KEY); }catch{}
  if(currentHistoryId&&!hist.some(x=>x.id===currentHistoryId)) currentHistoryId=null;
  renderHistory();
}
const titleOf=e=>e.title||autoTitle(e);
const stamp=ts=>new Date(ts).toLocaleString([],{day:'numeric',month:'short',year:'numeric',hour:'numeric',minute:'2-digit'});
function autoTitle(e){
  const p=String(e.endpoint).replace(/^[a-z]+:\/\/[^/]+/i,'').split('?')[0]||'/';
  return `${e.method} ${p}`;
}

/* Like continuing a chat: regenerating the same method+endpoint updates the open entry,
   anything else starts a new one. */
function saveHistory(entry){
  let cur=hist.find(x=>x.id===currentHistoryId);
  if(cur&&cur.method===entry.method&&cur.endpoint===entry.endpoint){
    Object.assign(cur,entry,{ts:Date.now(),results:{}});
    hist.splice(hist.indexOf(cur),1);
  } else {
    cur={...entry,id:'h'+Date.now().toString(36),ts:Date.now(),results:{},title:autoTitle(entry)};
    currentHistoryId=cur.id;
  }
  hist.unshift(cur); putSuite(cur); renderHistory();
}
function persistResults(){            // called whenever a Pass/Fail/Blocked mark changes
  const e=hist.find(x=>x.id===currentHistoryId); if(!e) return;
  e.results={...results}; putSuite(e,400); renderHistory();
}
addEventListener('pagehide',()=>{     // flush marks still waiting on the debounce
  for(const id in saveTimers){ const e=hist.find(x=>x.id===id); if(e) putSuite(e); }
});

function groupOf(ts){
  const d=new Date(ts), t=new Date(); t.setHours(0,0,0,0);
  const days=Math.floor((t-new Date(d).setHours(0,0,0,0))/864e5);
  return days<=0?'Today':days===1?'Yesterday':days<=7?'Previous 7 days':days<=30?'Previous 30 days':'Older';
}
let renaming=null;
function renderHistory(){
  const all=loadHistory(), q=$('histSearch').value.trim().toLowerCase();
  const list=all.filter(e=>!q||(titleOf(e)+e.endpoint+e.method).toLowerCase().includes(q));
  $('histCount').textContent=all.length;
  let html='', last='';
  for(const e of list){
    const g=groupOf(e.ts); if(g!==last){ html+=`<div class="hgroup">${g}</div>`; last=g; }
    const r=Object.values(e.results||{}), p=r.filter(x=>x==='pass').length, f=r.filter(x=>x==='fail').length;
    const title=renaming===e.id
      ?`<input class="hren" data-ren="${e.id}" value="${esc(titleOf(e))}">`
      :`<div class="htitle" title="${esc(e.endpoint)}">${esc(titleOf(e))}</div>`;
    html+=`<div class="hitem ${e.id===currentHistoryId?'cur':''}" data-id="${e.id}">
      <div class="hmain">${title}<div class="hurl" title="${esc(e.endpoint)}">${esc(e.endpoint)}</div><div class="hmeta">🕒 ${stamp(e.ts)}</div><div class="hmeta">${e.mode==='ai'?'🤖 AI':'⚙ Manual'} · ${e.cases.length} cases${r.length?` · ✅${p} ❌${f}`:''}</div></div>
      <div class="hacts"><button data-act="ren" title="Rename">✎</button><button class="del" data-act="del" title="Delete">🗑</button></div></div>`;
  }
  $('histList').innerHTML=html||`<div class="empty" style="font-size:13px">${all.length?'No matches.':'No saved suites yet.<br>Generate one and it shows up here.'}</div>`;
  const ri=$('histList').querySelector('.hren'); if(ri){ ri.focus(); ri.select(); }
}

function openHistoryItem(id){
  const e=loadHistory().find(x=>x.id===id); if(!e) return;
  method=e.method; syncMethod();
  $('endpoint').value=e.endpoint;
  $('reqBody').value=e.req!==undefined?JSON.stringify(e.req,null,2):'';
  $('resBody').value=e.res!==undefined?JSON.stringify(e.res,null,2):'';
  $('notes').value=e.notes||'';
  ['reqBody','resBody'].forEach(i=>$(i).dispatchEvent(new Event('input'))); chips();
  cases=e.cases; results={...e.results}; openIds.clear(); allOpen=false; catFilter=''; currentHistoryId=e.id;
  $('toggleAll').textContent='Expand all';
  buildDash(); buildCats(); render();
  $('results').hidden=false; renderHistory(); closeMobileSidebar();
  window.scrollTo({top:0,behavior:'smooth'});
}
function newSuite(){
  currentHistoryId=null; cases=[]; results={};
  $('reqBody').value=$('resBody').value=$('notes').value=''; $('err').textContent='';
  ['reqBody','resBody'].forEach(i=>$(i).dispatchEvent(new Event('input')));
  $('results').hidden=true; renderHistory(); closeMobileSidebar();
  window.scrollTo({top:0,behavior:'smooth'}); $('endpoint').focus();
}

const closeMobileSidebar=()=>document.querySelector('.app').classList.remove('mopen');
$('menuBtn').onclick=()=>{
  const app=document.querySelector('.app');
  if(matchMedia('(max-width:860px)').matches) app.classList.toggle('mopen'); else app.classList.toggle('collapsed');
};
$('sbScrim').onclick=closeMobileSidebar;
$('newBtn').onclick=newSuite;
$('histSearch').oninput=renderHistory;
$('histClear').onclick=()=>{
  if(!loadHistory().length||!confirm('Delete all saved test suites?')) return;
  hist=[]; api('',{method:'DELETE'}).catch(saveFailed); currentHistoryId=null; renderHistory();
};
function commitRename(input){
  const e=hist.find(x=>x.id===input.dataset.ren);
  if(e&&input.value.trim()&&input.value.trim()!==e.title){ e.title=input.value.trim(); putSuite(e); }
  renaming=null; renderHistory();
}
$('histList').onclick=ev=>{
  if(ev.target.closest('.hren')) return;
  const it=ev.target.closest('.hitem'); if(!it) return;
  const act=ev.target.closest('[data-act]');
  if(act&&act.dataset.act==='del'){
    if(!confirm('Delete this saved test suite?')) return;
    hist=hist.filter(x=>x.id!==it.dataset.id); deleteSuite(it.dataset.id);
    if(currentHistoryId===it.dataset.id){ currentHistoryId=null; $('results').hidden=true; }
    renderHistory(); return;
  }
  if(act&&act.dataset.act==='ren'){ renaming=it.dataset.id; renderHistory(); return; }
  openHistoryItem(it.dataset.id);
};
$('histList').addEventListener('keydown',ev=>{
  if(!ev.target.classList.contains('hren')) return;
  if(ev.key==='Enter') commitRename(ev.target);
  if(ev.key==='Escape'){ renaming=null; renderHistory(); }
});
$('histList').addEventListener('focusout',ev=>{ if(ev.target.classList&&ev.target.classList.contains('hren')&&renaming) commitRename(ev.target); });
renderHistory(); syncHistory();
