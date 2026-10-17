/* ---------- mode switch: Manual (offline rules) vs AI (any configured LLM) ---------- */
let mode='manual', serverUp=false, providers=[];

const curProvider=()=>providers.find(p=>p.id===$('provider').value)||{};
const providerLabel=()=>(curProvider().label||'The LLM').replace(/ \(.*\)/,'');
const needsKey=()=>{ const p=curProvider(); return !!p.needsKey&&!p.configured; };

function setMode(m){
  mode=m;
  document.querySelectorAll('#modeSeg button').forEach(b=>b.classList.toggle('on',b.dataset.mode===m));
  $('modeSeg').classList.toggle('ai',m==='ai');
  $('aiOptions').hidden=m!=='ai';
  refreshAI();
  try{ localStorage.setItem('tcMode',m); }catch{}
}
function refreshAI(){
  $('keyBox').hidden=!(mode==='ai'&&serverUp&&needsKey());
  $('modeBadge').textContent=mode==='ai'?'AI · '+providerLabel():'Manual · offline';
  $('modeNote').textContent=mode==='ai'?aiNote():'Offline rules — no network needed.';
  const p=curProvider(); $('model').placeholder=p.model?p.model+' (default)':'default';
}
function aiNote(){
  if(!serverUp) return '⚠ Server not reachable. Run "npm start" and open http://localhost:3000 (not the .html file).';
  const ready=providers.filter(p=>p.configured).length;
  return needsKey()?`No key in .env for ${providerLabel()} — paste one below, or pick a provider marked ✓.`
    :`Using ${providerLabel()} from .env.`+(ready>1?` (${ready} providers ready)`:'');
}

$('modeSeg').onclick=e=>{ const b=e.target.closest('button'); if(b) setMode(b.dataset.mode); };
$('provider').onchange=()=>{ try{ localStorage.setItem('tcProvider',$('provider').value); }catch{} $('apiKey').value=''; refreshAI(); };

async function initMode(){
  try{
    const s=await (await fetch('/api/status')).json(); serverUp=true; providers=s.providers;
    let pick=s.default; try{ const sv=localStorage.getItem('tcProvider'); if(providers.some(p=>p.id===sv)) pick=sv; }catch{}
    $('provider').innerHTML=providers.map(p=>`<option value="${p.id}">${p.configured?'✓ ':''}${p.label}</option>`).join('');
    $('provider').value=pick;
  }catch{ serverUp=false; }
  let saved='manual'; try{ saved=localStorage.getItem('tcMode')||'manual'; }catch{}
  setMode(saved==='ai'?'ai':'manual');
}
