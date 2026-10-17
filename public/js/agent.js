/* ---------- agent animation ---------- */
const STEPS_MANUAL=['Analysing endpoint & HTTP method','Parsing request body fields','Parsing response body schema','Designing positive & negative scenarios','Adding security, auth & boundary checks','Assembling test suite'];
const STEPS_AI=['Analysing endpoint & HTTP method','Sending bodies & rules to the LLM','The LLM is inferring business rules','Designing positive & negative scenarios','Validating the returned test suite','Assembling test suite'];
let STEPS=STEPS_MANUAL;
const sleep = ms => new Promise(r=>setTimeout(r,ms));

// Steps + progress bar animate while the work runs; the bar eases toward each step's target
// and creeps (max 95%) while waiting on the real API call, then fills to 100% on completion.
async function runAgent(work){
  STEPS=mode==='ai'?STEPS_AI:STEPS_MANUAL;
  const a=$('agent'); a.classList.add('show');
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
  $('pStep').textContent=error?'Failed':'Done'; target=100;
  while(shown<99.5) await sleep(60);
  await sleep(350); clearInterval(tick); a.classList.remove('show');
  if(error) throw error;
  return result;
}

async function callLLM(payload){
  const headers={'Content-Type':'application/json'};
  const key=$('apiKey').value.trim(); if(key) headers['x-api-key']=key;
  let r;
  try{ r=await fetch('/api/generate',{method:'POST',headers,body:JSON.stringify(payload)}); }
  catch{ throw new Error('Cannot reach the server. Run "npm start" and open http://localhost:3000.'); }
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
  let req,res;
  try{ req=['POST','PUT','PATCH'].includes(method)?parse('reqBody','Request body'):undefined; res=parse('resBody','Response body'); }
  catch(e){ return fail(e.message); }
  if(['POST','PUT','PATCH'].includes(method)&&req===undefined) return fail(`Please provide a request body for ${method}.`);
  if(method==='GET'&&res===undefined) return fail('Please provide the expected response body for GET.');
  if(mode==='ai'&&!serverUp) return fail('AI mode needs the server. Run "npm start" and open http://localhost:3000, or switch to Manual.');
  if(mode==='ai'&&needsKey()&&!$('apiKey').value.trim()) return fail(`Enter an API key for ${providerLabel()} (or set it in .env and restart the server).`);
  $('gen').disabled=true; $('results').hidden=true;
  let ai=[], base=[];
  if(mode==='ai'){
    try{ ai=await runAgent(callLLM({method,endpoint,request:req,response:res,notes:$('notes').value.trim(),provider:$('provider').value,model:$('model').value.trim()})); }
    catch(e){ $('gen').disabled=false; return fail('AI generation failed: '+e.message); }
    if($('baseline').checked) base=generate(method,endpoint,req,res);
  } else {
    await runAgent(Promise.resolve());
    base=generate(method,endpoint,req,res);
  }
  $('gen').disabled=false;
  const seen=new Set(base.map(x=>x.title.toLowerCase()));
  cases=base.concat(ai.filter(x=>!seen.has(x.title.toLowerCase()))).map((x,i)=>({...x,id:'TC'+String(i+1).padStart(3,'0')}));
  openIds.clear(); results={}; allOpen=false; catFilter='';
  saveHistory({method,endpoint,mode,req,res,notes:$('notes').value.trim(),cases});
  $('toggleAll').textContent='Expand all';
  buildDash(); buildCats(); render();
  $('results').hidden=false; $('results').scrollIntoView({behavior:'smooth'});
  toast(mode==='ai'?`✅ ${cases.length} test cases (${ai.length} from ${providerLabel()})`:`✅ ${cases.length} test cases generated`);
};
