/* ---------- validate what the readers produced, before anything is shown ----------
   1. field names must look like field names (no sentences, bullets, arrows) — a body full of "Response->id(int),name,…" keys is a mis-read,
      so it is discarded (and the endpoint is flagged) instead of being presented as a request/response
   2. URLs are normalised ( /users/:id -> /users/{id},  api.host.com/v1 -> https://api.host.com/v1 )
   3. every "POST /path" the text mentions is compared with the endpoints found, so missing endpoints are noticed                          */
const IMP_KEY_OK=/^[A-Za-z_$][\w$-]{0,48}$/;
function impBadKeys(v,path=''){
  const bad=[];
  if(Array.isArray(v)) v.slice(0,3).forEach(x=>bad.push(...impBadKeys(x,path+'[]')));
  else if(v&&typeof v==='object') Object.entries(v).forEach(([k,x])=>{
    if(!IMP_KEY_OK.test(k)) bad.push((path?path+'.':'')+k.slice(0,30)); else bad.push(...impBadKeys(x,path?path+'.'+k:k));
  });
  return bad;
}
function impValidateOps(ops){
  let junk=0;
  ops.forEach(o=>{
    o.issues=o.issues||[];
    o.url=String(o.url||'').replace(/\/:(\w+)/g,'/{$1}').replace(/\s+/g,'');
    if(!/^https?:\/\//i.test(o.url)&&/^[\w.-]+\.[a-z]{2,}(:\d+)?(\/|$)/i.test(o.url)) o.url='https://'+o.url;
    if(/^https?:\/\//i.test(o.url)) o.issues=o.issues.filter(i=>!/^URL has no host/.test(i));   // resolved by the merge / the document's Base URL
    ['req','res'].forEach(f=>{
      if(o[f]===undefined) return;
      const bad=impBadKeys(o[f]);
      if(typeof o[f]!=='object'||o[f]===null||bad.length){
        o.issues.push(`the ${f==='req'?'request':'response'} data read from the PDF had unreadable field names (${bad.slice(0,3).join(', ')||'not JSON'}) and was discarded`);
        o[f]=undefined; o.junk=true; junk++;
      }
    });
  });
  return {junk};
}
/* "POST /x", "Create user [POST] /x", "PUT /users/{userId}", "Get /products" … mentioned anywhere in the text */
function impMentions(text){
  const out=[], re=/\b(GET|POST|PUT|PATCH|DELETE)\b[\s\]\)\[:–-]*(https?:\/\/[^\s,;)\]]+|\/[A-Za-z0-9_{}:.\/-]+)/gi; let m;
  while((m=re.exec(text))){ const url=m[2].replace(/[.,;:]+$/,''); if(url.length>1) out.push({method:m[1].toUpperCase(),url}); }
  const seen=new Set();
  return out.filter(o=>{ const k=o.method+' '+impPathOf(o); if(seen.has(k)) return false; seen.add(k); return true; });
}
/* how trustworthy is the deterministic result? decides whether the AI is run automatically */
function impQuality(ops,text){
  const missing=impMentions(text).filter(m=>!ops.some(o=>impSameApi(o,m)));
  const hard=ops.filter(o=>(o.gaps||[]).some(g=>g!=='headers')).length;
  const junk=ops.filter(o=>o.junk).length;
  return {missing,hard,junk,messy:!ops.length||junk>0||missing.length>0||hard*2>=ops.length};
}
