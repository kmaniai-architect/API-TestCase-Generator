/* ---------- PDF "one section per API" layout (tolerant of partial documents) ----------
   A section can start with  "API-01 User Login", "POST /users", or a numbered heading, and may contain any of:
     Attribute | Value (Method, Endpoint, Full URL …) · Request Headers · Path / Query Parameters · Request Body Fields
     · Sample Request · Response Fields · Status Codes · Sample Response
   Whatever is present is used; whatever is missing is reported per API (op.gaps) instead of failing the whole read.
   Request JSON  <- Request Body Fields table (or a sample request / JSON block)
   Response JSON <- Sample Response JSON (or built from the Response Fields table)                                  */

const impRowText=r=>r.cells.map(c=>c.text).join(' ').trim();
const IMP_VERB=/\b(GET|POST|PUT|PATCH|DELETE)\b/;
/* sub-headings inside a section: label (colon / "(200)" suffix ignored) -> role */
const IMP_SUB=[
  ['sampleReq',/^(sample|example)\s+(request|payload|input)|^request\s+(sample|example)/i],
  ['sample',/^(sample|example)\s+(response|output)|^response\s+(sample|example)/i],
  ['headers',/^((request|http)\s+)?headers?$/i],
  ['params',/^((path|query|url)(\s*\/\s*(path|query))?\s+)?parameters?$|^(path|query)(\s*\/\s*(path|query))?\s+(params|parameters)$/i],
  ['body',/^request(\s+(body|payload|data|fields?|parameters?|params))*$|^(request\s+)?(body|payload)(\s+fields?)?$|^input(\s+(fields?|parameters?))?$/i],
  ['resp',/^response(\s+(body|payload|data|fields?|parameters?|params))*$|^output(\s+fields?)?$/i],
  ['status',/^((status|response|http)\s+)codes?$/i],
];
const impSubOf=r=>{
  if(r.cells.length>2) return null;
  const t=impRowText(r).replace(/\s*\([^)]*\)\s*$/,'').replace(/[:：]\s*$/,'').trim();
  if(!t||t.length>40) return null;
  const hit=IMP_SUB.find(([,re])=>re.test(t)); return hit?hit[0]:null;
};

/* a table inside a section: first row = column headings, later rows = records (a row with an empty first cell continues the record above) */
function impSimpleTable(rs){
  if(rs.length<2) return {cols:[],recs:[]};
  const hdr=impMergeHeader([rs[0]]), data=rs.slice(1), colOf=impColumns(hdr,hdr.map(()=>'c'),data), recs=[];
  data.forEach(r=>{
    const cells=hdr.map(()=>'');
    r.cells.forEach(c=>{ const k=colOf(c.x); if(k>=0) cells[k]=(cells[k]?cells[k]+' ':'')+c.text; });
    if(cells[0]||!recs.length) recs.push(cells);
    else cells.forEach((t,k)=>{ if(t){ const l=recs[recs.length-1]; l[k]=(l[k]?l[k]+' ':'')+t; } });
  });
  return {cols:hdr.map(h=>h.text.toLowerCase()),recs};
}
const impColIdx=(cols,re)=>cols.findIndex(c=>re.test(c));

