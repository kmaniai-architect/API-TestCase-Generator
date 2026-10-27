/* ---------- export ---------- */
function download(name,text,type){ const a=document.createElement('a'); a.href=URL.createObjectURL(new Blob([text],{type})); a.download=name; a.click(); toast('Downloaded '+name); }
$('csv').onclick=()=>{
  const sel=cases.filter(x=>selectedIds.has(x.id));
  if(!sel.length){ toast('Tick at least one test case to export as CSV'); return; }
  const q=v=>'"'+String(v).replace(/"/g,'""')+'"';
  const h=['ID','Category','Test Case','Type','Source','Method','Endpoint','Request','Expected Status','Expected Result','Priority','Test Steps ('+(stepFmt==='gherkin'?'Gherkin':'Standard')+')','Result'];
  download('test-cases.csv','﻿'+[h.map(q).join(',')].concat(sel.map(x=>[x.id,x.category,x.title,x.type,x.source,x.method,x.endpoint,
    typeof x.request==='string'?x.request:JSON.stringify(x.request),x.status,x.expected,x.priority,stepsText(x),results[x.id]||''].map(q).join(','))).join('\n'),'text/csv');
};
$('json').onclick=()=>download('test-cases.json',JSON.stringify(cases.map(x=>({...x,stepsFormat:stepFmt,stepsText:stepsText(x),result:results[x.id]||null})),null,2),'application/json');
$('feature').onclick=()=>{
  const sel=cases.filter(x=>selectedIds.has(x.id));
  if(!sel.length){ toast('Tick at least one test case to export as a Gherkin .feature file'); return; }
  download('test-cases.feature',featureFile(sel),'text/plain');
};
