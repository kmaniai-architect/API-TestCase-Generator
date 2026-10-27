/* ---------- agent animation ---------- */
const STEPS_MANUAL=['Analysing endpoint & HTTP method','Parsing request body fields','Parsing response body schema','Designing positive & negative scenarios','Adding security, auth & boundary checks','Assembling test suite'];
const STEPS_AI=['Analysing endpoint & HTTP method','Sending bodies & rules to the LLM','The LLM is inferring business rules','Designing positive & negative scenarios','Validating the returned test suite','Assembling test suite'];
let STEPS=STEPS_MANUAL;
const sleep = ms => new Promise(r=>setTimeout(r,ms));

// Steps + progress bar animate while the work runs; the bar eases toward each step's target
// and creeps (max 95%) while waiting on the real API call, then fills to 100% on completion.
async function runAgent(work){
  STEPS=mode==='ai'?STEPS_AI:STEPS_MANUAL;
  const a=$('agent'); a.classList.add('show'); $('stopGen').hidden=mode!=='ai'; $('stopGen').disabled=false;
  $('pTitle').textContent=mode==='ai'?(providerLabel()+' is designing your test cases…'):'Generating test cases from rules…';
  $('steps').innerHTML=STEPS.map((s,i)=>`<div class="step" id="s${i}"><span class="dot"></span>${s}</div>`).join('');
  a.scrollIntoView({behavior:'smooth',block:'center'});
  const n=STEPS.length, t0=performance.now();
  let target=0, shown=0, result, error, finished=false;
  const tick=setInterval(()=>{
    shown+=(target-shown)*0.18; if(target-shown<0.2) shown=target;
    $('prog').style.width=shown+'%'; $('pPct').textContent=Math.round(shown)+'%';
    $('pTime').textContent=((performance.now()-t0)/1000).toFixed(1)+'s';
  },60);
  const mark=i=>{ $('s'+i).className='step done'; $('s'+i).firstChild.textContent='✓'; };
  const ai=mode==='ai';
  work.then(r=>result=r,e=>error=e).finally(()=>finished=true);
  for(let i=0;i<n-1;i++){
    $('s'+i).classList.add('on'); $('pStep').textContent=STEPS[i]; target=(i+0.7)/n*100;
    await sleep(ai?(i<2?500:1500):380);
    if(ai&&finished&&i>=1){ mark(i); break; }
    mark(i); target=(i+1)/n*100;
  }
  if(ai) while(!finished){ target=Math.min(95,Math.max(target,shown)+0.6); await sleep(150); }
  for(let i=0;i<n;i++) if(!$('s'+i).classList.contains('done')){ $('s'+i).classList.add('on'); mark(i); }
  $('pStep').textContent=error?(error.stopped?'Stopped':'Failed'):'Done'; target=100; $('stopGen').hidden=true;
  while(shown<99.5) await sleep(60);
  await sleep(350); clearInterval(tick); a.classList.remove('show');
  if(error) throw error;
  return result;
}

let genAbort=null;
$('stopGen').onclick=()=>{ if(genAbort){ $('stopGen').disabled=true; $('pStep').textContent='Stopping…'; genAbort.abort(); } };
async function callLLM(payload){
  const headers={'Content-Type':'application/json'};
  let r; genAbort=new AbortController();
  try{ r=await fetch('/api/generate',{method:'POST',headers,signal:genAbort.signal,body:JSON.stringify(payload)}); }
  catch(e){ if(e&&e.name==='AbortError') throw Object.assign(new Error('Stopped'),{stopped:true}); throw new Error('Cannot reach the server. Run "npm start" and open http://localhost:3000.'); }
  const data=await r.json().catch(()=>({}));
  if(!r.ok) throw new Error(data.error||('HTTP '+r.status));
  return data.cases;
}

/* ---------- generate ---------- */
function fail(msg){ $('err').textContent=msg; const g=$('gen'); g.classList.remove('shake'); void g.offsetWidth; g.classList.add('shake'); }
function parse(id,name){
  const v=$(id).value.trim(); if(!v) return undefined;
  try{ return JSON.parse(v); }catch(e){ throw new Error(`${name} is not valid JSON: ${e.message}`); }
}
$('gen').onclick=async()=>{
  $('err').textContent='';
  const endpoint=$('endpoint').value.trim();
  if(!endpoint) return fail('Please enter an endpoint.');
  const hs=pmState(); if(hs.errs.length) return fail('Fix the header issues first: '+hs.errs[0]);
  let req,res;
  try{ req=['POST','PUT','PATCH'].includes(method)?parse('reqBody','Request body'):undefined; res=parse('resBody','Response body'); }
  catch(e){ return fail(e.message); }
  if(['POST','PUT','PATCH'].includes(method)&&req===undefined) return fail(`Please provide a request body for ${method}.`);
  if(method==='GET'&&res===undefined) return fail('Please provide the expected response body for GET.');
  if(mode==='ai'&&!serverUp) return fail('AI mode needs the server. Run "npm start" and open http://localhost:3000, or switch to Manual.');
  if(mode==='ai'&&!llmReady()) return fail('No LLM is configured. Add an API key to .env (e.g. GEMINI_API_KEY) and restart the server, or switch to Manual.');
  $('gen').disabled=true; $('results').hidden=true;
  let ai=[], base=[];
  if(mode==='ai'){
    try{ ai=await runAgent(callLLM({method,endpoint,request:req,response:res,headers:hs.list.map(h=>({name:h.k,value:h.secret?'<redacted>':h.v})),notes:$('notes').value.trim()})); }
    catch(e){ $('gen').disabled=false; return fail(e.stopped?'Stopped — nothing was generated. Press Generate to try again, or switch to Manual.':'AI generation failed: '+e.message); }
  } else {
    await runAgent(Promise.resolve());
    base=generate(method,endpoint,req,res);
  }
  $('gen').disabled=false;
  const seen=new Set(base.map(x=>x.title.toLowerCase()));
  selectedIds.clear();
  cases=base.concat(ai.filter(x=>!seen.has(x.title.toLowerCase()))).map((x,i)=>({...x,id:'TC'+String(i+1).padStart(3,'0')}));
  openIds.clear(); results={}; allOpen=false; catFilter=new Set();
  const fromImport=impSrc&&impSrc.method===method&&impStillMatches(impSrc.endpoint,endpoint);   // still the imported values, not edited by hand
  // the user generated tests from this endpoint: the final values are the "correct answer" for the PDF passage it came from -> learn it
  if(fromImport&&impSrc.type==='pdf'&&impSrc.chunk) impLearn([{chunk:impSrc.chunk,op:{method,url:endpoint,request:req,response:res}}],'confirmed',impSrc.name);
  currentHistoryId=null;   // new suite: not in the history until the user saves it
  pendingSuite={method,endpoint,mode,req,res,notes:$('notes').value.trim(),cases,input:fromImport?{type:impSrc.type,name:impSrc.name}:{type:'manual'}};
  renderHistory(); updateSaveBtn();
  $('toggleAll').textContent='Expand all';
  buildDash(); buildCats(); render();
  $('results').hidden=false; $('results').scrollIntoView({behavior:'smooth'});
  toast(mode==='ai'?`✅ ${cases.length} test cases (${ai.length} from ${providerLabel()})`:`✅ ${cases.length} test cases generated`);
  openSaveDlg();
};