/* a believable value for a field, from its type / description / name */
function impSampleFor(name,type,desc){
  const t=(type||'').toLowerCase(), d=(desc||'').trim(), n=String(name).split(/[.\[\]]+/).filter(Boolean).pop()||String(name);
  const en=d.match(/^([A-Za-z0-9_-]+(?:\s*[|\/]\s*[A-Za-z0-9_-]+)+)$/);   // CUSTOMER | ADMIN, CUSTOMER/ADMIN
  if(en) return en[1].split(/[|\/]/)[0].trim();
  if(/^array/.test(t)) return [];
  if(/^object/.test(t)) return {};
  if(/bool/.test(t)) return true;
  if(/int|long/.test(t)) return 1;
  if(/number|decimal|float|double/.test(t)) return 99.5;
  if(/date-?time|timestamp/.test(t)) return '2026-01-01T00:00:00Z';
  if(/date/.test(t)) return '2026-01-01';
  if(/uuid/.test(t)) return '3fa85f64-5717-4562-b3fc-2c963f66afa6';
  return /e-?mail/i.test(n)?'user@example.com':/phone|mobile/i.test(n)?'+919876543210':/pass/i.test(n)?'Passw0rd!23':/pin|zip|postal/i.test(n)?'600001':
    /city/i.test(n)?'Chennai':/name/i.test(n)?'John Doe':/coupon/i.test(n)?'SAVE10':/sku|productid/i.test(n)?'SKU-1001':/remark|note|comment|desc/i.test(n)?'sample note':'string';
}
function impFieldsToJson(tbl){
  const fi=impColIdx(tbl.cols,/field|parameter|name|attribute|key/), ti=impColIdx(tbl.cols,/type/), di=impColIdx(tbl.cols,/desc|comment|remark|note/), si=impColIdx(tbl.cols,/sample|example|value|default/);
  if(fi<0) return undefined;
  const obj={};
  tbl.recs.forEach(r=>{
    const name=(r[fi]||'').replace(/\s+/g,''); if(!name||/^(no|none|n\/a)/i.test(name)) return;
    impSetPath(obj,name,si>=0&&r[si]&&!/^(yes|no|required|optional)$/i.test(r[si])?impCoerce(r[si],r[ti]):impSampleFor(name,r[ti],r[di]));
  });
  return Object.keys(obj).length?obj:undefined;
}
/* table -> clean rows for the "details" view (works for field tables, header tables and status tables) */
function impTableRows(tbl){
  const ix=re=>impColIdx(tbl.cols,re), f=ix(/field|parameter|name|attribute|key|header|code/), t=ix(/type/), r=ix(/required|mandatory/), s=ix(/sample|example|value|format/), d=ix(/desc|meaning|comment/);
  return tbl.recs.filter(x=>f>=0&&x[f]).map(x=>({name:x[f],type:t>=0?x[t]:'',required:r>=0?x[r]:'',sample:s>=0?x[s]:'',description:d>=0?x[d]:''}));
}
/* every {...} block in the text that parses (single quotes, line-wrapped strings … tolerated), in order */
function impLooseBlocks(text){
  const out=[]; let i=text.indexOf('{');
  while(i>=0){
    const b=impBalanced(text.slice(i)), v=b?impParseLoose(b):undefined;
    if(v&&typeof v==='object'&&Object.keys(v).length&&!impBadKeys(v).length){ out.push(v); i=text.indexOf('{',i+b.length); } else i=text.indexOf('{',i+1);
  }
  return out;
}
const impJsonIn=text=>{ const b=impBalanced(text); return b?impParseLoose(b):undefined; };

/* ---- section boundaries ---- */
function impDropEdges(rows){   // running page header/footer: same text (digits ignored) at the top/bottom of most pages
  const norm=t=>t.replace(/\d+/g,'#'), byPage={}, cnt={}, edge=new Set();
  rows.forEach(r=>(byPage[r.page]=byPage[r.page]||[]).push(r));
  const pages=Object.keys(byPage).length;
  Object.values(byPage).forEach(rs=>[rs[0],rs[rs.length-1]].forEach(r=>{ const k=norm(impRowText(r)); cnt[k]=(cnt[k]||0)+1; }));
  Object.values(byPage).forEach(rs=>[rs[0],rs[rs.length-1]].forEach(r=>{ if(pages>=2&&cnt[norm(impRowText(r))]>=Math.max(2,pages*0.6)) edge.add(r); }));
  return rows.filter(r=>!edge.has(r));
}
function impFindHeadings(rows){
  const txt=rows.map(impRowText), byIdx=new Map();
  const add=(i,id,name)=>{ if(!byIdx.has(i)) byIdx.set(i,{i,id,name}); };
  const API=/^API[-\s]?(\d+)\s+(\S.*)$/i, VERBPATH=/\b(GET|POST|PUT|PATCH|DELETE)\b[\s\]\)\[]*(\/[^\s,;)\]]*|https?:\/\/[^\s,;)\]]+)/i;
  // 1) "API-01 User Login" headings are the strongest signal: when present they are the only ones used
  rows.forEach((r,i)=>{ if(r.cells.length>2) return; const m=txt[i].match(API); if(m) add(i,'API-'+m[1],m[2].trim()); });
  if(byIdx.size) return [...byIdx.values()].sort((a,b)=>a.i-b.i);
  // 2) a short line that names a method and a path in any style: "POST /users", "Get User GET /users/:id", "Update user (PUT /users/{id})", "2. Create user [POST] /users", "Create Order - post /orders"
  rows.forEach((r,i)=>{
    if(r.cells.length>3) return; const m=txt[i].match(VERBPATH);
    if(!m||/^\/(GET|POST|PUT|PATCH|DELETE)(\/|$)/i.test(m[2])) return;
    if(txt[i].length<=120||/^(GET|POST|PUT|PATCH|DELETE)\b/i.test(txt[i])) add(i,'',txt[i].slice(0,120));   // long prose lines count only when they START with the verb
  });
  // 3) numbered headings ("4.1 Create User", "1) Login"): kept when set in a larger font, or when the text under them talks about a Method / "POST /path"
  const hs=rows.flatMap(r=>r.cells.map(c=>c.h)).filter(Boolean).sort((a,b)=>a-b), body=hs[Math.floor(hs.length/2)]||0;
  const cand=[]; rows.forEach((r,i)=>{ if(r.cells.length<=2&&txt[i].length<80&&/^\d+(\.\d+)*[.)]?\s+[A-Za-z]/.test(txt[i])) cand.push(i); });
  cand.forEach((i,k)=>{
    const end=k+1<cand.length?cand[k+1]:rows.length, body_=txt.slice(i+1,end).join('\n');
    const big=body&&Math.max(...rows[i].cells.map(c=>c.h))>body*1.1, signal=/\bMethod\b/i.test(body_)||VERBPATH.test(body_);
    if(big||signal) add(i,'',txt[i].replace(/^\d+(\.\d+)*[.)]?\s+/,''));
  });
  return [...byIdx.values()].sort((a,b)=>a.i-b.i);
}

