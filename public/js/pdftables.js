/* ---------- PDF tables: rebuild rows/columns from text positions, then read
   (1) an operations table  — Endpoint | Method | Header | Source | Destination | Operation …
   (2) request-parameter tables and response tables — Name | Type | Required | Sample/Example | Description …
   Column positions come from each table's header row, so empty cells and wrapped text are handled. ---------- */

/* pdf.js text items -> rows of cells: [{page,y,cells:[{x,text}]}] */
async function impPdfRows(pdf,maxPages=200){
  const out=[];
  for(let p=1;p<=Math.min(pdf.numPages,maxPages);p++){
    const items=(await (await pdf.getPage(p)).getTextContent()).items
      .filter(i=>i.str&&i.str.trim()).map(i=>({s:i.str,x:i.transform[4],y:i.transform[5],w:i.width||0,h:i.height||0}))
      .sort((a,b)=>b.y-a.y||a.x-b.x);
    const rows=[];
    for(const it of items){
      const r=rows.find(r=>Math.abs(r.y-it.y)<=3);
      if(r) r.items.push(it); else rows.push({y:it.y,items:[it]});
    }
    rows.sort((a,b)=>b.y-a.y).forEach(r=>{
      r.items.sort((a,b)=>a.x-b.x);
      const cells=[];
      for(const it of r.items){
        const c=cells[cells.length-1];
        if(c&&it.x-c.x2<1.5){   // only glue text runs that touch; neighbouring columns can sit just a few points apart
         c.text+=(it.x-c.x2>1?' ':'')+it.s; c.x2=it.x+it.w; c.h=Math.max(c.h,it.h); c.parts.push({x:it.x,x2:it.x+it.w,text:it.s,h:it.h}); }
        else cells.push({x:it.x,x2:it.x+it.w,text:it.s,h:it.h,parts:[{x:it.x,x2:it.x+it.w,text:it.s,h:it.h}]});
      }
      out.push({page:p,y:r.y,cells});
    });
  }
  return out;
}

