'use strict';
// "Υπολογισμοί & μαθηματικά" panel: renders the analytic bundle of a recognised
// converter (studio_math) or an exercise template, as tabs with symbolic
// equations, numeric substitution, M(D) per operating region and G_vd(s).
(function(root){
 const P=root.Parts;
 const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const fmt=(v,d=4)=>Number.isFinite(+v)?Number((+v).toPrecision(d)).toLocaleString('el-GR',{maximumFractionDigits:9}):'—';
 const eng=(v,u='',d=4)=>P.eng(+v,u,d);
 const mm=(m,cls='')=>m&&m.mathml?`<div class="math ${cls}">${m.mathml}</div>`:'';
 const step=s=>`<div class="mstep"><h5>${esc(s.title)}</h5>${s.explanation?`<p>${esc(s.explanation)}</p>`:''}${mm(s.math)}${s.numeric?`<div class="sub-l">αντικατάσταση</div>${mm(s.numeric,'num')}`:''}${s.result?mm(s.result,'res'):''}</div>`;
 const h={esc,fmt,eng,
  steps:list=>(list||[]).map(step).join(''),
  table:(head,rows,wide)=>`<div class="wrap"><table class="mtable${wide?' wide':''}"><thead><tr>${head.map(x=>`<th>${x}</th>`).join('')}</tr></thead><tbody>${rows.map(r=>`<tr>${r.map(c=>`<td>${c}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`,
  kv:pairs=>pairs.map(([k,v])=>`<div><small>${esc(k)}</small><b>${v}</b></div>`).join('')};
 // ---------------------------------------------------------------- charts
 const charts=new Map();let chartId=0;
 const canvas=(spec,cls='')=>{const id='mc'+(++chartId);charts.set(id,spec);return `<div class="mchart ${cls}"><canvas data-mchart="${id}"></canvas></div>`;};
 function nice(span,n){const r=span/Math.max(1,n),p=10**Math.floor(Math.log10(r)),m=r/p;return (m<1.5?1:m<3.5?2:m<7.5?5:10)*p;}
 function draw(cv,s){const box=cv.parentElement.getBoundingClientRect(),dpr=devicePixelRatio||1,W=Math.max(260,box.width),H=s.h||230;cv.width=W*dpr;cv.height=H*dpr;cv.style.width=W+'px';cv.style.height=H+'px';
  const c=cv.getContext('2d');c.setTransform(dpr,0,0,dpr,0,0);c.clearRect(0,0,W,H);const L=56,R=12,T=18,B=30,pw=W-L-R,ph=H-T-B;
  const tx=v=>s.logx?Math.log10(v):v;const xs=s.x.map(tx);let x0=Math.min(...xs),x1=Math.max(...xs);
  let y0=Infinity,y1=-Infinity;for(const se of s.series)for(const v of se.y)if(Number.isFinite(v)){y0=Math.min(y0,v);y1=Math.max(y1,v);}
  if(s.point){y0=Math.min(y0,s.point.y);y1=Math.max(y1,s.point.y);}if(s.ymin!==undefined)y0=s.ymin;if(s.ymax!==undefined)y1=Math.min(y1,s.ymax);if(!(y1>y0)){y1=y0+1;}const pad=(y1-y0)*.06;y0-=s.ymin!==undefined?0:pad;y1+=pad;
  const X=v=>L+(tx(v)-x0)/(x1-x0)*pw,Y=v=>T+ph-(v-y0)/(y1-y0)*ph;
  c.font='10.5px ui-monospace,Menlo,Consolas,monospace';c.strokeStyle='#e6eeea';c.fillStyle='#5d7470';c.lineWidth=1;
  for(const [a,b] of s.shade||[]){c.fillStyle='#c47a1c14';c.fillRect(X(a),T,X(b)-X(a),ph);}c.fillStyle='#5d7470';
  const ys=nice(y1-y0,5);c.textAlign='right';c.textBaseline='middle';for(let v=Math.ceil(y0/ys)*ys;v<=y1;v+=ys){c.beginPath();c.moveTo(L,Y(v));c.lineTo(W-R,Y(v));c.stroke();c.fillText(fmt(Math.abs(v)<ys*1e-6?0:v,3),L-5,Y(v));}
  c.textAlign='center';c.textBaseline='top';
  if(s.logx){for(let e=Math.ceil(x0);e<=Math.floor(x1);e++){const x=L+(e-x0)/(x1-x0)*pw;c.beginPath();c.moveTo(x,T);c.lineTo(x,T+ph);c.stroke();c.fillText(eng(10**e,'',2).trim(),x,T+ph+5);}}
  else{const xs2=nice(x1-x0,6);for(let v=Math.ceil(x0/xs2)*xs2;v<=x1+1e-12;v+=xs2){c.beginPath();c.moveTo(X(v),T);c.lineTo(X(v),T+ph);c.stroke();c.fillText(fmt(v,3),X(v),T+ph+5);}}
  c.strokeStyle='#c9d6d1';c.strokeRect(L+.5,T+.5,pw-1,ph-1);
  for(const se of s.series){c.strokeStyle=se.color;c.lineWidth=se.width||1.8;c.setLineDash(se.dash||[]);c.beginPath();let on=false;se.y.forEach((v,i)=>{if(!Number.isFinite(v)){on=false;return;}const x=X(s.x[i]),y=Y(Math.min(Math.max(v,y0),y1));on?c.lineTo(x,y):c.moveTo(x,y);on=true;});c.stroke();c.setLineDash([]);}
  if(s.point){c.fillStyle='#b03a5b';c.beginPath();c.arc(X(s.point.x),Y(s.point.y),4.5,0,7);c.fill();c.textAlign='left';c.textBaseline='bottom';c.fillText(s.point.label||'',X(s.point.x)+7,Y(s.point.y)-3);}
  c.fillStyle='#5d7470';c.textAlign='right';c.textBaseline='top';c.fillText(s.xlab||'',W-R,T+ph+17);c.textAlign='left';c.textBaseline='bottom';c.fillText(s.ylab||'',4,T-1);
  const named=s.series.filter(se=>se.name);let lx=W-R-8-named.reduce((a,se)=>a+c.measureText(se.name).width+30,0);c.textBaseline='top';for(const se of named){c.fillStyle=se.color;c.fillRect(lx,T+12,12,3);c.fillStyle='#41575a';c.fillText(se.name,lx+16,T+7);lx+=c.measureText(se.name).width+30;}}
 function drawAll(el){for(const cv of el.querySelectorAll('[data-mchart]')){const s=charts.get(cv.dataset.mchart);if(s)draw(cv,s);}}
 // ---------------------------------------------------------------- tabs
 function tabs(el,list,key,state){const cur=list.some(t=>t.id===state[key])?state[key]:list[0].id;
  el.innerHTML=`<nav class="mtabs">${list.map(t=>`<button data-mtab="${t.id}" class="${t.id===cur?'on':''}">${esc(t.title)}</button>`).join('')}</nav><div class="mbody"></div>`;
  const body=el.querySelector('.mbody');const show=id=>{state[key]=id;charts.clear();const t=list.find(x=>x.id===id);body.innerHTML=t.html();el.querySelectorAll('[data-mtab]').forEach(b=>b.classList.toggle('on',b.dataset.mtab===id));requestAnimationFrame(()=>drawAll(body));t.after?.(body);};
  el.querySelectorAll('[data-mtab]').forEach(b=>b.onclick=()=>show(b.dataset.mtab));show(cur);}
 const state={};
 // ---------------------------------------------------------------- recognised converter
 const NAMES={buck:'Buck',boost:'Boost',buck_boost:'Αντιστρέφων buck–boost',flyback:'Flyback'};
 function renderConverter(el,B,roles,notes){
  const st=B.steady,m=st.metrics,cfg=st.config,topo=B.recognized.topology,neg=topo==='buck_boost',vo=cfg.vo*(neg?-1:1);
  const cur=B.curves&&!B.curves.error?B.curves:null,lin=B.linearize&&!B.linearize.error?B.linearize:null,der=B.derivation&&!B.derivation.error?B.derivation:null,pr=B.proof&&!B.proof.error?B.proof:null;
  const badge=`<span class="badge ${st.mode.toLowerCase()}">${esc(st.mode)}</span>`;
  const head=`<div class="mhead">${badge}<b>${esc(NAMES[topo]||topo)}</b> · αναγνωρίστηκε από τη συνδεσμολογία · D = ${fmt(m.duty,4)} · V_o = ${eng(vo,'V')} · I_o = ${eng(m.Iout,'A')} · L / L_crit = ${fmt(m.L_margin,3)}</div>`;
  const list=[
   {id:'model',title:'Κύκλωμα → μοντέλο',html:()=>head+h.table(['Ρόλος','Στοιχείο','Τιμή'],roles.map(r=>[r.role,esc(r.label),r.value]))+
    `<h4>Παραδοχές</h4><ul class="eqs">${st.assumptions.map(a=>`<li>${esc(a)}</li>`).join('')}${notes.map(a=>`<li class="warn-text">${esc(a)}</li>`).join('')}</ul><p class="muted small">${esc(B.recognized.scope||'')}</p>`},
   {id:'region',title:'Περιοχή λειτουργίας & M(D)',html:()=>{
     let chart='';if(cur){const pts=cur.points.filter(p=>p.valid!==false);const sh=[];let s0=null;pts.forEach((p,i)=>{const d=p.mode==='DCM';if(d&&s0===null)s0=p.duty;if((!d||i===pts.length-1)&&s0!==null){sh.push([s0,p.duty]);s0=null;}});
      chart=canvas({x:pts.map(p=>p.duty),series:[{name:'CCM: M(D)',y:pts.map(p=>Math.abs(p.gain_ccm_reference)),color:'#2f5fa0',dash:[5,4]},{name:'με το τρέχον L, R (CCM/DCM)',y:pts.map(p=>Math.abs(p.gain)),color:'#147966',width:2.4}],
       point:{x:m.duty,y:Math.abs(vo)/cfg.vin,label:'σημείο λειτουργίας'},shade:sh,xlab:'D',ylab:'|V_o| / V_in',ymin:0,ymax:Math.max(4,Math.abs(vo)/cfg.vin*1.6)});}
     const rg=B.region;return head+`<div class="kv">${h.kv(rg?[['Περιοχή',rg.mode],['K = 2Lf_s/R',fmt(rg.K,4)],['K_crit(D)',fmt(rg.Kcrit,4)],['L / L_crit(D)',eng(cfg.L,'H')+' / '+eng(rg.Lcrit,'H')],['M_CCM / M_DCM',fmt(rg.M_ccm,4)+' / '+fmt(rg.M_dcm,4)],['M = |V_o|/V_in',fmt(rg.M,5)]]:[['Περιοχή',st.mode]])}</div>`+
      (cur?`<div class="mgrid"><div><h4>CCM${st.mode==='CCM'?' · ισχύει τώρα':''}</h4>${mm(cur.gain_ccm)}</div><div><h4>DCM (ωμικό φορτίο)${st.mode==='DCM'?' · ισχύει τώρα':''}</h4>${mm(cur.gain_dcm_resistive)}</div><div><h4>Όριο BCM</h4>${mm(cur.boundary_equation)}</div></div>`+(rg?`<h4>Αντικατάσταση με τις τιμές του κυκλώματος</h4>`+h.steps(rg.steps):'')+chart+`<p class="muted small">Σκιασμένη περιοχή: DCM για τα τρέχοντα L, R, f_s. ${esc(cur.scope||'')}</p>`:'')+
      `<h4>Ανάπτυξη σημείου λειτουργίας</h4>`+h.steps(st.steps);}},
   {id:'ripple',title:'Κυμάτωση τάσης & ρεύματος',html:()=>`<div class="kv">${h.kv([['Δi_L p-p',eng(m.Iripple_pp,'A')],['i_L min / max',eng(m.Ivalley,'A')+' / '+eng(m.Ipeak,'A')],['ΔV_o p-p',eng(m.Vripple_pp,'V')],['Φορτίο ΔQ',eng(m.charge_pp,'C')],['I_C rms',eng(m.ICrms,'A')]])}</div>`+(der?h.steps(der.ripple_steps):'')},
   {id:'currents',title:'Ρεύματα, RMS & καταπονήσεις',html:()=>`<div class="kv">${h.kv([['⟨i_L⟩',eng(m.ILmean,'A')],['I_L rms',eng(m.ILrms,'A')],['I_S rms',eng(m.ISrms,'A')],['I_D rms / μέση',eng(m.IDrms,'A')+' / '+eng(m.IDmean,'A')],['I_in',eng(m.Iin,'A')],['V διακόπτη / V_R διόδου',eng(m.Vswitch,'V')+' / '+eng(m.Vdiode_reverse,'V')]])}</div>`+(der?h.steps(der.current_steps):'')},
   {id:'tf',title:'Συνάρτηση μεταφοράς G_vd(s)',html:()=>{if(!lin)return `<p class="muted">${esc(B.linearize?.error||'Δεν είναι διαθέσιμη.')}</p>`;
     const pl=(lin.poles||[]).map(p=>p.imag?`${fmt(p.real,4)} ${p.imag<0?'−':'+'} j${fmt(Math.abs(p.imag),4)}`:fmt(p.real,4)).join(', ');
     const w0=lin.poles?.length===2?Math.sqrt(lin.poles[0].real**2+lin.poles[0].imag**2):NaN,zeta=Number.isFinite(w0)&&w0>0?-lin.poles[0].real/w0:NaN;
     const bd=lin.bode;const b=bd?canvas({x:bd.frequency,series:[{name:'|G_vd| (dB)',y:bd.magnitude_db,color:'#147966',width:2}],logx:true,xlab:'f (Hz)',ylab:'dB',h:200})+canvas({x:bd.frequency,series:[{name:'∠G_vd (°)',y:bd.phase_deg,color:'#c47a1c',width:2}],logx:true,xlab:'f (Hz)',ylab:'°',h:170}):'';
     return `<div class="mhead">${badge} μέσο μοντέλο ${esc(lin.mode)} · ${esc(lin.scope||'')}</div><div class="mgrid"><div><h4>Πίνακας A</h4>${mm(lin.A)}</div><div><h4>B_d</h4>${mm(lin.Bd)}</div></div><h4>G_vd(s) = ṽ_o / d̃</h4>${mm(lin.Gvd)}<h4>Με τις τιμές του κυκλώματος</h4>${mm(lin.Gvd_numeric,'num')}<h4>G_vg(s) = ṽ_o / ṽ_in</h4>${mm(lin.Gvg)}
      <div class="kv">${h.kv([['Πόλοι (rad/s)',pl||'—'],['Μηδενικά',(lin.zeros||[]).length?(lin.zeros||[]).map(z=>fmt(z.real??z,4)).join(', '):'—'],['ω₀ / f₀',Number.isFinite(w0)?fmt(w0,4)+' rad/s / '+eng(w0/2/Math.PI,'Hz'):'—'],['ζ',fmt(zeta,3)],['Ευστάθεια',lin.stable?'ευσταθές':'ασταθές']])}</div>`+b;}},
   {id:'proof',title:'Απόδειξη μοντέλου',html:()=>pr?`<p class="muted">${esc(pr.method||'')}</p>`+h.steps(pr.steps)+(pr.transfer?.Gvd?`<h4>Αποτέλεσμα</h4>${mm(pr.transfer.Gvd)}`:''):`<p class="muted">${esc(B.proof?.error||'—')}</p>`}];
  tabs(el,list,'v1:'+topo,state);}
 // ---------------------------------------------------------------- exercise template
 function renderExercise(el,tpl,r,ctx){
  const list=tpl.sections.map(s=>({id:s.id,title:s.title,html:()=>`<div class="mhead"><b>${esc(tpl.title)}</b> · θέση: ${ctx.meta.above?'αποθήκευση πάνω από τον ζυγό':'αποθήκευση κάτω από τον ζυγό'} · παράθυρο ${r.config.vst_min}–${r.config.vst_max} V</div>`+s.html(r,ctx,h)+(s.id==='q2'?`<h4>Παραδοχές</h4><ul class="eqs">${r.assumptions.map(a=>`<li>${esc(a)}</li>`).join('')}</ul>`:''),
   after:body=>{
    body.querySelector('[data-ex-test]')?.addEventListener('change',e=>{ctx.test=r.q5.tests.find(t=>t.id===e.target.value);renderExercise(el,tpl,r,ctx);});
    body.querySelectorAll('[data-ex-load]').forEach(b=>b.onclick=()=>ctx.onLoad(r.q5.tests.find(t=>t.id===b.dataset.exLoad)));
    body.querySelector('[data-ex-copy]')?.addEventListener('click',async e=>{try{await navigator.clipboard.writeText(body.querySelector('[data-ex-script]').textContent);e.target.textContent='✓ Αντιγράφηκε';}catch{e.target.textContent='Επίλεξε και αντέγραψε';}});}}));
  tabs(el,list,'ex:'+tpl.id,state);}
 root.MathPanel={renderConverter,renderExercise,helpers:h,redraw:el=>drawAll(el)};
})(window);