/* "Base URL: https://api.x.com/v1", "base url is api.x.com/v1 (staging: …)" -> https://api.x.com/v1 (first mention wins) */
function impDocBase(text){
  const m=text.match(/Base\s*URL\s*(?:is|:|=)?\s*((?:https?:\/\/)?[\w-]+(?:\.[\w-]+)+(?:\/[^\s|,;)]*)?)/i);
  return m?(/^https?:\/\//i.test(m[1])?m[1]:'https://'+m[1]).replace(/[.,;]+$/,''):'';
}
function impFromSections(rows){
  if(!rows.length) return {ops:[],note:''};
  rows=impDropEdges(rows);
  const heads=impFindHeadings(rows); if(!heads.length) return {ops:[],note:''};
  const allText=rows.map(impRowText).join('\n'), base=impDocBase(allText);
  const ops=[];
  heads.forEach((h,k)=>{
    const end=k+1<heads.length?heads[k+1].i:rows.length, sec=rows.slice(h.i+1,end), headText=impRowText(rows[h.i]);
    const parts={attrs:[]}; let cur='attrs';
    sec.forEach(r=>{ const sub=impSubOf(r); if(sub){ cur=sub; parts[cur]=[]; return; } (parts[cur]=parts[cur]||[]).push(r); });
    const secText=[headText,...sec.map(impRowText)].join('\n');
    // ---- attributes (Method / Endpoint / Full URL …); partial documents: fall back to "Method: X", "POST /path" anywhere in the section
    const attrs={}; impSimpleTable(parts.attrs).recs.forEach(r=>{ if(r[0]) attrs[r[0].toLowerCase().replace(/[:：]\s*$/,'').trim()]=(r[1]||'').trim(); });
    const pick=(...ks)=>{ for(const k of ks) if(attrs[k]) return attrs[k]; return ''; };
    let method=pick('method','http method','verb','request method').toUpperCase().match(IMP_VERB);
    method=method?method[1]:'';
    let path=pick('endpoint','path','resource','uri','api path','endpoint url').replace(/\s+/g,''), full=pick('full url','request url','complete url','url').replace(/\s+/g,'');
    const vpm=secText.match(/\b(GET|POST|PUT|PATCH|DELETE)\b[\s\]\)\[]*(https?:\/\/[^\s|,;)\]]+|\/[^\s|,;)\]]*)/i), vp=vpm?[vpm[0],vpm[1].toUpperCase(),vpm[2]]:null;   // "[POST] /x", "post /x"
    if(!method){ const m=secText.match(/(?:HTTP\s+)?Method\s*[:=]?\s*(GET|POST|PUT|PATCH|DELETE)\b/i); method=m?m[1].toUpperCase():vp?vp[1]:''; }
    if(!path&&!full){ const m=secText.match(/(?:End\s*-?point|URL|URI|Path)\s*[:=]\s*(https?:\/\/[^\s|]+|\/[^\s|]*)/i); if(m) full=m[1]; else if(vp) full=vp[2]; }
    if(/^https?:\/\//i.test(path)&&!full){ full=path; path=''; }
    let url=full||(path&&base?base.replace(/\/+$/,'')+(path.startsWith('/')?'':'/')+path:path);
    if(base&&url.startsWith('/')) url=base.replace(/\/+$/,'')+url;   // a bare path found by "POST /users" inside the section text
    if(!method||!url) return;   // nothing usable in this section
    // ---- request: field table, else an explicit sample request / JSON in the section
    const none=parts.body&&parts.body.length&&/^no\s+(request\s+)?(body|payload)/i.test(impRowText(parts.body[0]));
    let req;
    if(['POST','PUT','PATCH'].includes(method)&&!none){
      // a plain list of fields ("• name - required", "phone - optional", "address.city", "address.pincode (6 digits)"; the bullet glyph is often missing from the text);
      // sentences and notes under the same heading are ignored
      const FL=/^[•·*-]?\s*([A-Za-z_][\w.\[\]]*)(?:\s*[-:–]\s*(.*)|\s*\((.*)\))?$/, NOT=/^(todo|note|notes|response|request|returns?|errors?|eg|e\.g|ex|sample|status|headers?)$/i;
      const fl=(parts.body||[]).map(r=>impRowText(r).match(FL)).filter(m=>m&&!NOT.test(m[1])&&(m[2]||m[3]||m[1].length<=40));
      if(fl.length&&!(parts.body||[]).some(r=>r.cells.length>=3)){
        const o={}; fl.forEach(m=>impSetPath(o,m[1],impSampleFor(m[1],'',m[2]||m[3]||'')));
        if(Object.keys(o).length) req=o;
      }
      if(req===undefined&&parts.body&&parts.body.length>1) req=impFieldsToJson(impSimpleTable(parts.body));
      if(req===undefined&&parts.body) req=impJsonIn(parts.body.map(impRowText).join('\n'));
      if(req===undefined&&parts.sampleReq) req=impJsonIn(parts.sampleReq.map(impRowText).join('\n'));
    }
    // ---- response: sample JSON, else JSON under "Response", else built from the field table
    let res;
    if(parts.sample) res=impJsonIn(parts.sample.map(impRowText).join('\n'));
    if(res===undefined&&parts.resp){ res=impJsonIn(parts.resp.map(impRowText).join('\n')); if(res===undefined&&parts.resp.length>1) res=impFieldsToJson(impSimpleTable(parts.resp)); }
    // ---- one mixed field table (Field | dtype | Mandatory? | Req/Resp | Comments) with no sub-headings: split it by its Req/Resp column
    const hi=sec.findIndex(r=>{ const cs=r.cells.map(c=>c.text.toLowerCase()); return cs.length>=3&&cs.some(c=>/^(field|name|parameter)/.test(c))&&cs.some(c=>/type/.test(c)); });
    let mixed=null;
    if(hi>=0){
      let end=hi+1; while(end<sec.length&&sec[end].cells.length>=2) end++;
      const mt=impSimpleTable(sec.slice(hi,end)), rd=impColIdx(mt.cols,/req.*resp|direction|kind|^in$/), ni=impColIdx(mt.cols,/field|name|parameter/);
      if(rd>=0&&ni>=0){
        const isReq=r=>/^req/i.test(r[rd]||''), isRes=r=>/^resp/i.test(r[rd]||''), reqR=mt.recs.filter(isReq);
        const expand=r=>{ const names=(r[ni]||'').split(/\s*,\s*/).filter(Boolean); if(names.length<2) return [r]; return names.map(n=>{ const src=reqR.find(q=>(q[ni]||'').trim()===n); return src?[...src.slice(0,rd),r[rd],...src.slice(rd+1)]:null; }).filter(Boolean); };   // "name, email, role — same as above"
        const resR=mt.recs.filter(isRes).flatMap(expand);
        mixed={req:{cols:mt.cols,recs:reqR},res:{cols:mt.cols,recs:resR}};
      }
    }
    if(mixed){ if(req===undefined&&['POST','PUT','PATCH'].includes(method)&&!none) req=impFieldsToJson(mixed.req); if(res===undefined) res=impFieldsToJson(mixed.res); }
    // ---- last resort for the response / request: JSON blocks anywhere in the section (one block = response sample, two = request then response)
    const usedReq=req!==undefined?JSON.stringify(req):'', blocks=impLooseBlocks(secText).filter(b=>JSON.stringify(b)!==usedReq);   // the block already used as the request is not also the response
    if(blocks.length){
      if(res===undefined) res=blocks[blocks.length-1];
      if(req===undefined&&['POST','PUT','PATCH'].includes(method)&&!none&&blocks.length>1) req=blocks[0];
    }
    // ---- extras shown in the import table
    const ht=parts.headers?impSimpleTable(parts.headers):{cols:[],recs:[]}, hn=impColIdx(ht.cols,/header|name/), hv=impColIdx(ht.cols,/value|format/), hr=impColIdx(ht.cols,/required/);
    const headers=ht.recs.filter(r=>hn>=0&&r[hn]&&(hr<0||/^y/i.test(r[hr]||''))).map(r=>r[hn]+(hv>=0&&r[hv]?': '+r[hv]:'')).join(', ');
    const st=parts.status?impSimpleTable(parts.status).recs.map(r=>r[0]).find(c=>/^2\d\d$/.test((c||'').trim())):'';
    const auth=pick('authentication','auth','security');
    const detail={headers:impTableRows(ht).map(r=>({name:r.name,value:r.sample,required:r.required})),
      reqFields:parts.body&&!none&&parts.body.length>1?impTableRows(impSimpleTable(parts.body)):[],
      resFields:parts.resp&&parts.resp.length>1?impTableRows(impSimpleTable(parts.resp)):[],
      statusCodes:parts.status?impTableRows(impSimpleTable(parts.status)).map(r=>({code:r.name,meaning:r.description})):[],auth:auth};
    ops.push({method,url,detail,summary:(h.id?h.id+' ':'')+(h.id?h.name:'')+(attrs.description?(h.id?' — ':'')+attrs.description:''),req,res,
      meta:{headers,source:auth?'Auth: '+auth:'',destination:st?'Success: '+st:''}});
  });
  return {ops,note:''};
}