/* ---- header recognition ---- */
const IMP_ROLES=[
  ['endpoint',/end\s*-?point|url|uri|path|resource/i],['method',/^\s*(http\s*)?(method|verb)/i],['header',/header/i],
  ['source',/source|consumer|caller/i],['destination',/destination|target|provider/i],['operation',/operation|action|service|api\s*name/i],
  ['sample',/sample|example|value|data/i],['type',/type/i],['required',/required|mandatory|optional/i],
  ['index',/^\s*(s\.?\s*no\.?|sl\.?\s*no\.?|sr\.?\s*no\.?|no\.?|#|serial)\s*$/i],
  ['name',/^(request\s*|response\s*)?(parameter|param|field|attribute|property|element|key|name)/i],['description',/desc|remark|note|detail/i],
];
const impRole=t=>{ const r=IMP_ROLES.find(([,re])=>re.test(t)); return r?r[0]:''; };

/* a header can wrap over several physical lines ("Destination" / "Operation"): take the run of consecutive label-only rows */
const impLabelLike=c=>/^[A-Za-z][A-Za-z .\/&()-]{0,28}$/.test(c.text.trim())&&!/^(GET|POST|PUT|PATCH|DELETE)$/i.test(c.text.trim());
function impHeaderRuns(rows,i){   // candidate headers: the row alone, +1 line, +2 lines (centred headers wrap over several lines)
  const first=rows[i]; if(!first||!first.cells.length) return [];
  const roles=first.cells.map(c=>impRole(c.text)).filter(Boolean);
  // the top line may also carry unlabelled columns ("S.No", "Remarks" …) as long as most cells are recognised headings
  if(!(roles.length===first.cells.length||(new Set(roles).size>=2&&roles.length>=first.cells.length*0.5))) return [];
  const out=[[first]];
  for(let j=i+1;j<rows.length&&out.length<3;j++){
    const r=rows[j], prev=out[out.length-1][out[out.length-1].length-1];
    if(!r.cells.length||r.page!==prev.page||prev.y-r.y>16||!r.cells.every(c=>impRole(c.text)||impLabelLike(c))) break;
    out.push(out[out.length-1].concat(r));
  }
  return out;
}
function impMergeHeader(run){
  const flat=[]; run.forEach(r=>r.cells.forEach(c=>(c.parts||[c]).forEach(p=>flat.push({...p,y:r.y,cx:(p.x+p.x2)/2}))));
  flat.sort((a,b)=>a.cx-b.cx);
  const cols=[];
  for(const c of flat.sort((a,b)=>a.x-b.x||b.y-a.y)){
    const g=cols.find(k=>Math.abs(k.cx-c.cx)<18||(Math.min(k.x2,c.x2)-Math.max(k.x,c.x))>0.4*Math.min(k.x2-k.x,c.x2-c.x));
    if(g){ g.parts.push(c); g.x=Math.min(g.x,c.x); g.x2=Math.max(g.x2,c.x2); g.cx=(g.x+g.x2)/2; }
    else cols.push({parts:[c],x:c.x,x2:c.x2,cx:c.cx,h:c.h});
  }
  return cols.sort((a,b)=>a.cx-b.cx).map(k=>({x:k.x,x2:k.x2,cx:k.cx,h:k.h,text:k.parts.sort((a,b)=>b.y-a.y).map(p=>p.text).join(' ')}));
}
function impHeaderInfo(cells){
  const roles=cells.map(c=>impRole(c.text)), known=roles.filter(Boolean), set=new Set(known);
  if(known.length<2||set.size<known.length) return null;
  const kind=set.has('endpoint')&&set.has('method')?'ops':set.has('name')&&(set.has('sample')||set.has('type')||set.has('description'))?'params':'';
  return kind?{kind,roles}:null;
}

/* column boundaries: left edges of the data cells (data is left-aligned even when headers are centred), each header goes to the one containing its centre */
function impColumns(hdr,roles,dataRows){
  const xs=[]; dataRows.forEach(r=>r.cells.forEach(c=>xs.push(c.x))); xs.sort((a,b)=>a-b);
  const starts=[]; xs.forEach(x=>{ if(!starts.length||x-starts[starts.length-1].last>6) starts.push({x,last:x}); else starts[starts.length-1].last=x; });
  let B=starts.map(s=>s.x); if(!B.length) B=[hdr[0].x];
  const idxOf=cx=>{ let k=0; B.forEach((b,i)=>{ if(b<=cx) k=i; }); return k; };
  const groups={}; hdr.forEach((h,i)=>(groups[idxOf(h.cx)]=groups[idxOf(h.cx)]||[]).push(i));
  Object.values(groups).forEach(g=>{ for(let k=1;k<g.length;k++) B.push((hdr[g[k-1]].cx+hdr[g[k]].cx)/2); });   // several headers inside one data column -> split between them
  B=[...new Set(B)].sort((a,b)=>a-b);
  const owner=B.map(()=>-1); hdr.forEach((h,i)=>{ let k=0; B.forEach((b,j)=>{ if(b<=h.cx) k=j; }); owner[k]=i; });
  let last=-1; const own=owner.map(o=>(o>=0?(last=o):last));   // data-only boundaries belong to the header on their left
  return x=>{ let k=-1; B.forEach((b,j)=>{ if(b<=x+4) k=j; }); return k<0?-1:own[k]; };
}

/* ---- walk the rows, collecting tables + the heading text that precedes each ---- */
function impReadTables(rows){
  const tables=[]; let ctx=[], i=0;
  while(i<rows.length){
    let hit=null, best=0;
    for(const run of impHeaderRuns(rows,i)){   // a wrapped header may span 2-3 lines: keep the reading that recognises the most column roles (ties -> the shorter header)
      const hdr=impMergeHeader(run), info=impHeaderInfo(hdr); if(!info) continue;
      // score: distinct roles found, then how many of the lines are pure heading lines (every cell a known heading)
      const score=new Set(info.roles.filter(Boolean)).size*10+run.filter(r=>r.cells.every(c=>impRole(c.text))).length, h=score>best?impReadOne(rows,i,run,hdr,info,ctx):null;
      if(h){ hit=h; best=score; }
    }
    if(hit){ tables.push(hit.tbl); ctx=[]; i=hit.next; continue; }
    if(rows[i].cells.length) ctx.push(rows[i].cells.map(c=>c.text).join(' '));
    i++;
  }
  return tables;
}
function impReadOne(rows,i,run,hdr,info,ctx){
  const labels=hdr.map(h=>h.text.toLowerCase()).join('|');
  const hRef=hdr.map(h=>h.h).sort((a,b)=>a-b)[Math.floor(hdr.length/2)]||0;
  // region = rows below the header until a gap, a bigger-font heading, or the next table header
  const region=[]; let j=i+run.length, prev=run[run.length-1];
  for(;j<rows.length;j++){
    const r=rows[j], rh=Math.max(...r.cells.map(c=>c.h),0);
    const nextRuns=impHeaderRuns(rows,j), nextRun=nextRuns[nextRuns.length-1]||[], nh=nextRun.length?impMergeHeader(nextRun):null, nextHdr=nh&&impHeaderInfo(nh);
    if(nextHdr){ if(nh.map(h=>h.text.toLowerCase()).join('|')===labels){ j+=nextRun.length-1; prev=nextRun[nextRun.length-1]; continue; } break; }   // header repeated on a new page / a different table
    if(r.page===prev.page&&prev.y-r.y>45) break;
    if(hRef&&rh>hRef*1.08) break;
    if(r.cells.length===1&&/^\s*(\d+(\.\d+)*[.)]?\s|api\s*#?\d|request|response|table\b|section\b)/i.test(r.cells[0].text)&&r.cells[0].x<=hdr[0].x+4+(hdr[0].cx-hdr[0].x)) break;
    region.push(r); prev=r;
  }
  const colOf=impColumns(hdr,info.roles,region), tbl={kind:info.kind,heading:ctx.slice(-3).join(' '),rec:[]};
  const roleAt=k=>info.roles[k]||'';
  // cells are often vertically centred, so a record's wrapped lines can sit ABOVE its anchor row (the one with the method / name):
  // every other row joins the nearest anchor row on its page
  const parsed=region.map(r=>{
    const byRole={}; r.cells.forEach(c=>{ const role=roleAt(colOf(c.x)); if(role) byRole[role]=(byRole[role]?byRole[role]+(role==='endpoint'?'':' '):'')+c.text; });
    const start=tbl.kind==='ops'?/^(GET|POST|PUT|PATCH|DELETE)$/i.test((byRole.method||'').trim()):!!(byRole.name||'').trim();
    return {r,byRole,start};
  });
  const anchors=parsed.filter(p=>p.start);
  if(!anchors.length) return null;
  const groups=anchors.map(a=>[a]);
  parsed.filter(p=>!p.start).forEach(p=>{
    const same=anchors.filter(a=>a.r.page===p.r.page), pool=same.length?same:anchors;
    const best=pool.reduce((m,a)=>Math.abs(a.r.y-p.r.y)<Math.abs(m.r.y-p.r.y)?a:m,pool[0]);
    groups[anchors.indexOf(best)].push(p);
  });
  groups.forEach(g=>{
    const rec={};
    g.sort((x,y)=>x.r.page-y.r.page||y.r.y-x.r.y).forEach(p=>Object.entries(p.byRole).forEach(([role,t])=>{
      rec[role]=(rec[role]?rec[role]+(role==='endpoint'?'':' '):'')+t;
    }));
    tbl.rec.push(rec);
  });
  return {tbl,next:j};
}

/* ---- parameter rows -> a JSON example ---- */
function impCoerce(raw,type){
  const v=String(raw||'').trim();
  if(v){
    try{ return JSON.parse(v); }catch{}
    const q=v.match(/^['"“‘](.*)['"”’]$/s); if(q) return q[1];
    return v;
  }
  const t=String(type||'').toLowerCase();
  return /int|long|number|numeric/.test(t)?1:/float|double|decimal/.test(t)?1.5:/bool/.test(t)?true:/array|list/.test(t)?[]:/object|map/.test(t)?{}:/date|time/.test(t)?'2026-01-01T00:00:00Z':'string';
}
function impSetPath(obj,path,val){
  const toks=[...path.matchAll(/([^.\[\]]+)|\[(\d*)\]/g)].map(m=>m[1]!==undefined?m[1]:Number(m[2]||0)); if(!toks.length) return;
  let cur=obj;
  toks.forEach((k,i)=>{
    const last=i===toks.length-1, nextIsIdx=typeof toks[i+1]==='number';
    if(last){ cur[k]=val; return; }
    if(cur[k]===undefined||typeof cur[k]!=='object') cur[k]=nextIsIdx?[]:{};
    cur=cur[k];
  });
}
function impParamsToJson(tbl){
  const obj={};
  tbl.rec.forEach(r=>{
    const name=(r.name||'').replace(/^(request|response|body)\./i,'').replace(/\s+/g,''); if(!name) return;
    impSetPath(obj,name,impCoerce(r.sample,r.type));
  });
  return Object.keys(obj).length?obj:undefined;
}

/* ---- tables -> operations ---- */
/* vertical layout: one small table per API, label in the first column and its value beside it
     Endpoint | https://…      Method | POST      Header | …      Source | …      Destination Operation | …      Request | {…}      Response | {…} */
function impFromKeyValue(rows){
  const KV=/^(end\s*-?point(\s*url)?|url|uri|(http\s*)?method|verb|headers?|source|destination(\s*(operation|service))?|operation|request(\s*(body|data|payload|sample))?|response(\s*(body|data|payload|sample))?)$/i;
  const keyOf=l=>{ l=l.toLowerCase(); return /end|url|uri/.test(l)?'endpoint':/method|verb/.test(l)?'method':/header/.test(l)?'header':/source/.test(l)?'source':/destination/.test(l)?'destination':/operation/.test(l)?'operation':/request/.test(l)?'request':'response'; };
  const clean=t=>t.replace(/[:\uff1a]\s*$/,'').trim();
  // the value column starts where the first "label | value" row puts its second cell
  let valX=null;
  for(const r of rows){ if(r.cells.length>=2&&KV.test(clean(r.cells[0].text))){ valX=r.cells[1].x; break; } }
  if(valX===null) return [];
  const entries=[]; let active=null;
  for(const r of rows){
    const left=r.cells.filter(c=>c.x<valX-4), right=r.cells.filter(c=>c.x>=valX-4), lt=clean(left.map(c=>c.text).join(' '));
    if(left.length){
      const wrapped=active&&!right.length&&r.page===active.page&&active.yEnd-r.y<=16&&KV.test(clean(active.label+' '+lt));   // label wrapped over two lines ("Destination" / "Operation")
      if(wrapped){ active.label=clean(active.label+' '+lt); active.yEnd=r.y; continue; }
      active=KV.test(lt)?{label:lt,page:r.page,yEnd:r.y,vals:[]}:null;   // other text ends the block
      if(active) entries.push(active);
    }
    if(right.length&&active&&r.page===active.page&&active.yEnd-r.y<=40){ active.vals.push({y:r.y,text:right.map(c=>c.text).join(' ')}); active.yEnd=Math.min(active.yEnd,r.y); }
  }
  const ops=[]; let cur=null;
  for(const e of entries){
    const key=keyOf(e.label);
    if(!cur||key in cur){ cur={}; ops.push(cur); }   // a repeated label starts the next API
    cur[key]=e.vals.sort((x,y)=>y.y-x.y).map(v=>v.text).join(key==='endpoint'?'':' ').trim();
  }
  const json=t=>{ if(!t) return undefined; const b=impBalanced(t); return b?impParseLoose(b):undefined; };
  return ops.filter(o=>o.endpoint&&/^(GET|POST|PUT|PATCH|DELETE)$/i.test((o.method||'').trim())).map(o=>({
    method:o.method.trim().toUpperCase(),url:o.endpoint.replace(/\s+/g,''),summary:o.operation||o.destination||'',req:json(o.request),res:json(o.response),
    meta:{headers:o.header||'',source:o.source||'',destination:o.destination||''}}));
}

function impFromTables(rows){
  const tables=impReadTables(rows); let ops=[];
  tables.filter(t=>t.kind==='ops').forEach(t=>t.rec.forEach(r=>{
    const url=(r.endpoint||'').replace(/\s+/g,''); if(!url||!r.method) return;
    ops.push({method:r.method.toUpperCase(),url,summary:r.operation||r.destination||'',req:undefined,res:undefined,
      meta:{headers:r.header||'',source:r.source||'',destination:r.destination||''}});
  }));
  if(!ops.length) ops=impFromKeyValue(rows);
  if(!ops.length) return {ops:[],note:''};
  const hasBody=o=>['POST','PUT','PATCH'].includes(o.method);
  let unk=0, matched=0, guessed=0;
  const find=(heading)=>{
    const h=heading.toLowerCase(), n=h.match(/\bapi\s*#?\s*(\d+)/);
    if(n&&ops[+n[1]-1]) return ops[+n[1]-1];
    return ops.find(o=>{ const seg=o.url.split('?')[0].split('/').filter(Boolean).pop(); return (seg&&h.includes(seg.toLowerCase()))||(o.summary&&h.includes(o.summary.toLowerCase())); });
  };
  tables.filter(t=>t.kind==='params').forEach(t=>{
    const json=impParamsToJson(t); if(json===undefined) return;
    const h=t.heading||'', isRes=/response|output|returns?/i.test(h), isReq=/request|input|payload|body|param/i.test(h)&&!isRes;
    const kind=isRes?'res':isReq?'req':(unk++%2===0?'req':'res');
    let op=find(h); if(op){ matched++; }
    else { op=ops.find(o=>o[kind]===undefined&&(kind==='res'||hasBody(o)))||ops.find(o=>o[kind]===undefined); guessed++; }   // otherwise: in document order
    if(op&&op[kind]===undefined) op[kind]=json;
  });
  const note=guessed?` ${guessed} parameter/response table${guessed>1?'s were':' was'} matched to endpoints by order — please check.`:'';
  return {ops,note};
}

/* request/response samples given as plain JSON blocks (not in a table): fill whatever is still missing, in document order,
   but only when the number of blocks matches the number of gaps exactly (otherwise a wrong guess is worse than none) */
function impFillFromJsonBlocks(ops,rows){
  const slots=[]; ops.forEach(o=>{ if(['POST','PUT','PATCH'].includes(o.method)&&o.req===undefined) slots.push([o,'req']); if(o.res===undefined) slots.push([o,'res']); });
  if(!slots.length) return '';
  const blocks=impJsonBlocks(rows.map(r=>r.cells.map(c=>c.text).join(' ')).join('\n')).blocks;
  if(!blocks.length||blocks.length!==slots.length) return '';
  slots.forEach(([o,k],i)=>{ o[k]=blocks[i].val; });
  return ` ${blocks.length} JSON sample${blocks.length>1?'s were':' was'} matched to endpoints by order — please check.`;
}
