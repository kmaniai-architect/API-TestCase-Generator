/* ---------- mode switch: Manual (offline rules) vs AI (any configured LLM) ---------- */
let mode='manual', serverUp=false, providers=[];

let defaultId='';
const curProvider=()=>providers.find(p=>p.id===defaultId)||{};
const providerLabel=()=>(curProvider().label||'The LLM').replace(/ \(.*\)/,'');
const llmReady=()=>!!curProvider().configured;
const llmName=()=>{ const p=curProvider(); return p.label?p.label.replace(/ \(.*\)/,'')+(p.model?' · '+p.model:''):'No LLM'; };

function setMode(m){
  mode=m;
  document.querySelectorAll('#modeSeg button').forEach(b=>b.classList.toggle('on',b.dataset.mode===m));
  $('modeSeg').classList.toggle('ai',m==='ai');
  $('aiOptions').hidden=m!=='ai';
  refreshAI();
  try{ localStorage.setItem('tcMode',m); }catch{}
}
function refreshAI(){
  $('modeBadge').textContent=mode==='ai'?(serverUp&&llmReady()?'AI · '+llmName():'AI · not configured'):'Manual · offline';
  $('llmLine').innerHTML=!serverUp?'⚠ Server not reachable':llmReady()?`🤖 LLM in use: <b>${esc(llmName())}</b> <small>(set in .env)</small>`:'⚠ <b>No LLM configured</b> <small>— add a key to .env and restart the server</small>';
  $('llmLine').className='llmline'+(serverUp&&llmReady()?'':' warn');
  $('modeNote').textContent=mode==='ai'?aiNote():'Offline rules — no network needed.';
}
function aiNote(){
  if(!serverUp) return '⚠ Server not reachable. Run "npm start" and open http://localhost:3000 (not the .html file).';
  return llmReady()?`Using ${llmName()} (configured in .env).`:'No LLM is configured — add an API key to .env (e.g. GEMINI_API_KEY) and restart the server.';
}

$('modeSeg').onclick=e=>{ const b=e.target.closest('button'); if(b) setMode(b.dataset.mode); };

async function initMode(){
  try{
    const s=await (await fetch('/api/status')).json(); serverUp=true; providers=s.providers;
    defaultId=s.default;
  }catch{ serverUp=false; }
  let saved='manual'; try{ saved=localStorage.getItem('tcMode')||'manual'; }catch{}
  setMode(saved==='ai'?'ai':'manual');
}