/* ---- combine what the different readers found ----
   structured readers (sections / tables / label|value) add endpoints; the plain-text reader only fills gaps in endpoints that are already known */
const impPathOf=o=>o.url.replace(/^https?:\/\/[^/]+/i,'').split('?')[0].replace(/\{[^}]*\}|:\w+/g,'{}').replace(/\/+$/,'').toLowerCase();
const impSameApi=(a,b)=>{ if(a.method!==b.method) return false; const x=impPathOf(a), y=impPathOf(b); return x===y||(x.length>1&&y.length>1&&(x.endsWith(y)||y.endsWith(x))); };   // "/v1/users" == "/users"
/* a body that is really an Attribute|Value table (Method / Endpoint / URL …) is a mis-read, not a request/response */
const impJunk=v=>v&&typeof v==='object'&&!Array.isArray(v)&&Object.keys(v).some(k=>/^(method|endpoint|full\s*url|url|description|authentication|attribute|value)$/i.test(k));
function impMergeOps(structured,text){
  const out=[];
  const add=(o,canAdd,primary)=>{
    const have=out.find(x=>impSameApi(x,o));
    const clean={...o,req:primary||!impJunk(o.req)?o.req:undefined,res:primary||!impJunk(o.res)?o.res:undefined};
    if(!have){ if(canAdd&&!impJunk(o.req)&&!impJunk(o.res)) out.push({...clean,meta:{...(o.meta||{})}}); return; }
    ['req','res'].forEach(f=>{ if(have[f]===undefined&&clean[f]!==undefined) have[f]=clean[f]; });
    if(!have.summary&&o.summary) have.summary=o.summary;
    if(/^\//.test(have.url)&&/^https?:\/\//i.test(o.url)) have.url=o.url;
    have.meta=have.meta||{}; Object.entries(o.meta||{}).forEach(([f,v])=>{ if(!have.meta[f]&&v) have.meta[f]=v; });
  };
  structured.forEach((l,k)=>l.ops.forEach(o=>add(o,true,k===0)));
  (text||[]).forEach(o=>add(o,out.length===0,false));
  return out;
}
/* what is still missing per endpoint (shown in the import table + verification step) */
function impAddGaps(ops){
  ops.forEach(o=>{
    const g=[];
    if(['POST','PUT','PATCH'].includes(o.method)&&o.req===undefined) g.push('request body');
    if(o.res===undefined) g.push('response sample');
    if(!(o.meta&&o.meta.headers)) g.push('headers');
    o.gaps=g;
  });
  return ops;
}
