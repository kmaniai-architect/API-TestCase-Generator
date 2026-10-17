/* ---------- helpers ---------- */
const esc = s => String(s).replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
const clone = o => JSON.parse(JSON.stringify(o));
const pretty = v => typeof v==='string'?v:JSON.stringify(v,null,2);
const typeOf = v => v===null?'null':Array.isArray(v)?'array':typeof v;
function leaves(obj,path=[]){
  const out=[];
  if(obj&&typeof obj==='object'&&!Array.isArray(obj))
    for(const k of Object.keys(obj)){ const v=obj[k];
      if(v&&typeof v==='object'&&!Array.isArray(v)) out.push(...leaves(v,[...path,k])); else out.push({path:[...path,k],value:v}); }
  return out;
}
function getAt(o,path){ return path.reduce((c,k)=>c==null?undefined:c[k],o); }
function setAt(obj,path,val,del=false){
  const o=clone(obj); let c=o;
  for(let i=0;i<path.length-1;i++) c=c[path[i]];
  const last=path[path.length-1]; if(del) delete c[last]; else c[last]=val; return o;
}
const wrongValue = v => ({string:12345,number:"abc",boolean:"yes",array:"not-an-array"}[typeOf(v)] ?? {});
function toast(t){ const el=$('toast'); el.textContent=t; el.classList.add('show'); clearTimeout(el._t); el._t=setTimeout(()=>el.classList.remove('show'),2200); }
