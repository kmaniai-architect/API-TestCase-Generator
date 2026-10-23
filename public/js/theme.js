/* ---------- theme toggle (light / dark) + button ripple ---------- */
(function(){
  const root=document.documentElement, btn=document.getElementById('themeBtn');
  const stored=()=>{ try{ const t=localStorage.getItem('theme'); return t==='light'||t==='dark'?t:null; }catch{ return null; } };
  function apply(t,animate){
    if(animate){ root.classList.add('theme-anim'); setTimeout(()=>root.classList.remove('theme-anim'),500); }
    root.dataset.theme=t; btn.setAttribute('aria-checked',t==='dark'); btn.title=t==='dark'?'Switch to light mode':'Switch to dark mode';
  }
  apply(root.dataset.theme==='dark'?'dark':'light',false);
  btn.onclick=()=>{ const t=root.dataset.theme==='dark'?'light':'dark'; apply(t,true); try{ localStorage.setItem('theme',t); }catch{} };
  matchMedia('(prefers-color-scheme:dark)').addEventListener('change',e=>{ if(!stored()) apply(e.matches?'dark':'light',true); });   // follow the OS until the user picks

  document.addEventListener('pointerdown',e=>{
    const el=e.target.closest('.btn,.tab,.cat,.newbtn'); if(!el||el.disabled) return;
    const r=el.getBoundingClientRect(), d=Math.max(r.width,r.height)*2, s=document.createElement('span');
    s.className='ripple'; s.style.cssText=`width:${d}px;height:${d}px;left:${e.clientX-r.left-d/2}px;top:${e.clientY-r.top-d/2}px`;
    el.appendChild(s); setTimeout(()=>s.remove(),600);
  });
})();
